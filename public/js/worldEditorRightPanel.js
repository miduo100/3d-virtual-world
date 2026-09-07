/**
 * worldEditorRightPanel.js v2
 * 世界编辑器右侧属性面板增强（仅位置行）：
 * 1. 位置 (X, Y, Z) 一键复制坐标（格式：X:-26.3 Y:9.6 Z:0.0）
 * 2. 粘贴识别："X:-26.3 Y:9.6 Z:0.0"、"X=-26.3, Y=9.6, Z=0"、
 *    "(-26.3, 9.6, 0.0)"、"-26.3, 9.6, 0" 等格式
 * 3. 粘贴后【不立即生效】：先显示"确认应用"按钮（含预览值），点击确认才填入输入框，
 *    防止误粘贴直接覆盖当前坐标。确认后仍需点击"保存更改"落库。
 * 4. 旋转/缩放行不做任何增强（用户要求）。
 */
(function () {
    'use strict';

    var POS_IDS = ['right-prop-x', 'right-prop-y', 'right-prop-z'];
    var POS_LABEL_KEY = 'worldEditor.rightPanel.positionLabel';

    function notify(msg, type) {
        if (typeof window.showNotification === 'function') {
            try { window.showNotification(msg, type || 'info'); } catch (e) { /* ignore */ }
        } else {
            console.log('[RightPanel] ' + msg);
        }
    }

    // ===== 坐标文本解析 =====
    var NUM = '-?\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?';

    function parseCoordText(text) {
        if (typeof text !== 'string') return null;
        text = text.trim();
        if (!text) return null;

        // 形式1：带轴标签（X:-26.3 Y:9.6 Z:0.0 / x=1, y=2, z=3）
        var labeled = {};
        var re = new RegExp('([xyzXYZ])\\s*[:=\\uff1a]\\s*(' + NUM + ')', 'g');
        var m;
        while ((m = re.exec(text)) !== null) {
            labeled[m[1].toLowerCase()] = parseFloat(m[2]);
        }
        if (labeled.x !== undefined && labeled.y !== undefined && labeled.z !== undefined) {
            return labeled;
        }

        // 形式2：三个数字（括号/逗号/空白分隔，按 X Y Z 顺序）
        var nums = text.match(new RegExp(NUM, 'g'));
        if (nums && nums.length === 3) {
            return { x: parseFloat(nums[0]), y: parseFloat(nums[1]), z: parseFloat(nums[2]) };
        }
        return null;
    }

    // ===== 剪贴板工具（含降级方案） =====
    function copyText(text, okMsg) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(function () {
                notify(okMsg, 'success');
            }).catch(function () { fallbackCopy(text, okMsg); });
        } else {
            fallbackCopy(text, okMsg);
        }
    }

    function fallbackCopy(text, okMsg) {
        try {
            var ta = document.createElement('textarea');
            ta.value = text;
            ta.style.cssText = 'position:fixed;left:-9999px;top:0;';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
            notify(okMsg, 'success');
        } catch (e) {
            notify('❌ 复制失败', 'error');
        }
    }

    function readClipboard(cb) {
        if (navigator.clipboard && navigator.clipboard.readText) {
            navigator.clipboard.readText().then(cb).catch(function () {
                notify('⚠️ 无法直接读取剪贴板，请在 X 输入框内按 Ctrl+V 粘贴', 'warning');
            });
        } else {
            notify('⚠️ 浏览器不支持读取剪贴板，请在 X 输入框内按 Ctrl+V 粘贴', 'warning');
        }
    }

    function getValues(ids) {
        return ids.map(function (id) {
            var el = document.getElementById(id);
            return el ? String(el.value || '').trim() : '';
        });
    }

    function setValues(ids, v) {
        ids.forEach(function (id, i) {
            var el = document.getElementById(id);
            if (el) el.value = v[i];
        });
    }

    function fmtParsed(p) {
        return 'X:' + p.x + ' Y:' + p.y + ' Z:' + p.z;
    }

    // ===== 位置行增强 =====
    function enhancePosRow() {
        var label = document.querySelector('.right-prop-label[data-i18n="' + POS_LABEL_KEY + '"]');
        var group = label ? label.parentElement : null;
        var firstInput = document.getElementById(POS_IDS[0]);
        if (!label || !group || !firstInput || label.dataset.rpEnhanced) return;

        var pending = null;
        var confirmBtn = null;

        function showConfirm(parsed) {
            pending = parsed;
            if (!confirmBtn) {
                confirmBtn = document.createElement('button');
                confirmBtn.type = 'button';
                confirmBtn.style.cssText = 'display:none;width:100%;margin-top:6px;padding:6px 8px;' +
                    'border:none;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;' +
                    'background:linear-gradient(135deg,#11998e,#38ef7d);color:#fff;text-align:center;';
                // 插到输入行之后
                var rowEl = firstInput.closest('.right-prop-row') || firstInput.parentElement;
                rowEl.parentElement.insertBefore(confirmBtn, rowEl.nextSibling);
                confirmBtn.addEventListener('click', function () {
                    if (!pending) return;
                    setValues(POS_IDS, [pending.x, pending.y, pending.z]);
                    notify('✅ 已应用粘贴坐标：' + fmtParsed(pending) + '（记得保存更改）', 'success');
                    pending = null;
                    confirmBtn.style.display = 'none';
                });
            }
            confirmBtn.textContent = '✅ 确认应用 ' + fmtParsed(parsed);
            confirmBtn.title = '点击后才会把该坐标填入 X/Y/Z 输入框（当前输入框尚未改动）';
            confirmBtn.style.display = 'block';
        }

        function hideConfirm() {
            pending = null;
            if (confirmBtn) confirmBtn.style.display = 'none';
        }

        function miniBtn(text, title, onClick) {
            var b = document.createElement('button');
            b.type = 'button';
            b.textContent = text;
            b.title = title;
            b.style.cssText = 'border:none;background:rgba(255,255,255,0.12);color:#fff;' +
                'border-radius:4px;padding:1px 5px;margin-left:4px;font-size:11px;cursor:pointer;line-height:1.4;';
            b.onmouseenter = function () { b.style.background = 'rgba(102,126,234,0.8)'; };
            b.onmouseleave = function () { b.style.background = 'rgba(255,255,255,0.12)'; };
            b.addEventListener('click', function (e) { e.preventDefault(); onClick(); });
            return b;
        }

        // 复制按钮
        label.appendChild(miniBtn('📋', '复制位置坐标（X:.. Y:.. Z:..）', function () {
            var vals = getValues(POS_IDS);
            var text = 'X:' + (vals[0] || '0') + ' Y:' + (vals[1] || '0') + ' Z:' + (vals[2] || '0');
            copyText(text, '📋 已复制：' + text);
        }));

        // 粘贴按钮
        label.appendChild(miniBtn('📥', '从剪贴板粘贴位置坐标（需确认后生效）', function () {
            readClipboard(function (text) {
                var parsed = parseCoordText(text);
                if (!parsed) {
                    notify('❌ 无法识别坐标："' + String(text).trim().slice(0, 50) + '"，支持格式如 X:1 Y:2 Z:3', 'error');
                    return;
                }
                showConfirm(parsed);
                notify('📥 已识别：' + fmtParsed(parsed) + '，请点击"确认应用"生效', 'info');
            });
        }));

        // 行内 Ctrl+V 粘贴识别（同样走确认流程）
        POS_IDS.forEach(function (id) {
            var el = document.getElementById(id);
            if (!el) return;
            el.addEventListener('paste', function (e) {
                var text = e.clipboardData && e.clipboardData.getData('text');
                var parsed = parseCoordText(text);
                if (parsed) {
                    e.preventDefault();
                    showConfirm(parsed);
                    notify('📥 已识别：' + fmtParsed(parsed) + '，请点击"确认应用"生效', 'info');
                }
                // 解析失败不拦截，保留浏览器默认粘贴行为
            });
            // 手动改输入框时取消未确认的粘贴
            el.addEventListener('input', hideConfirm);
        });

        label.dataset.rpEnhanced = '1';
        console.log('[RightPanel] 位置坐标复制/粘贴增强已就绪（粘贴需确认生效）');
    }

    function init() {
        enhancePosRow();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
