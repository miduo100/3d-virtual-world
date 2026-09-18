/**
 * uploadMetaDialog.js — 上传成功后弹出「名称 / 标签 / 🤖AI 描述」补充对话框
 *
 * 黑名单合规：不修改 world_editor.html 内联逻辑，全部通过包装 window.fetch 实现：
 *   1) POST /api/upload-model（单个）成功 → 弹 1 行编辑框
 *      POST /api/upload-models-batch（批量）成功 → 弹 N 行编辑框
 *      字段：名称（PUT /:id/display-name）、标签（PUT /:id/tags）、🤖AI 描述（PUT /:id/agent-description）
 *   2) POST /api/world/objects（放置模型到世界）→ 按 model_path 匹配已上传模型，
 *      自动把 uploaded_models.description 注入 world_objects.agent_description
 *      （AI 通过 observe 读到；放置图片/视频等无库内描述的类型则不注入，可在属性面板补填）
 * 依赖 world_editor.html 全局：uploadedModels（模型列表缓存，SELECT * 含 description）、
 *   showNotification、refreshUploadedModels（均为可选依赖，缺失时降级）
 */
(function () {
    'use strict';

    var MAX_DESC = 500;
    var _origFetch = window.fetch.bind(window);

    function authHeaders(extra) {
        var h = { 'Content-Type': 'application/json' };
        if (typeof window.__editorAuthHeaders === 'function') {
            h = window.__editorAuthHeaders();
        }
        if (extra) Object.assign(h, extra);
        return h;
    }

    // ==================== 对话框 UI ====================

    function buildRow(model, idx) {
        var displayName = model.display_name || model.file_name || model.fileName || ('模型 ' + (idx + 1));
        var wrap = document.createElement('div');
        wrap.style.cssText = 'border:1px solid var(--border);border-radius:6px;padding:10px;margin-bottom:10px;background:rgba(0,0,0,0.2);';
        wrap.innerHTML =
            '<div style="font-size:11px;color:#8b949e;margin-bottom:6px;">📦 ' + escapeHtml(String(model.file_name || displayName)) + '</div>' +
            '<div style="margin-bottom:6px;"><label style="font-size:11px;color:#8b949e;">名称</label>' +
            '<input class="umd-name" type="text" value="' + escapeHtml(displayName) + '"' +
            ' style="width:100%;padding:5px 8px;border:1px solid var(--border);border-radius:4px;font-size:12px;box-sizing:border-box;"></div>' +
            '<div style="margin-bottom:6px;"><label style="font-size:11px;color:#8b949e;">标签（逗号分隔，可选）</label>' +
            '<input class="umd-tags" type="text" placeholder="如：建筑, 办公楼"' +
            ' style="width:100%;padding:5px 8px;border:1px solid var(--border);border-radius:4px;font-size:12px;box-sizing:border-box;"></div>' +
            '<div><label style="font-size:11px;color:#a371f7;">🤖 AI 描述（给 AI 看，玩家不可见）</label>' +
            '<textarea class="umd-desc" rows="3" maxlength="' + MAX_DESC + '"' +
            ' placeholder="告诉 AI 这是什么、能干什么。AI 看不到 3D 模型，只靠名称和这段话认识物体。"' +
            ' style="width:100%;padding:6px 8px;border:1px solid rgba(163,113,247,0.4);border-radius:4px;font-size:12px;line-height:1.5;box-sizing:border-box;resize:vertical;"></textarea>' +
            '<div style="font-size:10px;color:#8b949e;margin-top:2px;">所有 AI（含公开游客）都能看到，勿写敏感信息；放置到世界时自动携带。</div></div>';
        return wrap;
    }

    function escapeHtml(s) {
        return String(s === undefined || s === null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function openDialog(models) {
        if (!models || !models.length) return;

        var overlay = document.createElement('div');
        overlay.id = 'umd-overlay';
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:99999;display:flex;align-items:center;justify-content:center;';
        var box = document.createElement('div');
        box.style.cssText = 'background:#161b22;color:#e6edf3;border:1px solid var(--border);border-radius:10px;width:460px;max-width:92vw;max-height:86vh;display:flex;flex-direction:column;box-shadow:0 8px 30px rgba(0,0,0,0.5);';
        box.innerHTML =
            '<div style="padding:12px 16px;border-bottom:1px solid var(--border);font-weight:600;font-size:14px;">' +
            '✅ 上传成功 · 补充模型信息（' + models.length + ' 个）</div>' +
            '<div class="umd-rows" style="padding:12px 16px;overflow-y:auto;flex:1;"></div>' +
            '<div style="padding:10px 16px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end;">' +
            '<button class="umd-skip" style="padding:6px 14px;border:1px solid var(--border);border-radius:6px;background:transparent;color:#8b949e;font-size:12px;cursor:pointer;">跳过</button>' +
            '<button class="umd-save" style="padding:6px 14px;border:none;border-radius:6px;background:#238636;color:#fff;font-size:12px;cursor:pointer;">保存</button>' +
            '</div>';

        var rowsBox = box.querySelector('.umd-rows');
        models.forEach(function (m, i) { rowsBox.appendChild(buildRow(m, i)); });
        overlay.appendChild(box);
        document.body.appendChild(overlay);

        function close() { if (overlay.parentElement) overlay.parentElement.removeChild(overlay); }
        box.querySelector('.umd-skip').addEventListener('click', close);
        overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });

        box.querySelector('.umd-save').addEventListener('click', function () {
            var rows = rowsBox.children;
            var chain = Promise.resolve();
            for (var i = 0; i < rows.length; i++) {
                (function (row) {
                    var model = models[i];
                    var name = row.querySelector('.umd-name').value.trim();
                    var tagsRaw = row.querySelector('.umd-tags').value.trim();
                    var desc = row.querySelector('.umd-desc').value.trim().slice(0, MAX_DESC);
                    if (name && name !== (model.display_name || model.file_name || model.fileName || '')) {
                        chain = chain.then(function () {
                            return _origFetch('/api/uploaded-models/' + model.id + '/display-name', {
                                method: 'PUT', headers: authHeaders(), body: JSON.stringify({ display_name: name })
                            }).then(function (r) { if (!r.ok) throw new Error('名称保存失败 HTTP ' + r.status); });
                        });
                    }
                    if (tagsRaw) {
                        var tags = tagsRaw.split(/[,，]/).map(function (s) { return s.trim(); }).filter(Boolean);
                        if (tags.length) {
                            chain = chain.then(function () {
                                return _origFetch('/api/uploaded-models/' + model.id + '/tags', {
                                    method: 'PUT', headers: authHeaders(), body: JSON.stringify({ tags: tags })
                                }).then(function (r) { if (!r.ok) throw new Error('标签保存失败 HTTP ' + r.status); });
                            });
                        }
                    }
                    // AI 描述总是保存（含清空为 null 的语义）
                    chain = chain.then(function () {
                        return _origFetch('/api/uploaded-models/' + model.id + '/agent-description', {
                            method: 'PUT', headers: authHeaders(),
                            body: JSON.stringify({ agent_description: desc || null })
                        }).then(function (r) {
                            if (!r.ok) throw new Error('AI 描述保存失败 HTTP ' + r.status);
                            model.description = desc || null;   // 同步内存缓存
                        });
                    });
                })(rows[i]);
            }
            chain.then(function () {
                close();
                if (typeof showNotification === 'function') showNotification('✅ 模型信息已保存', 'success');
                if (typeof refreshUploadedModels === 'function') refreshUploadedModels();
            }).catch(function (e) {
                if (typeof showNotification === 'function') showNotification('❌ 保存失败: ' + e.message, 'error');
            });
        });
    }

    // ==================== fetch 包装 ====================

    function extractModels(j) {
        if (!j) return [];
        if (j.model) return [j.model];
        if (Array.isArray(j.models)) return j.models.filter(function (m) { return m && m.id; });
        if (Array.isArray(j.results)) return j.results.filter(function (m) { return m && m.id; });
        return [];
    }

    window.fetch = function (input, init) {
        var url = typeof input === 'string' ? input : (input && input.url) || '';
        var method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();

        // 放置模型到世界：按 model_path 匹配已上传模型 → 注入 agent_description
        if (method === 'POST' && /\/api\/world\/objects\/?$/.test(url) && init && typeof init.body === 'string') {
            try {
                var body = JSON.parse(init.body);
                if (body && body.model_path && body.agent_description === undefined &&
                    typeof uploadedModels !== 'undefined' && Array.isArray(uploadedModels)) {
                    for (var i = 0; i < uploadedModels.length; i++) {
                        var m = uploadedModels[i];
                        if (m && m.path === body.model_path && m.description) {
                            body.agent_description = String(m.description).slice(0, 500);
                            init = Object.assign({}, init, { body: JSON.stringify(body) });
                            break;
                        }
                    }
                }
            } catch (e) { /* body 非 JSON，忽略 */ }
        }

        var p = _origFetch(input, init);

        // 上传成功 → 弹补充信息对话框
        if (method === 'POST' && /\/api\/upload-model(-batch)?$/.test(url.replace(/\?.*$/, ''))) {
            p = p.then(function (res) {
                var clone = res.clone();
                return res.json().then(function (j) {
                    if (j && j.success) {
                        var models = extractModels(j);
                        if (models.length) setTimeout(function () { openDialog(models); }, 350);
                    }
                    return clone;
                }).catch(function () { return clone; });
            });
        }
        return p;
    };
})();
