/**
 * accept_lod_stage4.js — LOD 三版模型方案【阶段 4：前端渲染 LOD 三带】可重跑验收脚本
 *
 * 用法：node scripts/accept_lod_stage4.js        （需先启动服务器；前置：红军等合批组已有 _mid/_lod）
 * 前置脚本：node scripts/lod_generate_merged_groups.js
 *
 * 判据（对应规范文档第 4 节 阶段 4，D1 口径经用户 2026-09-11 确认调整）：
 *   D1 开关开启 + 中低模就绪时，**公平对比点**（站 100m 外，全部实例在 200m 内，
 *      排除"远界 400/200"干扰）renderer.info.render.triangles 对比关闭开关下降 ≥60%
 *      （质心处降幅作为设计特性记录为 INFO：红军群紧密，90% 实例在 ≤40m 高模带）
 *   D2 实测 FPS：开启后提升（记录开/关两组数据）
 *   D3 近景（<40m）为高模（三带归属断言：高模带非空、三带总数=组内实例数）
 *   D4 远景（200~400m）使用低模（im.userData.__lodLevel==='low' 的 count > 0）
 *   D5 开关关闭 → 行为与改动前一致（三角数回到基线、蓝方块阈值回到 200、无变体 InstancedMesh）
 *   D6 走远卸载/走近重载循环 3 次无泄漏（textures/geometries 不单调增长）
 *   D7 0 console error
 *
 * 说明：D1/D2 用页面内 WorldInstanceMerger.setLodEnabled() 切换（同一会话、同一批实例，
 *       可比性最好）；D5 走真实链路（改数据库开关 → 重新加载页面）。
 */
const { chromium } = require('playwright');

const BASE = process.env.API_BASE || 'http://localhost:3002';
const USER = process.env.GAME_USER || 'diag_tmp_1';
const PASS = process.env.GAME_PASS || 'Diag#2026tmp';
const ADMIN_USER = process.env.ADMIN_USER || 'baseline_shot';
const ADMIN_PASS = process.env.ADMIN_PASS || 'Baseline#185';

const CENTROID = { x: -267, z: -1056 };   // 红军群质心（world_objects 实算）
const FAR_POINT = { x: -267, z: -256 };   // 距集群约 800m（确定性卸载）
const MID_POINT = { x: -267 + 250, z: -1056 }; // 距集群约 250m（部分实例进入 200~400m 低模带）

const checks = [];
function check(id, title, pass, detail) {
  checks.push({ id, title, pass: !!pass, detail: detail === undefined ? '' : String(detail) });
}

async function api(method, p, body, token) {
  const opts = { method, headers: {} };
  if (token) opts.headers['Authorization'] = 'Bearer ' + token;
  if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const r = await fetch(BASE + p, opts);
  let json = null;
  try { json = await r.json(); } catch (e) { /* ignore */ }
  return { status: r.status, json };
}

function isNoise(t) {
  return /runtime\.lastError|index\.global\.js|ResizeObserver loop|favicon\.ico/i.test(t || '');
}

// ---------- 页面内工具 ----------
async function measure(page, seconds) {
  return page.evaluate(async (sec) => {
    const r = window.gameWorld.renderer;
    let frames = 0; let tris = 0; let calls = 0;
    const t0 = performance.now();
    await new Promise((resolve) => {
      const loop = () => {
        frames += 1;
        tris += r.info.render.triangles;
        calls += r.info.render.calls;
        if (performance.now() - t0 > sec * 1000) { resolve(); return; }
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    });
    const dt = (performance.now() - t0) / 1000;
    return { fps: frames / dt, avgTris: tris / frames, avgCalls: calls / frames, frames };
  }, seconds);
}

async function teleport(page, x, z) {
  await page.evaluate(({ px, pz }) => {
    const p = window.player;
    if (!p || !p.position) return;
    p.position.x = px;
    p.position.z = pz;
    if (p.velocity) p.velocity.y = 0;
  }, { px: x, pz: z });
}

async function lodSnapshot(page) {
  return page.evaluate(() => {
    const M = window.WorldInstanceMerger;
    if (!M || !M.debugLod) return null;
    const d = M.debugLod();
    const biggest = d.groups.slice().sort((a, b) => b.instances - a.instances)[0] || null;
    return {
      lodEnabled: d.lodEnabled,
      groups: d.groups.length,
      biggest,
      stats: M.getStats(),
      mem: window.gameWorld.renderer.info.memory,
    };
  });
}

/** 等待：存在实例数 ≥ min 的合批组，且（可选）低模带已接入 */
async function waitForGroup(page, minInstances, requireLow, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const s = await lodSnapshot(page).catch(() => null);
    if (s && s.biggest && s.biggest.instances >= minInstances) {
      if (!requireLow) return s;
      if (s.biggest.lowTemplates > 0 && s.biggest.midTemplates > 0) return s;
    }
    await page.waitForTimeout(3000);
  }
  return null;
}

