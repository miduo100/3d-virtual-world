/**
 * 统一编辑器：世界对象模型按需加载器
 *
 * 背景：世界里有 1000+ 个对象（其中 700 个 uploaded_model，磁盘合计数 GB），
 * 旧逻辑在 loadWorldObjects() 里对每个对象立刻发起 GLB/OBJ 加载，
 * 浏览器瞬间并发上千个下载 + 主线程解析，页面直接卡死。
 *
 * 方案：
 *  1) 对象先以线框占位盒进入场景（位置/旋转/缩放与真实对象一致，可正常选中编辑）
 *  2) 只加载相机附近（radius）或处于视锥内的模型，按距离由近到远排队
 *  3) 全局并发上限（默认 2），避免下载/解析挤爆主线程
 *  4) 选中/聚焦的对象立即优先加载
 *  5) 面板提供「仅附近 / 全部加载 / 暂停」三档，随时切回旧行为
 */
(function (global) {
    'use strict';

    var PENDING = 0, LOADING = 1, DONE = 2, FAILED = 3;

    var DEFAULTS = {
        concurrency: 2,            // 同时加载的模型数
        radius: 150,               // 按需模式的加载半径（米）
        frustumRadiusFactor: 4,    // 视锥内对象的放宽倍数（radius * factor 内且在视锥内则加载）
        updateIntervalMs: 400,     // 相机静止时的重算间隔
        moveThreshold: 10,         // 相机移动超过该距离立即重算
        uiContainerId: 'object-list'
    };

    function now() {
        return (global.performance && global.performance.now) ? global.performance.now() : Date.now();
    }

    function dist3(a, b) {
        var dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }

    function WorldObjectLazyLoader() {
        this.cfg = {};
        for (var k in DEFAULTS) this.cfg[k] = DEFAULTS[k];
        this.items = new Map();
        this.queue = [];
        this.active = 0;
        this.mode = 'lazy';        // lazy = 按半径/视锥；all = 全部
        this.paused = false;
        this.deps = {};
        this._lastPos = null;
        this._lastUpdate = 0;
        this._dirty = true;
        this._ui = null;
    }

    WorldObjectLazyLoader.prototype.configure = function (opts) {
        opts = opts || {};
        for (var k in DEFAULTS) {
            if (opts[k] !== undefined) this.cfg[k] = opts[k];
        }
        this.deps = {
            createLoader: opts.createLoader,
            setupMeshopt: opts.setupMeshopt,
            ensureMeshopt: opts.ensureMeshopt,
            onLoaded: opts.onLoaded
        };
        this._initUI();
        this._updateUI();
        return this;
    };

    /** 注册一个需要按需加载的模型对象 */
    WorldObjectLazyLoader.prototype.register = function (item) {
        if (!item || item.id === undefined || item.id === null) return null;
        var rec = {
            id: String(item.id),
            rawId: item.id,
            position: item.position || { x: 0, y: 0, z: 0 },
            radius: item.radius || 1,
            placeholder: item.placeholder,
            loaderMesh: item.loaderMesh,
            loaderMaterial: item.loaderMaterial,
            modelPath: item.modelPath,
            modelType: item.modelType || 'gltf',
            state: PENDING,
            distance: Infinity,
            forced: false,
            removed: false
        };
        this.items.set(rec.id, rec);
        this._dirty = true;
        this._updateUI();
        return rec;
    };

    WorldObjectLazyLoader.prototype.unregister = function (id) {
        var rec = this.items.get(String(id));
        if (rec) rec.removed = true;
        this.items.delete(String(id));
        this._dirty = true;
        return !!rec;
    };

    /** 世界对象重建时调用：丢弃全部登记项与队列 */
    WorldObjectLazyLoader.prototype.clear = function () {
        var self = this;
        this.items.forEach(function (rec) { rec.removed = true; });
        this.items.clear();
        this.queue.length = 0;
        this._lastPos = null;
        this._dirty = true;
        this._updateUI();
        return self;
    };

    /** 选中对象时调用：无论距离立刻加载 */
    WorldObjectLazyLoader.prototype.prioritize = function (id) {
        var rec = this.items.get(String(id));
        if (!rec || rec.state !== PENDING) return false;
        rec.forced = true;
        this.queue.unshift(rec);
        this._pump();
        return true;
    };

    WorldObjectLazyLoader.prototype.setMode = function (mode) {
        this.mode = (mode === 'all') ? 'all' : 'lazy';
        this._dirty = true;
        this._pump2();
        return this;
    };

    WorldObjectLazyLoader.prototype.loadAll = function () { return this.setMode('all'); };

    WorldObjectLazyLoader.prototype.setPaused = function (p) {
        this.paused = !!p;
        if (!this.paused) { this._dirty = true; this._pump2(); }
        this._updateUI();
        return this;
    };

    WorldObjectLazyLoader.prototype.isLoaded = function (id) {
        var rec = this.items.get(String(id));
        return !!rec && rec.state === DONE;
    };

    /** 每帧调用（内部按时间/位移节流） */
    WorldObjectLazyLoader.prototype.update = function (camera) {
        var t = now();
        var pos = camera ? camera.position : null;
        var moved = false;
        if (pos) {
            if (!this._lastPos) {
                this._lastPos = { x: pos.x, y: pos.y, z: pos.z };
                moved = true;
            } else if (dist3(this._lastPos, pos) > this.cfg.moveThreshold) {
                this._lastPos = { x: pos.x, y: pos.y, z: pos.z };
                moved = true;
            }
        }
        if (!this._dirty && !moved && (t - this._lastUpdate) < this.cfg.updateIntervalMs) return;
        this._lastUpdate = t;
        if (this.items.size === 0) { this._dirty = false; return; }
        this._pump2(camera);
    };

    // 重算队列并派发
    WorldObjectLazyLoader.prototype._pump2 = function (camera) {
        if (camera) this._refreshQueue(camera);
        this._dirty = false;
        this._pump();
        this._updateUI();
    };

    WorldObjectLazyLoader.prototype._refreshQueue = function (camera) {
        var THREE = global.THREE;
        var self = this;
        var camPos = camera ? camera.position : null;
        var frustum = null;
        if (camera && THREE && THREE.Frustum) {
            try {
                frustum = new THREE.Frustum();
                frustum.setFromProjectionMatrix(
                    new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
                );
            } catch (e) { frustum = null; }
        }

        var cands = [];
        this.items.forEach(function (rec) {
            if (rec.state !== PENDING || rec.removed) return;
            var d = camPos ? dist3(rec.position, camPos) : 0;
            rec.distance = d;
            var need = rec.forced || self.mode === 'all' || d <= self.cfg.radius;
            if (!need && frustum && d <= self.cfg.radius * self.cfg.frustumRadiusFactor) {
                try {
                    var sphere = new THREE.Sphere(
                        new THREE.Vector3(rec.position.x, rec.position.y, rec.position.z),
                        Math.max(rec.radius, 1)
                    );
                    need = frustum.intersectsSphere(sphere);
                } catch (e) { need = false; }
            }
            if (need) cands.push(rec);
        });

        cands.sort(function (a, b) {
            if (a.forced !== b.forced) return a.forced ? -1 : 1;
            return a.distance - b.distance;
        });
        this.queue = cands;
    };

    WorldObjectLazyLoader.prototype._pump = function () {
        if (this.paused) return;
        var guard = 0;
        while (this.active < this.cfg.concurrency && this.queue.length && guard++ < 1000) {
            var rec = this.queue.shift();
            if (!rec || rec.removed || rec.state !== PENDING) continue;
            this._load(rec);
        }
    };

    WorldObjectLazyLoader.prototype._finish = function (rec, ok) {
        rec.state = ok ? DONE : FAILED;
        this.active = Math.max(0, this.active - 1);
        this._updateUI();
        this._pump();
    };

    WorldObjectLazyLoader.prototype._markFailed = function (rec) {
        if (rec.loaderMaterial && rec.loaderMaterial.color) {
            try { rec.loaderMaterial.color.set(0xff0000); } catch (e) { }
        }
    };

    WorldObjectLazyLoader.prototype._applyModel = function (rec, root) {
        if (rec.placeholder) {
            if (rec.loaderMesh) rec.placeholder.remove(rec.loaderMesh);
            rec.placeholder.add(root);
        }
        root.traverse(function (c) {
            if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; }
        });
        if (this.deps.onLoaded) {
            try { this.deps.onLoaded(rec, root); } catch (e) { }
        }
    };

    WorldObjectLazyLoader.prototype._load = function (rec) {
        var self = this;
        rec.state = LOADING;
        this.active++;
        var finish = function (ok) { self._finish(rec, ok); };
        try {
            if (rec.modelType === 'obj') this._loadObj(rec, finish);
            else this._loadGltf(rec, finish);
        } catch (e) {
            console.error('[LazyLoader] 加载异常:', rec.modelPath, e);
            this._markFailed(rec);
            finish(false);
        }
    };

    WorldObjectLazyLoader.prototype._loadGltf = function (rec, finish) {
        var self = this;
        var ensure = null;
        if (this.deps.ensureMeshopt) {
            try { ensure = this.deps.ensureMeshopt(); } catch (e) { ensure = null; }
        }
        Promise.resolve(ensure).catch(function () { }).then(function () {
            if (rec.removed) { finish(false); return; }
            var loader = self.deps.createLoader ? self.deps.createLoader() : new global.THREE.GLTFLoader();
            if (self.deps.setupMeshopt) {
                try { self.deps.setupMeshopt(loader); } catch (e) { }
            }
            loader.load(rec.modelPath, function (gltf) {
                if (rec.removed) { finish(false); return; }
                self._applyModel(rec, gltf.scene);
                finish(true);
            }, undefined, function (err) {
                console.error('[LazyLoader] GLTF 加载失败:', rec.modelPath, err);
                self._markFailed(rec);
                finish(false);
            });
        });
    };

    WorldObjectLazyLoader.prototype._loadObj = function (rec, finish) {
        var self = this;
        var THREE = global.THREE;
        if (!THREE || !THREE.OBJLoader) { this._markFailed(rec); finish(false); return; }

        var modelPath = rec.modelPath;
        var modelDir = modelPath.substring(0, modelPath.lastIndexOf('/') + 1);
        var mtlFileName = 'material.mtl';

        var loadObjOnly = function (materials) {
            var objLoader = new THREE.OBJLoader();
            if (materials) objLoader.setMaterials(materials);
            objLoader.load(modelPath, function (object) {
                if (rec.removed) { finish(false); return; }
                object.traverse(function (c) {
                    if (c.isMesh) {
                        if (!materials) c.material = new THREE.MeshLambertMaterial({ color: 0xcccccc });
                        c.castShadow = true;
                        c.receiveShadow = true;
                    }
                });
                self._applyModel(rec, object);
                finish(true);
            }, undefined, function (err) {
                console.error('[LazyLoader] OBJ 加载失败:', modelPath, err);
                self._markFailed(rec);
                finish(false);
            });
        };

        if (!THREE.MTLLoader) { loadObjOnly(null); return; }

        var mtlLoader = new THREE.MTLLoader();
        mtlLoader.setPath(modelDir);
        mtlLoader.setResourcePath(modelDir);
        mtlLoader.load(mtlFileName, function (materials) {
            materials.preload();
            loadObjOnly(materials);
        }, undefined, function () {
            // MTL 缺失是常态，退回纯 OBJ
            loadObjOnly(null);
        });
    };

    WorldObjectLazyLoader.prototype.stats = function () {
        var s = { total: this.items.size, pending: 0, loading: 0, done: 0, failed: 0, queued: this.queue.length };
        this.items.forEach(function (rec) {
            if (rec.state === PENDING) s.pending++;
            else if (rec.state === LOADING) s.loading++;
            else if (rec.state === DONE) s.done++;
            else s.failed++;
        });
        return s;
    };

    // ===== 状态条 UI =====
    WorldObjectLazyLoader.prototype._initUI = function () {
        if (this._ui || !this.cfg.uiContainerId) return;
        var host = document.getElementById(this.cfg.uiContainerId);
        if (!host || !host.parentNode) return;

        var bar = document.createElement('div');
        bar.id = 'lazy-model-load-bar';
        bar.style.cssText = 'display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:6px 8px;' +
            'margin:0 0 8px;background:#f4f6ff;border:1px solid #dde3ff;border-radius:6px;font-size:12px;color:#445;';
        bar.innerHTML =
            '<span data-role="info" style="flex:1 1 120px;min-width:110px;">模型加载 0/0</span>' +
            '<button type="button" data-act="near" style="border:1px solid #c9d2ff;background:#fff;color:#445;' +
            'border-radius:4px;padding:2px 8px;cursor:pointer;font-size:11px;">仅附近</button>' +
            '<button type="button" data-act="all" style="border:1px solid #c9d2ff;background:#fff;color:#445;' +
            'border-radius:4px;padding:2px 8px;cursor:pointer;font-size:11px;">全部加载</button>' +
            '<button type="button" data-act="pause" style="border:1px solid #c9d2ff;background:#fff;color:#445;' +
            'border-radius:4px;padding:2px 8px;cursor:pointer;font-size:11px;">暂停</button>';

        var self = this;
        bar.addEventListener('click', function (e) {
            var act = e.target && e.target.getAttribute ? e.target.getAttribute('data-act') : null;
            if (!act) return;
            if (act === 'near') self.setMode('lazy');
            else if (act === 'all') self.setMode('all');
            else if (act === 'pause') self.setPaused(!self.paused);
        });

        host.parentNode.insertBefore(bar, host);
        this._ui = bar;
    };

    WorldObjectLazyLoader.prototype._updateUI = function () {
        if (!this._ui) return;
        var s = this.stats();
        var info = this._ui.querySelector('[data-role="info"]');
        if (info) {
            info.textContent = '模型 ' + s.done + '/' + s.total + ' 已加载' +
                (s.loading ? '（加载中 ' + s.loading + '）' : '') +
                (s.failed ? '（失败 ' + s.failed + '）' : '');
        }
        var self = this;
        var btns = this._ui.querySelectorAll('button[data-act]');
        for (var i = 0; i < btns.length; i++) {
            var b = btns[i];
            var act = b.getAttribute('data-act');
            var on = (act === 'near' && this.mode === 'lazy') ||
                (act === 'all' && this.mode === 'all') ||
                (act === 'pause' && this.paused);
            b.style.background = on ? '#667eea' : '#fff';
            b.style.color = on ? '#fff' : '#445';
            if (act === 'pause') b.textContent = this.paused ? '继续' : '暂停';
        }
        void self;
    };

    global.WorldObjectLazyLoader = new WorldObjectLazyLoader();
    global.WorldObjectLazyLoader.WorldObjectLazyLoader = WorldObjectLazyLoader;
})(window);
