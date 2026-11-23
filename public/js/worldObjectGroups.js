/**
 * worldObjectGroups.js — 世界编辑器对象编组（持久化 + 列表树）
 * ------------------------------------------------------------------
 * 背景：
 *   原先的编组（worldEditorGrouping.js）是纯内存的 THREE.Group：刷新即散、
 *   同一时刻只能有一个组、对象列表里看不出层级（9795 行平铺）。
 *
 * 本模块把编组升级为「场景里的常驻逻辑分组」：
 *   · 组只存名字 + 成员关系，不存自身变换（成员坐标始终是世界坐标）
 *   · 每个组对应一个恒等变换的 THREE.Group 容器，成员 mesh 挂在自己组的容器里
 *   · 对象列表按「组行 + 展开后的成员行」派生扁平数组喂给现有虚拟化列表
 *     （不改 editorListVirtual.js，组行与对象行同高 58px）
 *
 * 分工：
 *   · 本文件：数据、容器、列表行派生、折叠/改名/解组、点选入口
 *   · worldEditorGrouping.js：整体拖动 gizmo、框选、烘焙（保持原职责）
 *
 * 依赖（world_editor.html 顶层 let/const，直接按标识符引用）：
 *   scene / worldObjects / selectedObjects / transformControls / API_BASE
 *   weT / showNotification / escapeHtml / highlightObject / updateSelection
 *   updateObjectList / updateRightObjectList / focusObject / getObjectIcon
 *   THREE
 */
