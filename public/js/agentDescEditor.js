/**
 * agentDescEditor.js — 世界编辑器「🤖 AI 描述」输入框
 *
 * 在右侧属性面板（名称输入框下方）注入一段文本域：
 *   - 管理员填写后自动 PUT /api/world/objects/:id 保存（600ms 防抖）
 *   - 仅 world_objects 真实行支持（ad_slot 等合成对象自动禁用）
 *   - AI/Agent 通过 GET /observe 的 objects[].description 读取
 * 依赖 world_editor.html 全局：worldObjects / API_BASE / showNotification /
 *   __editorAuthHeaders / updateRightPropsPanel（顶层函数声明 → window 属性，可安全包装）
 */
(function () {
    'use strict';

    var MAX_LEN = 500;
    var _injected = false;
    var _patched = false;
    var _currentId = null;
    var _saveTimer = null;

    function apiBase() {
        return (typeof API_BASE !== 'undefined') ? API_BASE : '/api/world';
    }

    function authHeaders() {
        if (typeof window.__editorAuthHeaders === 'function') return window.__editorAuthHeaders();
        return { 'Content-Type': 'application/json' };
    }

    function findObj(id) {
        if (typeof worldObjects === 'undefined' || !worldObjects) return null;
        for (var i = 0; i < worldObjects.length; i++) {
            var o = worldObjects[i];
            if (o && String(o.id) === String(id)) return o;
        }
        return null;
    }

    function notify(msg, type) {
        if (typeof showNotification === 'function') showNotification(msg, type || 'info');
    }

    function setStatus(text) {
        var hint = document.getElementById('agent-desc-hint');
        if (hint) hint.textContent = text;
    }

    function inject() {
        if (_injected) return true;
        var nameInput = document.getElementById('right-prop-name');
        if (!nameInput) return false;
        var nameGroup = nameInput.closest('.right-prop-group');
        if (!nameGroup || !nameGroup.parentElement) return false;

        var group = document.createElement('div');
        group.className = 'right-prop-group';
        group.id = 'agent-desc-group';
        group.innerHTML =
            '<div class="right-prop-label">🤖 AI 描述（给 AI 看，玩家不可见）</div>' +
            '<textarea id="agent-desc-input" rows="3" maxlength="' + MAX_LEN + '"' +
            ' placeholder="告诉 AI 这是什么、能干什么。AI 看不到 3D 模型，只靠名称和这段话认识物体。"' +
            ' style="width:100%;font-size:12px;line-height:1.5;padding:6px 8px;border:1px solid rgba(255,255,255,0.15);' +
            'border-radius:4px;background:rgba(0,0,0,0.35);color:#fff;resize:vertical;box-sizing:border-box;"></textarea>' +
            '<div id="agent-desc-hint" style="font-size:10px;color:rgba(255,255,255,0.35);margin-top:3px;">' +
            '停顿 0.6 秒自动保存；所有 AI（含公开游客）都能看到，勿写敏感信息</div>';

        nameGroup.parentElement.insertBefore(group, nameGroup.nextSibling);
        document.getElementById('agent-desc-input').addEventListener('input', function () {
            if (_currentId === null) return;
            clearTimeout(_saveTimer);
            _saveTimer = setTimeout(saveNow, 600);
        });
        _injected = true;
        return true;
    }

    function saveNow() {
        var ta = document.getElementById('agent-desc-input');
        if (!ta || _currentId === null) return;
        var id = _currentId;
        var val = String(ta.value || '').slice(0, MAX_LEN);
        fetch(apiBase() + '/objects/' + id, {
            method: 'PUT',
            headers: authHeaders(),
            body: JSON.stringify({ agent_description: val })
        }).then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.json();
        }).then(function (j) {
            if (!j.success) throw new Error(j.error || '保存失败');
            var obj = findObj(id);
            if (obj && obj.data) obj.data.agent_description = val;   // 同步内存，切走再切回不丢字
            setStatus('✓ 已保存 ' + new Date().toLocaleTimeString());
        }).catch(function (e) {
            setStatus('❌ 保存失败：' + e.message);
            notify('❌ AI 描述保存失败: ' + e.message, 'error');
        });
    }

    /** 选中对象变化时同步输入框（由包装后的 updateRightPropsPanel 调用） */
    function syncPanel(obj) {
        if (!inject()) return;
        var ta = document.getElementById('agent-desc-input');
        if (!ta) return;
        clearTimeout(_saveTimer);
        _saveTimer = null;

        if (!obj || !obj.data || obj.data.agent_description === undefined) {
            // 无选中 / 合成对象（ad_slot 等，无该字段）
            ta.value = '';
            ta.disabled = true;
            _currentId = null;
            setStatus(obj ? '该对象类型不支持 AI 描述' : '未选择对象');
            return;
        }
        ta.disabled = false;
        ta.value = obj.data.agent_description || '';
        _currentId = obj.id;
        setStatus('停顿 0.6 秒自动保存；所有 AI（含公开游客）都能看到，勿写敏感信息');
    }

    /** 包装编辑器的 updateRightPropsPanel（内联脚本顶层函数声明 → window 属性） */
    function patchPanel() {
        if (_patched || typeof window.updateRightPropsPanel !== 'function') return false;
        var orig = window.updateRightPropsPanel;
        window.updateRightPropsPanel = function (obj) {
            var r = orig.apply(this, arguments);
            try { syncPanel(obj); } catch (e) { console.error('[AgentDesc] 同步失败:', e); }
            return r;
        };
        _patched = true;
        return true;
    }

    // 等编辑器主脚本就绪（最多等 30 秒）
    var _tries = 0;
    (function waitReady() {
        if (patchPanel()) return;
        if (++_tries > 100) {
            console.warn('[AgentDesc] 未找到 updateRightPropsPanel，AI 描述框未接管选中事件');
            return;
        }
        setTimeout(waitReady, 300);
    })();

    window.AgentDescEditor = { syncPanel: syncPanel, saveNow: saveNow };
})();
