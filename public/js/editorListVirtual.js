/**
 * editorListVirtual.js — 世界编辑器对象列表虚拟化（v1.0.0）
 * ------------------------------------------------------------------
 * 背景（2026-10-19 会话3 / P2-1）：
 *   world_editor.html 的左右两个对象列表把 4317 个世界对象各自渲染成一行
 *   （左 4317 行 ≈ 43k DOM 节点、右 4317 行 ≈ 43k），合计 8.6 万节点，
 *   占整页 88,762 节点的 97%。全量 innerHTML 重建 304ms，
 *   而任何列表 DOM 变更都会触发全页样式重算（会话1 实测 16ms/次）。
 *
 * 做法：固定行高的滚动窗口——只渲染视口内约 50 行，上下用占位高度撑开滚动条。
 *   · 行 HTML 由页面传入的 renderRow 生成（**标记与 onclick 语义完全沿用原实现**，
 *     因此点击/多选/锁定徽标/删除/定位等行为零变化）
 *   · 选中变化只改视口内行的 class（不再遍历 4317 行）
 *   · 滚动/筛选/条目增删时才重建视口内行
 *
 * 用法：
 *   const vl = EditorListVirtual.create({
 *     container: el,                      // 滚动容器（内部会被清空重建）
 *     renderRow: (item, isSelected) => '<div class="...">...</div>',
 *     idOf: (item) => item.id,            // 可选，默认 item.id
 *     overscan: 6,                        // 视口外上下各多渲染几行
 *     fallbackPitch: 66                   // 行距测量失败时的兜底（px）
 *   });
 *   vl.setItems(list); vl.setSelected(selArr); vl.render();
 *   vl.setFilter(fn); vl.scrollToId(id); vl.invalidate(); vl.stats();
 *
 * 诊断：window.EditorListVirtual.stats() 汇总所有实例。
 */
