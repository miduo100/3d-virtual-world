/**
 * adminAgentDescBadge.js — 后台「上传模型库」的 🤖 AI 描述防漏标记
 *
 * 目的（用户决策 · G5）：117 个模型 0 个填了描述 —— 根因是「上传时填描述」只是弹窗提醒、
 * 可跳过，漏填后没有任何提示。本模块加一道持续可见的防线：
 *   ① 列表顶部统计：`🤖 AI 描述：已填 X / 共 Y，还有 N 个未填`
 *   ② 每个未填模型的名字后面挂红色 `🤖 未填` 标记
 *
 * 黑名单合规（admin.html 视为大文件）：不修改 admin.html 的内联逻辑，
 * 仅包装 `window.renderUploadedModels`（顶层函数声明 → window 属性），
 * admin.html 只加一行 `<script>` 引用。
 *
 * 补填入口：列表里每条自带的「✏️ 标签」编辑弹窗内含 AI 描述输入框（已存在，无需新增）。
 */
(function () {
    'use strict';

    function esc(s) {
        return String(s === undefined || s === null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function hasDesc(m) {
        return !!(m && m.description && String(m.description).trim());
    }

    /** 全量列表（统计口径不受搜索框过滤影响） */
    function fullList(fallback) {
        try {
            if (typeof allUploadedModels !== 'undefined' && Array.isArray(allUploadedModels) && allUploadedModels.length) {
                return allUploadedModels;
            }
        } catch (e) { /* ignore */ }
        return Array.isArray(fallback) ? fallback : [];
    }

    function injectStats(container, list) {
        if (!container) return;
        var total = list.length;
        var filled = list.filter(hasDesc).length;
        var missing = total - filled;

        var bar = document.getElementById('agent-desc-stats');
        if (!bar) {
            bar = document.createElement('div');
            bar.id = 'agent-desc-stats';
            bar.style.cssText = 'margin:0 0 10px;padding:8px 12px;border:1px solid rgba(163,113,247,0.35);' +
                'border-radius:6px;background:rgba(163,113,247,0.08);font-size:12px;line-height:1.6;';
            container.insertBefore(bar, container.firstChild);
        }
        var color = missing > 0 ? '#d29922' : '#3fb950';
        bar.innerHTML =
            '🤖 AI 描述：已填 <b>' + filled + '</b> / 共 <b>' + total + '</b>' +
            (missing > 0
                ? '，还有 <b style="color:' + color + '">' + missing + '</b> 个未填 —— 点每行的「✏️」按钮即可补填（AI 玩家靠它认识模型；未填 = AI 看不到）'
                : '，<b style="color:' + color + '">全部已填 ✅</b>');
    }

    /**
     * 逐行打标记。行的定位要兼容 admin.html 里两套 renderUploadedModels（后声明的生效）：
     *   ① 首选模型 id —— 行内预览按钮 onclick="showModelPreviewModal('<id>')"（最稳，过滤/排序都不怕）
     *   ② 次选按渲染顺序对齐（renderUploadedModels 的渲染顺序 == 入参 models 顺序）
     *   ③ 兜底按 file_name 文本匹配
     * 标记插在「文件名」列（有第 2 列时），避免撑坏模型名称按钮列。
     */
    function markRows(container, list, renderedModels) {
        if (!container) return;
        var rows = container.querySelectorAll('tbody tr');
        if (!rows.length) return;
        var byId = {};
        list.forEach(function (m) { if (m && m.id !== undefined) byId[String(m.id)] = m; });

        for (var i = 0; i < rows.length; i++) {
            var row = rows[i];
            if (row.querySelector('.agent-desc-missing') || row.querySelector('.agent-desc-ok')) continue;

            var model = null;
            var btn = row.querySelector('button[onclick*="showModelPreviewModal"]');
            if (btn) {
                var mm = /showModelPreviewModal\('([^']*)'\)/.exec(btn.getAttribute('onclick') || '');
                if (mm && byId[mm[1]]) model = byId[mm[1]];
            }
            if (!model && Array.isArray(renderedModels) && renderedModels[i]) model = renderedModels[i];
            var tds = row.querySelectorAll('td');
            if (!model && tds.length > 1) {
                var fname = String(tds[1].textContent || '').trim();
                for (var j = 0; j < list.length; j++) {
                    if (list[j] && list[j].file_name === fname) { model = list[j]; break; }
                }
            }
            if (!model) continue;

            var cell = tds.length > 1 ? tds[1] : tds[0];
            if (!cell) continue;
            if (hasDesc(model)) {
                cell.insertAdjacentHTML('beforeend',
                    ' <span class="agent-desc-ok" title="已填 AI 描述：' + esc(String(model.description).slice(0, 80)) +
                    '" style="font-size:11px;color:#3fb950;">🤖✓</span>');
            } else {
                cell.insertAdjacentHTML('beforeend',
                    ' <span class="agent-desc-missing badge badge-inactive" title="未填 AI 描述：AI 玩家看不到这个模型是什么" ' +
                    'style="font-size:10px;color:#f85149;">🤖 未填</span>');
            }
        }
    }

    function decorate(models) {
        var container = document.getElementById('uploaded-models-content');
        if (!container) return;
        var list = fullList(models);
        injectStats(container, list);
        markRows(container, list, models);
    }

    function patch() {
        if (typeof window.renderUploadedModels !== 'function') return false;
        if (window.renderUploadedModels.__agentDescPatched) return true;
        var orig = window.renderUploadedModels;
        var wrapped = function (models) {
            var r = orig.apply(this, arguments);
            try { decorate(models); } catch (e) { console.error('[AgentDescBadge] 标记失败:', e); }
            return r;
        };
        wrapped.__agentDescPatched = true;
        window.renderUploadedModels = wrapped;
        return true;
    }

    var _tries = 0;
    (function waitReady() {
        if (patch()) { decorate(); return; }
        if (++_tries > 100) {
            console.warn('[AgentDescBadge] 未找到 renderUploadedModels，未填标记未接管');
            return;
        }
        setTimeout(waitReady, 300);
    })();

    window.AdminAgentDescBadge = { decorate: decorate, refresh: function () { decorate(); } };
})();
