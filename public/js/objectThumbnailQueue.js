/**
 * 统一编辑器：对象列表缩略图异步队列
 *
 * 背景：updateObjectList() 在拼接 innerHTML 时对每个对象同步调用 generateThumbnail()
 * （clone mesh + 离屏渲染 + toDataURL），1000+ 对象 = 上千次同步 GPU 回读，
 * 页面会长时间冻结，并且把上千个 base64 图片塞进 DOM 字符串。
 *
 * 方案：列表先渲染轻量占位图，缩略图由 IntersectionObserver + 时间片队列异步生成，
 * 只有滚动到可见区域的条目才会真正渲染；单个时间片超出预算就等下一帧继续。
 */
(function (global) {
    'use strict';

    var PLACEHOLDER = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60">' +
        '<rect fill="#2c2f38" width="60" height="60"/>' +
        '<circle cx="30" cy="30" r="8" fill="#7b8496"/></svg>'
    );

    var cfg = {
        generate: null,      // (key, force) => dataURL | null
        budgetMs: 8,         // 单片预算（毫秒）
        idleDelayMs: 60      // 可见项全部完成后的下一次轮询
    };

    var cache = new Map();     // key -> dataURL（null 表示"暂不可生成"）
    var queue = [];            // 待生成的 key
    var inQueue = new Set();
    var running = false;
    var observer = null;
    var visibleKeys = new Set();
    var pollTimer = null;

    function keyOf(el) { return el.getAttribute('data-thumb-key'); }

    function ensureObserver(root) {
        var IO = global.IntersectionObserver;
        if (!IO) return null;
        if (observer && observer.root === root) return observer;
        if (observer) { try { observer.disconnect(); } catch (e) { } }
        observer = new IO(function (entries) {
            for (var i = 0; i < entries.length; i++) {
                var en = entries[i];
                var k = keyOf(en.target);
                if (!k) continue;
                if (en.isIntersecting) { visibleKeys.add(k); enqueue(k); }
                else visibleKeys.delete(k);
            }
            schedule();
        }, { root: root, rootMargin: '120px 0px', threshold: 0 });
        return observer;
    }

    function enqueue(key) {
        if (inQueue.has(key)) return;
        inQueue.add(key);
        queue.push(key);
    }

    function schedule() {
        if (running || queue.length === 0) return;
        running = true;
        var run = function () {
            var start = (global.performance && performance.now) ? performance.now() : Date.now();
            var t = start;
            while (queue.length) {
                var key = queue.shift();
                inQueue.delete(key);
                var img = document.querySelector('img[data-thumb-key="' + cssEscape(key) + '"]');
                if (!img) continue;
                var url = null;
                if (cfg.generate) {
                    try { url = cfg.generate(key, false); } catch (e) { url = null; }
                }
                if (url) { cache.set(key, url); img.src = url; }
                t = (global.performance && performance.now) ? performance.now() : Date.now();
                if (t - start > cfg.budgetMs) break;
            }
            running = false;
            if (queue.length) {
                global.requestAnimationFrame(run);
            } else if (pollTimer === null) {
                pollTimer = global.setTimeout(function () { pollTimer = null; }, cfg.idleDelayMs);
            }
        };
        global.requestAnimationFrame(run);
    }

    function cssEscape(v) { return String(v).replace(/["\\]/g, '\\$&'); }

    var api = {
        placeholder: PLACEHOLDER,

        configure: function (opts) {
            opts = opts || {};
            if (typeof opts.generate === 'function') cfg.generate = opts.generate;
            if (opts.budgetMs) cfg.budgetMs = opts.budgetMs;
            return api;
        },

        /** 列表渲染完成后调用：把可见条目的缩略图排入异步队列 */
        scan: function (container) {
            if (!container) return api;
            var imgs = container.querySelectorAll('img[data-thumb-key]');
            var io = ensureObserver(container);
            for (var i = 0; i < imgs.length; i++) {
                var img = imgs[i];
                var key = keyOf(img);
                if (!key) continue;
                if (cache.has(key) && cache.get(key)) { img.src = cache.get(key); continue; }
                if (io) io.observe(img);
                else { visibleKeys.add(key); enqueue(key); }
            }
            if (!io) schedule();
            return api;
        },

        /** 模型加载完成等场景：强制重新生成某个缩略图 */
        refresh: function (key) {
            key = String(key);
            var url = null;
            if (cfg.generate) {
                try { url = cfg.generate(key, true); } catch (e) { url = null; }
            }
            if (url) {
                cache.set(key, url);
                var img = document.querySelector('img[data-thumb-key="' + cssEscape(key) + '"]');
                if (img) img.src = url;
            }
            return api;
        },

        clear: function () {
            cache.clear();
            queue.length = 0;
            inQueue.clear();
            visibleKeys.clear();
            return api;
        }
    };

    global.ObjectThumbnails = api;
})(window);
