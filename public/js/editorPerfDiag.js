/**
 * editorPerfDiag.js — 世界编辑器现场诊断（v1.0.0，默认零开销）
 * ------------------------------------------------------------------
 * 背景（2026-10-19 会话3 / P2-5）：此文件在会话2 之前从磁盘丢失（页面一直 404），
 * 现场排查只能靠人肉读 DevTools。本模块补回并做成"页面内自检"：
 * 用户在自己浏览器里跑一次就能看到帧分布与长帧归因，不必依赖开发机。
 *
 * 用法（浏览器控制台）：
 *   EditorDiag.gpu()        // GPU 信息 + 是否软件渲染（SwiftShader / llvmpipe / Basic Render）
 *   EditorDiag.start()      // 开始采样（在此之前零开销）
 *   ...复现卡顿操作...
 *   EditorDiag.report()     // 打印帧分布 + 长帧明细（当时的 draw call / 三角形 / 前序操作）
 *   EditorDiag.report(true) // 返回 JSON（便于复制粘贴）
 *   EditorDiag.objects()    // 场景规模统计（节点/mesh/合批/占位盒）
 *   EditorDiag.stop()
 *
 * 归因口径（与会话1/2 一致，见《虚拟世界编辑器性能优化-开发规范与进度.md》§9）：
 *   · 帧间隔用独立 rAF 采样（不依赖游戏循环），长帧判定 > 33ms；
 *   · renderer.render 单独计时（renderMs）——长帧若 renderMs≈dt 说明是渲染/场景图，
 *     否则看"前序操作"时间线（范围加载、GLB 解析、面板刷新、列表刷新）；
 *   · **不要用 visible=false 做 draw call 归因**（编辑器有显隐接管逻辑，结果自相矛盾）。
 */
