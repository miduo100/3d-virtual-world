/**
 * 验收：world_editor 交互功能回归（配合 accept_editor_interaction_perf.js 使用）
 * ------------------------------------------------------------------
 * 判据 R1~R10：单选联动 / 取消选中 / 多选 / 左侧改数值生效并同步右侧 /
 *   右侧「应用更改」不抛错 / 远处对象选中强制加载入队 /
 *   占位盒镜像与模型矩阵一致（含移动后，走 EditorPerf.verify）/
 *   refreshScene 后占位盒重建无残留 / 各类对象仍在场景 / 0 console 错误
 *
 * 只读：autoSaveObjectTransform / saveObjectToDatabase / 非 GET fetch 全部在测试内替换为空实现，
 *       **不会写数据库**。
 * 用法：node scripts/accept_editor_func_regress.js（建议后台跑，见文档 §9.1-3）
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { chromium } = require('playwright');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const BASE = 'http://localhost:3002';

const results = [];
const add = (id, name, pass, d) => { results.push({ id, name, pass: !!pass, detail: d }); console.log((pass ? 'PASS ' : 'FAIL ') + id + ' ' + name + ' :: ' + d); };

(async () => {
  const pool = new Pool({ host: process.env.DB_HOST, port: +process.env.DB_PORT, database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD });
  const r = await pool.query("SELECT id, username FROM admin_users WHERE username='baseline_shot' LIMIT 1");
  await pool.end();
  const token = jwt.sign({ adminUserId: r.rows[0].id, username: r.rows[0].username, type: 'admin' }, process.env.ADMIN_JWT_SECRET, { expiresIn: '2h' });

  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  await ctx.addInitScript((t) => {
    localStorage.setItem('adminToken', t);
    localStorage.setItem('adminUser', JSON.stringify({ username: 'baseline_shot', role: 'admin' }));
  }, token);
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const loc = (m.location && m.location().url) || '';
    const s = m.text() + ' ' + loc;
    // favicon / 已知 404 模块 / 某模型内嵌贴图损坏 / 库里残留的缺失模型文件
    if (/favicon|runtime\.lastError|index\.global\.js|Couldn't load texture data|transformGizmoEnhance/.test(s)) return;
    if (/404/.test(s) && /\/models\/uploaded\//.test(s)) return;
    errs.push(s.slice(0, 200));
  });
  page.on('pageerror', (e) => { if (!/Couldn't load texture/.test(e.message)) errs.push('pageerror: ' + e.message.slice(0, 200)); });

  await page.goto(BASE + '/world_editor.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof worldObjects !== 'undefined' && worldObjects.length > 100, null, { timeout: 60000 });
  await page.waitForTimeout(14000);

  await page.evaluate(() => {
    window.__writes = 0;
    window.autoSaveObjectTransform = function () { window.__writes++; };
    window.saveObjectToDatabase = function () { window.__writes++; };
    window.__origFetch = window.fetch;
    window.fetch = function (u, o) {
      const m = (o && o.method || 'GET').toUpperCase();
      if (m !== 'GET' && String(u).indexOf('/api/') >= 0) { window.__writes++; return Promise.resolve(new Response('{"success":true}', { status: 200, headers: { 'Content-Type': 'application/json' } })); }
      return window.__origFetch.apply(this, arguments);
    };
  });

  // R1 单选
  const r1 = await page.evaluate(() => {
    const wo = worldObjects.find((o) => o.mesh && o.data && o.data.type === 'uploaded_model') || worldObjects.find((o) => o.mesh);
    selectObject(wo);
    return {
      count: selectedObjects.length,
      attached: !!(transformControls.object && transformControls.object === wo.mesh),
      rightName: (document.getElementById('right-prop-name') || {}).value,
      name: wo.data && wo.data.name,
      eventList: (document.getElementById('event-list-container') || {}).innerHTML ? true : true
    };
  });
  add('R1', '单选：gizmo/左右面板联动', r1.count === 1 && r1.attached && r1.rightName === r1.name,
    `选中=${r1.count} gizmo=${r1.attached} 右面板名="${r1.rightName}"`);

  // R2 取消选中
  const r2 = await page.evaluate(() => { deselectAll(); return { count: selectedObjects.length, gizmo: !!transformControls.object }; });
  add('R2', '取消选中：清空 + gizmo 摘除', r2.count === 0 && !r2.gizmo, `选中=${r2.count} gizmo=${r2.gizmo}`);

  // R3 多选（多选时编辑器使用锚点 gizmo，属原有设计）
  const r3 = await page.evaluate(() => {
    const a = worldObjects.find((o) => o.mesh);
    const b = worldObjects.filter((o) => o.mesh && o !== a)[0];
    selectObject(a); toggleSelection(b);
    return { count: selectedObjects.length, objIsAnchor: transformControls.object === a.mesh, attached: !!transformControls.object };
  });
  add('R3', '多选：2 个选中（gizmo 挂锚点，原设计）', r3.count === 2, `选中=${r3.count} gizmo=${r3.attached} 挂单对象=${r3.objIsAnchor}`);

  // R4 左侧面板改数值
  const r4 = await page.evaluate(() => {
    const wo = worldObjects.find((o) => o.mesh);
    selectObject(wo);
    const before = wo.mesh.scale.x;
    ['sx', 'sy', 'sz'].forEach((k) => { document.getElementById('prop-' + k).value = '1.2345'; });
    updateSelectedProperty();
    const after = wo.mesh.scale.x;
    const rightVal = document.getElementById('right-prop-sx').value;
    wo.mesh.scale.setScalar(before);
    return { before, after, rightVal, writes: window.__writes };
  });
  add('R4', '左侧改数值 → mesh 生效 + 右侧同步', Math.abs(r4.after - 1.2345) < 1e-6 && Math.abs(parseFloat(r4.rightVal) - 1.2345) < 1e-6,
    `scale ${r4.before.toFixed(4)} → ${r4.after.toFixed(4)} 右=${r4.rightVal} 落库调用=${r4.writes}`);

  // R5 右侧「应用更改」
  const r5 = await page.evaluate(() => {
    const wo = worldObjects.find((o) => o.mesh);
    selectObject(wo);
    document.getElementById('right-prop-x').value = '12.5';
    try { applyRightPanelProps(); } catch (e) { return { ok: false, err: String(e).slice(0, 120) }; }
    return { ok: true, writes: window.__writes };
  });
  add('R5', '右侧「应用更改」正常（不抛错）', r5.ok, r5.ok ? `落库已屏蔽，调用 ${r5.writes} 次` : r5.err);

  // R6 远处未加载对象 → 选中即强制加载（进入下载队列）
  const r6 = await page.evaluate(async () => {
    const v = new THREE.Vector3();
    const far = worldObjects.find((o) => {
      if (!o.mesh || o.loaded || !o.mesh.userData || !o.mesh.userData.pendingGlb) return false;
      return o.mesh.getWorldPosition(v).distanceTo(camera.position) > 400;
    });
    if (!far) return { skip: true };
    const q0 = glbLoadQueue.length + glbParseQueue.length;
    const dist = Math.round(far.mesh.getWorldPosition(v).distanceTo(camera.position));
    const hadPending = !!far.mesh.userData.pendingGlb;
    selectObject(far);
    const q1 = glbLoadQueue.length + glbParseQueue.length;
    const pendingGone = !far.mesh.userData.pendingGlb;
    return { skip: false, dist, q0, q1, hadPending, pendingGone, loadedFlag: !!far.loaded };
  });
  add('R6', '远处对象选中 → 强制加载入队', r6.skip || (r6.hadPending && r6.pendingGone && (r6.q1 > r6.q0 || r6.loadedFlag)),
    r6.skip ? '无 400m 外未加载对象（跳过）' : `距离=${r6.dist}m 队列 ${r6.q0}→${r6.q1} pendingGlb 已消费=${r6.pendingGone}`);

  // R7 占位盒镜像跟随模型（移动选中对象后自检矩阵一致）
  const r7 = await page.evaluate(async () => {
    const wo = worldObjects.find((o) => o.mesh && o.mesh.userData && o.mesh.userData._phEls && o.mesh.userData._phEls.length);
    if (!wo || !window.EditorPerf || !window.EditorPerf.verify) return { skip: true, why: 'no-ph-els' };
    selectObject(wo);
    showPlaceholder(wo);
    await new Promise((res) => setTimeout(res, 400));
    const px = wo.mesh.position.x;
    wo.mesh.position.x = px + 5.5;   // 模拟拖动
    await new Promise((res) => setTimeout(res, 400));
    const chk = window.EditorPerf.verify(120);
    wo.mesh.position.x = px;
    await new Promise((res) => setTimeout(res, 300));
    return { skip: false, chk, mirrors: window.EditorPerf.stats().placeholderMirrors };
  });
  add('R7', '占位盒镜像与模型矩阵一致（含移动后）', r7.skip || (r7.chk.bad === 0 && r7.chk.checked > 0),
    r7.skip ? '跳过: ' + JSON.stringify(r7) : `抽样 ${r7.chk.checked} 个，不一致 ${r7.chk.bad}（worst=${(r7.chk.worst || 0).toExponential(2)}）`);

  // R8 refreshScene 后占位盒重建
  const r8 = await page.evaluate(async () => {
    refreshScene();
    await new Promise((res) => setTimeout(res, 6000));
    const st = window.EditorPerf.stats();
    const chk = window.EditorPerf.verify(60);
    return { mirrors: st.placeholderMirrors, chk };
  });
  add('R8', 'refreshScene 后占位盒重建无残留', r8.mirrors > 1000 && r8.chk.bad === 0,
    `重建 ${r8.mirrors} 个镜像，抽样 ${r8.chk.checked} 个不一致 ${r8.chk.bad}`);

  // R9 各类对象仍在场景
  const r9 = await page.evaluate(() => {
    const t = {};
    worldObjects.forEach((o) => {
      const ty = (o.data && o.data.type) || '';
      if (!t[ty]) t[ty] = { total: 0, inScene: 0 };
      t[ty].total++;
      if (o.mesh && o.mesh.parent) t[ty].inScene++;
    });
    const pick = {};
    ['gaussian_splat', 'geometry_nature', 'geometry_building', 'threejs_code', 'uploaded_model'].forEach((k) => { if (t[k]) pick[k] = t[k]; });
    return pick;
  });
  add('R9', '各类对象仍在场景中', Object.keys(r9).every((k) => r9[k].inScene > 0), JSON.stringify(r9));

  // R10 控制台
  add('R10', '无噪音外 console 错误', errs.length === 0, errs.length ? errs.length + ' 条: ' + errs[0] : '0 条');
  const w = await page.evaluate(() => window.__writes);
  console.log('（测试内落库调用被替换为空实现，共拦截 ' + w + ' 次）');

  await browser.close();
  const failed = results.filter((x) => !x.pass);
  console.log('\n===== 功能回归 ' + (results.length - failed.length) + '/' + results.length + ' =====');
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
