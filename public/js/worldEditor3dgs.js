/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 *
 * 世界编辑器 - 高斯场景库面板
 * 在 world_editor.html 左侧"高斯"按钮展示 public/scenes/3dgs 下的 3DGS 文件
 * 支持点击"添加到场景"打开放置预览框（转交 world_editor.html 内联 openGaussianPlace）
 */
(function () {
    'use strict';

    let dgsFiles = [];

    function escapeHtml(text) {
        if (text === null || text === undefined) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function escapeAttr(text) {
        return escapeHtml(text)
            .replace(/'/g, '&#39;')
            .replace(/"/g, '&quot;');
    }

    function formatBytes(bytes) {
        if (!bytes || bytes <= 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return (bytes / Math.pow(k, i)).toFixed(2) + ' ' + sizes[i];
    }

    // 与 world_editor.html 内联 weT 行为一致：仅英文查翻译，否则回退中文原文
    function weT(key, fallback) {
        if (window.i18n && window.i18n.initialized && window.i18n.getCurrentLocale() === 'en-US') {
            const text = window.i18n.t('worldEditor.' + key);
            return (text && text !== 'worldEditor.' + key) ? text : fallback;
        }
        return fallback;
    }

    async function load3dgsFiles() {
        const listEl = document.getElementById('dgs-file-list');
        if (!listEl) return;
        listEl.innerHTML = '<div style="text-align:center; padding:15px; color:#999; font-size:12px;">' + weT('common.loading', '加载中...') + '</div>';
        try {
            const res = await fetch('/api/three-dgs/list');
            const data = await res.json();
            if (!data.success) throw new Error(data.error || '加载失败');
            dgsFiles = data.files || [];
            renderDgsList();
        } catch (err) {
            console.error('[3DGS] 加载高斯文件失败:', err);
            listEl.innerHTML = '<div style="text-align:center; padding:15px; color:#e74c3c; font-size:12px;">❌ ' + escapeHtml(err.message) + '</div>';
        }
    }

    function renderDgsList() {
        const listEl = document.getElementById('dgs-file-list');
        const countEl = document.getElementById('dgs-count');
        if (countEl) countEl.textContent = dgsFiles.length;
        const searchEl = document.getElementById('dgs-search');
        const keyword = (searchEl && searchEl.value || '').trim().toLowerCase();
        let files = dgsFiles;
        if (keyword) files = files.filter(f => ((f.scene_name || '') + ' ' + f.filename + ' ' + (f.dir || '')).toLowerCase().includes(keyword));
        if (!files.length) {
            listEl.innerHTML = '<div style="text-align:center; padding:15px; color:#999; font-size:12px;">' + weT('panel3dgs.empty', '暂无高斯文件') + '</div>';
            return;
        }
        listEl.innerHTML = files.map(f => {
            const ext = (f.ext || '').replace('.', '').toUpperCase() || '3DGS';
            const displayName = f.scene_name || f.filename;
            const thumbUrl = f.db_thumbnail_url || f.auto_thumbnail;
            const thumb = thumbUrl
                ? '<img class="media-thumb" src="' + escapeAttr(thumbUrl) + '" alt="' + escapeAttr(displayName) + '" onerror="this.style.display=\'none\'">'
                : '<div class="media-thumb-video" style="display:flex;align-items:center;justify-content:center;font-size:28px;color:#a78bfa;background:#1e1e2e;">✨</div>';
            return '<div class="media-card" title="' + escapeAttr(f.relative_path) + '">'
                + thumb
                + '<span class="media-type-badge">' + escapeHtml(ext) + '</span>'
                + '<div class="media-info">'
                + '<div class="media-name" title="' + escapeAttr(f.registered ? (f.scene_name + ' · ' + f.filename) : f.filename) + '">' + escapeHtml(displayName) + '</div>'
                + '<div class="media-meta">' + (f.size ? formatBytes(f.size) : '') + (f.mtime ? ' · ' + new Date(f.mtime).toLocaleString() : '') + '</div>'
                + '<div class="media-actions">'
                + '<button class="btn-add-scene" onclick="event.stopPropagation();window.startGaussianPlace(\'' + escapeAttr(f.relative_path) + '\')">' + weT('panel3dgs.addToScene', '添加到场景') + '</button>'
                + '</div>'
                + '</div></div>';
        }).join('');
    }

    function filterDgsList() {
        renderDgsList();
    }

    // 点击"添加到场景"：查找文件对象并转交编辑器内联脚本打开放置预览框
    async function startGaussianPlace(relPath) {
        const f = dgsFiles.find(x => x.relative_path === relPath);
        if (!f) {
            console.warn('[3DGS] 未找到文件:', relPath);
            return;
        }
        if (typeof window.openGaussianPlace === 'function') {
            await window.openGaussianPlace(f);
        } else {
            console.error('[3DGS] 编辑器 openGaussianPlace 未定义');
        }
    }

    // 页面加载完成后自动加载列表（i18n 可能尚未初始化，渲染兜底走中文原文）
    window.addEventListener('DOMContentLoaded', function () {
        if (typeof load3dgsFiles === 'function') load3dgsFiles();
    });

    window.load3dgsFiles = load3dgsFiles;
    window.renderDgsList = renderDgsList;
    window.filterDgsList = filterDgsList;
    window.startGaussianPlace = startGaussianPlace;
})();

/* =========================================================================
 * 编辑器 3DGS 预览接入（对话③：放置预览框接入真实高斯渲染）
 * 仅由 world_editor.html 三处钩子调用：
 *   editorGaussianCreatePreview - createMediaPreview 的 gaussian_splat 分支
 *   editorGaussianUpdatePreview - updateMediaPreview 的 gaussian_splat 分支
 *   onEditorGaussianTick        - animate() 中 renderer.render 之前驱动
 * dispose 不可改 world_editor.html 的 cancelMediaPlace，改用 tick 自检自愈：
 * 取消/保存/关闭面板都会 scene.remove(group) → 下一帧检测到 parent 为 null 即释放。
 * ========================================================================= */
(function () {
    'use strict';

    const PREVIEW_MAX_POINTS = 40000; // 预览抽稀上限：拖拽编辑要最流畅, 4 万点即可看清效果

    let _group = null;      // 当前预览 group（即 mediaPreviewMesh）
    let _splat = null;      // 当前 splat 节点 { object3D, update, dispose, setProgressCallback }
    let _splatRoot = null;  // group 内承载 占位盒/点云 的子节点（scale = w/3,h/3,w/3）
    let _placeholder = null; // 占位盒 + 中心点 容器
    let _sprite = null;     // 进度文字精灵（固定在 group 下，不受尺寸缩放影响）
    let _token = 0;         // 竞态令牌：切换/取消后旧异步结果直接丢弃

    const _isCurrent = (t) => t === _token;

    function _disposeSplat() {
        if (_splat) {
            try { _splat.dispose(); } catch (e) { console.warn('[3DGS预览] dispose 异常:', e); }
            _splat = null;
        }
    }

    // 固定尺寸进度文字精灵（CanvasTexture，r128 兼容）
    function _makeSprite() {
        const canvas = document.createElement('canvas');
        canvas.width = 512; canvas.height = 128;
        const ctx = canvas.getContext('2d');
        const tex = new THREE.CanvasTexture(canvas);
        tex.minFilter = THREE.LinearFilter;
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
            map: tex, transparent: true, depthTest: false, depthWrite: false
        }));
        sprite.scale.set(4, 1, 1);
        sprite.userData.canvas = canvas;
        sprite.userData.ctx = ctx;
        sprite.userData.tex = tex;
        return sprite;
    }

    function _setText(text) {
        if (!_sprite) return;
        const canvas = _sprite.userData.canvas;
        const ctx = _sprite.userData.ctx;
        const tex = _sprite.userData.tex;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        // 半透明圆角底
        ctx.fillStyle = 'rgba(15, 15, 35, 0.78)';
        ctx.beginPath();
        ctx.moveTo(24, 0);
        ctx.lineTo(canvas.width - 24, 0);
        ctx.quadraticCurveTo(canvas.width, 0, canvas.width, 24);
        ctx.lineTo(canvas.width, canvas.height - 24);
        ctx.quadraticCurveTo(canvas.width, canvas.height, canvas.width - 24, canvas.height);
        ctx.lineTo(24, canvas.height);
        ctx.quadraticCurveTo(0, canvas.height, 0, canvas.height - 24);
        ctx.lineTo(0, 24);
        ctx.quadraticCurveTo(0, 0, 24, 0);
        ctx.closePath();
        ctx.fill();
        // 文字
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 46px "Microsoft YaHei", Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 2);
        tex.needsUpdate = true;
    }

    window.editorGaussianCreatePreview = function (item, x, y, z, ry, w, h) {
        // 清理旧预览（连续放置不同文件时不泄漏 GPU 资源）
        _token++;
        _disposeSplat();
        _group = null; _splatRoot = null; _placeholder = null; _sprite = null;

        const group = new THREE.Group();
        group.position.set(x, y, z);
        group.rotation.y = ry * Math.PI / 180;
        group.userData.isMediaPreview = true;
        _group = group;

        // 尺寸根节点：占位盒/点云放这里，scale 由面板尺寸驱动（w/3,h/3,w/3）
        const root = new THREE.Group();
        root.scale.set(w / 3, h / 3, w / 3);
        group.add(root);
        _splatRoot = root;

        // 占位（紫色线框盒 + 中心点，风格与原占位一致）
        const placeholder = new THREE.Group();
        placeholder.add(new THREE.Mesh(
            new THREE.BoxGeometry(3, 3, 3),
            new THREE.MeshBasicMaterial({ color: 0xa78bfa, wireframe: true })
        ));
        placeholder.add(new THREE.Mesh(
            new THREE.SphereGeometry(0.2, 12, 12),
            new THREE.MeshBasicMaterial({ color: 0xa78bfa })
        ));
        root.add(placeholder);
        _placeholder = placeholder;

        // 进度文字
        const sprite = _makeSprite();
        sprite.position.set(0, 2.4, 0);
        group.add(sprite);
        _sprite = sprite;
        _setText('加载中 0%');

        const token = _token;
        const url = (item && item.url) || '';
        if (!url) { _setText('加载失败'); return group; }

        GaussianSplatLoader.loadPLY(url, {
            onDownload: function (p) {
                if (!_isCurrent(token)) return;
                _setText(p > 0 ? '下载中 ' + Math.round(p * 70) + '%' : '下载中 …');
            },
            onParse: function (p) {
                if (!_isCurrent(token)) return;
                _setText('解析中 ' + Math.round(70 + p * 30) + '%');
            },
            maxPoints: PREVIEW_MAX_POINTS
        }).then(function (data) {
            // 已取消（group 被 scene.remove）或已切换文件 → 静默丢弃
            if (!_isCurrent(token) || !_group || _group.parent === null) return;

            _disposeSplat();
            const splat = GaussianSplatRenderer.createSplatNode(data, {
                maxPointSize: 12,
                initialCount: 15000
            });
            splat.setProgressCallback(function (p) {
                if (!_isCurrent(token)) return;
                if (p >= 1) {
                    // 上屏完成：移除进度文字
                    if (_sprite && _sprite.parent) _sprite.parent.remove(_sprite);
                    _sprite = null;
                } else {
                    _setText('渲染中 ' + Math.round(p * 100) + '%');
                }
            });
            _splat = splat;

            // 替换占位：移除线框盒与中心点，挂上真实点云（进度文字保留到上屏完成）
            if (_placeholder && _placeholder.parent) _placeholder.parent.remove(_placeholder);
            _placeholder = null;
            // 底部贴地（与已保存对象/世界内一致）：root.scale 已按面板尺寸设置,
            // position.y = -minY 随 root.scale.y 同步缩放, 与点云同尺度,
            // 任意缩放下点云最低点都落在放置点 y=0, 预览所见即世界所得。
            splat.object3D.position.set(0, -(typeof data.minY === 'number' ? data.minY : 0), 0);
            // 点云直径归一化到面板宽度 w：root.scale=(w/3,h/3,w/3)，splat 内 scale=3/(2R)，
            // 显示直径恒等于 w，且拖拽改宽时直径自动跟随（预览所见 = 保存所得）
            if (data.boundingSphere && data.boundingSphere.radius > 0.01) {
                splat.object3D.scale.setScalar(3 / (2 * data.boundingSphere.radius));
            }
            _splatRoot.add(splat.object3D);
        }).catch(function (err) {
            if (!_isCurrent(token)) return;
            console.error('[3DGS预览] 加载失败:', err);
            _setText('加载失败');
        });

        return group;
    };

    window.editorGaussianUpdatePreview = function (group, w, h) {
        if (!group || group !== _group || !_splatRoot) return;
        // 3DGS 尺寸公式：深度跟随宽度（w/3, h/3, w/3）
        _splatRoot.scale.set(w / 3, h / 3, w / 3);
    };

    // 每帧渲染前调用（world_editor.html animate 中 renderer.render 之前）
    window.onEditorGaussianTick = function (camera, renderer) {
        if (!_splat) return;
        if (_group && _group.parent !== null) {
            // 预览存活：驱动渐进上屏 + 焦距更新
            _splat.update(camera, renderer);
        } else {
            // 预览已被取消/保存/关闭（group 被 scene.remove）→ 自愈释放 GPU 资源
            _disposeSplat();
            _group = null; _splatRoot = null; _placeholder = null; _sprite = null;
        }
    };
})();

