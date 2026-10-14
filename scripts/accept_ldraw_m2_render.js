/**
 * LDraw M2 世界内渲染冒烟：builtin GLB 走世界加载路径（uploaded_model）
 * 产出真实 mesh、无 404、结束后清理。
 *
 * 前置：3002 在跑；已跑 node scripts/ldraw_seed.js
 * 用法：node scripts/accept_ldraw_m2_render.js
 */
const path = require('path');
const { chromium } = require('playwright');

const BASE = process.env.WORLD_AI_BASE || 'http://localhost:3002';
const TEST_NAME = '__LDRW_m2_render';
const KEYS = ['3001', '2400'];   // wall + door 各一件

let pass = 0, fail = 0;
const log = (ok, name, extra) => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); };

async function api(p, { method = 'GET', token, body } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const r = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch (e) { j = {}; }
  return { status: r.status, j };
}

(async () => {
  const login = await api('/api/admin-auth/login', { method: 'POST', body: { username: 'baseline_shot', password: 'Baseline#185' } });
  if (login.status !== 200) { console.log('LOGIN FAIL', login.status, JSON.stringify(login.j).slice(0, 200)); process.exit(1); }
  const token = login.j.token;

  // 取件（从 DB 权威行拿 model_path）
  const { pool } = require('../src/database/db');
  const rows = (await pool.query(
    `SELECT i.part_key, u.path FROM part_library_items i
       JOIN part_libraries l ON l.id=i.library_id JOIN uploaded_models u ON u.id=i.model_id
      WHERE l.pack_key='ldraw_builtin' AND i.part_key = ANY($1)`, [KEYS])).rows;
  await pool.end();
  if (rows.length !== KEYS.length) { console.log('FATAL: 件不在库，先跑 scripts/ldraw_seed.js'); process.exit(2); }

  for (const k of KEYS) {
    const r = await fetch(BASE + rows.find(x => x.part_key === k).path);
    log(r.status === 200, `L0 ${k} GLB 静态可达`, 'HTTP ' + r.status);
  }

  const sp0 = await api('/api/world/spawn-point');
  const sp = (sp0.j.spawnPoint && sp0.j.spawnPoint.position) || { x: -26.32, y: 9.59, z: 12.56 };
  const ids = [];
  for (let i = 0; i < rows.length; i++) {
    const created = await api('/api/world/objects', {
      method: 'POST', token,
      body: {
        type: 'uploaded_model', name: TEST_NAME + '_' + rows[i].part_key, model_path: rows[i].path,
        position_x: Number(sp.x) + 4 + i * 1.5, position_y: Number(sp.y), position_z: Number(sp.z) - 4,
        rotation_x: 0, rotation_y: 0, rotation_z: 0,
        scale_x: 3, scale_y: 3, scale_z: 3, has_collision: false,
      },
    });
    const id = created.j.id || (created.j.object && created.j.object.id) || (created.j.data && created.j.data.id);
    if (!id) { console.log('CREATE FAIL', created.status, JSON.stringify(created.j).slice(0, 200)); process.exit(1); }
    ids.push(id);
  }
  log(true, 'L1 测试对象已建立', 'ids=' + ids.join(','));

  const browser = await chromium.launch({
    channel: 'chrome', headless: true,
    args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--use-gl=angle'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const consoleErrs = [], failed = [];
  page.on('console', m => {
    if (m.type() !== 'error') return;
    const loc = m.location() || {};
    consoleErrs.push({ text: m.text().slice(0, 200), url: String(loc.url || '') });
  });
  page.on('response', r => { if (r.status() === 404 && /ldraw/.test(r.url())) failed.push('404 ' + r.url()); });
  page.on('requestfailed', r => {
    if (!/ldraw/.test(r.url())) return;
    // ERR_ABORTED = 世界加载器中止了首次请求（进度流/重试机制），最终产物以 mesh 判定，
    // 不计入失败（实测两件都因此各 abort 一次后成功渲染）
    const err = (r.failure() || {}).errorText || '';
    if (/ABORTED/i.test(err)) return;
    failed.push('FAIL ' + r.url() + ' :: ' + err);
  });

  try {
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => window.gameWorld && window.player, null, { timeout: 90000 });
    await page.evaluate(() => {
      document.querySelectorAll('.close-controls-hint, #close-controls-hint').forEach(b => b.click());
    });

    // 探针：等两个对象的 entry.model 出现真实 mesh（LDraw 件小，世界加载有节流，给足时间）
    const probe = () => page.evaluate((ids) => {
      const out = {};
      for (const id of ids) {
        const gb = window.gameWorld.generatedBuildings;
        const e = gb.get(id) || gb.get(String(id)) || gb.get(Number(id));
        if (!e) { out[id] = { found: false }; continue; }
        if (e.isPlaceholder || !e.model) { out[id] = { found: true, placeholder: true }; continue; }
        let mesh = 0, tris = 0;
        e.model.traverse(o => { if (o.isMesh) { mesh++; const g = o.geometry; tris += g.index ? g.index.count / 3 : (g.attributes.position ? g.attributes.position.count / 3 : 0); } });
        out[id] = { found: true, mesh, tris: Math.round(tris) };
      }
      return out;
    }, ids);

    let final = null;
    for (let t = 0; t < 40; t++) {
      await page.waitForTimeout(1500);
      final = await probe();
      if (ids.every(id => final[id] && final[id].found && !final[id].placeholder && final[id].mesh > 0)) break;
    }
    for (const id of ids) {
      const s = final[id] || {};
      log(!!(s.found && !s.placeholder && s.mesh > 0), `L2 对象 ${id} 世界内产出真实 mesh`,
        JSON.stringify(s));
    }
    log(failed.length === 0, 'L3 无 ldraw 相关 404/加载失败', JSON.stringify(failed));
    const errs = consoleErrs.filter(e => !/favicon/.test(e.url));
    log(errs.length === 0, 'L4 0 console error', JSON.stringify(errs.slice(0, 3)));
  } finally {
    await browser.close();
  }

  for (const id of ids) await api('/api/world/objects/' + id, { method: 'DELETE', token });
  const still = await api('/api/world/objects');
  const left = (still.j.objects || still.j.data || []).filter(o => String(o.name || '').startsWith(TEST_NAME));
  log(left.length === 0, 'L5 无残留测试对象', 'left=' + left.length);

  console.log(`\n共 ${pass + fail} 条：PASS ${pass} / FAIL ${fail}`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('FATAL', e && e.stack || e); process.exit(1); });