(async () => {
  console.log('=== LOD Stage 4 Acceptance ===');
  let db = null;
  let browser = null;
  let originalLod = true;
  let adminToken = '';

  try {
    // ---------- 前置：登录 ----------
    const login = await api('POST', '/api/auth/login', { username: USER, password: PASS });
    if (!login.json || !login.json.token) throw new Error('游戏用户登录失败: ' + JSON.stringify(login.json));
    const adminLogin = await api('POST', '/api/admin-auth/login', { username: ADMIN_USER, password: ADMIN_PASS });
    adminToken = (adminLogin.json && adminLogin.json.token) || '';
    const ws0 = await api('GET', '/api/config/world-settings');
    originalLod = !!(ws0.json && ws0.json.lod_enabled);
    db = require('../src/database/db');
    console.log(`login ok (game=${USER}, admin=${ADMIN_USER ? 'yes' : 'no'}), lod_enabled=${originalLod}`);

    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
    const errors = { console: [], page: [], localFailed: [], aborted: [], expectedProbe404: [] };
    const attach = (page) => {
      page.on('console', (m) => {
        if (m.type() !== 'error' || isNoise(m.text())) return;
        const u = (m.location && m.location() && m.location().url) || '';
        const t = m.text();
        if (/favicon\.ico/.test(u)) return;
        // 变体探测未命中（该模型没有 _mid/_lod）属设计内的预期结果：HEAD 404 → 回退高模
        if (/_(mid|lod)\.glb$/i.test(u) && /404/.test(t)) { errors.expectedProbe404.push(u); return; }
        if (/Failed to load resource: net::ERR_/.test(t) && errors.localFailed.length === 0) return;
        errors.console.push(t + (u ? ' @ ' + u : ''));
      });
      page.on('pageerror', (e) => { if (!isNoise(e.message)) errors.page.push(e.message); });
      page.on('requestfailed', (r) => {
        const u = r.url();
        const err = (r.failure() && r.failure().errorText) || '';
        if (/ERR_ABORTED/.test(err)) { errors.aborted.push(u); return; }  // 页面重载/关闭导致的取消
        if (/^https?:\/\/(localhost|127\.)/.test(u) || !/^https?:/.test(u)) errors.localFailed.push(u + ' ' + err);
      });
    };

    // 注入登录态（同源页面写 localStorage）
    const seed = await ctx.newPage();
    await seed.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
    await seed.evaluate((d) => {
      localStorage.setItem('token', d.token);
      localStorage.setItem('userId', String(d.userId));
      localStorage.setItem('characterId', String(d.characterId));
    }, login.json);
    await seed.close();

    // ---------- 打开世界 ----------
    let page = await ctx.newPage();
    attach(page);
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => window.gameWorld && window.gameWorld.renderer && window.player, null, { timeout: 180000 });
    await page.evaluate(() => {
      const b = document.querySelector('.close-controls-hint');
      if (b) b.click();
    });
    const bootLod = await page.evaluate(() => ({
      enabled: window.__LOD_ENABLED,
      api: !!(window.WorldLodAssets && window.WorldLodAssets.isEnabled()),
    }));
    console.log('boot: __LOD_ENABLED =', bootLod.enabled, '| module =', bootLod.api);
    check('D5', 'startup reads lod switch from API (window.__LOD_ENABLED set)',
      bootLod.api === true && bootLod.enabled === true, JSON.stringify(bootLod));

    // ---------- 前往红军群，等合批组 + 变体就绪 ----------
    await teleport(page, CENTROID.x, CENTROID.z);
    console.log('teleported to red army centroid, waiting for merge group + LOD variants ...');
    let snap = await waitForGroup(page, 36, true, 240000);
    if (!snap) {
      snap = await waitForGroup(page, 1, false, 60000);
      check('D1', 'red army group with LOD variants ready', false, snap ? `group instances=${snap.biggest.instances} mid=${snap.biggest.midTemplates} low=${snap.biggest.lowTemplates}` : 'no merge group at all');
    } else {
      check('D1', 'red army group with LOD variants ready', true,
        `instances=${snap.biggest.instances} midTemplates=${snap.biggest.midTemplates} lowTemplates=${snap.biggest.lowTemplates}`);
    }
    await page.waitForTimeout(4000);

    // ---------- D1 / D2 / D3：LOD 开 vs 关 ----------
    const on1 = await measure(page, 3);
    const snapOn = await lodSnapshot(page);
    await page.evaluate(() => window.WorldInstanceMerger.setLodEnabled(false));
    await page.waitForTimeout(4000);   // 等一次完整裁剪周期，把三带归位
    const off = await measure(page, 3);
    const snapOff = await lodSnapshot(page);
    await page.evaluate(() => window.WorldInstanceMerger.setLodEnabled(true));
    await page.waitForTimeout(4000);
    const on2 = await measure(page, 3);

    const drop = off.avgTris > 0 ? (1 - on1.avgTris / off.avgTris) : 0;
    console.log(`tris: LOD on=${(on1.avgTris / 1e6).toFixed(2)}M (recheck ${(on2.avgTris / 1e6).toFixed(2)}M) off=${(off.avgTris / 1e6).toFixed(2)}M | fps: on=${on1.fps.toFixed(1)} off=${off.fps.toFixed(1)}`);
    // 质心处收益天然很小（红军群最大半径 74m，90% 实例落在 ≤40m 高模带）——
    // 用户 2026-09-11 决策：D1 判据改到"公平对比点"（见下），此处仅作特性记录。
    check('INFO', 'cluster-center drop (design characteristic: near instances stay high)',
      drop >= 0,
      `on=${Math.round(on1.avgTris)} off=${Math.round(off.avgTris)} drop=${(drop * 100).toFixed(1)}% (近景高模带，越小越说明实例都在 40m 内)`);
    check('D2', 'FPS improved with LOD on', on1.fps > off.fps,
      `on=${on1.fps.toFixed(1)}fps off=${off.fps.toFixed(1)}fps (+${((on1.fps / Math.max(off.fps, 0.001) - 1) * 100).toFixed(1)}%)`);
    check('D2', 'render calls recorded', on1.avgCalls > 0 && off.avgCalls > 0,
      `on=${Math.round(on1.avgCalls)} off=${Math.round(off.avgCalls)}`);

    // D3 三带归属：高模带必须非空，且三带总数 == 组内实例数；关闭开关时 mid/low 必须为 0
    const cOn = snapOn.biggest.counts;
    const cOff = snapOff.biggest.counts;
    check('D3', 'near band uses high model (high count > 0) and all instances accounted',
      cOn.high > 0 && (cOn.high + (cOn.mid || 0) + (cOn.low || 0)) === snapOn.biggest.instances,
      `on: ${JSON.stringify(cOn)} instances=${snapOn.biggest.instances}`);
    check('D3', 'mid band takes over part of what high renders when LOD enabled',
      (cOn.mid || 0) > 0 && (cOn.mid || 0) <= snapOn.biggest.instances && (cOff.mid || 0) === 0,
      `on.mid=${cOn.mid || 0} off.mid=${cOff.mid || 0} off.high=${cOff.high}`);
    check('D5', 'LOD off: single high band equals instance count, farLimit back to 200',
      (cOff.mid || 0) === 0 && (cOff.low || 0) === 0 && cOff.high === snapOff.biggest.instances && snapOff.biggest.farLimit === 200,
      `off counts=${JSON.stringify(cOff)} farLimit=${snapOff.biggest.farLimit}`);

    // ---------- INFO：公平对比（所有实例均在 200m 内 → 排除"远界 400 vs 200"的干扰） ----------
    await teleport(page, CENTROID.x + 100, CENTROID.z);
    await page.waitForTimeout(9000);
    const fairOn = await measure(page, 3);
    const fairOnSnap = await lodSnapshot(page);
    await page.evaluate(() => window.WorldInstanceMerger.setLodEnabled(false));
    await page.waitForTimeout(5000);
    const fairOff = await measure(page, 3);
    await page.evaluate(() => window.WorldInstanceMerger.setLodEnabled(true));
    await page.waitForTimeout(5000);
    const fairDrop = fairOff.avgTris > 0 ? (1 - fairOn.avgTris / fairOff.avgTris) : 0;
    console.log(`fair (100m away, all instances <200m): on=${(fairOn.avgTris / 1e6).toFixed(2)}M off=${(fairOff.avgTris / 1e6).toFixed(2)}M drop=${(fairDrop * 100).toFixed(1)}% | fps on=${fairOn.fps.toFixed(1)} off=${fairOff.fps.toFixed(1)} | counts=${JSON.stringify(fairOnSnap.biggest && fairOnSnap.biggest.counts)}`);
    // D1（用户 2026-09-11 决策口径）：公平对比点 —— 站 100m 外时全部实例都在 200m 内，
    // 排除"远界 400（LOD 开）vs 200（LOD 关）"带来的干扰，得到纯 LOD 降面收益。
    check('D1', 'triangles drop >= 60% at fair-comparison point (all instances <200m)', fairDrop >= 0.60,
      `tris on=${Math.round(fairOn.avgTris)} off=${Math.round(fairOff.avgTris)} drop=${(fairDrop * 100).toFixed(1)}% counts=${JSON.stringify(fairOnSnap.biggest && fairOnSnap.biggest.counts)}`);

    // ---------- D4：250m 远处进入低模带 ----------
    await teleport(page, MID_POINT.x, MID_POINT.z);
    await page.waitForTimeout(9000);
    const snapMid = await lodSnapshot(page);
    const biggestMid = snapMid && snapMid.biggest;
    check('D4', 'instances at 200~400m rendered by low band (__lodLevel=low count > 0)',
      !!biggestMid && (biggestMid.counts.low || 0) > 0,
      biggestMid ? `counts=${JSON.stringify(biggestMid.counts)} farLimit=${biggestMid.farLimit} lowTemplates=${biggestMid.lowTemplates}` : 'no group');
    await teleport(page, CENTROID.x, CENTROID.z);
    await page.waitForTimeout(6000);

    // ---------- D5：真实开关链路（数据库关闭 → 重新加载页面） ----------
    const wsName = (ws0.json && ws0.json.world_name) || '';
    const wsUrl = (ws0.json && ws0.json.world_url) || '';
    await api('PUT', '/api/config/world-settings', { world_name: wsName, world_url: wsUrl, world_description: (ws0.json && ws0.json.world_description) || '', lod_enabled: false });
    await page.close();
    page = await ctx.newPage();
    attach(page);
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => window.gameWorld && window.gameWorld.renderer && window.player, null, { timeout: 180000 });
    await page.evaluate(() => { const b = document.querySelector('.close-controls-hint'); if (b) b.click(); });
    await teleport(page, CENTROID.x, CENTROID.z);
    await page.waitForTimeout(30000);            // 等对象加载回同一批实例
    const snapDbOff = await lodSnapshot(page);
    const offDb = await measure(page, 3);
    check('D5', 'reload with DB switch off -> __LOD_ENABLED false + no LOD bands',
      snapDbOff && snapDbOff.lodEnabled === false
      && snapDbOff.biggest && (snapDbOff.biggest.midTemplates === 0 && snapDbOff.biggest.lowTemplates === 0
        && (snapDbOff.biggest.counts.mid || 0) === 0 && (snapDbOff.biggest.counts.low || 0) === 0),
      snapDbOff && snapDbOff.biggest ? `lodEnabled=${snapDbOff.lodEnabled} midTemplates=${snapDbOff.biggest.midTemplates} lowTemplates=${snapDbOff.biggest.lowTemplates}` : 'no snapshot');
    check('D5', 'reload with DB switch off -> triangles match runtime-off baseline (±10%)',
      Math.abs(offDb.avgTris - off.avgTris) / Math.max(off.avgTris, 1) <= 0.10,
      `dbOff=${Math.round(offDb.avgTris)} runtimeOff=${Math.round(off.avgTris)}`);

    // 恢复开关并重新加载（后续 D6 需要 LOD 生效）
    await api('PUT', '/api/config/world-settings', { world_name: wsName, world_url: wsUrl, world_description: (ws0.json && ws0.json.world_description) || '', lod_enabled: originalLod });
    await page.close();
    page = await ctx.newPage();
    attach(page);
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => window.gameWorld && window.gameWorld.renderer && window.player, null, { timeout: 180000 });
    await page.evaluate(() => { const b = document.querySelector('.close-controls-hint'); if (b) b.click(); });
    await teleport(page, CENTROID.x, CENTROID.z);

    // ---------- D6：走远卸载 → 走近重载 ×3，无泄漏 ----------
    const cycleMem = [];
    for (let i = 1; i <= 3; i += 1) {
      const s1 = await waitForGroup(page, 36, true, 240000);
      await page.waitForTimeout(3000);
      const mem = await page.evaluate(() => ({
        textures: window.gameWorld.renderer.info.memory.textures,
        geometries: window.gameWorld.renderer.info.memory.geometries,
      }));
      cycleMem.push(mem);
      console.log(`cycle ${i}: instances=${s1 ? s1.biggest.instances : 'n/a'} mem=${JSON.stringify(mem)}`);
      if (i < 3) {
        await teleport(page, FAR_POINT.x, FAR_POINT.z);
        await page.waitForTimeout(15000);        // 远离 → 对象卸载（>800m 确定性卸载）
        await teleport(page, CENTROID.x, CENTROID.z);
        await page.waitForTimeout(8000);
      }
    }
    const base = cycleMem[0] || { textures: 0, geometries: 0 };
    const last = cycleMem[cycleMem.length - 1] || base;
    check('D6', 'no leak across 3 away/back cycles (textures/geometries not growing)',
      last.textures <= base.textures * 1.15 && last.geometries <= base.geometries * 1.15,
      `cycles=${JSON.stringify(cycleMem)}`);

    // ---------- D7 ----------
    check('D7', '0 console error during world session (噪音已分类)',
      errors.console.length === 0 && errors.page.length === 0 && errors.localFailed.length === 0,
      `console=${errors.console.length} pageerror=${errors.page.length} localFailed=${errors.localFailed.length}`
      + ` (expectedProbe404=${errors.expectedProbe404.length} aborted=${errors.aborted.length})`
      + (errors.console.length ? ' | ' + errors.console.slice(0, 3).join(' ; ') : '')
      + (errors.localFailed.length ? ' | ' + errors.localFailed.slice(0, 3).join(' ; ') : ''));

    await ctx.close();
  } catch (e) {
    check('FATAL', 'acceptance run', false, e.message + (e.stack ? ' | ' + String(e.stack).split('\n')[1] : ''));
  } finally {
    try {
      const ws = await api('GET', '/api/config/world-settings');
      if (ws.json && ws.json.lod_enabled !== originalLod) {
        await api('PUT', '/api/config/world-settings', {
          world_name: ws.json.world_name, world_url: ws.json.world_url,
          world_description: ws.json.world_description || '', lod_enabled: originalLod,
        });
        console.log('restored lod_enabled =', originalLod);
      }
    } catch (e) { console.log('restore lod_enabled failed:', e.message); }
    if (browser) { try { await browser.close(); } catch (e) { /* ignore */ } }
    if (db && db.pool) { try { await db.pool.end(); } catch (e) { /* ignore */ } }
  }

  console.log('\n=== Results ===');
  checks.forEach((c) => console.log(`${c.pass ? 'PASS' : 'FAIL'} [${c.id}] ${c.title} -- ${c.detail}`));
  const failed = checks.filter((c) => !c.pass);
  console.log(`\nSUMMARY: ${checks.length - failed.length}/${checks.length} passed, failed=${failed.length}`);
  console.log(failed.length === 0 ? 'VERDICT: ACCEPTED' : 'VERDICT: REJECTED');
  process.exit(failed.length === 0 ? 0 : 1);
})();
