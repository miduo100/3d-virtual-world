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
    var phLayoutDirty = true;    // 条目增删后实例索引会整体位移 → 需整块重写

    function takeOverVisibility(mesh, ent) {
        // 拦截 visible 写入：编辑器的显隐逻辑照常工作（记录意图），
        // 渲染器读到恒 false，由 InstancedMesh 代为渲染
        var intent = mesh.visible;
        try {
            Object.defineProperty(mesh, 'visible', {
                configurable: true,
                get: function () { return false; },
                set: function (v) {
                    var nv = !!v;
                    if (nv === intent) return;
                    intent = nv;
                    // 显隐变化立即入待处理队列：分窗扫描可能还没轮到它，否则会出现
                    // "模型已经显示出来、蓝盒子却还盖在上面"的一两帧残影
                    if (!ent.pend) { ent.pend = true; phPend.push(ent); }
                }
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
        var ent = { size: size, material: m, getIntent: null, slot: -1, pend: false };
        if (!takeOverVisibility(mesh, ent)) return;
        phEntries.set(mesh, ent);
        phLayoutDirty = true; // 索引布局变化 → 下一次整块重写
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

    // 矩阵逐值比较（matrixWorld.elements 为 float64，零容差严格比较）
    function m4eq(a, e) {
        for (var k = 0; k < 16; k++) { if (a[k] !== e[k]) return false; }
        return true;
    }
    function m4copy(dst, e) {
        for (var k = 0; k < 16; k++) dst[k] = e[k];
    }

    // 脏更新：只写变化的实例，并用 addUpdateRange 只上传这些区段
    // （原实现每 2 帧把 3900+ 个实例全量 setMatrixAt + 整块 bufferSubData，实测 2.2~2.6ms/帧）
    var phList = [];        // ent 数组（下标 = 实例槽位；Map 不能按下标切片，故另存一份）
    var phCursor = 0;       // 分窗扫描游标
    var phPend = [];        // 显隐刚变化的条目（优先写，避免"模型已出现蓝盒子还在"）
    var focusRoots = new Set(); // 当前选中/高亮对象（其占位盒每帧都写，保证拖动时盒子跟手）
    var _fullSync = false, _runS = -1, _runE = -1, _dirtyCount = 0;

    function rebuildPhList() {
        phList.length = 0;
        phEntries.forEach(function (ent, mesh) {
            ent.mesh = mesh;
            ent.slot = phList.length;
            phList.push(ent);
        });
        phCursor = 0;
    }

    function markDirty(idx) {
        _dirtyCount++;
        if (_fullSync) return;                     // 整块上传时不需要区段
        var attr = phIM.instanceMatrix;
        if (_runS < 0) { _runS = _runE = idx; }
        else if (idx === _runE + 1) { _runE = idx; }
        else { attr.addUpdateRange(_runS * 16, (_runE - _runS + 1) * 16); _runS = _runE = idx; }
    }

    function writePhEntry(ent, full) {
        var im = phIM;
        var i = ent.slot;
        var vis = ent.getIntent ? ent.getIntent() : false;
        if (vis) {
            var mw = ent.mesh.matrixWorld.elements;
            if (full || !ent.written || !ent.mw || !m4eq(ent.mw, mw)) {
                if (!ent.mw) ent.mw = new Float64Array(16);
                m4copy(ent.mw, mw);
                im.setMatrixAt(i, _tmpM.multiplyMatrices(ent.mesh.matrixWorld, sizeMat(ent.size)));
                ent.written = true;
                markDirty(i);
            }
            // 颜色按 r/g/b 直接比较：Color.getHex() 会走色彩空间转换（含 pow），
            // 3940 个实例每次各调一次实测占同步耗时的大头。
            var col = ent.material.color;
            if (full || ent.cr !== col.r || ent.cg !== col.g || ent.cb !== col.b) {
                im.setColorAt(i, col);
                ent.cr = col.r; ent.cg = col.g; ent.cb = col.b;
                if (im.instanceColor) im.instanceColor.needsUpdate = true;
            }
        } else if (full || ent.written) {
            // 隐藏 → 写零矩阵（一次），省掉后续每次重复写
            im.setMatrixAt(i, ZERO);
            ent.written = false;
            ent.mw = null;
            markDirty(i);
        }
    }

    function syncPlaceholders(scene, doCleanup) {
        // 清理失效条目（对象已删除/刷新）——爬父链较贵，改成按需低频执行（见 tick）
        if (doCleanup) {
            phEntries.forEach(function (ent, mesh) {
                if (rootOf(mesh) !== scene) { phEntries.delete(mesh); phLayoutDirty = true; }
            });
        }
        if (phEntries.size === 0) { if (phIM) phIM.count = 0; return; }
        ensurePhIM(phEntries.size, scene);
        var im = phIM;
        // full：索引布局变了（条目增删）或首次同步 → 整块重写 + 整块上传（不带 updateRanges）
        var full = phLayoutDirty;
        if (full) { rebuildPhList(); phLayoutDirty = false; }
        _fullSync = full; _runS = -1; _runE = -1; _dirtyCount = 0;

        // 1) 显隐刚变化的条目（通常个位数）：立即写
        while (phPend.length) {
            var e0 = phPend.pop();
            e0.pend = false;
            // 条目可能已被清理（删除/刷新）→ 校验仍是当前注册表里的同一个条目，防写到别人的槽位
            if (e0.slot >= 0 && e0.mesh && phEntries.get(e0.mesh) === e0) writePhEntry(e0, full);
        }
        // 2) 选中/高亮对象：其占位盒每次同步都写，保证拖动时盒子跟手
        focusRoots.forEach(function (root) {
            if (!root) return;
            for (var c = 0; c < root.children.length; c++) {
                var ch = root.children[c];
                var e1 = phEntries.get(ch);
                if (e1) writePhEntry(e1, full);
                for (var c2 = 0; c2 < ch.children.length; c2++) {
                    var e2 = phEntries.get(ch.children[c2]);
                    if (e2) writePhEntry(e2, full);
                }
            }
        });
        // 3) 其余条目分两窗轮扫：3960 个条目全扫约 1.8ms（主要是矩阵缓存未命中），
        //    半窗约 0.9ms，两窗覆盖一次。位置变化只可能来自 gizmo（已在第 2 段覆盖）。
        var total = phList.length;
        var start = 0, end = total;
        if (!full && total > 256) {
            // 【会话2】窗口从 1/2 降到 1/4：这 3900+ 个条目里只有「当前选中对象」的盒子会动
            // （focusRoots 每轮必写），其余模型的位置根本不变，纯防御性重算。
            // 1/4 窗口 → 4 次同步覆盖一轮（≈8 帧 / 133ms），单次扫描成本降到约 1/4。
            var win = Math.ceil(total / 4);
            start = phCursor;
            end = Math.min(total, start + win);
            phCursor = end >= total ? 0 : end;
        }
        for (var k = start; k < end; k++) writePhEntry(phList[k], full);

        im.count = total;
        if (_dirtyCount > 0) {
            if (!full && _runS >= 0) im.instanceMatrix.addUpdateRange(_runS * 16, (_runE - _runS + 1) * 16);
            im.instanceMatrix.needsUpdate = true;
        }
        statPhDirtyWrites += _dirtyCount;
        if (full) statPhWriteWrites += total;
    }

    // ================= B2 几何对象实例合批 =================
    var geoGroups = new Map();      // realGroup -> { sources: [], batched }
    var keepUnbatched = new Set();  // 选中对象的 realGroup（保持还原供编辑）
    var batches = new Map();        // key -> { key, geometry, material, sources, im, dirty }
    var _syncBPending = false;      // 源增删后置位：下一帧立即同步一次（不等 4 帧节拍）
    var _batchEnabled = true;       // 诊断开关：EditorPerf.setBatchEnabled(false) 可临时关掉几何合批

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
        var emissive = m.emissive ? m.emissive.getHexString() : '-';
        // 黑色自发光下 emissiveIntensity 对画面无影响：highlightObject 取消选中时会把该值
        // 归零，若把它算进签名，「选过一次」的对象就会永久分裂成新批次（模板几何 1400+ 源时
        // 批次数量会随点选次数不断增长）。
        var emInt = (emissive !== '-' && emissive !== '000000' && m.emissiveIntensity !== undefined)
            ? m.emissiveIntensity : '-';
        return [m.type,
            m.color ? m.color.getHexString() : '-',
            emissive, m.opacity, m.transparent ? 1 : 0, m.wireframe ? 1 : 0,
            m.map ? m.map.uuid : '-',
            emInt,
            // 模板几何（GeometryTemplates）大量使用 Lambert/Standard：下面几项一旦不同，
            // 合批后就会出现肉眼可见差异（单/双面、平滑、顶点色、粗糙度/金属度）。
            m.side !== undefined ? m.side : '-',
            m.flatShading ? 1 : 0,
            m.vertexColors ? 1 : 0,
            m.roughness !== undefined ? m.roughness : '-',
            m.metalness !== undefined ? m.metalness : '-'].join('|');
    }

    function collectSources(realGroup) {
        var out = [];
        realGroup.traverse(function (child) {
            if (!child.isMesh || child.isSkinnedMesh) return;
            var ud = child.userData || {};
            if (ud.isPickProxy || ud.gsPlaceholder || ud.gsProgress) return;
            if (!child.geometry || !child.geometry.attributes || !child.geometry.attributes.position) return;
            if (child.geometry.morphAttributes && Object.keys(child.geometry.morphAttributes).length) return;
            if (Array.isArray(child.material)) return;
            // 占位线框盒（MeshBasicMaterial + wireframe）由 B1 占位镜像代渲染，绝不进合批
            if (child.material && child.material.isMeshBasicMaterial && child.material.wireframe) return;
            out.push(child);
        });
        return out;
    }

    // ---- 源显隐：源自身的 visible 被接管后仍需保留「编辑器显隐意图」 ----
    // 单 Mesh 模板几何（GeometryTemplates 里 `return mesh` 的那批）的源就是对象根，
    // 直接 `src.visible = false` 会把「用户隐藏对象」与「合批接管渲染」两种语义搅拌在一起
    // （读 chainVisible 永远 false → 实例被写成零矩阵，合批后什么都看不到）。
    // 这里照抄占位镜像的做法：拦截 visible 写入，getter 恒 false（渲染器跳过），
    // setter 只记录意图；同步时按意图决定实例矩阵。
    function takeOverSourceVisibility(src) {
        var intent = !!src.visible;
        try {
            Object.defineProperty(src, 'visible', {
                configurable: true,
                enumerable: true,
                get: function () { return false; },
                set: function (v) { intent = !!v; }
            });
        } catch (e) { return false; }
        src.__epVisIntent = function () { return intent; };
        src.__epVisTaken = true;
        return true;
    }

    function releaseSourceVisibility(src) {
        var intent = src.__epVisTaken && src.__epVisIntent ? src.__epVisIntent() : true;
        try {
            Object.defineProperty(src, 'visible', {
                value: intent, writable: true, configurable: true, enumerable: true
            });
        } catch (e) { try { src.visible = intent; } catch (e2) {} }
        src.__epVisTaken = false;
        src.__epVisIntent = null;
    }

    // 源是否应当显示（编辑器语义）：realGroup 的祖先链 + realGroup 自身/意图
    function sourceVisible(src) {
        var rg = src.__epRealGroup;
        if (!rg) return false;
        var n;
        if (rg === src) {
            // 源即对象根：自身 visible 已被接管，改看意图 + 祖先链
            if (src.__epVisIntent && src.__epVisIntent() === false) return false;
            n = rg.parent;
        } else {
            n = rg;
        }
        while (n) { if (!n.visible) return false; n = n.parent; }
        return true;
    }

    // realGroup 级显隐（同一组的源共享结论；rg === 源自身时看显隐意图）
    function groupVisible(rec) {
        var rg = rec.realGroup;
        if (!rg) return false;
        var n;
        if (rg === rec.sources[0]) {
            if (rg.__epVisIntent && rg.__epVisIntent() === false) return false;
            n = rg.parent;
        } else {
            n = rg;
        }
        while (n) { if (!n.visible) return false; n = n.parent; }
        return true;
    }

    // 强制刷新 realGroup 及其子节点的世界矩阵。
    // ★ 为什么必须：实例矩阵是从 src.matrixWorld 抄的，而「父节点 matrixWorld 已更新、
    //   子节点还是单位矩阵」是真实会出现的状态（对象刚被 add 进场景、或异步挂载真实模型后
    //   还没渲染过一帧）。会话2 实测：一次错误的首写 + 组级短路（组没变就不再逐源比对）
    //   = 1300+ 个实例永久停在原点，画面表现为「合批后大量模型消失」。
    function forceMatrices(rg) {
        if (!rg || typeof rg.updateWorldMatrix !== 'function') return;
        try { rg.updateWorldMatrix(true, true); } catch (e) {}
    }

    // 组级「世界矩阵 + 显隐」是否与上次同步一致（一致 → 整组源的实例矩阵已经正确）
    function groupUnchanged(rec, vis) {
        var rg = rec.realGroup;
        if (!rg || !rec._mw) return false;
        if (rec._vis !== vis) return false;
        var mw = rg.matrixWorld.elements;
        for (var k = 0; k < 16; k++) { if (rec._mw[k] !== mw[k]) return false; }
        return true;
    }

    function groupStamp(rec, vis) {
        var rg = rec.realGroup;
        if (!rg) return;
        if (!rec._mw) rec._mw = new Float64Array(16);
        var mw = rg.matrixWorld.elements;
        for (var k = 0; k < 16; k++) rec._mw[k] = mw[k];
        rec._vis = vis;
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
            src.__epRec = rec;
            src.__epRealGroup = rec.realGroup;
            // 接管渲染，源保留在场景树（拾取/包围球/释放链路不变）
            if (rec.realGroup === src) takeOverSourceVisibility(src);
            else src.visible = false;
        });
        rec.batched = true;
        forceMatrices(rec.realGroup);   // 首写前强制刷新父子矩阵（防实例停在原点）
        rec._mw = null;                 // 让下一次组级预扫判定为「变了」，再刷一遍
        _syncBPending = true;   // 立即同步（新合批的源不能等到 4 帧节拍）
        _syncBPending = true;   // 立即同步（新合批的源不能等到 4 帧节拍）
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
            src.__epRec = null;
            // 还原为独立渲染（选中编辑态），保留用户此前的显隐意图
            releaseSourceVisibility(src);
        });
        rec.batched = false;
        _syncBPending = true;   // 拆批后立即清掉旧实例矩阵
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

    function tryBatchGroup(realGroup, isTemplate) {
        if (!_batchEnabled) return;
        if (!realGroup || !realGroup.isObject3D || geoGroups.has(realGroup)) return;
        if (keepUnbatched.has(realGroup)) return;
        var sources = collectSources(realGroup);
        if (!sources.length) return;
        var rec = { realGroup: realGroup, sources: sources, batched: false, template: !!isTemplate };
        geoGroups.set(realGroup, rec);
        batchGroup(rec);
    }

    function chainVisible(node) {
        var n = node;
        while (n) { if (!n.visible) return false; n = n.parent; }
        return true;
    }

    function syncBatches(scene) {
        // 【组级短路】模板几何合批后源数量 1400+，逐源读 matrixWorld 比对约 0.5ms/次。
        // 编辑器只改「对象根」的变换（子 mesh 从不单独动），所以先按组判一次：
        // 整组世界矩阵 + 显隐都没变 → 该组所有源的实例矩阵已经是正确的，整组跳过。
        // 结论直接写在 rec 上（_dirty/_vis），不再每次同步 new 两个 Map（366 条目 × 每秒 30 次）。
        var _tg0 = performance.now();
        geoGroups.forEach(function (rec) {
            if (!rec.batched) return;
            var gv = groupVisible(rec);
            rec._dirty = !groupUnchanged(rec, gv);
            // 变了才需要重写；重写前强制刷新父子矩阵，避免抄到「父新子旧」的半成品矩阵
            if (rec._dirty) { forceMatrices(rec.realGroup); groupStamp(rec, gv); }
            rec._vis = gv;
        });
        statSyncBG += performance.now() - _tg0;
        var _ts0 = performance.now();
        batches.forEach(function (batch) {
            var rebuilt = false;
            if (batch.dirty) { rebuildBatch(batch, scene); batch.dirty = false; rebuilt = true; }
            if (!batch.im) return;
            var im = batch.im;
            // 结构变了（重建 / 源增删）→ 缓存失效，整块重写
            var full = rebuilt || !batch.cache || batch.cache.length !== batch.sources.length;
            if (full) { batch.cache = new Array(batch.sources.length); batch.vis = new Uint8Array(batch.sources.length); }
            var runS = -1, runE = -1, dirtyCount = 0;
            function mark(idx) {
                dirtyCount++;
                if (full) return;
                if (runS < 0) { runS = runE = idx; }
                else if (idx === runE + 1) { runE = idx; }
                else { im.instanceMatrix.addUpdateRange(runS * 16, (runE - runS + 1) * 16); runS = runE = idx; }
            }
            for (var i = 0; i < batch.sources.length; i++) {
                var src = batch.sources[i];
                var rec = src.__epRec;
                var vis = rec ? rec._vis : sourceVisible(src);
                // 整组未变 → 无需逐源比对
                if (!full && rec && rec._dirty === false) continue;
                var wasVis = batch.vis[i] === 1;
                if (vis) {
                    var mw = src.matrixWorld.elements;
                    var cache = batch.cache[i];
                    if (full || !wasVis || !cache || !m4eq(cache, mw)) {
                        if (!cache) cache = batch.cache[i] = new Float64Array(16);
                        m4copy(cache, mw);
                        im.setMatrixAt(i, src.matrixWorld);
                        batch.vis[i] = 1;
                        mark(i);
                    }
                } else if (full || wasVis) {
                    im.setMatrixAt(i, ZERO);
                    batch.vis[i] = 0;
                    batch.cache[i] = null;
                    mark(i);
                }
            }
            if (dirtyCount > 0) {
                if (!full && runS >= 0) im.instanceMatrix.addUpdateRange(runS * 16, (runE - runS + 1) * 16);
                im.instanceMatrix.needsUpdate = true;
            }
            statBatchDirtyWrites += dirtyCount;
        });
        statSyncBS += performance.now() - _ts0;
    }

    // ================= 生命周期 =================
    function dropRoot(root) {
        phEntries.forEach(function (ent, mesh) {
            if (rootOf(mesh) === root) { phEntries.delete(mesh); phLayoutDirty = true; }
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
        phLayoutDirty = true;
        phList.length = 0; phPend.length = 0; phCursor = 0; focusRoots.clear();
        if (phIM) { var sc2 = gScene(); if (sc2) sc2.remove(phIM); phIM.dispose(); phIM = null; phCap = 0; }
    }

    // ---- 巡检（2s 自愈）：注册新占位盒/新加载的几何体，丢弃失效条目 ----
    function woType(wo) { return wo.type || (wo.data && wo.data.type) || ''; }

    // 旧格式模板几何识别（会话2 P1-1）：
    //   geometry:nature/decoration/... 由 GeometryTemplates 同步生成，wo.mesh 子树就是真实几何，
    //   既没有 _realMesh（异步 GLB/API 渲染产物才有），也没有 pendingGeometry（geometry_building 占位盒才有）。
    function isTemplateGeom(u) {
        if (!u) return false;
        if (u._realMesh || u.pendingGeometry || u.pendingGlb) return false;
        if (u.objectType === 'geometry_building' || u.objectType === 'gaussian_splat') return false;
        return true;
    }

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
                else if (isTemplateGeom(u)) {
                    // 【会话2 P1-1】旧格式模板几何（GeometryTemplates 同步生成）：
                    // wo.mesh 本身就是真实几何容器，没有 _realMesh/占位链路 → 直接合批
                    tryBatchGroup(mesh, true);
                } else {
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
    var tickCount = 0;
    // tick 自身耗时统计（供验收脚本读取；只累加两个计数器，零额外遍历）
    var statTickCount = 0, statTickSum = 0, statTickMax = 0, statTickLast = 0;
    var statPhDirtyWrites = 0, statPhWriteWrites = 0, statBatchDirtyWrites = 0;
    var statSyncP = 0, statSyncB = 0, statSyncN = 0;
    var statSyncBG = 0, statSyncBS = 0;   // syncB 内部分解：组级扫描 / 逐源循环
    function tick() {
        var scene = gScene();
        if (!scene || !scene.isScene) return;
        var _t0 = performance.now();
        tickCount++;
        // 占位盒镜像每 2 帧一次（拖动时必须跟手）；失效条目清理要逐个爬父链，降到每 60 帧
        // （2s 一次，与 sweep 同量级即可——清理只兜「对象被删除/刷新」的残留）。
        if (tickCount % 2 === 0) {
            var _a = performance.now();
            syncPlaceholders(scene, tickCount % 60 === 0);
            statSyncP += performance.now() - _a;
        }
        // 合批同步每 4 帧一次 + 事件触发即时同步（选中拆批/取消重新合批时立刻补一次，
        // 否则最多 3 帧看到"零矩阵"的空档）。拖动中的对象在选中时已拆批，不受这 4 帧影响。
        if (tickCount % 4 === 0 || _syncBPending) {
            _syncBPending = false;
            var _b = performance.now();
            syncBatches(scene);
            statSyncB += performance.now() - _b;
            statSyncN++;
        }
        var _dt = performance.now() - _t0;
        statTickLast = _dt;
        statTickSum += _dt;
        statTickCount++;
        if (_dt > statTickMax) statTickMax = _dt;
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
            // 选中对象的占位盒每次同步都写（拖动时盒子必须跟手，不能等分窗轮扫）
            if (mesh) { if (hl) focusRoots.add(mesh); else focusRoots.delete(mesh); }
            // realGroup 两种形态：uploaded_model/geometry_building 的 _realMesh（异步容器），
            // 以及模板几何的 wo.mesh 本身（会话2 P1-1）。后者没有 _realMesh，得按对象根查表。
            var rg = (mesh && mesh.userData && mesh.userData._realMesh) || null;
            if (!rg && mesh && geoGroups.has(mesh)) rg = mesh;
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
            var tg = 0, tgs = 0;
            geoGroups.forEach(function (rec) {
                if (!rec.template) return;
                tg++;
                tgs += rec.sources.length;
            });
            return {
                placeholderMirrors: phEntries.size, batchedSources: bs, batches: im,
                templateGroups: tg, templateSources: tgs,
                groups: geoGroups.size, keepUnbatched: keepUnbatched.size,
                tickCount: statTickCount, tickSumMs: statTickSum,
                tickMaxMs: statTickMax, tickLastMs: statTickLast,
                phDirtyTotal: statPhDirtyWrites, phWriteTotal: statPhWriteWrites, syncP: statSyncP, syncB: statSyncB, syncN: statSyncN,
                syncBG: statSyncBG, syncBS: statSyncBS,
                batchDirtyTotal: statBatchDirtyWrites
            };
        },
        reset: dropAll,
        resweep: sweep,
        // 诊断/验收：临时关掉几何合批（占位盒镜像 B1 继续工作），用于「合批前后像素对比」
        setBatchEnabled: function (on) {
            _batchEnabled = !!on;
            if (!_batchEnabled) {
                geoGroups.forEach(function (rec) { unbatchGroup(rec); });
                geoGroups.clear();
                batches.forEach(function (b) {
                    if (b.im) { var sc = gScene(); if (sc) sc.remove(b.im); b.im.dispose(); b.im = null; }
                });
                batches.clear();
            } else {
                _syncBPending = true;
                sweep();
            }
            return _batchEnabled;
        },
        // 诊断：某个世界对象的合批状态（验收/现场排查「选中后是否已退出合批」）
        inspect: function (id) {
            var wos = gWorldObjects();
            if (!wos) return null;
            for (var i = 0; i < wos.length; i++) {
                if (String(wos[i].id) !== String(id)) continue;
                var m = wos[i].mesh, u = (m && m.userData) || {};
                var rg = u._realMesh || m;
                var rec = geoGroups.get(rg);
                return {
                    id: wos[i].id, type: woType(wos[i]),
                    hasRealMesh: !!u._realMesh,
                    template: !!(rec && rec.template),
                    batched: !!(rec && rec.batched),
                    sources: rec ? rec.sources.length : 0,
                    keepUnbatched: keepUnbatched.has(rg),
                    rootVisible: m ? m.visible : null
                };
            }
            return null;
        },
        // 自检（会话2）：抽样比对「批次实例矩阵」与「源 mesh 的 matrixWorld」，
        // 返回不一致个数——合批后画面异常时先跑它（不信赖可见性，只看矩阵）。
        verifyBatches: function (n) {
            var limit = n || 400, checked = 0, bad = 0, worst = 0, sample = null;
            var got = new THREE.Matrix4();
            batches.forEach(function (batch) {
                if (!batch.im) return;
                for (var i = 0; i < batch.sources.length && checked < limit; i++) {
                    var src = batch.sources[i];
                    if (batch.vis[i] !== 1) continue;
                    checked++;
                    batch.im.getMatrixAt(i, got);
                    var exp = src.matrixWorld.elements;
                    var d = 0;
                    for (var k = 0; k < 16; k++) {
                        var tol = Math.max(1e-4, Math.abs(exp[k]) * 1e-6);
                        var dd = Math.abs(got.elements[k] - exp[k]) - tol;
                        if (dd > 0) d += dd;
                    }
                    if (d > 0) {
                        bad++;
                        if (d > worst) {
                            worst = d;
                            sample = {
                                objId: (function () {
                                    var r = src.__epRealGroup;
                                    return r && r.userData ? r.userData.objectId : null;
                                })(),
                                groupPos: (function () {
                                    var r = src.__epRealGroup;
                                    return r ? [r.position.x, r.position.y, r.position.z] : null;
                                })(),
                                instPos: [got.elements[12], got.elements[13], got.elements[14]],
                                srcPos: [exp[12], exp[13], exp[14]]
                            };
                        }
                    }
                }
            });
            return { checked: checked, bad: bad, worst: worst, sample: sample };
        },
        // 诊断：按源数量排序的批次概览（验收看「几何签名+材质签名」是否真的合到预期批次）
        batchTop: function (n) {
            var arr = [];
            batches.forEach(function (b) {
                if (!b.im) return;
                arr.push({ key: b.key, sources: b.sources.length });
            });
            arr.sort(function (a, b) { return b.sources - a.sources; });
            return arr.slice(0, n || 20);
        },
        // 自检：抽样比对「占位盒镜像实例矩阵」与「模型矩阵 × 盒子尺寸」，返回不一致个数。
        // 用于验收/现场排查（分窗扫描是否漏写、写错槽位）。
        verify: function (n) {
            if (!phIM) return { checked: 0, bad: 0 };
            var limit = n || 80, checked = 0, bad = 0, worst = 0;
            var got = new THREE.Matrix4();
            for (var i = 0; i < phList.length && checked < limit; i++) {
                var ent = phList[i];
                if (!ent.written || !ent.mesh) continue;
                checked++;
                _tmpM.multiplyMatrices(ent.mesh.matrixWorld, sizeMat(ent.size));
                phIM.getMatrixAt(ent.slot, got);
                // instanceMatrix 是 Float32Array，几千米远处 float32 精度约 1e-4，
                // 故按相对容差比较（1e-6 相对误差），而不是绝对相等。
                var d = 0;
                for (var k = 0; k < 16; k++) {
                    var exp = _tmpM.elements[k];
                    var tol = Math.max(1e-4, Math.abs(exp) * 1e-6);
                    var dd = Math.abs(got.elements[k] - exp) - tol;
                    if (dd > 0) d += dd;
                }
                if (d > 0) { bad++; if (d > worst) worst = d; }
            }
            return { checked: checked, bad: bad, worst: worst };
        }
    };
    console.log('[EditorPerf] 已启用：占位盒实例化 + 几何实例合批（画面零变化）');
})();