/* =========================================================================
 * 编辑器 3DGS 已保存对象真实渲染
 * 由 world_editor.html createMeshFromObject 的 gaussian_splat 分支调用：
 *   editorGaussianLoadIntoGroup(obj, group) - 异步加载 PLY，替换占位为真实点云
 * 点云中心对齐 + 尺寸归一化规则与 world3dgs.js 的 fitSplatToGroup 完全一致，
 * 保证编辑器所见 = 世界所得（同一 group.scale × 同一点云）。
 * 资源释放沿用 tick 自检自愈：刷新/删除对象 group 被 scene.remove → 下一帧 dispose。
 * ========================================================================= */
(function () {
    'use strict';

    // 编辑器内所有"已保存对象"splat 注册表（key: 'obj-'+id -> record）
    // record: { group, splat, token, disposed }
    const records = new Map();
    let tokenSeq = 0;

    // 简洁进度精灵（CanvasTexture，r128 兼容）
    function makeProgressSprite() {
        const canvas = document.createElement('canvas');
        canvas.width = 256; canvas.height = 64;
        const ctx = canvas.getContext('2d');
        const tex = new THREE.CanvasTexture(canvas);
        tex.minFilter = THREE.LinearFilter;
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
            map: tex, transparent: true, depthTest: false, depthWrite: false
        }));
        sprite.scale.set(3, 0.75, 1);
        sprite.userData.canvas = canvas;
        sprite.userData.ctx = ctx;
        sprite.userData.tex = tex;
        return sprite;
    }

    function setSpriteText(sprite, text) {
        if (!sprite) return;
        const canvas = sprite.userData.canvas;
        const ctx = sprite.userData.ctx;
        const tex = sprite.userData.tex;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = 'rgba(15, 15, 35, 0.78)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 24px "Microsoft YaHei", Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 1);
        tex.needsUpdate = true;
    }

    function disposeObject3D(obj) {
        if (!obj) return;
        obj.traverse(function (node) {
            if (node.geometry) { try { node.geometry.dispose(); } catch (e) {} }
            if (node.material) {
                const mats = Array.isArray(node.material) ? node.material : [node.material];
                mats.forEach(function (m) {
                    if (m.map) { try { m.map.dispose(); } catch (e) {} }
                    try { m.dispose(); } catch (e) {}
                });
            }
        });
    }

    // 移除占位视觉（线框盒/中心点）；keepSprite=true 时保留进度精灵（上屏阶段继续显示）
    function removePlaceholderVisuals(group, keepSprite) {
        if (!group) return;
        for (let i = group.children.length - 1; i >= 0; i--) {
            const child = group.children[i];
            if (!child.userData) continue;
            if (child.userData.gsPlaceholder) {
                group.remove(child);
                disposeObject3D(child);
            } else if (child.userData.gsProgress && !keepSprite) {
                group.remove(child);
                disposeObject3D(child);
            }
        }
    }

    function disposeRecord(rec) {
        if (!rec || rec.disposed) return;
        rec.disposed = true;
        if (rec.splat) {
            try { rec.splat.dispose(); } catch (e) { console.warn('[3DGS对象] dispose 异常:', e); }
            rec.splat = null;
        }
        if (rec.group) removePlaceholderVisuals(rec.group, false);
    }

    window.editorGaussianLoadIntoGroup = function (obj, group) {
        if (!obj || !group) return;

        // 同一对象重复加载（刷新场景）→ 释放旧记录，防 GPU 泄漏
        const id = (obj.id !== undefined && obj.id !== null) ? obj.id : obj.objectId;
        const key = 'obj-' + id;
        if (records.has(key)) {
            const old = records.get(key);
            if (old.group !== group) disposeRecord(old);
            records.delete(key);
        }

        const url = obj.model_path || obj.url || '';
        if (!url || !window.GaussianSplatLoader || !window.GaussianSplatRenderer) return;

        const token = ++tokenSeq;
        const rec = { group: group, splat: null, token: token, disposed: false };
        records.set(key, rec);

        // 进度精灵（固定在 group 下，不受 group.scale 影响文字清晰度）
        const sprite = makeProgressSprite();
        sprite.position.set(0, 2.2, 0);
        sprite.userData.gsProgress = true;
        group.add(sprite);
        setSpriteText(sprite, '加载中 0%');

        // 与世界内一致: 按重要度抽稀到 5 万点(与 world3dgs.js 相同预算), 编辑器所见 = 世界所得
        GaussianSplatLoader.loadPLY(url, {
            maxPoints: 50000,
            noCache: true, // 编辑器不缓存全量解析，加载完即释放约 144MB 常驻内存
            onDownload: function (p) {
                if (rec.disposed || token !== rec.token) return;
                setSpriteText(sprite, p > 0 ? '下载中 ' + Math.round(p * 70) + '%' : '下载中 …');
            },
            onParse: function (p) {
                if (rec.disposed || token !== rec.token) return;
                setSpriteText(sprite, '解析中 ' + Math.round(70 + p * 30) + '%');
            }
        }).then(function (data) {
            // 已释放/已刷新（group 出场景）→ 静默丢弃
            if (rec.disposed || token !== rec.token || !group || group.parent === null) return;

            const splat = GaussianSplatRenderer.createSplatNode(data, {
                maxPointSize: 10,
                initialCount: Math.min(20000, data.count || 50000),
                incrementPerFrame: Math.max(2000, Math.ceil((data.count || 50000) / 120))
            });
            rec.splat = splat;

            // 点云尺寸归一化 + 底部贴地（与 world3dgs.js fitSplatToGroup 一致）：
            // scale_x/scale_y 解释为"目标显示跨度(米)"，点云按真实半径归一化到该跨度，
            // 编辑器所见 = 世界所得（同一 group.scale × 同一点云）。
            const bs = data.boundingSphere;
            const radius = bs ? bs.radius : 0;
            if (radius > 0.01) {
                const userW = parseFloat(obj.scale_x);
                const userH = parseFloat(obj.scale_y);
                const spanW = (isFinite(userW) && userW > 0) ? userW : 20;
                const spanH = (isFinite(userH) && userH > 0) ? userH : spanW;
                group.scale.set(
                    spanW / (2 * radius),
                    spanH / (2 * radius),
                    spanW / (2 * radius)
                );
            }
            // 先在 group 缩放后设置位置, minY 随 group.scale 同步缩放,
            // 点云最低点严格落在放置点 y=0, 与 GLB 模型底贴地语义一致。
            const minY = (typeof data.minY === 'number') ? data.minY : 0;
            splat.object3D.position.set(0, -minY, 0);

            // 移除占位盒/中心点，挂真实点云（进度精灵保留到上屏完成）
            removePlaceholderVisuals(group, true);

            splat.setProgressCallback(function (p) {
                if (rec.disposed || token !== rec.token) return;
                if (p >= 1) {
                    // 上屏完成：移除进度精灵
                    if (sprite.parent) sprite.parent.remove(sprite);
                    disposeObject3D(sprite);
                } else {
                    setSpriteText(sprite, '渲染中 ' + Math.round(p * 100) + '%');
                }
            });

            group.add(splat.object3D);
        }).catch(function (err) {
            if (rec.disposed || token !== rec.token) return;
            console.error('[3DGS对象] 加载失败:', url, err);
            setSpriteText(sprite, '加载失败');
        });
    };

    // 每帧驱动：先执行原 tick（放置预览），再驱动已保存对象注册表
    const origTick = window.onEditorGaussianTick;
    window.onEditorGaussianTick = function (camera, renderer) {
        if (origTick) { try { origTick(camera, renderer); } catch (e) {} }
        records.forEach(function (rec, key) {
            if (rec.disposed) { records.delete(key); return; }
            if (!rec.group || rec.group.parent === null) {
                // 对象被删除/刷新（group 出场景）→ 自愈释放 GPU 资源
                disposeRecord(rec);
                records.delete(key);
                return;
            }
            if (rec.splat) {
                try { rec.splat.update(camera, renderer); } catch (e) {}
            }
        });
    };
})();
