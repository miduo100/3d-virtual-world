/**
 * worldEditorGrouping.js
 * 世界编辑器 - 框选 + 编组 + 组整体拖动/复制/删除（M1）
 *
 * 功能：
 *  1. 框选：工具栏「框选」按钮（框选模式）或 Shift+左键拖拽，矩形框选多个对象
 *  2. 编组：选中 >=2 个对象 → 「编组」→ THREE.Group，可整体拖动/旋转/缩放
 *  3. 拖动结束自动烘焙保存（每个成员的世界变换写回数据库）
 *  4. 组感知复制：整组复制并自动重新编组，副本可直接整体拖动
 *  5. 组感知删除：删除组内任一对象 = 删除整组
 *  6. 解组：成员恢复独立（世界变换保持不变）
 *  7. 方向键整体移动：全选/多选后按 ↑↓←→ 自动编组并整体移动（Shift 加速，跟随相机视角），无需鼠标拖动
 *  8. 组变换数值面板：右侧属性面板显示组的位置/旋转/缩放输入框，精确控制整体变换（绕组中心旋转/缩放），无需拖拽
 *  9. 多选整体变换锚点：框选多个对象后点「移动/旋转/缩放」，gizmo 附着整体中心，拖动即整体变换全部选中对象
 *
 * 依赖（world_editor.html 提供，均为全局顶层声明，直接按标识符引用）：
 *  scene/camera/renderer/controls/transformControls/editMode/worldObjects/selectedObjects/API_BASE
 *  weT/weTp/showNotification/highlightObject/deselectAll/updateSelection/
 *  updateObjectList/updateStats/disposeObject3D/setEditMode/deleteSelected/loadWorldObjects
 *  THREE（r128）
 */
