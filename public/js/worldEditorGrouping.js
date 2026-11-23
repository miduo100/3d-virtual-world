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
    // 持久化编组后：组的 3D 容器由 worldObjectGroups.js 持有（恒等变换），
    // 这里只记录「当前激活哪个组」，整体变换一律走多选锚点（onAnchorObjectChange）。
    let activeGroupId = null;       // 当前激活的组 id（null = 未激活任何组）
    let groupMembers = [];          // 当前激活组的成员 worldObj 引用
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
    // 供右侧面板三态判断（编组中优先显示组变换面板，不显示批量/单对象表单）
    window.__weGroupActive = function () { return !!activeGroupId; };
    // 供 worldObjectGroups.js 驱动（激活/退出组、查询当前组）
    window.WorldEditorGrouping = {
        activate: activateGroup,
        deactivate: deactivateGroup,
        activeId: function () { return activeGroupId; },
        members: function () { return groupMembers.slice(); },
        bake: function (silent) { bakeGroupAndSave(!!silent); }
    };

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

    // ===== 组激活 / 退出（持久化编组）=====
    // 组的 3D 容器恒等变换（成员坐标 == 世界坐标），整体平移/旋转/缩放走多选锚点。
    /**
     * 激活一个组：选中全部成员、gizmo 附着包围盒中心、右侧切成组变换面板。
     * @param {string} groupId world_object_groups.id
     */
    function activateGroup(groupId) {
        if (!groupId || !window.WorldObjectGroups) return;
        const members = window.WorldObjectGroups.membersOf(groupId);
        if (!members.length) {
            showNotify(weT('group.emptyGroup', '⚠️ 该编组没有成员'), 'info');
            return;
        }
        if (activeGroupId && activeGroupId !== groupId) {
            // 切组：先把旧组未落库的变换保存掉
            clearTimeout(_bakeTimer);
            doBakeMembers(groupMembers.slice(), true);
        }

        activeGroupId = groupId;
        groupMembers = members.slice();

        // 手动切换选中集（不能调 deselectAll：它会触发 updateSelection，
        // 而 updateSelection 里的「不再整组全选就退出组模式」校验会把刚激活的组立刻退掉）
        if (typeof selectedObjects !== 'undefined') {
            selectedObjects.forEach(function (o) { if (o && o.mesh) highlightObject(o.mesh, false); });
            selectedObjects = members.slice();
        }
        members.forEach(function (obj) { if (obj.mesh) highlightObject(obj.mesh, true); });

        editMode = 'select';
        const modeEl = document.getElementById('current-mode');
        if (modeEl) modeEl.textContent = weT('status.modeSelectMove', '选择/移动');
        const btn = document.getElementById('ctb-group');
        if (btn) btn.classList.add('active');

        // updateSelection 内部对多选 detach；包装器随后 syncTransformAnchor 建立包围盒锚点
        updateSelection();
        syncGroupPanelUI();
    }

    /**
     * 退出组模式（不销毁组本身）。
     * @param {string} [groupId] 只在当前激活的组等于它时才退出
     */
    function deactivateGroup(groupId) {
        if (!activeGroupId) return;
        if (groupId && activeGroupId !== groupId) return;

        // 退出前同步落库（不能等防抖：清空 groupMembers 后定时器就取不到成员了）
        clearTimeout(_bakeTimer);
        if (groupMembers.length) doBakeMembers(groupMembers.slice(), true);

        transformControls.detach();
        destroyTransformAnchor();
        activeGroupId = null;
        groupMembers = [];
        const btn = document.getElementById('ctb-group');
        if (btn) btn.classList.remove('active');
        syncGroupPanelUI();
    }

    // 兼容旧调用（框选后点「组整体」等场景）
    function selectGroupAsWhole() {
        if (activeGroupId) activateGroup(activeGroupId);
    }

    // ===== 编组 / 解组（转交 worldObjectGroups.js：建组要落库、列表要成树）=====
    function groupSelected() {
        if (!window.WorldObjectGroups) {
            showNotify('❌ 编组模块未加载，请刷新页面', 'error');
            return;
        }
        // 规则：选中的对象已在别的组里 → 提示并禁止（不做「组内再分组」）
        window.WorldObjectGroups.createFromSelection();
    }

    function ungroupActive() {
        if (!activeGroupId) {
            showNotify(weT('group.noGroup', '⚠️ 没有选中的编组'), 'info');
            return;
        }
        window.WorldObjectGroups.release(activeGroupId);
    }

    // ===== 烘焙保存（组/多选锚点拖动结束自动写库） =====
    function onGizmoDragEnd(event) {
        if (event.value) return; // 拖动开始
        if (activeGroupId || (transformAnchor && anchorMembers.length)) bakeGroupAndSave();
    }

    function bakeGroupAndSave(silent) {
        clearTimeout(_bakeTimer);
        _bakeTimer = setTimeout(function () { doBake(!!silent); }, 250);
    }

    // 通用烘焙保存：组 → 全部成员；多选锚点 → 全部选中；单选 → 单个对象；silent 用于方向键静默保存
    async function doBake(silent) {
        const members = (activeGroupId && groupMembers.length)
            ? groupMembers.slice()
            : (selectedObjects.length >= 1 ? selectedObjects.slice() : []);
        return doBakeMembers(members, silent);
    }

    // 用显式成员列表烘焙（退出组时要在清空 groupMembers 之前同步调用）
    async function doBakeMembers(members, silent) {
        if (!members || !members.length) return;
        const updates = members.map(function (obj) {
            if (!obj) return null;
            let pos, quat, scale;
            if (obj.mesh) {
                pos = new THREE.Vector3();
                quat = new THREE.Quaternion();
                scale = new THREE.Vector3();
                obj.mesh.getWorldPosition(pos);
                obj.mesh.getWorldQuaternion(quat);
                obj.mesh.getWorldScale(scale);
            } else {
                // 【2026-11-18】未加载成员没有 mesh，原代码在这里直接抛 TypeError
                //（mesh.getWorldPosition of null）→ 拖组/切组的落库整批失败。
                // 改用数据字段：它们可能已被整体拖动/旋转写回。
                pos = objVec3(obj);
                quat = objQuat(obj);
                scale = objScl(obj);
            }
            const euler = new THREE.Euler().setFromQuaternion(quat, 'XYZ');
            return {
                id: obj.id,
                body: {
                    position_x: pos.x, position_y: pos.y, position_z: pos.z,
                    rotation_x: euler.x, rotation_y: euler.y, rotation_z: euler.z,
                    scale_x: scale.x, scale_y: scale.y, scale_z: scale.z
                }
            };
        }).filter(Boolean);
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
                        activeGroupId
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
        const isGroupCopy = !!(activeGroupId && groupMembers.length &&
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
            // 整组复制 → 副本自动成组（走后端落库，列表里立刻出现新组）
            if (isGroupCopy && copies.length >= 2) {
                selectedObjects = copies.slice();
                copies.forEach(function (obj) { if (obj.mesh) highlightObject(obj.mesh, true); });
                if (window.WorldObjectGroups) window.WorldObjectGroups.createFromSelection();
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
            return activeGroupId && groupMembers.indexOf(o) >= 0;
        });
        if (inGroup.length > 0 && groupMembers.length > 0) {
            const count = groupMembers.length;
            if (!confirm(weTp('group.deleteConfirm', { count: count }, '确定要删除组内 ' + count + ' 个对象吗？'))) return;
            const groupIdToRelease = activeGroupId;
            try {
                for (let i = 0; i < groupMembers.length; i++) {
                    // 【2026-11-15】出生点是系统对象，跳过：后端并无这条记录（只会 404），
                    // 但本地移除会让玩家当场失去落点。
                    if (groupMembers[i].id === 'spawn_point') continue;
                    const resp = await fetch(API_BASE + '/objects/' + groupMembers[i].id, { method: 'DELETE' });
                    const data = await resp.json();
                    if (!data.success) throw new Error(data.error || 'delete failed');
                }
                // 移除本地引用与场景对象
                groupMembers.forEach(function (obj) {
                    if (obj.id === 'spawn_point') return;   // 出生点保留在场景与世界列表里
                    const idx = worldObjects.indexOf(obj);
                    if (idx >= 0) worldObjects.splice(idx, 1);
                    if (obj.mesh) {
                        if (obj.mesh.parent) obj.mesh.parent.remove(obj.mesh);
                        disposeObject3D(obj.mesh, obj.type === 'uploaded_model');
                    }
                });
                // 组里成员全删了 → 组记录也要删掉，否则列表留下空组
                if (groupIdToRelease) {
                    try {
                        await fetch(API_BASE + '/object-groups/' + groupIdToRelease, { method: 'DELETE' });
                    } catch (e) { /* 组已不存在也无所谓 */ }
                    if (window.WorldObjectGroups) {
                        window.WorldObjectGroups.state.groups =
                            window.WorldObjectGroups.state.groups.filter(function (g) { return g.id !== groupIdToRelease; });
                        const c = window.WorldObjectGroups.containerOf(groupIdToRelease);
                        if (c && c.parent) c.parent.remove(c);
                        window.WorldObjectGroups.state.containers.delete(groupIdToRelease);
                    }
                }
                activeGroupId = null;
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
        // 持久化编组：所有组容器由 worldObjectGroups.js 持有，成员归还场景后统一 dispose
        if (window.WorldObjectGroups) {
            window.WorldObjectGroups.cleanupAll();
        }
        activeGroupId = null;
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

    /* ---- 未加载成员的变换兜底（2026-11-18）----
     * 组常见上千个对象，流式加载只把相机附近的拉进来（loadDistance 200m），
     * 其余 obj.mesh 为空。原实现直接 `const mesh = obj.mesh; mesh.getWorldPosition()`
     * 会抛 TypeError，导致「拖组」或「切组落库」直接失败；锚点也会因为只统计
     * 少量已加载对象而飞到远处。这里统一用数据库位置字段兜底。 */
    function _pnum(v, d) {
        return (typeof v === 'number' && isFinite(v)) ? v : (typeof d === 'number' ? d : 0);
    }
    function objVec3(obj) {
        const d = (obj && obj.data) || {};
        return new THREE.Vector3(
            _pnum(obj && obj.position_x, d.position_x),
            _pnum(obj && obj.position_y, d.position_y),
            _pnum(obj && obj.position_z, d.position_z)
        );
    }
    function objQuat(obj) {
        const d = (obj && obj.data) || {};
        const e = new THREE.Euler(
            _pnum(obj && obj.rotation_x, d.rotation_x),
            _pnum(obj && obj.rotation_y, d.rotation_y),
            _pnum(obj && obj.rotation_z, d.rotation_z), 'XYZ');
        return new THREE.Quaternion().setFromEuler(e);
    }
    function objScl(obj) {
        const d = (obj && obj.data) || {};
        return new THREE.Vector3(
            _pnum(obj && obj.scale_x, _pnum(d.scale_x, 1)),
            _pnum(obj && obj.scale_y, _pnum(d.scale_y, 1)),
            _pnum(obj && obj.scale_z, _pnum(d.scale_z, 1))
        );
    }
    function setObjTransform(obj, pos, quat, scl) {
        const e = new THREE.Euler().setFromQuaternion(quat, 'XYZ');
        const body = {
            position_x: pos.x, position_y: pos.y, position_z: pos.z,
            rotation_x: e.x, rotation_y: e.y, rotation_z: e.z,
            scale_x: scl.x, scale_y: scl.y, scale_z: scl.z
        };
        Object.assign(obj, body);
        if (!obj.data) obj.data = {};
        Object.assign(obj.data, body);
    }

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

        /**
         * 【2026-11-18 修】gizmo 跑到很远的地方
         * ------------------------------------------------------------
         * 上面只统计了「已经有 mesh 的成员」。组往往有上千个对象，流式加载只把
         * 相机附近的拉进来（loadDistance 200m），其余 obj.mesh 为空被跳过；
         * 只要此刻恰好有几个远处成员加载完成，包围盒并集中心就会飞到那边，
         * 表现为「选中组后移动箭头在很远的地方，根本不在组上方」。
         *
         * 修法：再用数据库里的位置字段（position_x/y/z，恒可用、与加载状态无关）
         * 算一个位置中心做交叉校验；两者偏差超过阈值时以位置中心为准。
         * 位置不会说谎 —— 它描述的是这套东西实际摆在哪。
         */
        let px = 0, py = 0, pz = 0, pn = 0;
        selectedObjects.forEach(function (o) {
            if (!o) return;
            if (typeof o.position_x === 'number' && typeof o.position_z === 'number') {
                px += o.position_x;
                py += (typeof o.position_y === 'number' ? o.position_y : 0);
                pz += o.position_z;
                pn++;
            }
        });

        let finalCenter = center.clone();
        let posCenter = null;
        if (pn > 0) {
            posCenter = new THREE.Vector3(px / pn, py / pn, pz / pn);
            const gap = center.distanceTo(posCenter);
            /**
             * 【2026-11-18 二次修】组模式**强制**用位置中心，不再看偏差阈值。
             * 组动辄上千个成员，网格只加载了零星几个（流式加载按距离），
             * 采样出来的包围盒中心根本没有代表性 —— 哪怕只差 30 米，gizmo 也是飘的。
             * 普通多选（非组）成员少、加载基本齐全，仍优先用网格中心。
             */
            if (activeGroupId || (pn > 1 && gap > 80)) {
                finalCenter.copy(posCenter);
            }
        }

        console.log('[锚点] 成员=' + selectedObjects.length +
            ' 有效mesh=' + validCount + ' 有坐标=' + pn +
            ' | 网格中心=' + center.toArray().map(function (v) { return +v.toFixed(1); }).join(',') +
            ' | 位置中心=' + (posCenter ? posCenter.toArray().map(function (v) { return +v.toFixed(1); }).join(',') : 'n/a') +
            ' | 采用=' + finalCenter.toArray().map(function (v) { return +v.toFixed(1); }).join(',') +
            ' | 组模式=' + (!!activeGroupId));

        if (!transformAnchor) {
            transformAnchor = new THREE.Object3D();
            scene.add(transformAnchor);
        }
        transformAnchor.position.copy(finalCenter);
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
            if (!obj) return;
            const mesh = obj.mesh;
            // 未加载成员也要记初始变换，否则整体拖动时它留在原地、组就散了
            memberStart[obj.id] = mesh
                ? { pos: mesh.position.clone(), quat: mesh.quaternion.clone(), scl: mesh.scale.clone(), noMesh: false }
                : { pos: objVec3(obj), quat: objQuat(obj), scl: objScl(obj), noMesh: true };
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
            const s = memberStart[obj.id];
            if (!s) return;
            const rel = new THREE.Vector3().subVectors(s.pos, anchorStart.pos);
            rel.multiply(dScl);
            rel.applyQuaternion(dQuat);
            const newPos = rel.add(anchorStart.pos).add(dPos);
            const newQuat = new THREE.Quaternion().multiplyQuaternions(dQuat, s.quat);
            const mesh = obj.mesh;
            const finalScl = new THREE.Vector3(s.scl.x * dScl.x, s.scl.y * dScl.y, s.scl.z * dScl.z);
            if (mesh) {
                mesh.position.copy(newPos);
                mesh.quaternion.copy(newQuat);
                mesh.scale.copy(finalScl);
            }
            // 【2026-11-18 修】无论有没有 mesh 都同步回对象数据。
            // 原先只动 mesh、不更新 obj.position_x/z，拖完以后再点这个组，
            // createTransformAnchor 用「位置中心」算出来的还是拖动前的坐标，
            // gizmo 就留在原地、跟模型差出两百多米。
            setObjTransform(obj, newPos, newQuat, finalScl);
        });
        if (transformControls && transformControls.object === transformAnchor) transformControls.update();
    }

    // 根据 编辑模式 + 选择状态 同步锚点（select=移动，rotate/scale 同理）
    function syncTransformAnchor() {
        if (typeof editMode === 'undefined') {
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
        if (!selectedObjects.length && !activeGroupId) return;
        e.preventDefault(); // 阻止方向键滚动页面

        // 多选且未编组 → 先建组（会落库），再按键才整体移动。
        // 编组已经成为持久概念，不再做「按一下键就偷偷建个临时组」的动作。
        if (!activeGroupId && selectedObjects.length > 1) {
            groupSelected();
            return;
        }
        if (!activeGroupId && selectedObjects.length !== 1) return;

        const step = e.shiftKey ? 2 : 0.5;          // 默认步长 0.5，Shift 加速到 2
        const delta = getScreenMoveDelta(key, step);
        if (!delta) return;

        if (activeGroupId && groupMembers.length) {
            // 组整体移动：组容器恒等，直接平移每个成员（世界坐标）
            groupMembers.forEach(function (obj) {
                if (obj && obj.mesh) obj.mesh.position.add(delta);
            });
            // 锚点/起始快照一起前移，否则下次 gizmo 拖动会把这段位移重复应用一次
            if (transformAnchor) {
                transformAnchor.position.add(delta);
                if (anchorStart) anchorStart.pos.add(delta);
                anchorMembers.forEach(function (obj) {
                    const s = memberStart[obj.id];
                    if (s && obj.mesh) s.pos.copy(obj.mesh.position);
                });
            }
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
    // 面板形态统一交给 world_editor.html 的 setRightPropsMode / refreshRightPanelForSelection 管，
    // 避免两处各写一套 display 逻辑互相覆盖（属性面板收起后组面板也会被一起藏起来）。
    function syncGroupPanelUI() {
        const panel = document.getElementById('group-transform-panel');
        if (!panel) return;
        if (activeGroupId) {
            panel.style.display = 'block';
            if (typeof window.setRightPropsMode === 'function') {
                window.setRightPropsMode('group');
            } else {
                const empty = document.getElementById('right-props-empty');
                const form = document.getElementById('right-props-form');
                if (empty) empty.style.display = 'none';
                if (form) form.style.display = 'none';
            }
            refreshGroupPanelValues();
        } else {
            panel.style.display = 'none';
            if (typeof window.refreshRightPanelForSelection === 'function') {
                window.refreshRightPanelForSelection();
            } else {
                const empty = document.getElementById('right-props-empty');
                const form = document.getElementById('right-props-form');
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
    }

    // 组的锚点 = 全体成员的世界包围盒中心（组容器恒等，自身没有 transform）
    function groupAnchorCenter() {
        if (!groupMembers.length) return null;
        const box = new THREE.Box3();
        let valid = false;
        groupMembers.forEach(function (obj) {
            if (!obj || !obj.mesh) return;
            try { box.expandByObject(obj.mesh); valid = true; } catch (e) { /* 个别空几何跳过 */ }
        });
        if (!valid || box.isEmpty()) return null;
        const c = box.getCenter(new THREE.Vector3());
        if (!isFinite(c.x) || !isFinite(c.y) || !isFinite(c.z)) return null;
        return c;
    }

    function refreshGroupPanelValues() {
        if (!activeGroupId) return;
        const c = groupAnchorCenter();
        if (c) {
            setGroupInput('group-prop-x', c.x);
            setGroupInput('group-prop-y', c.y);
            setGroupInput('group-prop-z', c.z);
        }
        // 旋转/缩放按「相对增量」处理：每次应用后归零/归一，避免与绝对值输入语义打架
        setGroupInput('group-prop-rx', 0);
        setGroupInput('group-prop-ry', 0);
        setGroupInput('group-prop-rz', 0);
        setGroupInput('group-prop-sx', 1);
        setGroupInput('group-prop-sy', 1);
        setGroupInput('group-prop-sz', 1);
    }
    function setGroupInput(id, v) {
        const el = document.getElementById(id);
        if (el) el.value = (+v).toFixed(2);
    }

    // 应用组变换：位置=绝对锚点，旋转/缩放=相对增量，绕包围盒中心作用到每个成员
    function applyGroupTransform() {
        if (!activeGroupId || !groupMembers.length) {
            showNotify(weT('group.noGroup', '⚠️ 当前没有编组'), 'info');
            return;
        }
        const center = groupAnchorCenter();
        if (!center) {
            showNotify('❌ 无法计算编组中心（成员几何体异常）', 'error');
            return;
        }
        const num = function (id, dft) {
            const el = document.getElementById(id);
            const v = parseFloat(el ? el.value : '');
            return isFinite(v) ? v : dft;
        };

        const target = new THREE.Vector3(
            num('group-prop-x', center.x),
            num('group-prop-y', center.y),
            num('group-prop-z', center.z)
        );
        const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(
            THREE.MathUtils.degToRad(num('group-prop-rx', 0)),
            THREE.MathUtils.degToRad(num('group-prop-ry', 0)),
            THREE.MathUtils.degToRad(num('group-prop-rz', 0)),
            'XYZ'
        ));
        const scl = new THREE.Vector3(
            Math.max(0.01, num('group-prop-sx', 1)),
            Math.max(0.01, num('group-prop-sy', 1)),
            Math.max(0.01, num('group-prop-sz', 1))
        );

        groupMembers.forEach(function (obj) {
            const mesh = obj && obj.mesh;
            if (!mesh) return;
            const rel = new THREE.Vector3().subVectors(mesh.position, center);
            rel.multiply(scl);
            rel.applyQuaternion(q);
            mesh.position.copy(target).add(rel);
            mesh.quaternion.premultiply(q);
            mesh.scale.set(mesh.scale.x * scl.x, mesh.scale.y * scl.y, mesh.scale.z * scl.z);
        });

        syncTransformAnchor();      // 重建锚点与起始快照，避免下次拖动跳变
        bakeGroupAndSave();
        refreshGroupPanelValues();
        showNotify(weT('group.transformApplied', '✅ 组变换已应用并保存'), 'success');
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
        if (activeGroupId && editMode === 'select' && !e.ctrlKey && !e.metaKey &&
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
