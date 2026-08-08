/**
 * 济宁米多信息科技有限公司 版权所有
 * 世界编辑器 - Three.js 代码库面板
 * 在 world_editor.html 左侧展示 /api/threejs-blocks 列表，支持点击/拖拽加入场景
 */
(function () {
    'use strict';

    let threejsCodeBlocks = [];
    let threejsCodeSearch = '';

    function escapeHtml(text) {
        if (text === null || text === undefined) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function escapeAttr(text) {
        return escapeHtml(text)
            .replace(/'/g, '&#39;')
            .replace(/"/g, '&quot;');
    }

    function escapeJsString(text) {
        return String(text || '')
            .replace(/\\/g, '\\\\')
            .replace(/'/g, "\\'")
            .replace(/"/g, '\\"')
            .replace(/\n/g, '\\n')
            .replace(/\r/g, '\\r');
    }

    function formatBytes(bytes) {
        if (!bytes || bytes <= 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return (bytes / Math.pow(k, i)).toFixed(2) + ' ' + sizes[i];
    }

    function getDropPositionInFrontOfCamera() {
        if (typeof camera !== 'undefined' && camera && camera.getWorldDirection) {
            const cameraDirection = new THREE.Vector3();
            camera.getWorldDirection(cameraDirection);
            return camera.position.clone().add(cameraDirection.multiplyScalar(20));
        }
        return new THREE.Vector3(0, 0, 0);
    }

    async function loadThreejsCodeBlocks() {
        try {
            const res = await fetch('/api/threejs-blocks?limit=200');
            const data = await res.json();
            if (data.success && Array.isArray(data.blocks)) {
                threejsCodeBlocks = data.blocks;
                renderThreejsCodeList();
            } else {
                console.warn('加载 Three.js 代码块失败:', data.error);
            }
        } catch (e) {
            console.error('加载 Three.js 代码块失败:', e);
        }
    }

    function filterThreejsCodeList(term) {
        threejsCodeSearch = term;
        renderThreejsCodeList();
    }

    function renderThreejsCodeList() {
        const container = document.getElementById('threejs-code-list');
        const countEl = document.getElementById('threejs-code-count');
        if (!container) return;
        if (countEl) countEl.textContent = threejsCodeBlocks.length;

        const term = threejsCodeSearch.toLowerCase().trim();
        const blocks = term
            ? threejsCodeBlocks.filter(b =>
                (b.name || '').toLowerCase().includes(term) ||
                (b.description || '').toLowerCase().includes(term) ||
                (b.tags || []).join(' ').toLowerCase().includes(term)
            )
            : threejsCodeBlocks;

        if (blocks.length === 0) {
            container.innerHTML = '<div style="text-align:center;padding:20px;color:#999;font-size:13px;">暂无代码块</div>';
            return;
        }

        container.innerHTML = blocks.map(block => {
            const id = block.id;
            const name = escapeHtml(block.name || '未命名');
            const nameJs = escapeJsString(block.name || '未命名');
            const desc = escapeHtml(block.description || '');
            const tags = (block.tags || []).slice(0, 3).map(t =>
                `<span class="threejs-code-tag">${escapeHtml(t)}</span>`
            ).join('');
            const codeLen = block.code_length ? formatBytes(block.code_length) : '';
            return `
                <div class="object-item draggable-model"
                     draggable="true"
                     data-block-id="${id}"
                     onclick="addThreejsCodeBlockToScene('${id}', '${nameJs}')"
                     ondragstart="onThreejsCodeDragStart(event, '${id}', '${nameJs}')"
                     ondragend="onThreejsCodeDragEnd(event)">
                    <div class="object-info" style="flex:1;min-width:0;">
                        <div class="object-name" title="${escapeAttr(block.name || '未命名')}">🧩 ${name}</div>
                        <div class="object-type" title="${escapeAttr(block.description || '')}">
                            ${desc || 'Three.js 代码块'} ${codeLen ? '· ' + codeLen : ''}
                        </div>
                        ${tags ? '<div style="margin-top:4px;display:flex;gap:4px;flex-wrap:wrap;">' + tags + '</div>' : ''}
                    </div>
                </div>
            `;
        }).join('');
    }

    async function addThreejsCodeBlockToScene(id, name) {
        try {
            if (typeof showNotification === 'function') showNotification('正在加载 Three.js 代码块...', 'info');

            const res = await fetch('/api/threejs-blocks/' + encodeURIComponent(id));
            const data = await res.json();
            if (!data.success || !data.block) throw new Error(data.error || '获取代码块失败');

            const code = data.block.code || '';
            if (!code.trim()) throw new Error('代码块内容为空');

            if (typeof ThreeJSCodeRunner === 'undefined') throw new Error('ThreeJSCodeRunner 未加载');
            const runner = ThreeJSCodeRunner.runThreeJSCode(code, { mode: 'world', THREE: window.THREE });
            if (runner.error) throw new Error('代码执行失败: ' + runner.error.message);

            const position = getDropPositionInFrontOfCamera();

            const response = await fetch('/api/world/objects', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type: 'threejs_code',
                    name: data.block.name || name,
                    threejs_code: code,
                    position_x: position.x,
                    position_y: position.y,
                    position_z: position.z,
                    rotation_x: 0,
                    rotation_y: 0,
                    rotation_z: 0,
                    scale_x: 1,
                    scale_y: 1,
                    scale_z: 1
                })
            });

            if (!response.ok) {
                const err = await response.json().catch(() => ({}));
                throw new Error(err.details || err.error || '添加失败');
            }

            const result = await response.json();

            if (typeof loadWorldObjects === 'function') await loadWorldObjects();
            if (result && result.id) {
                setTimeout(() => {
                    if (typeof focusObject === 'function') focusObject(result.id);
                    const newObj = (typeof worldObjects !== 'undefined' ? worldObjects : []).find(o => o.id === result.id);
                    if (newObj && typeof selectObject === 'function') selectObject(newObj, false);
                    if (typeof updateRightObjectList === 'function') updateRightObjectList();
                }, 300);
            }

            if (typeof showNotification === 'function') showNotification('✅ Three.js 代码块已添加到场景', 'success');
        } catch (error) {
            console.error('添加 Three.js 代码块失败:', error);
            if (typeof showNotification === 'function') showNotification('添加失败: ' + error.message, 'error');
        }
    }

    let threejsDragData = null;

    function onThreejsCodeDragStart(event, id, name) {
        threejsDragData = { id, name };
        event.dataTransfer.effectAllowed = 'copy';
        event.dataTransfer.setData('text/plain', 'threejs-code:' + id + ':' + name);
        event.target.classList.add('dragging');
        console.log('开始拖拽 Three.js 代码块:', name);
    }

    function onThreejsCodeDragEnd(event) {
        if (event && event.target) event.target.classList.remove('dragging');
        threejsDragData = null;
    }

    function createFallbackBox() {
        const geometry = new THREE.BoxGeometry(2, 2, 2);
        const material = new THREE.MeshBasicMaterial({ color: 0xff00ff, wireframe: true });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.userData.isErrorPlaceholder = true;
        return mesh;
    }

    function createMeshFromThreejsCode(obj) {
        if (!obj || !obj.threejs_code) {
            console.warn('createMeshFromThreejsCode: 无代码内容');
            return createFallbackBox();
        }
        if (typeof ThreeJSCodeRunner === 'undefined') {
            console.warn('ThreeJSCodeRunner 未加载');
            return createFallbackBox();
        }

        const runner = ThreeJSCodeRunner.runThreeJSCode(obj.threejs_code, { mode: 'world', THREE: window.THREE });
        if (runner.error) {
            console.error('Three.js 代码运行失败:', runner.error);
            return createFallbackBox();
        }

        const group = runner.object;
        if (!group) {
            console.warn('Three.js 代码未返回对象');
            return createFallbackBox();
        }

        group.position.set(obj.position_x || 0, obj.position_y || 0, obj.position_z || 0);
        group.rotation.set(obj.rotation_x || 0, obj.rotation_y || 0, obj.rotation_z || 0);
        group.scale.set(obj.scale_x || 1, obj.scale_y || 1, obj.scale_z || 1);

        if (typeof runner.onFrame === 'function') {
            group.userData.onFrame = runner.onFrame;
        }

        return group;
    }

    window.loadThreejsCodeBlocks = loadThreejsCodeBlocks;
    window.filterThreejsCodeList = filterThreejsCodeList;
    window.addThreejsCodeBlockToScene = addThreejsCodeBlockToScene;
    window.onThreejsCodeDragStart = onThreejsCodeDragStart;
    window.onThreejsCodeDragEnd = onThreejsCodeDragEnd;
    window.createMeshFromThreejsCode = createMeshFromThreejsCode;
    window.getThreejsDragData = function () { return threejsDragData; };
})();