(function () {
    'use strict';

    // ===== 模块状态 =====
    let marqueeMode = false;        // 框选模式开关
    let activeGroup = null;         // 当前编组 THREE.Group
    let groupMembers = [];          // 组成员 worldObj 引用
    let _marqueeState = null;       // 框选进行中状态
    let _suppressClickUntil = 0;    // 框选结束后抑制 click 的截止时间
    let _bakeTimer = null;          // 烘焙保存防抖定时器

    // ===== 对外暴露（HTML 按钮直接调用） =====
    window.toggleMarqueeMode = toggleMarqueeMode;
    window.groupSelected = groupSelected;
    window.ungroupActive = ungroupActive;
    window.copySelectedGroupAware = copySelectedGroupAware;
    window.deleteSelectedGroupAware = deleteSelectedGroupAware;
    window.cleanupEditorGroup = cleanupEditorGroup;
    window.applyGroupTransform = applyGroupTransform;

    // ===== 初始化：轮询等待编辑器就绪后绑定事件 =====
    function tryInit() {
        try {
            if (typeof scene === 'undefined' || typeof camera === 'undefined' ||
                typeof renderer === 'undefined' || typeof controls === 'undefined' ||
                typeof transformControls === 'undefined' ||
                !scene || !camera || !renderer || !controls || !transformControls) {
                return false;
            }
        } catch (e) {
            // worldEditorGrouping.js 先于主脚本（let scene 等）加载，
            // 全局 let 变量此时处于 TDZ（typeof 同样抛 ReferenceError），
            // 返回 false 让 waitForEditor 稍后重试，避免整个模块崩溃
            return false;
        }
        bindEvents();
        return true;
    }
    (function waitForEditor() {
        try {
            if (!tryInit()) setTimeout(waitForEditor, 200);
        } catch (e) {
            // 任何未知异常都不能中断轮询
            setTimeout(waitForEditor, 200);
        }
    })();

    function bindEvents() {
        const container = document.getElementById('canvas-container');
        if (!container) return;

        // capture 阶段拦截 pointerdown：
        //  先于 OrbitControls（canvas target 阶段）执行，空白处启动框选并禁用它，阻止旋转视角
        renderer.domElement.addEventListener('pointerdown', onCanvasPointerDownCapture, true);

        // capture 阶段拦截 click：
        //  1) 框选拖拽结束后抑制后续 click（避免触发取消选择/点选）
        //  2) 组模式下点击组成员 → 保持整组选择（不切换到成员单选）
        container.addEventListener('click', onCapturedClick, true);

        // 组拖动结束 → 烘焙保存
        transformControls.addEventListener('dragging-changed', onGizmoDragEnd);

        // 方向键整体移动（单选 / 多选自动编组 / 已编组）
        document.addEventListener('keydown', onGroupKeyDown);

        // 注入框选矩形样式 + 组变换面板
        injectMarqueeStyle();
        injectGroupPanel();

        // 多选整体变换锚点：gizmo 拖动时把变换应用到所有选中对象
        transformControls.addEventListener('objectChange', onAnchorObjectChange);
        // 包装全局选择/模式函数，保持锚点与选择状态同步
        wrapGlobalFunctions();
    }

    // ===== 框选 =====
    function toggleMarqueeMode() {
        marqueeMode = !marqueeMode;
        if (marqueeMode && editMode !== 'select') {
            setEditMode('select');
        }
        const btn = document.getElementById('ctb-marquee');
        if (btn) btn.classList.toggle('active', marqueeMode);
        showNotify(
            marqueeMode
                ? weT('group.marqueeOn', '🔲 框选模式已开启：在画布上拖拽矩形框选多个对象')
                : weT('group.marqueeOff', '🔲 框选模式已关闭'),
            'info'
        );
    }

    function onCanvasPointerDownCapture(e) {
        if (_marqueeState) return;
        if (e.button !== 0) return;                       // 仅左键
        if (transformControls && transformControls.dragging) return; // gizmo 拖动中

        const shift = e.shiftKey;
        const shouldMarquee = marqueeMode || shift;       // 框选模式 或 Shift 临时框选
        if (!shouldMarquee) return;

        // 点到对象 → 交给 click 正常选择；仅在空白处启动框选
        if (hitTestObject(e.clientX, e.clientY)) return;

        // capture 先于 OrbitControls 执行：禁用后其 onPointerDown 直接 return，不进入旋转
        if (controls) controls.enabled = false;
        beginMarquee(e.clientX, e.clientY, shift);
    }

    function beginMarquee(clientX, clientY, append) {
        const container = document.getElementById('canvas-container');
        const crect = container.getBoundingClientRect();
        _marqueeState = {
            startX: clientX, startY: clientY, append: !!append,
            el: null, moved: false,
            cLeft: crect.left, cTop: crect.top   // 容器相对视口的偏移
        };
        const el = document.createElement('div');
        el.id = 'marquee-selector';
        el.style.display = 'none';
        container.appendChild(el);
        _marqueeState.el = el;
        if (controls) controls.enabled = false;           // 框选时暂停相机操作
        document.addEventListener('pointermove', onMarqueeMove);
        document.addEventListener('pointerup', onMarqueeUp);
    }

    function onMarqueeMove(e) {
        const s = _marqueeState;
        if (!s) return;
        const dx = e.clientX - s.startX;
        const dy = e.clientY - s.startY;
        if (Math.abs(dx) + Math.abs(dy) > 3) s.moved = true;
        const x = Math.min(s.startX, e.clientX) - s.cLeft;   // 视口坐标 → 容器局部坐标
        const y = Math.min(s.startY, e.clientY) - s.cTop;
        s.el.style.display = 'block';
        s.el.style.left = x + 'px';
        s.el.style.top = y + 'px';
        s.el.style.width = Math.abs(dx) + 'px';
        s.el.style.height = Math.abs(dy) + 'px';
        s.endX = e.clientX;
        s.endY = e.clientY;
    }

    function onMarqueeUp(e) {
        if (!_marqueeState) return;
        const s = _marqueeState;
        document.removeEventListener('pointermove', onMarqueeMove);
        document.removeEventListener('pointerup', onMarqueeUp);
        if (s.el && s.el.parentNode) s.el.parentNode.removeChild(s.el);
        _marqueeState = null;
        if (controls) controls.enabled = true;
        finishMarquee(s);
    }

    function finishMarquee(s) {
        // 矩形（视口坐标系，与 getObjectScreenBox 返回的 sx/sy 一致）
        const m = {
            left: Math.min(s.startX, s.endX),
            right: Math.max(s.startX, s.endX),
            top: Math.min(s.startY, s.endY),
            bottom: Math.max(s.startY, s.endY)
        };

        // 命中判定
        const hits = worldObjects.filter(function (obj) {
            return obj.mesh && testObjectInRect(obj.mesh, m);
        });

        // 应用选择
        if (s.append) {
            hits.forEach(function (obj) {
                if (selectedObjects.indexOf(obj) < 0) {
                    selectedObjects.push(obj);
                    highlightObject(obj.mesh, true);
                }
            });
        } else {
            deselectAll();
            hits.forEach(function (obj) {
                selectedObjects.push(obj);
                highlightObject(obj.mesh, true);
            });
        }
        updateSelection();

        // 多选整体变换锚点：强制同步（框选多对象后 gizmo 立即附着整体中心）
        syncTransformAnchor();

        showNotify(
            hits.length
                ? weTp('group.selected', { count: hits.length }, '🔲 框选选中 ' + hits.length + ' 个对象')
                : weT('group.selectedNone', '🔲 框选未选中任何对象'),
            'info'
        );

        // 拖动超过阈值 → 抑制后续 click
        if (s.moved) _suppressClickUntil = performance.now() + 300;
    }

    // 对象 8 角投影到屏幕的 AABB
    function getObjectScreenBox(mesh) {
        const box = new THREE.Box3().setFromObject(mesh);
        const min = box.min, max = box.max;
        const corners = [
            new THREE.Vector3(min.x, min.y, min.z), new THREE.Vector3(max.x, min.y, min.z),
            new THREE.Vector3(min.x, max.y, min.z), new THREE.Vector3(max.x, max.y, min.z),
            new THREE.Vector3(min.x, min.y, max.z), new THREE.Vector3(max.x, min.y, max.z),
            new THREE.Vector3(min.x, max.y, max.z), new THREE.Vector3(max.x, max.y, max.z)
        ];
        const rect = renderer.domElement.getBoundingClientRect();
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        let valid = 0;
        corners.forEach(function (c) {
            // 克隆后投影，避免覆盖原始世界坐标，同时读取 NDC z
            const v = c.clone().project(camera);
            // NDC z 必须在 [-1,1] 视锥内；z 越界说明该角在相机后方或超出远近裁剪面，
            // 其屏幕坐标会被镜像到画面另一侧，导致 AABB 异常巨大
            if (v.z < -1 || v.z > 1) return;
            const sx = (v.x + 1) * 0.5 * rect.width + rect.left;
            const sy = (1 - v.y) * 0.5 * rect.height + rect.top;
            if (sx < minX) minX = sx;
            if (sx > maxX) maxX = sx;
            if (sy < minY) minY = sy;
            if (sy > maxY) maxY = sy;
            valid++;
        });
        // 全部角点都在视锥外/相机后方，不应被框选命中
        if (valid === 0) return { left: 0, right: 0, top: 0, bottom: 0, empty: true };
        return { left: minX, right: maxX, top: minY, bottom: maxY };
    }

    function testObjectInRect(mesh, rect) {
        const sb = getObjectScreenBox(mesh);
        if (sb.empty) return false;
        // AABB 粗筛：屏幕包围盒与框选矩形相交
        if (!(sb.left <= rect.right && sb.right >= rect.left &&
              sb.top <= rect.bottom && sb.bottom >= rect.top)) return false;
        // 精筛：对象中心点必须在框选矩形内，避免 space_场景 等超大包围盒被 AABB 误命中
        const center = new THREE.Vector3();
        new THREE.Box3().setFromObject(mesh).getCenter(center);
        const ndc = center.clone().project(camera);
        if (ndc.z < -1 || ndc.z > 1) return false;
        const canvasRect = renderer.domElement.getBoundingClientRect();
        const sx = (ndc.x + 1) * 0.5 * canvasRect.width + canvasRect.left;
        const sy = (1 - ndc.y) * 0.5 * canvasRect.height + canvasRect.top;
        return sx >= rect.left && sx <= rect.right && sy >= rect.top && sy <= rect.bottom;
    }

    // 与 world_editor.html onMouseClick 一致的射线拾取
    function hitTestObject(clientX, clientY) {
        const r = renderer.domElement.getBoundingClientRect();
        const m = new THREE.Vector2();
        m.x = ((clientX - r.left) / r.width) * 2 - 1;
        m.y = -((clientY - r.top) / r.height) * 2 + 1;
        const rc = new THREE.Raycaster();
        rc.setFromCamera(m, camera);
        const selectables = worldObjects.map(function (o) { return o.mesh; }).filter(Boolean);
        if (!selectables.length) return null;
        const hits = rc.intersectObjects(selectables, true);
        if (!hits.length) return null;
        let target = hits[0].object;
        while (target.parent && !target.userData.objectId) target = target.parent;
        const id = target.userData.objectId;
        if (!id) return null;
        return worldObjects.find(function (o) { return o.id === id; }) || null;
    }

    // ===== 组选择 =====
    function selectGroupAsWhole() {
        deselectAll();
        selectedObjects = groupMembers.slice();
        groupMembers.forEach(function (obj) {
            if (obj.mesh) highlightObject(obj.mesh, true);
        });
        editMode = 'select';
        document.getElementById('current-mode').textContent = weT('status.modeSelectMove', '选择/移动');
        updateSelection();
        // updateSelection 对多选会 detach，这里重新附着组
        transformControls.attach(activeGroup);
        transformControls.setMode('translate');
        syncGroupPanelUI();
    }

    // ===== 编组 / 解组 =====
    function groupSelected() {
        destroyTransformAnchor(); // 编组前清掉多选锚点，成员移入组后锚点失效
        if (activeGroup) {
            showNotify(weT('group.alreadyGrouped', '⚠️ 当前已有编组，请先解组'), 'info');
            return;
        }
        if (selectedObjects.length < 2) {
            showNotify(weT('group.needTwo', '⚠️ 请至少选择 2 个对象进行编组'), 'info');
            return;
        }
        const members = selectedObjects.slice();
        const group = new THREE.Group();
        group.userData.isEditorGroup = true;
        members.forEach(function (obj) {
            if (obj.mesh) {
                if (obj.mesh.parent) obj.mesh.parent.remove(obj.mesh);
                group.add(obj.mesh);
            }
        });
        scene.add(group);

        activeGroup = group;
        groupMembers = members;

        transformControls.attach(group);
        transformControls.setMode('translate');
        editMode = 'select';
        document.getElementById('current-mode').textContent = weT('status.modeSelectMove', '选择/移动');
        const btn = document.getElementById('ctb-group');
        if (btn) btn.classList.add('active');
        showNotify(weTp('group.grouped', { count: members.length }, '✅ 已编组 ' + members.length + ' 个对象，可整体拖动'), 'success');
        updateObjectList();
        syncGroupPanelUI(); // 右侧显示组变换面板
    }

    function ungroupActive() {
        destroyTransformAnchor(); // 解组前清掉多选锚点
        if (!activeGroup) {
            showNotify(weT('group.noGroup', '⚠️ 当前没有编组'), 'info');
            return;
        }
        const members = groupMembers.slice();
        members.forEach(function (obj) {
            if (obj.mesh) {
                if (obj.mesh.parent) obj.mesh.parent.remove(obj.mesh);
                scene.attach(obj.mesh);
            }
        });
        if (activeGroup.parent) activeGroup.parent.remove(activeGroup);
        activeGroup = null;
        groupMembers = [];
        transformControls.detach();
        const btn = document.getElementById('ctb-group');
        if (btn) btn.classList.remove('active');

        // 解组后重新选中原成员
        deselectAll();
        members.forEach(function (obj) {
            selectedObjects.push(obj);
            if (obj.mesh) highlightObject(obj.mesh, true);
        });
        updateSelection();

        showNotify(weTp('group.ungrouped', { count: members.length }, '✅ 已解组 ' + members.length + ' 个对象'), 'success');
        updateObjectList();
        syncGroupPanelUI(); // 解组后恢复普通属性面板
    }

    // ===== 烘焙保存（组/多选锚点拖动结束自动写库） =====
    function onGizmoDragEnd(event) {
        if (event.value) return; // 拖动开始
        if (activeGroup || (transformAnchor && anchorMembers.length)) bakeGroupAndSave();
    }

    function bakeGroupAndSave(silent) {
        clearTimeout(_bakeTimer);
        _bakeTimer = setTimeout(function () { doBake(!!silent); }, 250);
    }

    // 通用烘焙保存：组 → 全部成员；多选锚点 → 全部选中；单选 → 单个对象；silent 用于方向键静默保存
    async function doBake(silent) {
        const members = activeGroup && groupMembers.length
            ? groupMembers.slice()
            : (selectedObjects.length >= 1 ? selectedObjects.slice() : []);
        if (!members.length) return;
        const updates = members.map(function (obj) {
            const mesh = obj.mesh;
            const pos = new THREE.Vector3();
            const quat = new THREE.Quaternion();
            const scale = new THREE.Vector3();
            mesh.getWorldPosition(pos);
            mesh.getWorldQuaternion(quat);
            mesh.getWorldScale(scale);
            const euler = new THREE.Euler().setFromQuaternion(quat, 'XYZ');
            return {
                id: obj.id,
                body: {
                    position_x: pos.x, position_y: pos.y, position_z: pos.z,
                    rotation_x: euler.x, rotation_y: euler.y, rotation_z: euler.z,
                    scale_x: scale.x, scale_y: scale.y, scale_z: scale.z
                }
            };
        });
        try {
            const results = await Promise.all(updates.map(function (u) {
                return fetch(API_BASE + '/objects/' + u.id, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(u.body)
                }).then(function (r) { return r.json(); })
                  .then(function (d) { return { id: u.id, ok: !!(d && d.success), u: u }; })
                  .catch(function () { return { id: u.id, ok: false, u: u }; });
            }));
            const failed = results.filter(function (r) { return !r.ok; });
            if (failed.length) {
                showNotify(weTp('group.saveFailed', { count: failed.length }, '❌ ' + failed.length + ' 个对象变换保存失败'), 'error');
            } else {
                results.forEach(function (r) {
                    const obj = members.find(function (o) { return o.id === r.id; });
                    if (obj) Object.assign(obj.data, r.u.body);
                });
                if (!silent) {
                    showNotify(
                        activeGroup
                            ? weTp('group.saved', { count: members.length }, '💾 组变换已保存 (' + members.length + ' 个对象)')
                            : (selectedObjects.length === 1
                                ? weT('group.savedSingle', '💾 位置已保存')
                                : weTp('group.savedMulti', { count: members.length }, '💾 整体变换已保存 (' + members.length + ' 个对象)')),
                        'success'
                    );
                }
            }
        } catch (error) {
            console.error('[编组] 烘焙保存失败:', error);
            showNotify(weTp('group.saveError', { error: error.message }, '❌ 组保存失败: ' + error.message), 'error');
        }
    }

    // ===== 组感知复制 =====
    async function copySelectedGroupAware() {
        if (selectedObjects.length === 0) {
            showNotify(weT('copy.selectObjectFirst', '⚠️ 请先选择对象'), 'info');
            return;
        }
        // 判断是否整组复制：当前选择 == 全部组成员
        const isGroupCopy = !!(activeGroup && groupMembers.length &&
            groupMembers.every(function (m) { return selectedObjects.indexOf(m) >= 0; }) &&
            selectedObjects.every(function (o) { return groupMembers.indexOf(o) >= 0; }));
        const originals = isGroupCopy ? groupMembers.slice() : selectedObjects.slice();

        try {
            const newIds = [];
            for (let i = 0; i < originals.length; i++) {
                const obj = originals[i];
                const body = { offset_x: 0, offset_z: 0 };
                // 传 mesh 实际世界变换，避免数据库位置滞后（拖动保存延迟）导致副本回到旧位置
                if (obj && obj.mesh) {
                    const pos = new THREE.Vector3();
                    const quat = new THREE.Quaternion();
                    const scl = new THREE.Vector3();
                    obj.mesh.getWorldPosition(pos);
                    obj.mesh.getWorldQuaternion(quat);
                    obj.mesh.getWorldScale(scl);
                    const euler = new THREE.Euler().setFromQuaternion(quat, 'XYZ');
                    body.position_x = pos.x;
                    body.position_y = pos.y;
                    body.position_z = pos.z;
                    body.rotation_x = euler.x;
                    body.rotation_y = euler.y;
                    body.rotation_z = euler.z;
                    body.scale_x = scl.x;
                    body.scale_y = scl.y;
                    body.scale_z = scl.z;
                }
                const resp = await fetch(API_BASE + '/objects/' + obj.id + '/copy', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body)
                });
                const data = await resp.json();
                if (!data.success) throw new Error(data.error || 'copy failed');
                newIds.push(data.object.id);
            }
            // 重载场景（内部会 cleanupEditorGroup 拆除旧组）
            await loadWorldObjects();

            // 选中副本
            const copies = newIds.map(function (id) {
                return worldObjects.find(function (o) { return o.id === id; });
            }).filter(Boolean);
            if (copies.length) {
                selectedObjects = copies.slice();
                copies.forEach(function (obj) {
                    if (obj.mesh) highlightObject(obj.mesh, true);
                });
                updateSelection();
                // 副本原位复制后 gizmo 直接附着，复制完即可拖动到目标位置
                syncTransformAnchor();
            }
            // 整组复制 → 副本自动重新编组
            if (isGroupCopy && copies.length >= 2) {
                const group = new THREE.Group();
                group.userData.isEditorGroup = true;
                copies.forEach(function (obj) {
                    if (obj.mesh) {
                        if (obj.mesh.parent) obj.mesh.parent.remove(obj.mesh);
                        group.add(obj.mesh);
                    }
                });
                scene.add(group);
                activeGroup = group;
                groupMembers = copies;
                transformControls.attach(group);
                transformControls.setMode('translate');
                document.getElementById('ctb-group').classList.add('active');
                syncGroupPanelUI();
            }
            showNotify(weTp('copy.copied', { count: originals.length }, '✅ 已复制 ' + originals.length + ' 个对象'), 'success');
            updateObjectList();
        } catch (error) {
            console.error('复制失败:', error);
            showNotify(weTp('copy.copyFailed', { error: error.message }, '❌ 复制失败: ' + error.message), 'error');
        }
    }

    // ===== 组感知删除 =====
    async function deleteSelectedGroupAware() {
        // 组模式下：删除组内任一对象 = 删除整组
        const inGroup = selectedObjects.filter(function (o) {
            return activeGroup && groupMembers.indexOf(o) >= 0;
        });
        if (inGroup.length > 0 && groupMembers.length > 0) {
            const count = groupMembers.length;
            if (!confirm(weTp('group.deleteConfirm', { count: count }, '确定要删除组内 ' + count + ' 个对象吗？'))) return;
            try {
                for (let i = 0; i < groupMembers.length; i++) {
                    const resp = await fetch(API_BASE + '/objects/' + groupMembers[i].id, { method: 'DELETE' });
                    const data = await resp.json();
                    if (!data.success) throw new Error(data.error || 'delete failed');
                }
                // 移除本地引用与场景对象
                groupMembers.forEach(function (obj) {
                    const idx = worldObjects.indexOf(obj);
                    if (idx >= 0) worldObjects.splice(idx, 1);
                    if (obj.mesh) {
                        if (obj.mesh.parent) obj.mesh.parent.remove(obj.mesh);
                        disposeObject3D(obj.mesh, obj.type === 'uploaded_model');
                    }
                });
                if (activeGroup && activeGroup.parent) activeGroup.parent.remove(activeGroup);
                activeGroup = null;
                groupMembers = [];
                selectedObjects = [];
                transformControls.detach();
                const btn = document.getElementById('ctb-group');
                if (btn) btn.classList.remove('active');
                updateSelection();
                updateStats();
                updateObjectList();
                syncGroupPanelUI();
                showNotify(weTp('group.deleted', { count: count }, '🗑️ 已删除 ' + count + ' 个对象'), 'success');
            } catch (error) {
                console.error('删除失败:', error);
                showNotify(weTp('group.deleteFailed', { error: error.message }, '❌ 删除失败: ' + error.message), 'error');
            }
            return;
        }
        // 普通删除 → 原逻辑
        await deleteSelected();
    }

    // ===== 清理（loadWorldObjects 重建前调用） =====
    function cleanupEditorGroup() {
        destroyTransformAnchor(); // 世界重载前清掉多选锚点
        if (activeGroup) {
            groupMembers.forEach(function (obj) {
                if (obj.mesh && obj.mesh.parent) {
                    obj.mesh.parent.remove(obj.mesh);
                    scene.add(obj.mesh); // 归还场景，供 loadWorldObjects 统一 scene.remove + dispose
                }
            });
            if (activeGroup.parent) activeGroup.parent.remove(activeGroup);
            activeGroup = null;
        }
        groupMembers = [];
        transformControls.detach();
        const btn = document.getElementById('ctb-group');
        if (btn) btn.classList.remove('active');
        syncGroupPanelUI();
    }

    // ===== 多选整体变换锚点（框选多个 → 点移动/旋转/缩放 → gizmo 整体变换） =====
    let transformAnchor = null;     // 虚拟锚点（选中对象包围盒中心）
    let anchorMembers = [];         // 锚点变换涉及的成员
    let anchorStart = null;         // 锚点初始变换
    let memberStart = {};           // 成员初始本地变换

    function createTransformAnchor() {
        if (selectedObjects.length < 2) { destroyTransformAnchor(); return; }
        // 逐对象计算世界包围盒并求并集，跳过无效对象（NaN 顶点/空 AABB/计算异常），
        // 避免个别特殊对象（媒体/记忆空间/空几何等）拖垮整体锚点导致 gizmo 不出现
        let box = null;
        let validCount = 0;
        selectedObjects.forEach(function (obj) {
            if (!obj || !obj.mesh) return;
            try {
                const b = new THREE.Box3().setFromObject(obj.mesh);
                if (!isFinite(b.min.x) || !isFinite(b.min.y) || !isFinite(b.min.z) ||
                    !isFinite(b.max.x) || !isFinite(b.max.y) || !isFinite(b.max.z) || b.isEmpty()) {
                    console.warn('[锚点] 跳过无效包围盒对象:', obj.id, obj.name || obj.mesh.name || '');
                    return;
                }
                if (!box) box = new THREE.Box3();
                box.union(b);
                validCount++;
            } catch (e) {
                console.warn('[锚点] 对象包围盒计算异常:', obj.id, (obj.name || ''), e.message);
            }
        });
        if (!box) {
            console.warn('[锚点] 无有效包围盒对象，无法创建整体锚点 selected=', selectedObjects.length);
            destroyTransformAnchor();
            return;
        }
        const center = box.getCenter(new THREE.Vector3());
        if (!isFinite(center.x) || !isFinite(center.y) || !isFinite(center.z)) {
            console.warn('[锚点] 包围盒中心无效，无法创建整体锚点 valid=', validCount);
            destroyTransformAnchor();
            return;
        }

        if (!transformAnchor) {
            transformAnchor = new THREE.Object3D();
            scene.add(transformAnchor);
        }
        transformAnchor.position.copy(center);
        transformAnchor.quaternion.set(0, 0, 0, 1);
        transformAnchor.scale.set(1, 1, 1);

        anchorMembers = selectedObjects.slice();
        anchorStart = {
            pos: transformAnchor.position.clone(),
            quat: transformAnchor.quaternion.clone(),
            scl: transformAnchor.scale.clone()
        };
        memberStart = {};
        anchorMembers.forEach(function (obj) {
            const mesh = obj.mesh;
            if (!mesh) return;
            memberStart[obj.id] = {
                pos: mesh.position.clone(),
                quat: mesh.quaternion.clone(),
                scl: mesh.scale.clone()
            };
        });

        transformControls.attach(transformAnchor);
        if (editMode === 'rotate') transformControls.setMode('rotate');
        else if (editMode === 'scale') transformControls.setMode('scale');
        else transformControls.setMode('translate');
    }

    function destroyTransformAnchor() {
        if (!transformAnchor) return;
        if (transformControls && transformControls.object === transformAnchor) {
            transformControls.detach();
        } else if (transformAnchor.parent) {
            scene.remove(transformAnchor);
        }
        transformAnchor = null;
        anchorMembers = [];
        anchorStart = null;
        memberStart = {};
    }

    // gizmo 拖动中：把锚点增量变换应用到所有成员（绕中心旋转/缩放 + 平移）
    function onAnchorObjectChange() {
        if (!transformAnchor || !anchorStart || !anchorMembers.length) return;
        const dPos = new THREE.Vector3().subVectors(transformAnchor.position, anchorStart.pos);
        const dQuat = new THREE.Quaternion().multiplyQuaternions(transformAnchor.quaternion, anchorStart.quat.clone().invert());
        const dScl = new THREE.Vector3(
            transformAnchor.scale.x / anchorStart.scl.x,
            transformAnchor.scale.y / anchorStart.scl.y,
            transformAnchor.scale.z / anchorStart.scl.z
        );
        anchorMembers.forEach(function (obj) {
            const mesh = obj.mesh;
            const s = memberStart[obj.id];
            if (!mesh || !s) return;
            const rel = new THREE.Vector3().subVectors(s.pos, anchorStart.pos);
            rel.multiply(dScl);
            rel.applyQuaternion(dQuat);
            mesh.position.copy(rel.add(anchorStart.pos).add(dPos));
            mesh.quaternion.copy(new THREE.Quaternion().multiplyQuaternions(dQuat, s.quat));
            mesh.scale.set(s.scl.x * dScl.x, s.scl.y * dScl.y, s.scl.z * dScl.z);
        });
        if (transformControls && transformControls.object === transformAnchor) transformControls.update();
    }

    // 根据 编辑模式 + 选择状态 同步锚点（select=移动，rotate/scale 同理）
    function syncTransformAnchor() {
        if (activeGroup || typeof editMode === 'undefined') {
            destroyTransformAnchor();
            return;
        }
        if (selectedObjects.length >= 2 && transformControls) {
            createTransformAnchor();
        } else {
            destroyTransformAnchor();
        }
    }

    // 包装全局函数：选择/模式/世界重载变化后保持锚点同步
    function wrapGlobalFunctions() {
        if (typeof window.updateSelection === 'function' && !window.updateSelection.__groupWrapped) {
            const orig = window.updateSelection;
            const wrapper = function () {
                orig.apply(null, arguments);
                syncTransformAnchor();
            };
            wrapper.__groupWrapped = true;
            window.updateSelection = wrapper;
        }
        if (typeof window.setEditMode === 'function' && !window.setEditMode.__groupWrapped) {
            const orig = window.setEditMode;
            const wrapper = function (mode) {
                orig.apply(null, arguments);
                syncTransformAnchor();
            };
            wrapper.__groupWrapped = true;
            window.setEditMode = wrapper;
        }
        if (typeof window.loadWorldObjects === 'function' && !window.loadWorldObjects.__groupWrapped) {
            const orig = window.loadWorldObjects;
            const wrapper = function () {
                destroyTransformAnchor();
                return orig.apply(null, arguments);
            };
            wrapper.__groupWrapped = true;
            window.loadWorldObjects = wrapper;
        }
    }

    // ===== 方向键整体移动（全选 → 自动编组 → 方向键移动，无需拖拽） =====
    function onGroupKeyDown(e) {
        const key = e.key;
        if (key !== 'ArrowUp' && key !== 'ArrowDown' && key !== 'ArrowLeft' && key !== 'ArrowRight') return;
        // 焦点在输入框/下拉框/文本域时忽略（避免干扰搜索、表单输入）
        const t = e.target;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
        if (transformControls && transformControls.dragging) return; // gizmo 拖动中不响应
        if (!selectedObjects.length && !activeGroup) return;
        e.preventDefault(); // 阻止方向键滚动页面

        // 多选且未编组 → 按一次方向键自动编组，之后整体移动
        if (!activeGroup && selectedObjects.length > 1) {
            groupSelected();
        }
        if (!activeGroup && selectedObjects.length !== 1) return;

        const step = e.shiftKey ? 2 : 0.5;          // 默认步长 0.5，Shift 加速到 2
        const delta = getScreenMoveDelta(key, step);
        if (!delta) return;

        if (activeGroup) {
            activeGroup.position.add(delta);
        } else {
            const mesh = selectedObjects[0].mesh;
            if (!mesh) return;
            mesh.position.add(delta);
        }
        bakeGroupAndSave(true);      // 防抖静默保存（按住不放只保存最后一次）
        refreshGroupPanelValues();   // 面板数值同步
    }

    // 屏幕方向键 → 世界坐标位移（跟随相机视角，始终"屏幕上下左右"）
    function getScreenMoveDelta(key, step) {
        const dir = new THREE.Vector3();
        camera.getWorldDirection(dir);
        const forward = new THREE.Vector3(dir.x, 0, dir.z); // 相机朝向投影到地面
        if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1); // 垂直俯视兜底
        forward.normalize();
        const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
        const delta = new THREE.Vector3();
        if (key === 'ArrowUp') delta.addScaledVector(forward, step);
        else if (key === 'ArrowDown') delta.addScaledVector(forward, -step);
        else if (key === 'ArrowRight') delta.addScaledVector(right, step);
        else if (key === 'ArrowLeft') delta.addScaledVector(right, -step);
        return delta;
    }

    // ===== 组变换数值面板（整体移动/旋转/缩放，无需拖拽） =====
    function injectGroupPanel() {
        if (document.getElementById('group-transform-panel')) return;
        const content = document.getElementById('right-props-content');
        if (!content) return;
        const div = document.createElement('div');
        div.id = 'group-transform-panel';
        div.style.display = 'none';
        div.style.border = '1px solid rgba(102,126,234,0.35)';
        div.style.borderRadius = '8px';
        div.style.padding = '10px';
        div.style.margin = '8px';
        div.style.background = 'rgba(102,126,234,0.08)';
        div.innerHTML =
            '<div style="font-weight:bold;color:#38ef7d;margin-bottom:8px;">📦 编组变换（整体）</div>' +
            '<div class="right-prop-group">' +
            '  <div class="right-prop-label">位置 (X, Y, Z)</div>' +
            '  <div class="right-prop-row">' +
            '    <input type="number" step="0.1" class="right-prop-input" id="group-prop-x" placeholder="X">' +
            '    <input type="number" step="0.1" class="right-prop-input" id="group-prop-y" placeholder="Y">' +
            '    <input type="number" step="0.1" class="right-prop-input" id="group-prop-z" placeholder="Z">' +
            '  </div>' +
            '</div>' +
            '<div class="right-prop-group">' +
            '  <div class="right-prop-label">旋转 (X, Y, Z) 度</div>' +
            '  <div class="right-prop-row">' +
            '    <input type="number" step="1" class="right-prop-input" id="group-prop-rx" placeholder="X°">' +
            '    <input type="number" step="1" class="right-prop-input" id="group-prop-ry" placeholder="Y°">' +
            '    <input type="number" step="1" class="right-prop-input" id="group-prop-rz" placeholder="Z°">' +
            '  </div>' +
            '</div>' +
            '<div class="right-prop-group">' +
            '  <div class="right-prop-label">缩放 (X, Y, Z)</div>' +
            '  <div class="right-prop-row">' +
            '    <input type="number" step="0.1" class="right-prop-input" id="group-prop-sx" placeholder="X" min="0.01">' +
            '    <input type="number" step="0.1" class="right-prop-input" id="group-prop-sy" placeholder="Y" min="0.01">' +
            '    <input type="number" step="0.1" class="right-prop-input" id="group-prop-sz" placeholder="Z" min="0.01">' +
            '  </div>' +
            '</div>' +
            '<button class="right-prop-apply-btn" onclick="applyGroupTransform()" ' +
            'style="width:100%;margin-top:6px;padding:10px;background:linear-gradient(135deg,#667eea,#764ba2);font-size:13px;font-weight:bold;">' +
            '✅ 应用组变换（移动/旋转/缩放）</button>' +
            '<div style="margin-top:6px;color:#999;font-size:11px;">↑↓←→ 方向键整体移动，Shift 加速</div>';
        content.insertBefore(div, content.firstChild);
    }

    // 组面板与普通属性面板的显隐切换 + 数值填充
    function syncGroupPanelUI() {
        const panel = document.getElementById('group-transform-panel');
        if (!panel) return;
        const empty = document.getElementById('right-props-empty');
        const form = document.getElementById('right-props-form');
        if (activeGroup) {
            panel.style.display = 'block';
            if (empty) empty.style.display = 'none';
            if (form) form.style.display = 'none';
            refreshGroupPanelValues();
        } else {
            panel.style.display = 'none';
            if (selectedObjects.length === 1 && typeof updateRightPropsPanel === 'function') {
                if (empty) empty.style.display = 'none';
                if (form) form.style.display = 'block';
                updateRightPropsPanel(selectedObjects[0]);
            } else {
                if (empty) empty.style.display = 'block';
                if (form) form.style.display = 'none';
            }
        }
    }

    function refreshGroupPanelValues() {
        if (!activeGroup) return;
        setGroupInput('group-prop-x', activeGroup.position.x);
        setGroupInput('group-prop-y', activeGroup.position.y);
        setGroupInput('group-prop-z', activeGroup.position.z);
        setGroupInput('group-prop-rx', THREE.MathUtils.radToDeg(activeGroup.rotation.x));
        setGroupInput('group-prop-ry', THREE.MathUtils.radToDeg(activeGroup.rotation.y));
        setGroupInput('group-prop-rz', THREE.MathUtils.radToDeg(activeGroup.rotation.z));
        setGroupInput('group-prop-sx', activeGroup.scale.x);
        setGroupInput('group-prop-sy', activeGroup.scale.y);
        setGroupInput('group-prop-sz', activeGroup.scale.z);
    }
    function setGroupInput(id, v) {
        const el = document.getElementById(id);
        if (el) el.value = (+v).toFixed(2);
    }

    // 应用组变换：旋转/缩放先绕组中心（组锚点=包围盒中心），再烘焙保存
    function applyGroupTransform() {
        if (!activeGroup) {
            showNotify(weT('group.noGroup', '⚠️ 当前没有编组'), 'info');
            return;
        }
        recenterGroupPivot();
        const num = function (id, dft) {
            const el = document.getElementById(id);
            const v = parseFloat(el ? el.value : '');
            return isFinite(v) ? v : dft;
        };
        activeGroup.position.set(num('group-prop-x', 0), num('group-prop-y', 0), num('group-prop-z', 0));
        activeGroup.rotation.set(
            THREE.MathUtils.degToRad(num('group-prop-rx', 0)),
            THREE.MathUtils.degToRad(num('group-prop-ry', 0)),
            THREE.MathUtils.degToRad(num('group-prop-rz', 0))
        );
        activeGroup.scale.set(
            Math.max(0.01, num('group-prop-sx', 1)),
            Math.max(0.01, num('group-prop-sy', 1)),
            Math.max(0.01, num('group-prop-sz', 1))
        );
        if (transformControls && transformControls.object === activeGroup) transformControls.update();
        bakeGroupAndSave();
        showNotify(weT('group.transformApplied', '✅ 组变换已应用并保存'), 'success');
    }

    // 把组锚点移到成员包围盒中心（使旋转/缩放绕整体中心）
    function recenterGroupPivot() {
        const box = new THREE.Box3();
        groupMembers.forEach(function (obj) {
            if (obj.mesh) box.expandByObject(obj.mesh);
        });
        const center = box.getCenter(new THREE.Vector3());
        if (isFinite(center.x) && isFinite(center.y) && isFinite(center.z)) {
            activeGroup.position.copy(center);
        }
    }

    // ===== capture 阶段 click 拦截 =====
    function onCapturedClick(e) {
        // 1. 框选拖拽结束后的 click 抑制
        if (performance.now() < _suppressClickUntil) {
            e.stopImmediatePropagation();
            _suppressClickUntil = 0;
            return;
        }
        // 2. 组模式下点击组成员 → 保持整组选择
        if (activeGroup && editMode === 'select' && !e.ctrlKey && !e.metaKey &&
            e.target === renderer.domElement) {
            const hit = hitTestObject(e.clientX, e.clientY);
            if (hit && groupMembers.indexOf(hit) >= 0) {
                e.stopImmediatePropagation();
                selectGroupAsWhole();
            }
        }
    }

    // ===== 工具函数 =====
    function weT(key, fallback) {
        return typeof window.weT === 'function' ? window.weT(key, fallback) : fallback;
    }
    function weTp(key, params, fallback) {
        return typeof window.weTp === 'function' ? window.weTp(key, params, fallback) : fallback;
    }
    function showNotify(message, type) {
        if (typeof window.showNotification === 'function') {
            window.showNotification(message, type);
        } else {
            console.log('[编组]', message);
        }
    }

    function injectMarqueeStyle() {
        const style = document.createElement('style');
        style.textContent = '#marquee-selector{position:absolute;border:1.5px dashed #667eea;background:rgba(102,126,234,0.15);pointer-events:none;z-index:200;box-sizing:border-box;}';
        document.head.appendChild(style);
    }
})();
