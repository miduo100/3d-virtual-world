/**
 * worldBoxLayer.js — 世界「方框层」原型（只做视觉，不参与拾取）
 * ------------------------------------------------------------------
 * 目的：验证「把 9000+ 个对象画成合批方框」到底能省多少帧时间。
 *
 * 设计（已与用户确认）：
 *   · 方框只用于标注「这里有模型」，不参与拾取；能点的是已经加载出来的真模型
 *   · 近处：一个对象一个方框（detail 层）
 *   · 远处：整块聚合成一个大方框（merged 层），相机拉近自动分裂成小方框
 *   · 按 128m 空间分块，每块两个 InstancedMesh —— three.js 能对整块做视锥剔除
 *
 * 本文件不修改 world_editor.html 的任何现有逻辑：
 *   · 加一行 <script src="js/worldBoxLayer.js"> 即可加载，但默认不启用
 *   · 启用：WorldBoxLayer.enable()   关闭：WorldBoxLayer.disable()
 *   · 对比用：WorldBoxLayer.hideRealObjects() / showRealObjects()
 *
 * 统计：WorldBoxLayer.stats()
 */
(function () {
    'use strict';
    if (window.WorldBoxLayer) return;

    const CHUNK = 128;          // 分块边长（米）
    const DETAIL_R = 400;       // 这个距离内画「每个对象一个小方框」，之外整块聚合成一个大方框
    const BOX_MIN = 1.2;        // 方框最小边长，避免小零件看不见

    let enabled = false;
    let root = null;
    let boxGeo = null;
    let matDetail = null;
    let matMerged = null;
    let chunks = new Map();     // key "cx,cz" -> { detail, merged, cx, cz, count, centerX, centerZ }
    let updateTimer = null;
    let lastCamX = 1e9, lastCamZ = 1e9;

    function api() {
        try {
            if (typeof THREE === 'undefined') return null;
            if (typeof scene === 'undefined' || !scene) return null;
            if (typeof camera === 'undefined' || !camera) return null;
            if (typeof worldObjects === 'undefined') return null;
            return { THREE: THREE, scene: scene, camera: camera, worldObjects: worldObjects };
        } catch (e) {
            return null;    // TDZ / 尚未初始化
        }
    }

    function ensureAssets() {
        if (boxGeo) return;
        boxGeo = new THREE.BoxGeometry(1, 1, 1);
        matDetail = new THREE.MeshBasicMaterial({
            color: 0x3fd0ff, wireframe: true, transparent: true, opacity: 0.55, depthWrite: false
        });
        matMerged = new THREE.MeshBasicMaterial({
            color: 0xffb454, wireframe: true, transparent: true, opacity: 0.45, depthWrite: false
        });
    }

    function disposeChunks() {
        chunks.forEach(function (c) {
            if (c.detail) { root.remove(c.detail); c.detail.dispose(); }
            if (c.merged) { root.remove(c.merged); c.merged.dispose(); }
        });
        chunks.clear();
    }

    // 取对象的世界位置与尺寸（优先用拾取球缓存，避免对 9000 个对象算 Box3）
    let _v = null;
    function objectWorldBox(obj) {
        const mesh = obj && obj.mesh;
        if (!mesh) return null;
        if (!_v) _v = new THREE.Vector3();
        const sph = mesh.userData && mesh.userData._pickSphere;
        let cx, cy, cz, size;
        if (sph && sph.center) {
            _v.copy(sph.center).applyMatrix4(mesh.matrixWorld);
            cx = _v.x; cy = _v.y; cz = _v.z;
            const e = mesh.matrixWorld.elements;
            const sx = Math.sqrt(e[0] * e[0] + e[1] * e[1] + e[2] * e[2]);
            const sy = Math.sqrt(e[4] * e[4] + e[5] * e[5] + e[6] * e[6]);
            const sz = Math.sqrt(e[8] * e[8] + e[9] * e[9] + e[10] * e[10]);
            size = Math.max(BOX_MIN, sph.radius * 2 * Math.max(sx, sy, sz));
        } else {
            mesh.getWorldPosition(_v);
            cx = _v.x; cy = _v.y; cz = _v.z;
            const s = mesh.getWorldScale(new THREE.Vector3());
            size = Math.max(BOX_MIN, 2 * Math.max(s.x, s.y, s.z));
        }
        return { x: cx, y: cy, z: cz, size: size };
    }

    function build() {
        const ctx = api();
        if (!ctx) return false;
        ensureAssets();
        disposeChunks();

        if (!root) {
            root = new THREE.Group();
            root.name = '__boxLayer__';
            root.userData.isBoxLayer = true;
            ctx.scene.add(root);
        }

        // 1) 按 128m 网格分桶
        const buckets = new Map();
        const objs = ctx.worldObjects;
        let valid = 0;
        for (let i = 0; i < objs.length; i++) {
            const b = objectWorldBox(objs[i]);
            if (!b) continue;
            valid++;
            const cx = Math.floor(b.x / CHUNK);
            const cz = Math.floor(b.z / CHUNK);
            const key = cx + ',' + cz;
            let arr = buckets.get(key);
            if (!arr) { arr = { cx: cx, cz: cz, items: [] }; buckets.set(key, arr); }
            arr.items.push(b);
        }

        // 2) 每块建两个 InstancedMesh：detail（每对象一个）/ merged（整块一个）
        buckets.forEach(function (bucket) {
            const items = bucket.items;
            if (!items.length) return;

            const detail = new THREE.InstancedMesh(boxGeo, matDetail, items.length);
            detail.frustumCulled = true;
            detail.userData.isBoxLayer = true;
            const m = new THREE.Matrix4();
            let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
            for (let i = 0; i < items.length; i++) {
                const it = items[i];
                m.makeScale(it.size, it.size, it.size);
                m.setPosition(it.x, it.y, it.z);
                detail.setMatrixAt(i, m);
                if (it.x - it.size / 2 < minX) minX = it.x - it.size / 2;
                if (it.y - it.size / 2 < minY) minY = it.y - it.size / 2;
                if (it.z - it.size / 2 < minZ) minZ = it.z - it.size / 2;
                if (it.x + it.size / 2 > maxX) maxX = it.x + it.size / 2;
                if (it.y + it.size / 2 > maxY) maxY = it.y + it.size / 2;
                if (it.z + it.size / 2 > maxZ) maxZ = it.z + it.size / 2;
            }
            detail.instanceMatrix.needsUpdate = true;
            detail.computeBoundingSphere();

            // 聚合块：用块内对象的 AABB 中心与尺寸（比固定 128m 贴合实际分布）
            const merged = new THREE.InstancedMesh(boxGeo, matMerged, 1);
            merged.frustumCulled = true;
            merged.userData.isBoxLayer = true;
            const w = Math.max(BOX_MIN, maxX - minX);
            const h = Math.max(BOX_MIN, maxY - minY);
            const d = Math.max(BOX_MIN, maxZ - minZ);
            const mm = new THREE.Matrix4();
            mm.makeScale(w, h, d);
            mm.setPosition((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
            merged.setMatrixAt(0, mm);
            merged.instanceMatrix.needsUpdate = true;
            merged.computeBoundingSphere();

            root.add(detail);
            root.add(merged);

            chunks.set(bucket.cx + ',' + bucket.cz, {
                detail: detail,
                merged: merged,
                cx: bucket.cx,
                cz: bucket.cz,
                count: items.length,
                centerX: (minX + maxX) / 2,
                centerZ: (minZ + maxZ) / 2
            });
        });

        window.__boxLayerBuild = { chunks: chunks.size, objects: valid };
        return true;
    }

    // 按相机距离切换 detail / merged（同一个块二选一，不重复画）
    function updateVisibility() {
        const ctx = api();
        if (!ctx || !chunks.size) return;
        const cp = ctx.camera.position;
        const lim2 = DETAIL_R * DETAIL_R;
        let detailChunks = 0, mergedChunks = 0;
        chunks.forEach(function (c) {
            const dx = c.centerX - cp.x;
            const dz = c.centerZ - cp.z;
            const near = (dx * dx + dz * dz) <= lim2;
            if (c.detail) c.detail.visible = near;
            if (c.merged) c.merged.visible = !near;
            if (near) detailChunks++; else mergedChunks++;
        });
        window.__boxLayerView = { detailChunks: detailChunks, mergedChunks: mergedChunks };
    }

    function tick() {
        if (!enabled) return;
        const ctx = api();
        if (ctx) {
            const cp = ctx.camera.position;
            const moved = Math.abs(cp.x - lastCamX) + Math.abs(cp.z - lastCamZ);
            if (moved > 8) {     // 相机移动超过 8m 才重算，避免每帧都算
                lastCamX = cp.x;
                lastCamZ = cp.z;
                updateVisibility();
            }
        }
        updateTimer = setTimeout(tick, 250);
    }

    function enable() {
        if (enabled) return;
        if (!build()) { console.warn('[BoxLayer] 场景未就绪，稍后重试'); setTimeout(function () { if (!enabled) enable(); }, 1000); return; }
        enabled = true;
        lastCamX = 1e9;
        updateVisibility();
        tick();
        console.log('[BoxLayer] 已启用', window.__boxLayerBuild);
    }

    function disable() {
        enabled = false;
        if (updateTimer) { clearTimeout(updateTimer); updateTimer = null; }
        if (root) { root.visible = false; }
        console.log('[BoxLayer] 已关闭');
    }

    // ===== 对比用：临时隐藏/恢复「真模型层」（只动 worldObjects 的 mesh，不动方框层）=====
    function hideRealObjects() {
        const ctx = api();
        if (!ctx) return;
        ctx.worldObjects.forEach(function (o) {
            if (o && o.mesh) o.mesh.visible = false;
        });
        console.log('[BoxLayer] 已隐藏真模型层');
    }
    function showRealObjects() {
        const ctx = api();
        if (!ctx) return;
        ctx.worldObjects.forEach(function (o) {
            if (o && o.mesh) o.mesh.visible = true;
        });
        console.log('[BoxLayer] 已恢复真模型层');
    }

    function stats() {
        let detailInst = 0, mergedInst = 0;
        chunks.forEach(function (c) {
            detailInst += c.detail ? c.detail.count : 0;
            mergedInst += c.merged ? c.merged.count : 0;
        });
        return {
            chunks: chunks.size,
            detailInstances: detailInst,
            mergedInstances: mergedInst,
            chunkSize: CHUNK,
            detailRadius: DETAIL_R,
            render: window.__boxLayerView || null,
            calls: (typeof renderer !== 'undefined' && renderer.info) ? renderer.info.render.calls : -1,
            triangles: (typeof renderer !== 'undefined' && renderer.info) ? renderer.info.render.triangles : -1
        };
    }

    window.WorldBoxLayer = {
        enable: enable,
        disable: disable,
        toggle: function () { enabled ? disable() : enable(); },
        rebuild: build,
        updateVisibility: updateVisibility,
        hideRealObjects: hideRealObjects,
        showRealObjects: showRealObjects,
        stats: stats,
        CHUNK: CHUNK,
        DETAIL_R: DETAIL_R
    };
})();
