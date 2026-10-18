/**
 * transformGizmoEnhance.js — 缩放 Gizmo 增强（默认等比缩放，按住 Shift = 单轴）
 * ==================================================================
 * 版本：1.1.0（2026-10-19 会话2 重建；磁盘丢失前的 1.0.x 已无 git 记录）
 * 接入：three.js 之后加载一行 <script> 即可，三处编辑器/世界通用：
 *   public/world_editor.html（世界编辑器）、public/unified_editor.html（统一编辑器）、
 *   public/index.html（主世界管理员编辑，gizmo 在 buildingManager 里创建）
 *
 * 为什么需要它：three r185 原生 scale 模式只有「轴端方块 = 单轴」「平面片 = 双轴」
 * 「中心白方块 = 等比」三种入口，中心方块又小又难命中，且中心手柄的原生公式
 * `|pointEnd| / |pointStart|` 在从正中心按下时 pointStart ≈ 0，倍率会爆炸到百万级
 * （历史事故：模型飞出视距、编辑器卡死）。
 *
 * 本模块做三件事（都不改 three 源码）：
 *   1. 拖动单轴/平面手柄且未按 Shift 时，做「后置等比广播」：按该轴的原生倍率
 *      k 把三轴统一缩放（视觉上是拖动一个手柄、整体等比缩放）。
 *   2. 中心手柄保持原生等比，但把倍率钳制到 [0.02, 50]，并对三轴做
 *      isFinite && |v| ≤ 1e5 校验（防爆炸/防 NaN）。
 *   3. 拖动期 objectChange 节流 100ms、松手补发一次（面板刷新交给编辑器自己，
 *      本模块绝不写任何 DOM/面板）。
 *
 * ★ 监听顺序（最关键，改动前务必读）：
 *   TransformControls 是在**每次 pointerdown 时**才 addEventListener('pointermove')，
 *   pointerup 时移除。所以补丁只能在**自己的 pointerdown 处理器**里
 *   removeEventListener + addEventListener **重新注册** pointermove，才能排在其后执行；
 *   否则补丁先跑、随后被原生单轴结果覆盖（表现为「诊断计数在涨，但 scale 没变」）。
 *
 * 诊断：window.TransformGizmoEnhance._debug（enhanced/pointerdown/uniformStarted/
 *       pointermove/uniformApplied/clamped/rejected/patchNotified）
 */
