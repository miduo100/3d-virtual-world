/**
 * mediaAgentDesc.js — 世界编辑器「媒体库」的 🤖 AI 描述（图片 / 视频 / 3DGS）
 *
 * 黑名单合规：不修改 world_editor.html 的内联逻辑，全部靠「包装全局函数 + 包装 fetch」：
 *   ① 包装 renderMediaGrid / renderImageLibrary / renderVideoLibrary：
 *      渲染完成后给每个媒体卡片补一个 🤖 按钮（已填显示 🤖✓），点开即可编辑
 *   ② 包装 window.fetch：放置媒体（POST /api/world/objects，type=media_image/media_video/...）
 *      时按 model_path（= 媒体 url）匹配媒体库项，把描述注入 agent_description
 *      （仅在调用方未传 agent_description、且描述非空时注入；不覆盖）
 *
 * 存储：媒体项的描述存在 localStorage['world_editor_media_library'] 的
 *       item.agentDescription 字段里（媒体库本身就是这份 localStorage，不新建 DB 表）。
 *       —— 这是本步与用户确认的取舍：全库只有 3 个媒体对象，建元数据表过重；
 *          若将来需要「媒体描述跨浏览器共享」，再单独讨论建表（属方案变更）。
 *
 * 依赖 world_editor.html 全局（缺失时静默降级）：
 *   mediaLibrary（顶层 let，另一脚本可裸名访问）、saveMediaLibrary、showNotification、
 *   renderMediaGrid / renderImageLibrary / renderVideoLibrary（顶层函数声明 → window 属性）
 */