(function () {
    'use strict';
    if (window.EditorDiag) return;

    var active = false;
    var rafId = 0;
    var frames = [];           // {dt, t, renderMs, calls, tris}
    var ops = [];              // {t, name, ms}
    var MAX_FRAMES = 3600;     // 约 60s@60fps
    var MAX_OPS = 400;
    var lastT = 0;
    var renderMs = 0;
    var wrapped = [];
    var origRender = null;

    function now() { return performance.now(); }

    function pushOp(name, ms) {
        if (!active) return;
        ops.push({ t: now(), name: name, ms: +ms.toFixed(2) });
        if (ops.length > MAX_OPS) ops.splice(0, ops.length - MAX_OPS);
    }

    // 包装一个 window 上的函数（顶层 function 声明即全局属性；不存在则跳过）
    function wrapFn(name) {
        var orig = window[name];
        if (typeof orig !== 'function' || orig.__diagWrapped) return false;
        var w = function () {
            if (!active) return orig.apply(this, arguments);
            var a = now();
            try { return orig.apply(this, arguments); }
            finally { pushOp(name, now() - a); }
        };
        w.__diagWrapped = true;
        w.__orig = orig;
        window[name] = w;
        wrapped.push(name);
        return true;
    }

    function unwrapAll() {
        wrapped.forEach(function (n) {
            var w = window[n];
            if (w && w.__diagWrapped && w.__orig) window[n] = w.__orig;
        });
        wrapped = [];
    }

    function installRenderHook() {
        var r = window.renderer;
        if (!r || r.__diagHooked || !r.render) return false;
        origRender = r.render;
        // WebGLRenderer.render 是实例方法（不在原型上），必须实例级替换
        r.render = function () {
            if (!active) return origRender.apply(this, arguments);
            var a = now();
            try { return origRender.apply(this, arguments); }
            finally { renderMs = now() - a; }
        };
        r.__diagHooked = true;
        return true;
    }

    function uninstallRenderHook() {
        var r = window.renderer;
        if (r && r.__diagHooked && origRender) { r.render = origRender; r.__diagHooked = false; }
        origRender = null;
    }

    function sampler(t) {
        if (!active) return;
        if (lastT) {
            var dt = t - lastT;
            var info = window.renderer && window.renderer.info;
            frames.push({
                dt: dt, t: t, renderMs: renderMs,
                calls: info ? info.render.calls : 0,
                tris: info ? info.render.triangles : 0
            });
            if (frames.length > MAX_FRAMES) frames.splice(0, frames.length - MAX_FRAMES);
        }
        lastT = t;
        renderMs = 0;
        rafId = requestAnimationFrame(sampler);
    }

    function pct(arr, p) {
        if (!arr.length) return 0;
        var a = arr.slice().sort(function (x, y) { return x - y; });
        var i = Math.min(a.length - 1, Math.max(0, Math.round((a.length - 1) * p)));
        return a[i];
    }

    var api = {
        start: function () {
            if (active) return '已在采样';
            active = true;
            frames = []; ops = []; lastT = 0; renderMs = 0;
            installRenderHook();
            ['updateRangeLoading', 'triggerRealLoad', 'forceLoadObject', 'pumpGlbParse', 'processGlbQueue',
                'updateObjectList', 'updateRightObjectList', 'updatePropertiesPanel', 'updateRightPropsPanel',
                'updateEventList', 'selectObject', 'refreshScene', 'onMouseClick'].forEach(wrapFn);
            rafId = requestAnimationFrame(sampler);
            return 'EditorDiag 已开始采样：复现卡顿后执行 EditorDiag.report()';
        },
        stop: function () {
            active = false;
            if (rafId) cancelAnimationFrame(rafId);
            rafId = 0;
            uninstallRenderHook();
            unwrapAll();
            return '已停止采样';
        },
        report: function (asJson) {
            var dts = frames.map(function (f) { return f.dt; });
            var body = dts.slice(3);
            var longFrames = frames.filter(function (f) { return f.dt > 33; });
            var detail = longFrames.slice(-25).map(function (f) {
                // 该帧前 1.2s 内的操作时间线（谁把主线程占住了）
                var related = ops.filter(function (o) { return f.t - o.t >= 0 && f.t - o.t < 1200; })
                    .map(function (o) { return o.name + '(' + o.ms + 'ms)'; });
                return {
                    dt: +f.dt.toFixed(1), renderMs: +f.renderMs.toFixed(1),
                    calls: f.calls, tris: f.tris,
                    before: related.slice(-10).join(' → ') || '（无面板/加载类操作 → 疑似渲染或 GC）'
                };
            });
            var out = {
                frames: frames.length,
                p50: +pct(body, 0.5).toFixed(2),
                p95: +pct(body, 0.95).toFixed(2),
                max: +Math.max.apply(null, body.concat([0])).toFixed(2),
                longFrames: longFrames.length,
                renderMedian: +pct(frames.map(function (f) { return f.renderMs; }), 0.5).toFixed(2),
                callsMedian: Math.round(pct(frames.map(function (f) { return f.calls; }), 0.5)),
                trisMedian: Math.round(pct(frames.map(function (f) { return f.tris; }), 0.5)),
                longDetail: detail,
                opsTop: (function () {
                    var m = {};
                    ops.forEach(function (o) { m[o.name] = (m[o.name] || 0) + o.ms; });
                    var a = Object.keys(m).map(function (k) { return { name: k, ms: +m[k].toFixed(1) }; });
                    a.sort(function (x, y) { return y.ms - x.ms; });
                    return a.slice(0, 12);
                })()
            };
            if (asJson) return out;
            console.log('%c[EditorDiag] 帧分布 p50=' + out.p50 + 'ms p95=' + out.p95 + 'ms max=' + out.max +
                'ms 长帧=' + out.longFrames + '/' + out.frames + ' | render 中位=' + out.renderMedian +
                'ms calls=' + out.callsMedian + ' tris=' + out.trisMedian, 'color:#667eea;font-weight:bold');
            if (detail.length) {
                console.log('[EditorDiag] 长帧明细（最后 ' + detail.length + ' 个）：');
                if (console.table) console.table(detail);
                else detail.forEach(function (d) { console.log(d); });
            }
            console.log('[EditorDiag] 操作耗时累计（Top12）：');
            if (console.table) console.table(out.opsTop);
            return out;
        },
        gpu: function () {
            var res = { vendor: null, renderer: null, software: false, advice: '' };
            try {
                var c = document.createElement('canvas');
                var gl = c.getContext('webgl2') || c.getContext('webgl');
                if (!gl) { res.renderer = 'WebGL 不可用'; res.advice = '浏览器未启用 WebGL'; return res; }
                var ext = gl.getExtension('WEBGL_debug_renderer_info');
                res.vendor = ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR);
                res.renderer = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
                res.software = /swiftshader|llvmpipe|software|basic render|microsoft basic/i.test(String(res.renderer));
                res.advice = res.software
                    ? '⚠️ 当前是软件渲染（CPU 光栅化）——编辑器会明显卡顿。请用 Chrome/Edge 并在'
                    + '「设置 → 系统」打开"使用图形加速"，或更新显卡驱动；套壳浏览器（360/QQ 等）请换 Chrome。'
                    : '硬件渲染（正常）';
                var dbg = gl.getExtension('WEBGL_debug_renderer_info');
                if (dbg) gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL);
            } catch (e) { res.advice = '探测失败: ' + e.message; }
            console.log('[EditorDiag] GPU:', res.renderer, '|', res.advice);
            return res;
        },
        objects: function () {
            var wos = (function () { try { return (0, eval)('worldObjects'); } catch (e) { return null; } })();
            var sc = (function () { try { return (0, eval)('scene'); } catch (e) { return null; } })();
            var nodes = 0, meshes = 0, visibleMeshes = 0, tris = 0;
            if (sc) {
                sc.traverse(function (o) {
                    nodes++;
                    if (o.isMesh) {
                        meshes++;
                        if (o.visible) visibleMeshes++;
                        var g = o.geometry;
                        if (g) {
                            if (g.index) tris += g.index.count / 3;
                            else if (g.attributes && g.attributes.position) tris += g.attributes.position.count / 3;
                        }
                    }
                });
            }
            var byType = {};
            if (wos) wos.forEach(function (o) {
                var t = (o.data && o.data.type) || 'unknown';
                byType[t] = (byType[t] || 0) + 1;
            });
            var out = {
                worldObjects: wos ? wos.length : 0,
                sceneNodes: nodes, meshes: meshes, visibleMeshes: visibleMeshes,
                sceneTris: Math.round(tris),
                domNodes: document.getElementsByTagName('*').length,
                perf: window.EditorPerf && window.EditorPerf.stats ? window.EditorPerf.stats() : null,
                listVirtual: window.EditorListVirtual && window.EditorListVirtual.stats ? window.EditorListVirtual.stats() : null,
                byType: byType
            };
            console.log('[EditorDiag] 场景/页面规模:', out);
            return out;
        }
    };

    window.EditorDiag = api;
    console.log('[EditorDiag] 已就绪：控制台 EditorDiag.gpu() / start() → report()');
})();
