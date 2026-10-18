/**
 * 验收：缩放 Gizmo 增强（会话2 / P1-2）
 * ------------------------------------------------------------------
 * 权威文档：虚拟世界编辑器性能优化-开发规范与进度.md §4.2 P1-2
 *
 * 判据：
 *   W1 模块已加载 + THREE.TransformControls 被 Proxy 包装 + 实例已增强
 *   W2 真实拖拽单轴（X）手柄、不按 Shift → 三轴同倍放大（k>1，三轴比例一致）
 *   W3 真实拖拽单轴（X）手柄、按住 Shift → 只有 X 变，Y/Z 不变
 *   W4 从中心手柄（XYZ）按下并向外拖 → 三轴仍等比，且倍率被钳制（k ≤ 50，不爆炸）
 *   W5 拖动期/松手后补派发 objectChange（patchNotified 增长）
 *   U1 unified_editor.html：模块加载 + 动态加载 three 后实例被轮询补装
 *   M1 主世界 index.html：buildingManager.transformControls 已被增强
 *
 * 只读：拖动前把 autoSaveObjectTransform 换成空实现，绝不写数据库。
 * 用法：node scripts/accept_gizmo_scale_uniform.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { chromium } = require('playwright');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const BASE = process.env.EDITOR_BASE || 'http://localhost:3002';
const results = [];
const log = (m) => console.log('[gizmo] ' + m);
function add(id, name, pass, detail) {
  results.push({ id, name, pass: !!pass, detail });
  log((pass ? 'PASS ' : 'FAIL ') + id + ' ' + name + ' :: ' + detail);
}
const r4 = (v) => (isFinite(v) ? Math.round(v * 1e4) / 1e4 : String(v));

const isNoise = (t, loc) => {
  const s = (t || '') + ' ' + (loc || '');
  if (!s.trim()) return true;
  if (/Couldn't load texture data/i.test(s)) return true;
  if (/accept_p5\/city_hall\.glb/.test(s)) return true;
  // 编辑器有两个已知 404 模块（文档 §3.1），与本任务无关
  return /runtime\.lastError|index\.global\.js|favicon\.ico|ResizeObserver loop/.test(s) ||
    /editorPerfDiag\.js/.test(s);
};

async function makeAdminToken() {
  const pool = new Pool({
    host: process.env.DB_HOST || 'localhost', port: Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME || 'virtual_world', user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'password'
  });
  try {
    const r = await pool.query("SELECT id, username FROM admin_users WHERE is_active IS NOT FALSE AND username='baseline_shot' LIMIT 1");
    const row = r.rows[0] || (await pool.query('SELECT id, username FROM admin_users ORDER BY id LIMIT 1')).rows[0];
    if (!row) throw new Error('admin_users 无可用管理员');
    const token = jwt.sign({ adminUserId: row.id, username: row.username, type: 'admin' },
      process.env.ADMIN_JWT_SECRET, { expiresIn: '2h' });
    return { token, row };
  } finally { await pool.end().catch(() => {}); }
}

// 页面内：计算某个手柄的可点击屏幕坐标（r185 把手柄变换烘焙进 geometry）
const PAGE_HELPERS = () => {
  window.__gzHandle = function (axis) {
    const tc = transformControls;
    if (!tc || !tc._gizmo || !tc._gizmo.picker || !tc._gizmo.picker.scale) return null;
    const kids = tc._gizmo.picker.scale.children || [];
    let target = null;
    for (let i = 0; i < kids.length; i++) {
      if (kids[i].name === axis) { target = kids[i]; break; }
    }
    if (!target) return null;
    target.updateWorldMatrix(true, false);
    if (!target.geometry.boundingBox) target.geometry.computeBoundingBox();
    const c = target.geometry.boundingBox.getCenter(new THREE.Vector3());
    c.applyMatrix4(target.matrixWorld);
    c.project(camera);
    const canvas = renderer.domElement;
    const rect = canvas.getBoundingClientRect();
    return {
      x: rect.left + (c.x * 0.5 + 0.5) * rect.width,
      y: rect.top + (-c.y * 0.5 + 0.5) * rect.height,
      ndcZ: c.z
    };
  };
  window.__gzState = function () {
    const wo = window.__gz;
    const m = wo && wo.mesh;
    return {
      axis: transformControls.axis,
      dragging: transformControls.dragging,
      mode: transformControls.mode,
      scale: m ? [m.scale.x, m.scale.y, m.scale.z] : null,
      dbg: window.TransformGizmoEnhance ? window.TransformGizmoEnhance._debug : null
    };
  };
};

// 找一个真正能 hover 到目标轴的点（允许 ±px 抖动，避开多手柄重叠）
async function findHandlePoint(page, axis, tries) {
  const base = await page.evaluate((a) => window.__gzHandle(a), axis);
  if (!base) return null;
  const offsets = [[0, 0]];
  const n = tries || 12;
  for (let k = 1; k <= n; k++) {
    offsets.push([k * 3, 0], [-k * 3, 0], [0, k * 3], [0, -k * 3], [k * 3, k * 3], [-k * 3, -k * 3]);
  }
  for (const [dx, dy] of offsets) {
    const x = base.x + dx, y = base.y + dy;
    if (x < 0 || y < 0) continue;
    await page.mouse.move(x, y);
    const hit = await page.evaluate(() => transformControls.axis);
    if (hit === axis) return { x, y, hovered: hit };
  }
  return null;
}

async function doDrag(page, from, dx, dy, opts) {
  const o = opts || {};
  if (o.shift) await page.keyboard.down('Shift');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  const steps = 8;
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(from.x + (dx * i) / steps, from.y + (dy * i) / steps);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  if (o.shift) await page.keyboard.up('Shift');
}

(async () => {
  const health = await fetch(BASE + '/api/health').then((r) => r.json()).catch(() => null);
  if (!health || health.status !== 'ok') throw new Error('服务器未运行: ' + BASE);

  const { token, row } = await makeAdminToken();
  log('自签管理员 token: ' + row.username);

  const browser = await chromium.launch({
    channel: 'chrome', headless: true,
    args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist']
  });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(({ tok, usr }) => {
    try {
      localStorage.setItem('adminToken', tok);
      localStorage.setItem('adminUser', JSON.stringify({ id: usr.id, username: usr.username, role: 'admin' }));
    } catch (e) {}
  }, { tok: token, usr: row });

  // ==================== W 组：world_editor.html 真实拖拽 ====================
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const loc = (m.location && m.location().url) || '';
    if (isNoise(m.text(), loc)) return;
    errors.push((m.text() + ' @ ' + loc).slice(0, 200));
  });
  page.on('pageerror', (e) => { if (!isNoise(e.message)) errors.push('pageerror: ' + e.message.slice(0, 200)); });

  await page.goto(BASE + '/world_editor.html', { waitUntil: 'domcontentloaded' });
  if (/admin_login/.test(page.url())) throw new Error('管理员 token 无效');
  await page.waitForFunction(() => typeof worldObjects !== 'undefined' && worldObjects.length > 100, null, { timeout: 60000 });
  await page.waitForTimeout(6000);   // 等首屏加载与合批巡检稳定

  const loaded = await page.evaluate(() => {
    const T = window.THREE;
    return {
      mod: !!window.TransformGizmoEnhance,
      version: window.TransformGizmoEnhance ? window.TransformGizmoEnhance.version : null,
      wrapped: !!(T && T.TransformControls && T.TransformControls.__tgeWrapped),
      instanceofOrig: (function () {
        try { return transformControls instanceof T.TransformControls; } catch (e) { return false; }
      })(),
      enhanced: !!(transformControls && transformControls.__tgeEnhanced),
      debug: window.TransformGizmoEnhance ? window.TransformGizmoEnhance._debug : null
    };
  });
  add('W1', '模块加载 + Proxy 包装 + 实例增强',
    loaded.mod && loaded.wrapped && loaded.enhanced && loaded.instanceofOrig,
    `mod=${loaded.mod} v=${loaded.version} wrapped=${loaded.wrapped} enhanced=${loaded.enhanced} instanceof=${loaded.instanceofOrig}`);

  // 选一个模板几何对象，相机对准它（不写库）
  const target = await page.evaluate(() => {
    window.autoSaveObjectTransform = function () { /* 测试内禁写库 */ };
    const isTpl = (o) => {
      const t = (o.data && o.data.type) || '';
      const u = (o.mesh && o.mesh.userData) || {};
      return t.indexOf('geometry_') === 0 && !u._realMesh && !u.pendingGeometry && u.objectType !== 'geometry_building';
    };
    const wo = worldObjects.find(isTpl) || worldObjects.find((o) => o.mesh);
    window.__gz = wo;
    deselectAll();
    selectObject(wo);
    transformControls.setMode('scale');
    transformControls.attach(wo.mesh);
    transformControls.size = 1.4;
    const p = new THREE.Vector3();
    wo.mesh.getWorldPosition(p);
    const box = new THREE.Box3().setFromObject(wo.mesh);
    const size = Math.max(1, box.getSize(new THREE.Vector3()).length());
    const d = Math.max(9, size * 2.4);
    camera.position.set(p.x + d * 0.55, p.y + d * 0.5, p.z + d * 0.75);
    controls.target.copy(p);
    camera.lookAt(p);
    controls.update();
    const __helper = transformControls.getHelper ? transformControls.getHelper() : null;
    if (__helper) __helper.updateMatrixWorld(true);   // r185：gizmo 由 getHelper() 的 helper 承载
    return {
      id: wo.id, type: (wo.data && wo.data.type) || '', size: Math.round(size * 100) / 100, dist: Math.round(d * 100) / 100,
      scale: [wo.mesh.scale.x, wo.mesh.scale.y, wo.mesh.scale.z]
    };
  });
  log('拖拽目标: id=' + target.id + ' type=' + target.type + ' 尺寸=' + target.size +
    ' 相机距离=' + target.dist + ' scale=' + JSON.stringify(target.scale));

  await page.waitForTimeout(400);   // 等 gizmo 跟随相机重建
  await page.evaluate(PAGE_HELPERS);

  const dbg0 = await page.evaluate(() => (window.TransformGizmoEnhance ? window.TransformGizmoEnhance._debug : null));

  // ---- W2：单轴 X 拖动（不按 Shift）→ 三轴同倍 ----
  let w2 = { ok: false, why: 'no-handle' };
  const ptX = await findHandlePoint(page, 'X');
  if (ptX) {
    const s0 = await page.evaluate(() => window.__gzState().scale);
    await doDrag(page, ptX, 90, 0);
    await page.waitForTimeout(120);
    const s1 = await page.evaluate(() => window.__gzState().scale);
    const kx = s1[0] / s0[0], ky = s1[1] / s0[1], kz = s1[2] / s0[2];
    const equal = Math.abs(ky - kx) < 1e-6 && Math.abs(kz - kx) < 1e-6;
    // 90px 拖动的倍率取决于 gizmo 屏占比（实测约 0.05），只断言「变了 + 三轴一致 + 在钳制区间内」
    w2 = {
      ok: equal && Math.abs(kx - 1) > 0.05 && kx >= 0.02 - 1e-9 && kx <= 50 + 1e-6,
      why: `k=(${r4(kx)},${r4(ky)},${r4(kz)})`, s0, s1, equal
    };
  }
  add('W2', '单轴拖动 → 三轴同倍（默认等比）', w2.ok, w2.why + (ptX ? '' : '（未命中 X 手柄）'));

  // 还原 scale
  await page.evaluate(() => { window.__gz.mesh.scale.set(1, 1, 1); });

  // ---- W3：按住 Shift 单轴 → 只有 X 变 ----
  let w3 = { ok: false, why: 'no-handle' };
  const ptX2 = await findHandlePoint(page, 'X');
  if (ptX2) {
    await page.evaluate(() => { window.__gz.mesh.scale.set(1, 1, 1); });
    const s0 = await page.evaluate(() => window.__gzState().scale);
    await doDrag(page, ptX2, 90, 0, { shift: true });
    await page.waitForTimeout(120);
    const s1 = await page.evaluate(() => window.__gzState().scale);
    const changed = Math.abs(s1[0] - s0[0]) > 1e-4;
    const others = Math.abs(s1[1] - s0[1]) < 1e-6 && Math.abs(s1[2] - s0[2]) < 1e-6;
    w3 = { ok: changed && others, why: `${r4(s0[0])}→${r4(s1[0])} y=${r4(s0[1])}→${r4(s1[1])} z=${r4(s0[2])}→${r4(s1[2])}`, s0, s1 };
  }
  add('W3', 'Shift + 单轴拖动 → 只改一轴', w3.ok, w3.why + (ptX2 ? '' : '（未命中 X 手柄）'));

  // ---- W4：中心手柄（XYZ）向外拖 → 等比 + 钳制 ----
  let w4 = { ok: false, why: 'no-center-handle' };
  await page.evaluate(() => { window.__gz.mesh.scale.set(1, 1, 1); });
  const ptC = await findHandlePoint(page, 'XYZ', 6);
  if (ptC) {
    const s0 = await page.evaluate(() => window.__gzState().scale);
    await doDrag(page, ptC, 260, -180);   // 大幅拖动：原生公式会算到很大
    await page.waitForTimeout(120);
    const s1 = await page.evaluate(() => window.__gzState().scale);
    const kin = [s1[0] / s0[0], s1[1] / s0[1], s1[2] / s0[2]];
    const equal = Math.abs(kin[1] - kin[0]) < 1e-6 && Math.abs(kin[2] - kin[0]) < 1e-6;
    const bounded = kin.every((v) => isFinite(v) && v >= 0.02 - 1e-9 && v <= 50 + 1e-6) && s1.every((v) => Math.abs(v) <= 1e5);
    w4 = { ok: equal && bounded, why: `k=${r4(kin[0])} 三轴相等=${equal} 在[0.02,50]内=${bounded}`, s0, s1, kin };
  }
  add('W4', '中心手柄拖动 → 等比且倍率被钳制（≤50）', w4.ok, w4.why);

  // ---- W5：objectChange 补派发 ----
  const dbg1 = await page.evaluate(() => (window.TransformGizmoEnhance ? window.TransformGizmoEnhance._debug : null));
  const applied = (dbg1.uniformApplied || 0) - (dbg0.uniformApplied || 0);
  const notified = (dbg1.patchNotified || 0) - (dbg0.patchNotified || 0);
  const pdown = (dbg1.pointerdown || 0) - (dbg0.pointerdown || 0);
  add('W5', '拖动生效并补派发 objectChange',
    applied > 0 && notified > 0 && pdown >= 3,
    `pointerdown=${pdown} uniformApplied=${applied} patchNotified=${notified} clamped=${(dbg1.clamped || 0)} rejected=${(dbg1.rejected || 0)}`);

  add('W6', '无非噪音 console 错误', errors.length === 0,
    errors.length ? `${errors.length} 条，首条: ${errors[0]}` : '0 条');
  await page.close();

  // ==================== U 组：unified_editor.html ====================
  const pageU = await ctx.newPage();
  const errU = [];
  pageU.on('pageerror', (e) => { if (!isNoise(e.message)) errU.push(e.message.slice(0, 160)); });
  await pageU.goto(BASE + '/unified_editor.html', { waitUntil: 'domcontentloaded' });
  const uOk = await pageU.waitForFunction(() => {
    return window.TransformGizmoEnhance && window.TransformGizmoEnhance._debug && window.TransformGizmoEnhance._debug.enhanced >= 1;
  }, null, { timeout: 45000 }).then(() => true).catch(() => false);
  const uInfo = await pageU.evaluate(() => ({
    mod: !!window.TransformGizmoEnhance,
    version: window.TransformGizmoEnhance ? window.TransformGizmoEnhance.version : null,
    enhanced: window.TransformGizmoEnhance ? window.TransformGizmoEnhance._debug.enhanced : 0,
    hasTC: !!(window.THREE && window.THREE.TransformControls),
    wrapped: !!(window.THREE && window.THREE.TransformControls && window.THREE.TransformControls.__tgeWrapped)
  }));
  add('U1', 'unified_editor：模块加载且 gizmo 实例被增强', uOk && uInfo.mod,
    `mod=${uInfo.mod} v=${uInfo.version} enhanced=${uInfo.enhanced} THREE.TransformControls=${uInfo.hasTC} wrapped=${uInfo.wrapped} pageerror=${errU.length}`);
  await pageU.close();

  // ==================== M 组：主世界 index.html ====================
  // 说明：主世界 buildingManager 只有在「玩家的 /api/auth/me 返回 role=admin」时才创建
  // transformControls（buildingManager.checkAdminPermission），游客态不会创建。
  // 因此这里验证的是**同一个接入机制**：模块加载 + THREE.TransformControls 被包装，
  // 并实际 new 一个实例确认被自动增强（buildingManager 之后走的是同一条路）。
  const pageM = await ctx.newPage();
  await pageM.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
  await pageM.waitForFunction(() => window.THREE && window.gameWorld, null, { timeout: 60000 }).catch(() => {});
  const mInfo = await pageM.evaluate(() => {
    const T = window.THREE;
    const out = {
      mod: !!window.TransformGizmoEnhance,
      wrapped: !!(T && T.TransformControls && T.TransformControls.__tgeWrapped),
      enhancedNew: false, err: null,
      bmTc: !!(window.gameWorld && gameWorld.buildingManager && gameWorld.buildingManager.transformControls)
    };
    try {
      const tc = new T.TransformControls(gameWorld.camera, gameWorld.renderer.domElement);
      out.enhancedNew = !!tc.__tgeEnhanced;
      out.instanceOf = tc instanceof T.TransformControls;
      if (tc.dispose) tc.dispose();
    } catch (e) { out.err = String(e && e.message || e).slice(0, 160); }
    return out;
  });
  add('M1', '主世界：模块加载 + 新建 gizmo 自动增强', mInfo.mod && mInfo.wrapped && mInfo.enhancedNew,
    `mod=${mInfo.mod} wrapped=${mInfo.wrapped} newInstanceEnhanced=${mInfo.enhancedNew} instanceof=${mInfo.instanceOf} ` +
    `（游客态 buildingManager.transformControls 不存在属预期：${mInfo.bmTc}）` + (mInfo.err ? ' err=' + mInfo.err : ''));
  await pageM.close();

  await browser.close();

  const failed = results.filter((r) => !r.pass);
  console.log('\n===== 验收结果 ' + (results.length - failed.length) + '/' + results.length + ' =====');
  results.forEach((r) => console.log(`${r.pass ? '✅' : '❌'} ${r.id} ${r.name} :: ${r.detail}`));
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