(function () {
    'use strict';

    var MAX_LEN = 500;
    var _origFetch = window.fetch.bind(window);
    var _patchedRenders = {};

    function lib() {
        try {
            return (typeof mediaLibrary !== 'undefined' && Array.isArray(mediaLibrary)) ? mediaLibrary : null;
        } catch (e) { return null; }
    }

    function findItem(id) {
        var L = lib();
        if (!L || id === undefined || id === null) return null;
        for (var i = 0; i < L.length; i++) {
            if (L[i] && String(L[i].id) === String(id)) return L[i];
        }
        return null;
    }

    function findByUrl(url) {
        var L = lib();
        if (!L || !url) return null;
        for (var i = 0; i < L.length; i++) {
            var it = L[i];
            if (!it) continue;
            if (it.url === url || it.originalUrl === url) return it;
        }
        return null;
    }

    function notify(msg, type) {
        if (typeof showNotification === 'function') showNotification(msg, type || 'info');
    }

    function saveLib() {
        if (typeof saveMediaLibrary === 'function') saveMediaLibrary();
    }

    // ==================== 卡片装饰（🤖 按钮）====================

    function decorate() {
        var cards = document.querySelectorAll('.media-card[data-id]');
        for (var i = 0; i < cards.length; i++) {
            var card = cards[i];
            var item = findItem(card.getAttribute('data-id'));
            if (!item) continue;
            var actions = card.querySelector('.media-actions');
            if (!actions) continue;

            var btn = actions.querySelector('.agent-desc-btn');
            if (!btn) {
                btn = document.createElement('button');
                btn.className = 'agent-desc-btn';
                btn.type = 'button';
                btn.style.cssText = 'border:none;background:rgba(163,113,247,0.18);color:#a371f7;border-radius:4px;' +
                    'padding:2px 6px;font-size:11px;cursor:pointer;margin-left:4px;';
                btn.addEventListener('click', function (ev) {
                    ev.stopPropagation();
                    openEditor(findItem(this.getAttribute('data-media-id')));
                });
                actions.appendChild(btn);
            }
            btn.setAttribute('data-media-id', item.id);
            var has = !!(item.agentDescription && String(item.agentDescription).trim());
            btn.textContent = has ? '🤖✓' : '🤖';
            btn.title = has
                ? 'AI 描述（已填）：' + String(item.agentDescription).slice(0, 60)
                : 'AI 描述（未填）—— AI 玩家靠它认识这个媒体，点此填写';
        }
    }

    // ==================== 编辑弹窗 ====================

    function closeModal() {
        var el = document.getElementById('mad-overlay');
        if (el && el.parentElement) el.parentElement.removeChild(el);
    }

    function openEditor(item) {
        if (!item) { notify('未找到该媒体项', 'error'); return; }
        closeModal();

        var overlay = document.createElement('div');
        overlay.id = 'mad-overlay';
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:99999;' +
            'display:flex;align-items:center;justify-content:center;';
        overlay.innerHTML =
            '<div style="background:#161b22;color:#e6edf3;border:1px solid #30363d;border-radius:10px;width:440px;' +
            'max-width:92vw;box-shadow:0 8px 30px rgba(0,0,0,0.5);">' +
            '  <div style="padding:12px 16px;border-bottom:1px solid #30363d;font-weight:600;font-size:14px;">' +
            '    🤖 AI 描述 · ' + escapeHtml(item.name || item.id) + '</div>' +
            '  <div style="padding:12px 16px;">' +
            '    <textarea id="mad-input" rows="4" maxlength="' + MAX_LEN + '"' +
            '      placeholder="告诉 AI 这是什么、能干什么（例：一幅景区导览图，靠近可查看）。AI 看不到画面内容。"' +
            '      style="width:100%;padding:8px;border:1px solid rgba(163,113,247,0.4);border-radius:6px;' +
            'font-size:12px;line-height:1.5;box-sizing:border-box;background:rgba(0,0,0,0.3);color:#e6edf3;resize:vertical;"></textarea>' +
            '    <div style="font-size:10px;color:#8b949e;margin-top:4px;">' +
            '      放置到世界时自动写到该对象的 AI 描述；所有 AI（含公开游客）都能看到，勿写敏感信息。</div>' +
            '  </div>' +
            '  <div style="padding:10px 16px;border-top:1px solid #30363d;display:flex;gap:8px;justify-content:flex-end;">' +
            '    <button class="mad-clear" style="padding:6px 14px;border:1px solid #30363d;border-radius:6px;' +
            'background:transparent;color:#8b949e;font-size:12px;cursor:pointer;">清空</button>' +
            '    <button class="mad-cancel" style="padding:6px 14px;border:1px solid #30363d;border-radius:6px;' +
            'background:transparent;color:#8b949e;font-size:12px;cursor:pointer;">取消</button>' +
            '    <button class="mad-save" style="padding:6px 14px;border:none;border-radius:6px;' +
            'background:#238636;color:#fff;font-size:12px;cursor:pointer;">保存</button>' +
            '  </div>' +
            '</div>';
        document.body.appendChild(overlay);

        function escapeHtml(s) {
            return String(s === undefined || s === null ? '' : s)
                .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        }

        var input = document.getElementById('mad-input');
        input.value = item.agentDescription || '';
        setTimeout(function () { input.focus(); }, 30);

        overlay.addEventListener('click', function (e) { if (e.target === overlay) closeModal(); });
        overlay.querySelector('.mad-cancel').addEventListener('click', closeModal);
        overlay.querySelector('.mad-clear').addEventListener('click', function () { input.value = ''; input.focus(); });
        overlay.querySelector('.mad-save').addEventListener('click', function () {
            var val = String(input.value || '').trim().slice(0, MAX_LEN);
            if (val) item.agentDescription = val; else delete item.agentDescription;
            saveLib();
            decorate();
            closeModal();
            notify(val ? '✅ 已保存媒体 AI 描述（放置到世界时自动携带）' : '已清空媒体 AI 描述', 'success');
        });
    }

    // ==================== 包装渲染函数 ====================

    function patchRender(name) {
        if (_patchedRenders[name]) return true;
        if (typeof window[name] !== 'function') return false;
        var orig = window[name];
        window[name] = function () {
            var r = orig.apply(this, arguments);
            try { decorate(); } catch (e) { console.error('[MediaAgentDesc] 装饰失败:', e); }
            return r;
        };
        _patchedRenders[name] = true;
        return true;
    }

    // 等编辑器主脚本就绪（最多 30 秒）
    var _tries = 0;
    (function waitReady() {
        var ok = patchRender('renderMediaGrid') && patchRender('renderImageLibrary') && patchRender('renderVideoLibrary');
        if (ok) { decorate(); return; }
        if (++_tries > 100) {
            console.warn('[MediaAgentDesc] 未找到媒体库渲染函数，AI 描述按钮未接管');
            return;
        }
        setTimeout(waitReady, 300);
    })();

    // ==================== 包装 fetch：放置媒体时注入描述 ====================

    window.fetch = function (input, init) {
        var url = typeof input === 'string' ? input : (input && input.url) || '';
        var method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();

        if (method === 'POST' && /\/api\/world\/objects\/?$/.test(url.split('?')[0]) &&
            init && typeof init.body === 'string') {
            try {
                var body = JSON.parse(init.body);
                if (body && body.model_path && body.agent_description === undefined) {
                    var it = findByUrl(body.model_path);
                    var desc = it && it.agentDescription ? String(it.agentDescription).trim() : '';
                    if (desc) {
                        body.agent_description = desc.slice(0, MAX_LEN);
                        init = Object.assign({}, init, { body: JSON.stringify(body) });
                    }
                }
            } catch (e) { /* body 非 JSON，忽略 */ }
        }
        return _origFetch(input, init);
    };

    window.MediaAgentDesc = {
        decorate: decorate,
        openEditor: openEditor,
        findItem: findItem,
        prettyBadge: function () { decorate(); }
    };
})();
