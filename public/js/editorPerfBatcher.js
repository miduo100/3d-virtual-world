/**
 * editorPerfBatcher.js — 世界编辑器 draw call 降载模块
 * ------------------------------------------------------------------
 * 背景：编辑器场景 ~3000 draw calls（706 个独立占位线框盒 + 1300+ 几何
 * 碎片 mesh），三角形总量仅 20 万，GTX 960 纯 CPU 提交开销即超帧预算，
 * 旋转视角连续掉帧。
 *
 * 两项优化（画面零变化、不隐藏任何对象）：
 *   B1 占位盒实例化：所有 wireframe 占位盒镜像到 1 个 InstancedMesh
 *      （706 calls → 1 call）。原 mesh 通过 visible 访问器拦截保持
 *      "编辑器认为可见、渲染器跳过"的语义，编辑器显隐逻辑零改动。
 *   B2 几何对象实例合批：geometry_* 类型真实模型（renderFromComponents
 *      产物）按「几何参数签名 + 材质签名」合并为 InstancedMesh。
 *      源 mesh 保留在场景树中（visible=false），拾取代理包围球、
 *      删除释放、showReal/showPlaceholder 显隐链路全部不变。
 *
 * 接入方式（不侵入 world_editor.html 逻辑，仅包装全局函数）：
 *   - highlightObject        选中时拆批还原（可编辑），取消选中后重新合批
 *   - disposeObject3D        释放前先摘除注册，防批次引用已释放几何
 *   - refreshScene           刷新场景前全量重置
 *   - onEditorGaussianTick   每帧渲染前驱动镜像/批次矩阵同步（渲染顺序安全）
 *
 * 调试：window.EditorPerf.stats() 查看注册/合批统计。
 */