(function () {
    'use strict';
    if (window.WorldObjectGroups) return;

    // 组里对象过多时，展开只渲染前 N 行提示，避免一次派生上万行（列表本身是虚拟化的，仅防极端）
    const MAX_EXPAND_ROWS = 3000;

    const state = {
        groups: [],                 // [{ id, name, color, collapsed, member_count }]
        containers: new Map(),      // groupId -> THREE.Group（恒等容器）
        loaded: false
    };

    function api(path) {
        return (typeof API_BASE !== 'undefined' ? API_BASE : (location.origin + '/api/world')) + path;
    }
    function T(key, dft) { return typeof weT === 'function' ? weT(key, dft) : dft; }
    function notify(msg, type) {
        if (typeof showNotification === 'function') showNotification(msg, type || 'info');
    }
    function canUseScene() {
        try {
            return typeof scene !== 'undefined' && !!scene && typeof THREE !== 'undefined';
        } catch (e) {
            return false;   // TDZ：主脚本尚未执行到 let scene
        }
    }

    // ===== 数据 =====
    async function load(force) {
        if (state.loaded && !force) return state.groups;
        try {
            const r = await fetch(api('/object-groups'));
            const d = await r.json();
            if (d && d.success) {
                state.groups = d.groups || [];
                state.loaded = true;
            }
        } catch (e) {
            console.warn('[groups] 组列表加载失败:', e);
        }
        return state.groups;
    }

    function groupById(id) {
        return state.groups.find(function (g) { return g.id === id; }) || null;
    }

    function groupIdOf(obj) {
        if (!obj) return null;
        const gid = obj.group_id || (obj.data && obj.data.group_id) || null;
        return gid && groupById(gid) ? gid : null;
    }

    function membersOf(groupId) {
        return (typeof worldObjects !== 'undefined' ? worldObjects : [])
            .filter(function (o) { return groupIdOf(o) === groupId; });
    }

    // ===== 三维容器（恒等变换）=====
    function ensureContainer(groupId) {
        let g = state.containers.get(groupId);
        if (g) return g;
        if (!canUseScene()) return null;
        g = new THREE.Group();
        g.name = 'object-group:' + groupId;
        g.userData.isObjectGroup = true;
        g.userData.groupId = groupId;
        // 刻意不设 position/rotation/scale —— 恒等容器，成员本地坐标 == 世界坐标
        scene.add(g);
        state.containers.set(groupId, g);
        return g;
    }

    function containerOf(groupId) {
        return state.containers.get(groupId) || null;
    }

    /**
     * 对象加载时调用：按 group_id 决定挂到组容器还是场景根。
     * 必须在 mesh 创建后、加入 scene 前调用（否则会先闪一下再被搬走）。
     */
    function attachObject(mesh, obj) {
        if (!mesh || !obj || !canUseScene()) return;
        const gid = obj.group_id || (obj.data && obj.data.group_id);
        if (!gid || !groupById(gid)) {
            if (mesh.parent !== scene) scene.add(mesh);
            return;
        }
        const c = ensureContainer(gid);
        if (!c) { scene.add(mesh); return; }
        if (mesh.parent !== c) c.add(mesh);
    }

    // 把成员搬进/搬出容器，保持世界变换不变（容器恒等时等价于直接 add，用 attach 兜住意外）
    function moveInto(obj, container) {
        if (!obj || !obj.mesh || !container) return;
        if (obj.mesh.parent === container) return;
        container.attach(obj.mesh);
    }
    function moveToScene(obj) {
        if (!obj || !obj.mesh || !canUseScene()) return;
        if (obj.mesh.parent === scene) return;
        scene.attach(obj.mesh);
    }

    // 世界重载前清理所有容器（成员还给场景，交给 loadWorldObjects 统一 remove + dispose）
    function cleanupAll() {
        state.containers.forEach(function (c) {
            if (!c) return;
            const kids = c.children.slice();
            kids.forEach(function (m) {
                c.remove(m);
                if (canUseScene()) scene.add(m);
            });
            if (c.parent) c.parent.remove(c);
        });
        state.containers.clear();
        state.loaded = false;
    }

    // ===== 列表行派生（喂给 editorListVirtual）=====
    /**
     * @param {Array} [objects] 世界对象数组（默认 worldObjects）
     * @param {boolean} [forceExpand] 搜索时强制展开所有组（否则命中成员会被折叠挡住）
     */
    function buildRows(objects, forceExpand) {
        const list = objects || (typeof worldObjects !== 'undefined' ? worldObjects : []);
        const selSet = new Set((typeof selectedObjects !== 'undefined' ? selectedObjects : []).map(function (o) { return o.id; }));
        const bucket = new Map();
        state.groups.forEach(function (g) { bucket.set(g.id, []); });
        const loose = [];

        list.forEach(function (o) {
            const gid = groupIdOf(o);
            if (gid && bucket.has(gid)) bucket.get(gid).push(o);
            else loose.push(o);
        });

        const rows = [];
        state.groups.forEach(function (g) {
            const members = bucket.get(g.id) || [];
            if (members.length === 0) return;   // 空组不占列表
            let selCount = 0;
            for (let i = 0; i < members.length; i++) if (selSet.has(members[i].id)) selCount++;
            rows.push({
                id: 'grp:' + g.id,
                __isGroup: true,
                group: g,
                count: members.length,
                selCount: selCount        // 组行复选框三态用：0 / 部分 / 全部
            });
            if (g.collapsed && !forceExpand) return;
            const shown = members.slice(0, MAX_EXPAND_ROWS);
            shown.forEach(function (o) {
                rows.push(Object.assign({}, o, { __inGroup: g.id }));
            });
            if (members.length > shown.length) {
                rows.push({
                    id: 'grp-more:' + g.id,
                    __isGroupMore: true,
                    group: g,
                    hidden: members.length - shown.length
                });
            }
        });
        loose.forEach(function (o) { rows.push(o); });
        return rows;
    }

    // ===== 渲染 =====
    // 组行与成员行必须与对象行同高（虚拟列表按实测行距滚动），所以复用 item 的 padding/margin
    function renderGroupRow(row, cls) {
        const g = row.group;
        const arrow = g.collapsed ? '▶' : '▼';
        const name = typeof escapeHtml === 'function' ? escapeHtml(g.name) : g.name;
        /* 属性值必须转义双引号：escapeHtml 走 textContent→innerHTML，不处理 " ，
           组名里只要出现一个 " 就会把 title="..." 截断，后面整段 HTML 结构错乱
           （浏览器报 Uncaught SyntaxError: Invalid or unexpected token）。 */
        const nameAttr = String(g.name == null ? '' : g.name)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
        const idAttr = String(g.id == null ? '' : g.id)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;');
        const isActive = (window.WorldEditorGrouping && window.WorldEditorGrouping.activeId &&
            window.WorldEditorGrouping.activeId() === g.id);

        // 组行复选框：整组全选 = 勾上，部分 = 半选（琥珀），全不选 = 空
        const selCount = typeof row.selCount === 'number' ? row.selCount : 0;
        const allSel = selCount > 0 && selCount === row.count;
        const someSel = selCount > 0 && selCount < row.count;
        // 只有带复选框的列表（右侧）才渲染勾选框；左侧列表对象行本来就没有勾选框
        const withCheck = cls.indexOf('right-object-item') >= 0;
        const checkHtml = withCheck
            ? '<div class="right-object-check' + (allSel ? ' checked' : '') + (someSel ? ' partial' : '') + '"' +
              '     title="勾选/取消整组"' +
              '     onclick="event.stopPropagation();WorldObjectGroups.toggleGroupSelection(\'' + g.id + '\')">✓</div>'
            : '';

        // 「编辑中」标记：组内某个成员被单独选中时，提示组整体 gizmo 已让位
        let editingTag = '';
        const editingId = editingMemberId();
        if (editingId) {
            const editingObj = (typeof worldObjects !== 'undefined' ? worldObjects : [])
                .find(function (o) { return o.id === editingId; });
            if (editingObj && groupIdOf(editingObj) === g.id) editingTag = ' · 编辑中';
        }

        return '' +
            '<div class="' + cls + ' gp-group-row' + (g.collapsed ? ' collapsed' : '') + (isActive ? ' gp-active' : '') + '"' +
            '     onclick="WorldObjectGroups.selectGroup(\'' + g.id + '\')"' +
            '     ondblclick="WorldObjectGroups.promptRename(\'' + g.id + '\')"' +
            '     data-group-id="' + idAttr + '">' +
            checkHtml +
            '  <span class="gp-arrow" title="展开/折叠"' +
            '        onclick="event.stopPropagation();WorldObjectGroups.toggle(\'' + g.id + '\')">' + arrow + '</span>' +
            '  <div class="gp-icon">📦</div>' +
            '  <div class="gp-info">' +
            '    <div class="gp-name" title="' + nameAttr + '（双击改名）">' + name + '</div>' +
            '    <div class="gp-meta">编组 · ' + row.count + ' 个' + editingTag + '</div>' +
            '  </div>' +
            '  <div class="gp-actions">' +
            '    <button class="gp-btn" title="选中整组并定位"' +
            '            onclick="event.stopPropagation();WorldObjectGroups.focusGroup(\'' + g.id + '\')">📍</button>' +
            '    <button class="gp-btn danger" title="解组"' +
            '            onclick="event.stopPropagation();WorldObjectGroups.release(\'' + g.id + '\')">✂️</button>' +
            '  </div>' +
            '</div>';
    }

    function renderMoreRow(row) {
        return '<div class="gp-more-row">… 还有 ' + row.hidden + ' 个成员未展开</div>';
    }

    // ===== 折叠 / 改名 =====
    async function toggle(groupId) {
        const g = groupById(groupId);
        if (!g) return;
        g.collapsed = !g.collapsed;
        refreshLists();
        try {
            await fetch(api('/object-groups/' + g.id), {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ collapsed: g.collapsed })
            });
        } catch (e) { console.warn('[groups] 折叠状态保存失败:', e); }
    }

    async function rename(groupId, newName) {
        const g = groupById(groupId);
        if (!g) return;
        const name = String(newName || '').trim();
        if (!name || name === g.name) return;
        g.name = name.slice(0, 120);
        refreshLists();
        try {
            await fetch(api('/object-groups/' + g.id), {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: g.name })
            });
            notify(T('group.renamed', '✅ 组名已更新'), 'success');
        } catch (e) { notify('❌ 组名保存失败', 'error'); }
    }

    // 双击组名改名（组行绑定 dblclick）
    function promptRename(groupId) {
        const g = groupById(groupId);
        if (!g) return;
        const v = window.prompt(T('group.renamePrompt', '组名'), g.name);
        if (v !== null) rename(groupId, v);
    }

    // ===== 建组 / 解组 =====
    function suggestGroupName(members) {
        const names = members
            .map(function (o) { return ((o.data && o.data.name) || o.name || '').trim(); })
            .filter(Boolean);
        if (!names.length) return T('group.defaultName', '编组') + ' × ' + members.length;
        // 「Medieval Village Kit · Wall」「kit-xxx-baa482.glb」→ 去扩展名、取「·」/「_」前的部分作基座
        const base = names[0]
            .replace(/\.(glb|gltf|obj|fbx|ply|stl)$/i, '')
            .split('·')[0]
            .split('_')[0]
            .trim() || names[0];
        return base + ' × ' + members.length;
    }

    /**
     * 编组：把当前选中的对象收进新组。
     * 规则（已与用户确认）：只支持一级编组，组内成员不能再套组。
     *   ① 选中对象分属 ≥2 个组 → 拒绝（不能跨组合并）
     *   ② 选中对象都在同一个组里 → 提示已在该组
     *   ③ 选中 = 某组成员 + 组外对象 → 询问后「并入该组」（这是最常见的诉求：往已有组里补物件）
     */
    async function createFromSelection() {
        const sel = (typeof selectedObjects !== 'undefined' ? selectedObjects : []).slice();
        if (sel.length < 2) {
            notify(T('group.needTwo', '⚠️ 请至少选择 2 个对象进行编组'), 'info');
            return;
        }

        // 统计选中对象分别属于哪些组
        const gidHit = new Map();
        sel.forEach(function (o) {
            const gid = groupIdOf(o);
            if (gid) gidHit.set(gid, (gidHit.get(gid) || 0) + 1);
        });

        if (gidHit.size >= 2) {
            notify(T('group.crossNotAllowed', '⚠️ 选中的对象分属多个编组。只支持一级编组，不能把组与组合并'), 'warning');
            return;
        }

        if (gidHit.size === 1) {
            const gid = Array.from(gidHit.keys())[0];
            const g = groupById(gid);
            const outside = sel.filter(function (o) { return groupIdOf(o) !== gid; });
            if (outside.length === 0) {
                notify(T('group.allInside', '⚠️ 选中的对象都已在编组「') + (g ? g.name : '?') + '」内', 'info');
                return;
            }
            const ok = window.confirm(
                T('group.addConfirm', '把选中的 ') + outside.length + T('group.addConfirmMid', ' 个对象并入编组「') +
                (g ? g.name : '?') + T('group.addConfirmTail', '」？')
            );
            if (ok) await addToGroup(gid, outside);
            return;
        }

        // 全新编组
        const name = suggestGroupName(sel);
        try {
            const r = await fetch(api('/object-groups'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: name, ids: sel.map(function (o) { return o.id; }) })
            });
            const d = await r.json();
            if (!r.ok || !d.success) throw new Error(d.error || ('HTTP ' + r.status));

            const g = d.group;
            state.groups.push(g);
            sel.forEach(function (o) {
                o.group_id = g.id;
                if (o.data) o.data.group_id = g.id;
            });
            const c = ensureContainer(g.id);
            sel.forEach(function (o) { moveInto(o, c); });
            refreshLists();
            if (window.WorldEditorGrouping && window.WorldEditorGrouping.activate) {
                window.WorldEditorGrouping.activate(g.id);
            }
            notify(T('group.created', '✅ 已编组：') + g.name, 'success');
        } catch (e) {
            console.error('[groups] 编组失败:', e);
            notify('❌ 编组失败: ' + e.message, 'error');
        }
    }

    /** 把一批对象并入已有组（PATCH 传全量成员替换，不会踢出原有成员） */
    async function addToGroup(groupId, objs) {
        const g = groupById(groupId);
        if (!g || !objs || !objs.length) return;
        const existIds = membersOf(groupId).map(function (o) { return o.id; });
        const ids = existIds.concat(objs.map(function (o) { return o.id; }));
        try {
            const r = await fetch(api('/object-groups/' + groupId), {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids: ids })
            });
            const d = await r.json();
            if (!r.ok || !d.success) throw new Error(d.error || ('HTTP ' + r.status));

            const c = ensureContainer(groupId);
            objs.forEach(function (o) {
                o.group_id = groupId;
                if (o.data) o.data.group_id = groupId;
                moveInto(o, c);
            });
            g.member_count = ids.length;
            refreshLists();
            if (window.WorldEditorGrouping && window.WorldEditorGrouping.activate) {
                window.WorldEditorGrouping.activate(groupId);
            }
            notify('✅ 已并入 ' + objs.length + ' 个对象到「' + g.name + '」', 'success');
        } catch (e) {
            console.error('[groups] 并入失败:', e);
            notify('❌ 并入失败: ' + e.message, 'error');
        }
    }

    /** 组行复选框：整组全选 / 全部取消 */
    function toggleGroupSelection(groupId) {
        const members = membersOf(groupId);
        if (!members.length) return;
        const sel = (typeof selectedObjects !== 'undefined' ? selectedObjects : []);
        const allIn = members.every(function (m) { return sel.indexOf(m) >= 0; });

        if (allIn) {
            members.forEach(function (m) {
                const i = sel.indexOf(m);
                if (i >= 0) {
                    sel.splice(i, 1);
                    if (m.mesh && typeof highlightObject === 'function') highlightObject(m.mesh, false);
                }
            });
            if (window.WorldEditorGrouping && window.WorldEditorGrouping.activeId() === groupId) {
                window.WorldEditorGrouping.deactivate();
            }
            if (typeof updateSelection === 'function') updateSelection();
        } else {
            members.forEach(function (m) {
                if (sel.indexOf(m) < 0) {
                    sel.push(m);
                    if (m.mesh && typeof highlightObject === 'function') highlightObject(m.mesh, true);
                }
            });
            // 勾满整组 → 顺带激活（gizmo 出现在包围盒中心，属性面板切组变换）
            if (window.WorldEditorGrouping && window.WorldEditorGrouping.activate) {
                window.WorldEditorGrouping.activate(groupId);
            } else if (typeof updateSelection === 'function') {
                updateSelection();
            }
        }
    }

    /** 解组：成员回到场景根（世界变换不变），组记录删除 */
    async function release(groupId, silent) {
        const g = groupById(groupId);
        if (!g) return;
        const members = membersOf(groupId);
        if (!silent && !window.confirm(T('group.confirmRelease', '确定解散编组「') + g.name + T('group.confirmReleaseTail', '」？对象本身不会被删除。'))) {
            return;
        }
        try {
            const r = await fetch(api('/object-groups/' + g.id), { method: 'DELETE' });
            const d = await r.json();
            if (!r.ok || !d.success) throw new Error(d.error || ('HTTP ' + r.status));
        } catch (e) {
            notify('❌ 解组失败: ' + e.message, 'error');
            return;
        }

        members.forEach(function (o) {
            o.group_id = null;
            if (o.data) o.data.group_id = null;
            moveToScene(o);
        });
        const c = containerOf(groupId);
        if (c && c.parent) c.parent.remove(c);
        state.containers.delete(groupId);
        state.groups = state.groups.filter(function (x) { return x.id !== groupId; });

        if (window.WorldEditorGrouping && window.WorldEditorGrouping.deactivate) {
            window.WorldEditorGrouping.deactivate(groupId);
        }
        refreshLists();
        notify(T('group.released', '✅ 已解组'), 'success');
    }

    // ===== 选中入口 =====
    /** 点组行：激活整组（gizmo 附着到组），属性面板显示组变换 */
    function selectGroup(groupId) {
        if (window.WorldEditorGrouping && window.WorldEditorGrouping.activate) {
            window.WorldEditorGrouping.activate(groupId);
        }
        refreshLists();
    }

    function focusGroup(groupId) {
        selectGroup(groupId);
        const members = membersOf(groupId);
        if (members.length && typeof focusObject === 'function') {
            focusObject(members[0].id);
        }
    }

    /** 点成员行：单独选中该成员编辑（组 gizmo 让位，属性面板切成单对象） */
    function selectMember(objId) {
        const obj = (typeof worldObjects !== 'undefined' ? worldObjects : [])
            .find(function (o) { return o.id === objId; });
        if (!obj) return;
        if (window.WorldEditorGrouping && window.WorldEditorGrouping.deactivate) {
            window.WorldEditorGrouping.deactivate();   // 不传 id = 仅让出 gizmo，不动组结构
        }
        if (typeof selectedObjects !== 'undefined') {
            selectedObjects.length = 0;
            selectedObjects.push(obj);
        }
        if (typeof highlightObject === 'function' && obj.mesh) highlightObject(obj.mesh, true);
        if (typeof updateSelection === 'function') updateSelection();
        if (typeof focusObject === 'function') focusObject(objId);
    }

    // 列表刷新（左右两个列表共用派生行）
    function refreshLists() {
        if (typeof updateObjectList === 'function') updateObjectList(true);
        else if (typeof updateRightObjectList === 'function') updateRightObjectList(true);
    }

    // 组内成员的"编辑中"标记（供渲染用）
    function editingMemberId() {
        if (typeof window.__weGroupActive === 'function' && window.__weGroupActive()) return null;
        if (typeof selectedObjects === 'undefined' || selectedObjects.length !== 1) return null;
        const o = selectedObjects[0];
        return groupIdOf(o) ? o.id : null;
    }

    window.WorldObjectGroups = {
        state: state,
        load: load,
        buildRows: buildRows,
        renderGroupRow: renderGroupRow,
        renderMoreRow: renderMoreRow,
        attachObject: attachObject,
        cleanupAll: cleanupAll,
        ensureContainer: ensureContainer,
        containerOf: containerOf,
        membersOf: membersOf,
        groupById: groupById,
        groupIdOf: groupIdOf,
        toggle: toggle,
        rename: rename,
        promptRename: promptRename,
        createFromSelection: createFromSelection,
        addToGroup: addToGroup,
        toggleGroupSelection: toggleGroupSelection,
        release: release,
        selectGroup: selectGroup,
        focusGroup: focusGroup,
        selectMember: selectMember,
        refreshLists: refreshLists,
        editingMemberId: editingMemberId,
        suggestGroupName: suggestGroupName
    };
})();