(function () {
    'use strict';
    if (window.EditorListVirtual) return;

    var instances = [];

    function create(opts) {
        opts = opts || {};
        var container = opts.container;
        if (!container) throw new Error('[EditorListVirtual] 缺少 container');
        var idOf = opts.idOf || function (it) { return it.id; };
        var renderRow = opts.renderRow;
        var overscan = opts.overscan == null ? 6 : opts.overscan;
        var fallbackPitch = opts.fallbackPitch || 60;
        if (typeof renderRow !== 'function') throw new Error('[EditorListVirtual] 缺少 renderRow');

        // ---- DOM 骨架：spacer（撑高滚动条）+ window（视口内行） ----
        var spacer = document.createElement('div');
        spacer.className = 'vl-spacer';
        spacer.style.position = 'relative';
        spacer.style.width = '100%';
        var win = document.createElement('div');
        win.className = 'vl-window';
        win.style.position = 'absolute';
        win.style.left = '0';
        win.style.right = '0';
        win.style.top = '0';
        spacer.appendChild(win);
        container.innerHTML = '';
        container.appendChild(spacer);

        var items = [];        // 原始数据
        var visible = [];      // 过滤后的数据
        var filterFn = null;
        var filterRev = 0;
        var sel = new Set();   // 选中 id
        var pitch = 0;         // 行距（行高 + margin-bottom），实测得到
        var pitchExact = false;
        var rowsReady = false;
        var lastKey = '';
        var start = 0, end = 0;
        var rafPending = false;
        var stats = { renders: 0, fullRenders: 0, rowsWritten: 0, selOnly: 0 };

        function padTop() {
            var v = parseFloat(getComputedStyle(container).paddingTop);
            return isFinite(v) ? v : 0;
        }

        // 行距实测：渲染一行量一次（不确定时用兜底并稍后重试）
        function calibrate() {
            if (pitchExact) return;
            if (!visible.length) { pitch = pitch ? pitch : fallbackPitch; return; }
            var prev = win.innerHTML;
            try {
                win.style.transform = 'translateY(0px)';
                win.innerHTML = renderRow(visible[0], false);
                var row = win.firstElementChild;
                if (row) {
                    var h = row.getBoundingClientRect().height;
                    var mb = parseFloat(getComputedStyle(row).marginBottom);
                    if (!isFinite(mb)) mb = 0;
                    if (h > 4) { pitch = Math.round((h + mb) * 100) / 100; pitchExact = true; }
                }
            } catch (e) { /* 忽略：走兜底 */ }
            if (!pitch) pitch = fallbackPitch;
            win.innerHTML = prev;
        }

        function computeRange() {
            var n = visible.length;
            var pad = padTop();
            var viewH = container.clientHeight || 400;
            var scrollTop = container.scrollTop || 0;
            var first = Math.floor(Math.max(0, scrollTop - pad) / pitch);
            start = Math.max(0, first - overscan);
            var count = Math.ceil(viewH / pitch) + overscan * 2 + 1;
            end = Math.min(n, start + count);
            if (end < start) end = start;
            return n;
        }

        function applySelectionClasses() {
            var rows = win.children;
            for (var i = 0; i < rows.length; i++) {
                var el = rows[i];
                var id = el.getAttribute('data-id');
                var on = sel.has(id) || sel.has(Number(id)) || sel.has(String(id));
                el.classList.toggle('selected', on);
                var check = el.querySelector('.right-object-check');
                if (check) check.classList.toggle('checked', on);
            }
        }

        function render(force) {
            stats.renders++;
            calibrate();
            var n = computeRange();
            spacer.style.height = (n * pitch) + 'px';
            win.style.transform = 'translateY(' + (start * pitch) + 'px)';
            var key = start + ':' + end + ':' + n + ':' + filterRev + ':' + pitch;
            if (!force && rowsReady && key === lastKey) {
                stats.selOnly++;
                applySelectionClasses();
                return;
            }
            var html = '';
            for (var i = start; i < end; i++) {
                var it = visible[i];
                html += renderRow(it, sel.has(idOf(it)));
            }
            win.innerHTML = html;
            rowsReady = true;
            lastKey = key;
            stats.fullRenders++;
            stats.rowsWritten += (end - start);
        }

        function invalidate() { rowsReady = false; lastKey = ''; }

        function onScroll() {
            if (rafPending) return;
            rafPending = true;
            requestAnimationFrame(function () {
                rafPending = false;
                invalidate();
                render(false);
            });
        }
        container.addEventListener('scroll', onScroll, { passive: true });

        // 容器尺寸变化（面板折叠/展开、窗口缩放）→ 视口行数变了，需重算
        var lastH = -1;
        var resizeTimer = setInterval(function () {
            var h = container.clientHeight;
            if (h !== lastH) { lastH = h; invalidate(); render(false); }
        }, 500);

        var api = {
            setItems: function (arr) {
                items = arr || [];
                if (!filterFn) visible = items;
                else { visible = []; for (var i = 0; i < items.length; i++) { if (filterFn(items[i])) visible.push(items[i]); } }
                if (visible.length !== (api._lastVisibleLen || 0)) { invalidate(); api._lastVisibleLen = visible.length; }
            },
            setFilter: function (fn) {
                filterFn = typeof fn === 'function' ? fn : null;
                filterRev++;
                visible = [];
                for (var i = 0; i < items.length; i++) { if (!filterFn || filterFn(items[i])) visible.push(items[i]); }
                container.scrollTop = 0;
                invalidate();
                render(true);
            },
            setSelected: function (arr) {
                sel = new Set();
                if (arr) for (var i = 0; i < arr.length; i++) sel.add(idOf(arr[i]));
            },
            invalidate: invalidate,
            render: render,
            // 滚动到指定 id（仅当其不在当前视口内时才滚，等价 scrollIntoView({block:'nearest'}))
            scrollToId: function (id) {
                var idx = -1;
                for (var i = 0; i < visible.length; i++) { if (idOf(visible[i]) === id) { idx = i; break; } }
                if (idx < 0) return false;
                computeRange();
                if (idx >= start && idx < end) return true;
                var pad = padTop();
                var viewH = container.clientHeight || 400;
                var target = pad + idx * pitch - viewH / 2 + pitch / 2;
                if (target < 0) target = 0;
                try { container.scrollTo({ top: target, behavior: 'smooth' }); }
                catch (e) { container.scrollTop = target; }
                invalidate();
                return true;
            },
            stats: function () {
                return {
                    total: visible.length, start: start, end: end, rendered: end - start,
                    pitch: pitch, pitchExact: pitchExact,
                    renders: stats.renders, fullRenders: stats.fullRenders,
                    selOnly: stats.selOnly, rowsWritten: stats.rowsWritten
                };
            },
            _destroy: function () {
                container.removeEventListener('scroll', onScroll);
                clearInterval(resizeTimer);
                var k = instances.indexOf(api);
                if (k >= 0) instances.splice(k, 1);
            }
        };
        api._lastVisibleLen = -1;
        instances.push(api);
        return api;
    }

    window.EditorListVirtual = {
        create: create,
        stats: function () {
            return instances.map(function (v) { return v.stats(); });
        }
    };
    console.log('[EditorListVirtual] 已加载（对象列表虚拟化）');
})();