(function () {
    'use strict';
    if (!window.THREE) { console.warn('[EditorPerf] THREE 未就绪，模块停用'); return; }
    if (window.EditorPerf) return;

    // ---- 页面顶层 let 绑定访问（scene / worldObjects 为经典脚本顶层 let）----
    function gWorldObjects() { try { return (0, eval)('worldObjects'); } catch (e) { return null; } }
    function gScene() { try { return (0, eval)('scene'); } catch (e) { return null; } }

    var ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
    var _tmpM = new THREE.Matrix4();
    var _tmpC = new THREE.Color();
    var sizeMatCache = {}; // 占位盒几何边长 -> 缩放矩阵

    function sizeMat(size) {
        var k = size.toFixed(3);
        if (!sizeMatCache[k]) sizeMatCache[k] = new THREE.Matrix4().makeScale(size, size, size);
        return sizeMatCache[k];
    }

    // ================= B1 占位盒实例镜像 =================
    var phEntries = new Map();   // mesh -> { size, material, intent }
    var phIM = null, phCap = 0;

    function takeOverVisibility(mesh, ent) {
        // 拦截 visible 写入：编辑器的显隐逻辑照常工作（记录意图），
        // 渲染器读到恒 false，由 InstancedMesh 代为渲染
        var intent = mesh.visible;
        try {
            Object.defineProperty(mesh, 'visible', {
                configurable: true,
                get: function () { return false; },
                set: function (v) { intent = !!v; }
            });
        } catch (e) { return false; }
        ent.getIntent = function () { return intent; };
        return true;
    }

    function registerPlaceholder(mesh) {
        if (!mesh || !mesh.isMesh || !mesh.material || !mesh.geometry) return;
        var ud = mesh.userData || {};
        if (ud.gsPlaceholder || ud.isPickProxy) return;
        var m = mesh.material;
        if (!m.isMeshBasicMaterial || !m.wireframe) return; // 只接管线框占位盒
        if (phEntries.has(mesh)) return;
        var p = mesh.geometry.parameters || {};
        var size = p.width || 1;
        var ent = { size: size, material: m, getIntent: null };
        if (!takeOverVisibility(mesh, ent)) return;
        phEntries.set(mesh, ent);
    }

    function rootOf(obj) { var n = obj; while (n.parent) n = n.parent; return n; }

    function ensurePhIM(need, scene) {
        if (phIM && phCap >= need) return true;
        if (phIM) { scene.remove(phIM); phIM.dispose(); phIM = null; }
        phCap = Math.max(64, need * 2);
        phIM = new THREE.InstancedMesh(
            new THREE.BoxGeometry(1, 1, 1),
            new THREE.MeshBasicMaterial({ wireframe: true }),
            phCap
        );
        phIM.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        phIM.frustumCulled = false;
        phIM.setColorAt(0, _tmpC.set(0xffffff));
        scene.add(phIM);
        return true;
    }

    function syncPlaceholders(scene) {
        // 清理失效条目（对象已删除/刷新）
        phEntries.forEach(function (ent, mesh) {
            if (rootOf(mesh) !== scene) { phEntries.delete(mesh); }
        });
        if (phEntries.size === 0) { if (phIM) phIM.count = 0; return; }
        ensurePhIM(phEntries.size, scene);
        var i = 0;
        phEntries.forEach(function (ent, mesh) {
            var vis = ent.getIntent ? ent.getIntent() : false;
            if (vis) {
                phIM.setMatrixAt(i, _tmpM.multiplyMatrices(mesh.matrixWorld, sizeMat(ent.size)));
                phIM.setColorAt(i, _tmpC.copy(ent.material.color));
            } else {
                phIM.setMatrixAt(i, ZERO);
            }
            i++;
        });
        phIM.count = i;
        phIM.instanceMatrix.needsUpdate = true;
        if (phIM.instanceColor) phIM.instanceColor.needsUpdate = true;
    }

    // ================= B2 几何对象实例合批 =================
    var geoGroups = new Map();      // realGroup -> { sources: [], batched }
    var keepUnbatched = new Set();  // 选中对象的 realGroup（保持还原供编辑）
    var batches = new Map();        // key -> { key, geometry, material, sources, im, dirty }

    function fnvAttr(attr) {
        var h = 0x811c9dc5, a = attr.array, step = a.length > 4096 ? 3 : 1;
        for (var i = 0; i < a.length; i += step) { h ^= (a[i] | 0); h = (h * 0x01000193) >>> 0; }
        return h;
    }

    function geoSig(g) {
        var s = g.type + '|' + (g.parameters ? JSON.stringify(g.parameters) : '') + '|' +
            (g.index ? g.index.count : -1) + '|' + (g.attributes.position ? g.attributes.position.count : 0);
        if (!g.parameters && g.attributes && g.attributes.position) s += '|' + fnvAttr(g.attributes.position);
        return s;
    }

    function matSig(m) {
        return [m.type,
            m.color ? m.color.getHexString() : '-',
            m.emissive ? m.emissive.getHexString() : '-',
            m.opacity, m.transparent ? 1 : 0, m.wireframe ? 1 : 0,
            m.map ? m.map.uuid : '-',
            m.emissiveIntensity !== undefined ? m.emissiveIntensity : '-'].join('|');
    }

    function collectSources(realGroup) {
        var out = [];
        realGroup.traverse(function (child) {
            if (!child.isMesh || child.isSkinnedMesh) return;
            var ud = child.userData || {};
            if (ud.isPickProxy) return;
            if (!child.geometry || !child.geometry.attributes || !child.geometry.attributes.position) return;
            if (child.geometry.morphAttributes && Object.keys(child.geometry.morphAttributes).length) return;
            if (Array.isArray(child.material)) return;
            out.push(child);
        });
        return out;
    }

    function batchGroup(rec) {
        rec.sources.forEach(function (src) {
            if (src.__epBatch) return;
            var key = geoSig(src.geometry) + '::' + matSig(src.material);
            var batch = batches.get(key);
            if (!batch) {
                batch = { key: key, geometry: src.geometry, material: src.material, sources: [], im: null, dirty: true };
                batches.set(key, batch);
            }
            batch.sources.push(src);
            batch.dirty = true;
            src.__epBatch = batch;
            src.__epRealGroup = rec.realGroup;
            src.visible = false; // 接管渲染，源保留在场景树（拾取/包围球/释放链路不变）
        });
        rec.batched = true;
    }

    function unbatchGroup(rec) {
        rec.sources.forEach(function (src) {
            var batch = src.__epBatch;
            if (batch) {
                var idx = batch.sources.indexOf(src);
                if (idx >= 0) batch.sources.splice(idx, 1);
                batch.dirty = true;
            }
            src.__epBatch = null;
            src.visible = true; // 还原为独立渲染（选中编辑态）
        });
        rec.batched = false;
    }

    function rebuildBatch(batch, scene) {
        if (batch.im) { scene.remove(batch.im); batch.im.dispose(); batch.im = null; }
        if (batch.sources.length === 0) { batches.delete(batch.key); return; }
        var im = new THREE.InstancedMesh(batch.geometry, batch.material, batch.sources.length);
        im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        im.frustumCulled = false;
        im.count = batch.sources.length;
        scene.add(im);
        batch.im = im;
    }

    function tryBatchGroup(realGroup) {
        if (!realGroup || !realGroup.isObject3D || geoGroups.has(realGroup)) return;
        if (keepUnbatched.has(realGroup)) return;
        var sources = collectSources(realGroup);
        if (!sources.length) return;
        var rec = { realGroup: realGroup, sources: sources, batched: false };
        geoGroups.set(realGroup, rec);
        batchGroup(rec);
    }

    function chainVisible(node) {
        var n = node;
        while (n) { if (!n.visible) return false; n = n.parent; }
        return true;
    }

    function syncBatches(scene) {
        batches.forEach(function (batch) {
            if (batch.dirty) { rebuildBatch(batch, scene); batch.dirty = false; }
            if (!batch.im) return;
            for (var i = 0; i < batch.sources.length; i++) {
                var src = batch.sources[i];
                if (chainVisible(src.__epRealGroup)) {
                    batch.im.setMatrixAt(i, src.matrixWorld);
                } else {
                    batch.im.setMatrixAt(i, ZERO);
                }
            }
            batch.im.instanceMatrix.needsUpdate = true;
        });
    }

    // ================= 生命周期 =================
    function dropRoot(root) {
        phEntries.forEach(function (ent, mesh) {
            if (rootOf(mesh) === root) phEntries.delete(mesh);
        });
        geoGroups.forEach(function (rec, rg) {
            if (rootOf(rg) === root) { unbatchGroup(rec); geoGroups.delete(rg); }
        });
    }

    function dropAll() {
        phEntries.forEach(function (ent, mesh) { phEntries.delete(mesh); });
        geoGroups.forEach(function (rec) { unbatchGroup(rec); });
        geoGroups.clear();
        batches.forEach(function (batch) {
            if (batch.im) { var sc = gScene(); if (sc) sc.remove(batch.im); batch.im.dispose(); batch.im = null; }
        });
        batches.clear();
        keepUnbatched.clear();
        if (phIM) { var sc2 = gScene(); if (sc2) sc2.remove(phIM); phIM.dispose(); phIM = null; phCap = 0; }
    }

    // ---- 巡检（2s 自愈）：注册新占位盒/新加载的几何体，丢弃失效条目 ----
    function woType(wo) { return wo.type || (wo.data && wo.data.type) || ''; }
    function sweep() {
        var wos = gWorldObjects(), scene = gScene();
        if (!wos || !scene || !scene.isScene) return;
        for (var i = 0; i < wos.length; i++) {
            var wo = wos[i];
            var mesh = wo.mesh;
            if (!mesh || !mesh.parent) continue;
            var u = mesh.userData || {};
            if (u.objectType === 'gaussian_splat') continue; // 3DGS 占位由独立模块管理
            var type = woType(wo);
            var isGeom = type.indexOf('geometry_') === 0;
            if (!isGeom && type !== 'uploaded_model') continue;
            if (wo.custom_config) continue; // 自定义配置对象不参与合批
            if (u._loaderMesh) registerPlaceholder(u._loaderMesh);
            if (u._phEls) {
                for (var j = 0; j < u._phEls.length; j++) registerPlaceholder(u._phEls[j]);
            }
            if (isGeom) {
                if (u._realMesh) tryBatchGroup(u._realMesh);
                else {
                    // 未加载的几何建筑：注册初始占位盒
                    for (var k = 0; k < mesh.children.length; k++) registerPlaceholder(mesh.children[k]);
                }
            } else {
                // uploaded_model 未加载：注册加载指示盒
                for (var k2 = 0; k2 < mesh.children.length; k2++) registerPlaceholder(mesh.children[k2]);
            }
        }
    }

    // ---- 每帧驱动（渲染前） ----
    var lastStat = 0;
    function tick() {
        var scene = gScene();
        if (!scene || !scene.isScene) return;
        syncPlaceholders(scene);
        syncBatches(scene);
        var now = performance.now();
        if (now - lastStat > 10000) {
            lastStat = now;
            var bs = 0; batches.forEach(function (b) { bs += b.sources.length; });
            console.log('[EditorPerf] 占位盒镜像 ' + phEntries.size + ' | 合批源 ' + bs + ' / 批次 ' + batches.size);
        }
    }

    // ================= 全局函数包装（接入点） =================
    // 选中/取消选中：选中拆批还原供编辑，取消后重新合批
    var origHighlight = window.highlightObject;
    window.highlightObject = function (mesh, hl) {
        try {
            var rg = mesh && mesh.userData && mesh.userData._realMesh;
            if (rg && geoGroups.has(rg)) {
                var rec = geoGroups.get(rg);
                if (hl) {
                    keepUnbatched.add(rg);
                    if (rec.batched) unbatchGroup(rec);
                } else if (keepUnbatched.delete(rg) && !rec.batched) {
                    batchGroup(rec);
                }
            }
        } catch (e) {}
        return origHighlight ? origHighlight(mesh, hl) : undefined;
    };

    // 释放前摘除注册（防批次引用已释放几何）
    var origDispose = window.disposeObject3D;
    window.disposeObject3D = function (root, shared) {
        try { if (root) dropRoot(root); } catch (e) {}
        return origDispose ? origDispose(root, shared) : undefined;
    };

    // 刷新场景前全量重置
    var origRefresh = window.refreshScene;
    window.refreshScene = function () {
        try { dropAll(); } catch (e) {}
        return origRefresh ? origRefresh.apply(this, arguments) : undefined;
    };

    // 每帧驱动：借道 3DGS tick（渲染前调用，顺序安全）；无则自建 rAF
    var origGauss = window.onEditorGaussianTick;
    window.onEditorGaussianTick = function (c, r) {
        if (origGauss) { try { origGauss(c, r); } catch (e) {} }
        tick();
    };
    if (!origGauss) {
        (function loop() { requestAnimationFrame(loop); tick(); })();
    }

    // 启动巡检
    sweep();
    setInterval(sweep, 2000);

    window.EditorPerf = {
        stats: function () {
            var bs = 0, im = 0;
            batches.forEach(function (b) { bs += b.sources.length; if (b.im) im++; });
            return { placeholderMirrors: phEntries.size, batchedSources: bs, batches: im, groups: geoGroups.size, keepUnbatched: keepUnbatched.size };
        },
        reset: dropAll,
        resweep: sweep
    };
    console.log('[EditorPerf] 已启用：占位盒实例化 + 几何实例合批（画面零变化）');
})();
