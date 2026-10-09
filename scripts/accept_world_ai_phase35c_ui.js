/**
 * accept_world_ai_phase35c_ui.js —— Phase 3.5-3 围栏叠层验收（world_editor 内只读可视化）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 判据（WRO-1~6）：
 *   WRO-1 模块加载且全局口可用（0 pageerror）
 *   WRO-2 编辑器场景就绪后能拉到区域并画出一组围栏（_diag.hasGroup）
 *   WRO-3 组挂在编辑器场景里（父链可达 scene）且不带任何可交互副作用（只读：纯 Line/Sprite）
 *   WRO-4 hide/show 生效（visible 翻转）
 *   WRO-5 后台新建区域后 60s 轮询之前手动 refresh 能跟进（新区域出现）
 *   WRO-6 0 console error（favicon 按 URL 过滤）
 * 跑法：node scripts/accept_world_ai_phase35c_ui.js   （需要 3002 在跑）
 */
'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { chromium } = require('playwright');
const BASE = process.env.WORLD_AI_BASE || 'http://localhost:3002';
const KEY = 'accept_wro_' + Date.now();
const REPORT = [];
function log(name, ok, detail) {
  REPORT.push({ name, ok: !!ok });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail !== undefined && detail !== '' ? '  [' + detail + ']' : ''));
}
(async () => {
  let T = null;
  // 管理员登录（建/删测试区域用）
  const li = await fetch(BASE + '/api/admin-auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'baseline_shot', password: 'Baseline#185' }) }).then((r) => r.json());
  T = li.token || li.adminToken;
  if (!T) { console.log('FATAL 登录失败'); process.exit(1); }
  const api = async (p, opt) => {
    const o = opt || {};
    const res = await fetch(BASE + p, { method: o.method || 'GET', headers: Object.assign({ 'Content-Type': 'application/json', Authorization: 'Bearer ' + T }, o.headers || {}), body: o.body ? JSON.stringify(o.body) : undefined });
    let j = null; try { j = await res.json(); } catch (e) { j = {}; }
    return { status: res.status, j };
  };

  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-gpu'] });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const consoleErrors = [];
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    let u = ''; try { u = m.location().url || ''; } catch (e) { /* ignore */ }
    if (u.indexOf('favicon') >= 0) return;
    consoleErrors.push(u.slice(0, 80) + ' ' + m.text().slice(0, 160));
  });

  await page.addInitScript(([token]) => {
    try {
      localStorage.setItem('adminToken', token);
      localStorage.setItem('adminUser', JSON.stringify({ username: 'baseline_shot', role: 'superadmin' }));
    } catch (e) { /* ignore */ }
  }, [T]);

  // 先建一个测试区域（叠层要有东西可画）
  const reg = await api('/api/world-ai/regions', { method: 'POST', body: {
    regionKey: KEY, name: '围栏验收区', bounds: { x: 7600, z: 7600, width: 60, depth: 60 },
    autonomy: 'semi_autonomous', gridsnap: { kind: 'modular', unit: [1, 1, 1] }, notes: 'WRO 验收',
  } });
  log('前置：测试区域已建', !!reg.j.region, reg.j.region && reg.j.region.region_key);

  await page.goto(BASE + '/world_editor.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
  // WRO-1：模块加载 + 全局口（页面内轮询，规避编辑器守卫重定向的时序）
  const wro1 = await page.evaluate(async () => {
    const t0 = Date.now();
    for (;;) {
      if (window.WorldRegionOverlay && typeof window.WorldRegionOverlay.refresh === 'function') return { ok: true, url: location.href };
      if (Date.now() - t0 > 20000) return { ok: false, url: location.href };
      await new Promise((r) => setTimeout(r, 300));
    }
  });
  log('WRO-1 worldRegionOverlay 模块加载且全局口可用', wro1.ok, wro1.url.slice(0, 60));

  // WRO-2：场景就绪后画出一组围栏
  const wro2 = await page.evaluate(async () => {
    const t0 = Date.now();
    for (;;) {
      await window.WorldRegionOverlay.refresh();
      const d = window.WorldRegionOverlay._diag();
      if (d.hasGroup && d.regions >= 1) return { ok: true, d };
      if (Date.now() - t0 > 30000) return { ok: false, d };
      await new Promise((r) => setTimeout(r, 800));
    }
  });
  log('WRO-2 编辑器场景画出围栏组（refresh → hasGroup）', wro2.ok, JSON.stringify(wro2.d));
  log('WRO-3 叠层只读（组内只有 Line/Sprite，无 Mesh/灯光/控制器）', await page.evaluate(() => {
    const d = window.WorldRegionOverlay._diag();
    if (!d.hasGroup) return false;
    let only = true;
    window.WorldRegionOverlay.refresh();
    // 找到根组：遍历场景找 __aiRegionOverlayRoot__
    let root = null;
    try {
      // 编辑器 scene 是全局词法绑定，eval 可达
      root = scene.children.find((c) => c.userData && c.userData.__aiRegionOverlay);
    } catch (e) { return false; }
    if (!root) return false;
    root.traverse((o) => {
      if (o.isMesh || o.isLight || o.isCamera || o.type === 'TransformControls') only = false;
    });
    return only;
  }));

  // WRO-4：hide/show
  const wro4 = await page.evaluate(() => {
    const d0 = window.WorldRegionOverlay._diag();
    window.WorldRegionOverlay.hide();
    const d1 = window.WorldRegionOverlay._diag();
    window.WorldRegionOverlay.show();
    const d2 = window.WorldRegionOverlay._diag();
    return d0.visible === true && d1.visible === false && d2.visible === true;
  });
  log('WRO-4 hide/show 翻转生效', wro4);

  // WRO-5：后台再建一个区域，手动 refresh 跟进
  const reg2 = await api('/api/world-ai/regions', { method: 'POST', body: {
    regionKey: KEY + '_b', name: '围栏验收区B', bounds: { x: 7700, z: 7700, width: 40, depth: 40 },
    autonomy: 'managed', gridsnap: { kind: 'modular', unit: [1, 1, 1] }, notes: 'WRO 验收B',
  } });
  const wro5 = await page.evaluate(async (key) => {
    await window.WorldRegionOverlay.refresh();
    const t0 = Date.now();
    for (;;) {
      let n = -1;
      try {
        const root = scene.children.find((c) => c.userData && c.userData.__aiRegionOverlay);
        if (root) n = root.children.length;
      } catch (e) { /* ignore */ }
      if (n >= 2) return { ok: true, n };
      if (Date.now() - t0 > 15000) return { ok: false, n };
      await new Promise((r) => setTimeout(r, 500));
    }
  }, KEY + '_b');
  log('WRO-5 新建区域后 refresh 跟进（围栏数 1→2）', wro5.ok, 'groups=' + wro5.n);

  log('WRO-6 0 console error（favicon 已过滤）', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' ; '));

  // 收尾
  await api('/api/world-ai/regions/' + KEY, { method: 'DELETE' });
  await api('/api/world-ai/regions/' + KEY + '_b', { method: 'DELETE' });
  const back = await api('/api/world-ai/regions');
  log('收尾：测试区域已删', back.j.regions && !back.j.regions.some((r) => String(r.region_key).indexOf('accept_wro_') === 0), '');
  await browser.close();
  const fails = REPORT.filter((r) => !r.ok);
  console.log('\n共 ' + REPORT.length + ' 条：PASS ' + (REPORT.length - fails.length) + ' / FAIL ' + fails.length);
  console.log('\n════════ VERDICT: ' + (fails.length ? 'FAILED' : 'ACCEPTED') + '（' + (REPORT.length - fails.length) + '/' + REPORT.length + '）════════');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