(function () {
    'use strict';
    if (window.TransformGizmoEnhance) return;

    var VERSION = '1.1.0';
    var MIN_K = 0.02;          // 倍率下限
    var MAX_K = 50;            // 倍率上限
    var MAX_ABS = 1e5;         // 单轴 scale 绝对上限（防爆炸）
    var MIN_ABS = 1e-6;        // 单轴 scale 绝对下限（防 0/塌缩）
    var NOTIFY_MS = 100;       // 拖动期 objectChange 节流

    var dbg = {
        version: VERSION, enhanced: 0, pointerdown: 0, uniformStarted: 0,
        pointermove: 0, uniformApplied: 0, clamped: 0, rejected: 0, patchNotified: 0,
        hintShown: false
    };

    function now() {
        return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    }
    function clampK(k) {
        if (!isFinite(k)) return 1;
        if (k < MIN_K) return MIN_K;
        if (k > MAX_K) return MAX_K;
        return k;
    }
    function safeScale(v) {
        return isFinite(v) && Math.abs(v) <= MAX_ABS && Math.abs(v) >= MIN_ABS * 0.001;
    }

    // 给一个 TransformControls 实例装补丁（幂等）
    function enhance(tc) {
        if (!tc || tc.__tgeEnhanced) return tc;
        var dom = tc.domElement;
        if (!dom || typeof dom.addEventListener !== 'function') return tc;

        tc.__tgeEnhanced = true;
        var st = tc.__tgeState = {
            mode: 'none',           // none | uniform | center | native
            axis: '',
            start: new THREE.Vector3(1, 1, 1),
            dirty: false,
            lastNotify: 0
        };
        dbg.enhanced++;

        function startOf() {
            // three 在 pointerDown 里把按下瞬间的 scale 抄进 _scaleStart（r185 字段名）
            var s = tc._scaleStart;
            return (s && typeof s.x === 'number') ? s : st.start;
        }

        // 取「本帧原生算出的单轴倍率」：轴端值 / 按下时的值
        function axisFactor() {
            var s = startOf();
            var cur = tc.object.scale;
            var axis = st.axis;
            if (axis.indexOf('X') !== -1 && Math.abs(s.x) > 1e-9) return cur.x / s.x;
            if (axis.indexOf('Y') !== -1 && Math.abs(s.y) > 1e-9) return cur.y / s.y;
            if (axis.indexOf('Z') !== -1 && Math.abs(s.z) > 1e-9) return cur.z / s.z;
            // 起点该轴为 0（异常模型）→ 退回指针距离比
            var d0 = tc.pointStart ? tc.pointStart.length() : 0;
            var d1 = tc.pointEnd ? tc.pointEnd.length() : 0;
            return d0 > 1e-6 ? d1 / d0 : 1;
        }

        function applyUniform(base, k) {
            var vx = base.x * k, vy = base.y * k, vz = base.z * k;
            if (!safeScale(vx) || !safeScale(vy) || !safeScale(vz)) {
                dbg.rejected++;
                tc.object.scale.copy(base);
                return false;
            }
            tc.object.scale.set(vx, vy, vz);
            return true;
        }

        function notifyChange(force) {
            st.dirty = true;
            var t = now();
            if (!force && (t - st.lastNotify) < NOTIFY_MS) return;
            st.lastNotify = t;
            st.dirty = false;
            dbg.patchNotified++;
            try { tc.dispatchEvent({ type: 'objectChange' }); } catch (e) {}
        }

        function onDown(e) {
            st.mode = 'none';
            st.axis = '';
            st.dirty = false;
            // 本处理器注册得比 three 自己的 pointerdown 晚 → 此时 dragging / axis 已就绪
            if (!tc.enabled || !tc.dragging || !tc.object || tc.mode !== 'scale') return;
            var axis = String(tc.axis || '');
            if (!axis) return;
            st.axis = axis;
            st.start.copy(startOf());
            // ★ 关键：three 刚在它的 pointerdown 里注册了 pointermove，必须重新注册排在它后面
            dom.removeEventListener('pointermove', onMove);
            dom.addEventListener('pointermove', onMove);
            if (axis.indexOf('XYZ') !== -1) {
                st.mode = 'center';        // 中心白方块：原生等比 + 钳制
            } else if (!(e && e.shiftKey)) {
                st.mode = 'uniform';       // 单轴/平面：后置等比广播
                dbg.uniformStarted++;
                if (!dbg.hintShown) {
                    dbg.hintShown = true;
                    try { console.info('[TransformGizmoEnhance] 缩放默认等比，按住 Shift 拖动 = 单轴'); } catch (e2) {}
                }
            } else {
                st.mode = 'native';        // Shift：完全交给原生单轴
            }
            dbg.pointerdown++;
        }

        function onMove(e) {
            dbg.pointermove++;
            if (st.mode === 'none' || !tc.dragging || !tc.object) return;
            if (tc.mode !== 'scale') return;
            var shift = !!(e && e.shiftKey);
            var obj = tc.object;

            if (st.mode === 'uniform') {
                if (shift) return;                       // 中途按下 Shift → 交还原生单轴
                var base = startOf();
                var r = axisFactor();
                if (!isFinite(r)) return;
                var k = clampK(Math.abs(r));
                if (k !== Math.abs(r)) dbg.clamped++;
                if (!applyUniform(base, k)) return;
                dbg.uniformApplied++;
                notifyChange(false);
            } else if (st.mode === 'center') {
                var baseC = startOf();
                var cur = obj.scale;
                var kc = Math.abs(baseC.x) > 1e-9 ? cur.x / baseC.x
                    : (Math.abs(baseC.y) > 1e-9 ? cur.y / baseC.y
                        : (Math.abs(baseC.z) > 1e-9 ? cur.z / baseC.z : 1));
                if (!isFinite(kc)) { obj.scale.copy(baseC); dbg.rejected++; return; }
                var kc2 = clampK(Math.abs(kc));
                if (kc2 !== Math.abs(kc)) dbg.clamped++;
                if (!applyUniform(baseC, kc2)) return;
                dbg.uniformApplied++;
                notifyChange(false);
            }
        }

        function onUp() {
            dom.removeEventListener('pointermove', onMove);
            if (st.dirty) notifyChange(true);   // 松手补发一次（补齐节流窗口内最后一帧）
            st.mode = 'none';
            st.axis = '';
        }

        // 注意：不加 capture，跟 three 同一阶段按注册顺序执行
        dom.addEventListener('pointerdown', onDown);
        dom.addEventListener('pointerup', onUp);
        dom.addEventListener('pointercancel', onUp);
        return tc;
    }

    // ---- 安装（Proxy 包装 + 轮询兜底）----
    function ensureWrapped() {
        var T = window.THREE;
        if (!T || !T.TransformControls) return false;
        var Orig = T.TransformControls;
        if (Orig.__tgeWrapped) return true;
        if (typeof Proxy !== 'function') return false;   // 极老浏览器：只靠轮询补装已有实例
        var Wrapped;
        try {
            Wrapped = new Proxy(Orig, {
                construct: function (target, args) {
                    // 保持原型链：Wrapped.prototype === Orig.prototype
                    // → inst instanceof Orig 与 inst instanceof Wrapped 都成立
                    var inst = Reflect.construct(target, args);
                    try { enhance(inst); } catch (e) {}
                    return inst;
                }
            });
        } catch (e) {
            console.warn('[TransformGizmoEnhance] Proxy 包装失败，改用轮询增强：', e);
            return false;
        }
        Wrapped.__tgeWrapped = true;
        try { T.TransformControls = Wrapped; } catch (e) { return false; }
        return true;
    }

    function scan() {
        ensureWrapped();
        var cands = [];
        // 裸名（world_editor / unified_editor 的顶层 let 绑定，不是 window 属性）
        try {
            if (typeof transformControls !== 'undefined' && transformControls) cands.push(transformControls);
        } catch (e) { /* TDZ：主脚本还没执行到这里 */ }
        if (window.transformControls) cands.push(window.transformControls);
        // 挂在不同对象上的 gizmo（主世界 buildingManager 等）
        // 注意：main.js 里 buildingManager 是函数作用域的 const，只有 gameWorld.buildingManager 可达
        var holders = ['buildingManager', 'gameWorld', 'editor', 'characterEditor'];
        for (var i = 0; i < holders.length; i++) {
            var h = null;
            try { h = window[holders[i]]; } catch (e) {}
            if (!h) { try { h = (0, eval)(holders[i]); } catch (e2) { h = null; } }
            if (!h) continue;
            if (h.transformControls) cands.push(h.transformControls);
            if (h.buildingManager && h.buildingManager.transformControls) cands.push(h.buildingManager.transformControls);
        }
        for (var j = 0; j < cands.length; j++) {
            try { enhance(cands[j]); } catch (e) {}
        }
        updateButtonHints();
    }

    // 只改 title 文案，让孩子都知道「默认等比、Shift 单轴」（幂等）
    function updateButtonHints() {
        try {
            var ids = ['btn-scale', 'ctb-scale'];
            for (var i = 0; i < ids.length; i++) {
                var el = document.getElementById(ids[i]);
                if (!el || el.__tgeHint) continue;
                el.__tgeHint = true;
                var t = el.getAttribute('title') || '';
                if (t.indexOf('Shift') === -1) {
                    el.setAttribute('title', (t ? t + ' ' : '') + '（默认等比，按住 Shift = 单轴）');
                }
            }
        } catch (e) {}
    }

    // 启动：立刻尝试安装（绝大多数页面 three 已经就绪），之后轮询兜底
    ensureWrapped();
    scan();
    var startedAt = Date.now();
    var timer = setInterval(function () {
        scan();
        if (Date.now() - startedAt > 60000) {
            clearInterval(timer);
            setInterval(scan, 5000);
        }
    }, 500);
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', scan);
    }

    window.TransformGizmoEnhance = {
        version: VERSION,
        enhance: enhance,
        scan: scan,
        thresholds: { MIN_K: MIN_K, MAX_K: MAX_K, MAX_ABS: MAX_ABS, NOTIFY_MS: NOTIFY_MS },
        _debug: dbg
    };
    console.log('[TransformGizmoEnhance] v' + VERSION + ' 已启用：缩放默认等比，按住 Shift = 单轴');
})();
