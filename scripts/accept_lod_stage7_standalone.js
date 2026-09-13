/**
 * accept_lod_stage7_standalone.js — LOD 三期「散装模型 LOD 化」可重跑验收（会话 1 实现就绪版）
 *
 * 判据：
 *   A1 模块加载：window.WorldLodStandalone 存在且散装注册数 > 0（教室区域）
 *   A2 高模带：近点（表面距 ≤ near）高模在场景、变体不在场景
 *   A3 中模带：near~mid 懒加载中模并切显（高模摘出场景、无 CULL_MARK）
 *   A4 材质共享：变体网格材质贴图与高模同 Texture 对象（零额外显存、零 shader 重编译）
 *   A5 低模带：mid~200m 切显低模
 *   A6 >200m：变体摘除 + 模型设 __culledByDist 交还既有裁剪/蓝方块路径
 *   A7 编辑模式：isAdminMode 置位后全部还原高模并暂停
 *   A8 LRU：调低上限后未在显示的变体被驱逐（held ≤ cap）
 *   A9 0 console error（过滤噪音 + 变体探测 404）
 *
 * 用法：node scripts/accept_lod_stage7_standalone.js   （需先启动服务器；真实 GPU chrome）
 */
const { chromium } = require('playwright');
const path = require('path');

const BASE = process.env.API_BASE || 'http://localhost:3002';
const USER = process.env.GAME_USER || 'diag_tmp_1';
const PASS = process.env.GAME_PASS || 'Diag#2026tmp';

// 教室热点（统计口径修正行实测：女生×3 各 150 万面 + 课桌×4）
const HOTSPOT = { x: -22, z: 803 };

const checks = [];
function check(id, title, pass, detail) {
  checks.push({ id, title, pass: !!pass, detail: detail === undefined ? '' : String(detail) });
  console.log(`${pass ? 'PASS' : 'FAIL'} [${id}] ${title}${detail ? ' | ' + detail : ''}`);
}
const INFO = (t, d) => console.log(`INFO ${t}${d ? ' | ' + d : ''}`);

function isNoise(t) {
  return /runtime\.lastError|index\.global\.js|ResizeObserver loop|favicon\.ico/i.test(t || '');
}

async function api(method, p, body) {
  const opts = { method, headers: {} };
  if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const r = await fetch(BASE + p, opts);
  let json = null;
  try { json = await r.json(); } catch (e) { /* ignore */ }
  return { status: r.status, json };
}

async function main() {
  const login = await api('POST', '/api/auth/login', { username: USER, password: PASS });
  if (!login.json || !login.json.token) throw new Error('game login failed');

  const cfg = await api('GET', '/api/config/lod-enabled');
  const BANDS = (cfg.json && Number.isFinite(cfg.json.near)) ? cfg.json : { near: 30, mid: 60, far: 400 };
  INFO('bands', JSON.stringify(BANDS));

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const errors = { console: [], page: [], localFailed: [] };
  try {
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
    const seed = await ctx.newPage();
    await seed.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
    await seed.evaluate((d) => {
      localStorage.setItem('token', d.token);
      localStorage.setItem('userId', String(d.userId));
      localStorage.setItem('characterId', String(d.characterId));
    }, login.json);
    await seed.close();

    const page = await ctx.newPage();
    page.on('console', (m) => {
      const u0 = (m.location && m.location() && m.location().url) || '';
      if (/favicon\.ico/i.test(u0)) return;
      if (m.type() !== 'error' || isNoise(m.text())) return;
      const t = m.text();
      if (/_(mid|lod)\.glb$/i.test(u0) && /404/.test(t)) return; // 变体 HEAD 探测 404 属预期
      if (/Failed to load resource: net::ERR_/.test(t) && errors.localFailed.length === 0) return;
      errors.console.push(t + (u0 ? ' @ ' + u0 : ''));
    });
    page.on('pageerror', (e) => { if (!isNoise(e.message)) errors.page.push(e.message); });
    page.on('requestfailed', (r) => {
      const err = (r.failure() && r.failure().errorText) || '';
      if (/ERR_ABORTED/.test(err)) return;
      if (/^https?:\/\/(localhost|127\.)/.test(r.url())) errors.localFailed.push(r.url() + ' ' + err);
    });

    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => window.gameWorld && window.gameWorld.renderer && window.player, null, { timeout: 180000 });
    await page.evaluate(() => { const b = document.querySelector('.close-controls-hint'); if (b) b.click(); });

    // ---- 传送至教室热点，等散装模型加载并注册 ----
    await page.evaluate(({ x, z }) => {
      const p = window.player; p.position.x = x; p.position.z = z; if (p.velocity) p.velocity.y = 0;
    }, HOTSPOT);
    let stats = null;
    const t0 = Date.now();
    while (Date.now() - t0 < 180000) {
      stats = await page.evaluate(() => {
        const S = window.WorldLodStandalone; if (!S) return null;
        return S.getStats();
      }).catch(() => null);
      if (stats && stats.registered > 0) break;
      await page.waitForTimeout(3000);
    }
    check('A1', 'module loaded & standalone models registered at hotspot',
      !!(stats && stats.registered > 0), JSON.stringify(stats));

    // ---- 选定目标：非跳过、非合批、按 dist 最近的可测对象 ----
    let target = null;
    for (let i = 0; i < 20 && !target; i++) {
      target = await page.evaluate(() => {
        const S = window.WorldLodStandalone;
        const rows = S.debug().filter((r) => !String(r.state).startsWith('skipped'));
        rows.sort((a, b) => a.dist - b.dist);
        return rows[0] || null;
      }).catch(() => null);
      if (!target) await page.waitForTimeout(3000);
    }
    if (!target) throw new Error('no testable standalone rec near hotspot');
    INFO('target', JSON.stringify(target));

    // 测试期调高 LRU 上限，防止其它模型的变体把目标变体驱逐干扰断言（A8 再调低测驱逐）
    await page.evaluate(() => window.WorldLodStandalone.setLruCap(64));

    // ---- 摆位工具：把玩家放到目标表面距 dist 处（按 debug.dist 迭代收敛，±5% 或 ±1m）----
    // 注意：传送后 runFrame 需要 1~2 帧才更新 debug.dist，读前必须等待（否则拿到
    // 上一位置的陈旧值会做反向修正，把玩家越摆越远——2026-09-13 A6/A7 假失败根因）
    async function placeAt(dist) {
      let tx = null;
      for (let i = 0; i < 8; i++) {
        const d = await page.evaluate(async ({ id, dist, tx }) => {
          const w = window.gameWorld;
          let model = null;
          w.generatedBuildings.forEach((e, eid) => { if (String(eid) === String(id) && e && e.model) model = e.model; });
          if (!model) return null;
          const B = window.WorldObjectBounds;
          const r = B ? B.radiusOf(id) : 0;
          const px = (tx === null) ? (model.position.x + r + dist) : tx; // 沿 +X 摆
          const p = window.player;
          p.position.x = px; p.position.z = model.position.z; if (p.velocity) p.velocity.y = 0;
          await new Promise((res) => setTimeout(res, 700)); // 等 runFrame 更新 dist
          const row = window.WorldLodStandalone.debug(id)[0];
          return { got: row ? row.dist : null, px };
        }, { id: target.id, dist, tx });
        if (!d || d.got === null) { await page.waitForTimeout(800); continue; }
        if (Math.abs(d.got - dist) <= Math.max(1, dist * 0.05)) return d;
        tx = d.px + (dist - d.got); // 按实测偏差修正
        await page.waitForTimeout(500);
      }
      return null;
    }

    async function waitState(id, pred, timeoutMs) {
      const t = Date.now();
      let last = null;
      while (Date.now() - t < timeoutMs) {
        last = await page.evaluate((i) => window.WorldLodStandalone.debug(i)[0] || null, String(id)).catch(() => null);
        if (last && pred(last)) return last;
        await page.waitForTimeout(1500);
      }
      return last;
    }

    // ---- A2 高模带（取带内中点，窄带配置也留出摆位容差）----
    await placeAt(Math.max(2, BANDS.near * 0.5));
    await page.waitForTimeout(3000);
    const high = await waitState(target.id, (r) => r.state === 'high' && r.modelInScene, 30000);
    check('A2', `high band (<=${BANDS.near}m): high model in scene, no variant`,
      !!(high && high.state === 'high' && high.modelInScene), JSON.stringify(high));

    // ---- A3 中模带（懒加载 + 切显）----
    await placeAt(BANDS.near + Math.max(2, (BANDS.mid - BANDS.near) / 2));
    const mid = await waitState(target.id, (r) => r.state === 'mid' && r.midReady && !r.modelInScene, 120000);
    check('A3', `mid band (${BANDS.near}~${BANDS.mid}m): lazy-loaded mid variant displayed, high model out of scene`,
      !!(mid && mid.state === 'mid' && mid.midReady && !mid.modelInScene), JSON.stringify(mid));

    // ---- A4 材质共享：变体材质贴图与高模同对象 ----
    const share = await page.evaluate((id) => {
      const SLOTS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'bumpMap', 'alphaMap'];
      const w = window.gameWorld;
      let model = null;
      w.generatedBuildings.forEach((e, eid) => { if (String(eid) === String(id) && e && e.model) model = e.model; });
      let group = null;
      w.scene.traverse((g) => {
        if (!g.isGroup) return;
        if (g.name === 'LodStandalone:mid:' + id || g.name === 'LodStandalone:low:' + id) group = g;
      });
      if (!model || !group) return { found: false };
      const highTex = new Set();
      model.traverse((c) => { if (c.isMesh) (Array.isArray(c.material) ? c.material : [c.material]).forEach((m) => m && SLOTS.forEach((s) => { if (m[s]) highTex.add(m[s]); })); });
      let total = 0, shared = 0, variantTex = 0, details = [];
      group.traverse((c) => {
        if (!c.isMesh) return;
        total++;
        (Array.isArray(c.material) ? c.material : [c.material]).forEach((m) => {
          if (!m) return;
          SLOTS.forEach((s) => {
            if (!m[s]) return;
            variantTex++;
            if (highTex.has(m[s])) shared++;
            else if (details.length < 3) details.push(s);
          });
        });
      });
      return { found: true, meshes: total, sharedTex: shared, variantTex, diverged: details };
    }, target.id);
    check('A4', 'variant borrows high-model textures (same Texture objects, zero extra VRAM)',
      share.found && share.meshes > 0 && share.diverged.length === 0 && (share.sharedTex > 0 || share.variantTex === 0),
      JSON.stringify(share));

    // ---- A5 低模带 ----
    await placeAt(BANDS.mid + Math.max(10, (200 - BANDS.mid) / 2));
    const low = await waitState(target.id, (r) => r.state === 'low' && r.lowReady && !r.modelInScene, 120000);
    check('A5', `low band (${BANDS.mid}~200m): lazy-loaded low variant displayed`,
      !!(low && low.state === 'low' && low.lowReady && !low.modelInScene), JSON.stringify(low));

    // ---- A6 >200m 交还既有路径 ----
    await placeAt(260);
    const far = await waitState(target.id, (r) => r.state === 'high' && !r.modelInScene, 60000);
    const mark = await page.evaluate((id) => {
      let m = null;
      window.gameWorld.generatedBuildings.forEach((e, eid) => { if (String(eid) === String(id) && e && e.model) m = e.model; });
      let group = false;
      window.gameWorld.scene.traverse((g) => { if (g.isGroup && (g.name === 'LodStandalone:low:' + id || g.name === 'LodStandalone:mid:' + id)) group = true; });
      return { culledMark: !!(m && m.userData && m.userData.__culledByDist), variantInScene: group };
    }, target.id);
    check('A6', '>200m: variant removed, model handed back to existing cull path (__culledByDist set)',
      !!(far && far.state === 'high' && !far.modelInScene) && mark.culledMark && !mark.variantInScene,
      JSON.stringify({ far, mark }));

    // ---- A7 编辑模式：全部还原高模并暂停 ----
    await page.evaluate((id) => {
      const bm = window.gameWorld.buildingManager;
      if (bm) bm.isAdminMode = true;
      window.player.position.x -= 150; // 拉回中带距离，验证暂停还原
    }, target.id);
    await page.waitForTimeout(4000);
    const edited = await page.evaluate((id) => {
      const S = window.WorldLodStandalone;
      const st = S.getStats();
      const row = S.debug(id)[0] || {};
      return { displayedMid: st.displayedMid, displayedLow: st.displayedLow, state: row.state, modelInScene: row.modelInScene };
    }, target.id);
    check('A7', 'edit mode (isAdminMode): all variants restored to high & paused',
      edited.displayedMid === 0 && edited.displayedLow === 0 && edited.state === 'high' && edited.modelInScene,
      JSON.stringify(edited));
    await page.evaluate(() => { const bm = window.gameWorld.buildingManager; if (bm) bm.isAdminMode = false; });
    await page.waitForTimeout(2000);

    // ---- A8 LRU：先拉到 >200m（无显示变体），再调低上限，未显示变体被驱逐 ----
    await placeAt(260);
    await page.waitForTimeout(6000); // 等 passivateFar 生效（变体全部不在显示态）
    await page.evaluate(() => {
      window.WorldLodStandalone.setLruCap(1);
      window.WorldLodStandalone.rescan();
    });
    await page.waitForTimeout(4000);
    const lru = await page.evaluate(() => window.WorldLodStandalone.getStats());
    check('A8', 'LRU: held variants evicted down to cap (non-displayed only)',
      lru.held <= 1, JSON.stringify(lru));
    await page.evaluate(() => window.WorldLodStandalone.setLruCap(24));

    // ---- A9 console 错误 ----
    check('A9a', '0 console error (filtered)', errors.console.length === 0, errors.console.slice(0, 3).join(' || '));
    check('A9b', '0 pageerror', errors.page.length === 0, errors.page.slice(0, 3).join(' || '));
    check('A9c', '0 local resource failure', errors.localFailed.length === 0, errors.localFailed.slice(0, 3).join(' || '));

    await page.screenshot({ path: path.join(__dirname, '..', 'Screenshot', 'accept_lod_stage7', 'standalone_lod.png') });
  } finally {
    await browser.close();
  }

  const failed = checks.filter((c) => !c.pass);
  console.log(`\n===== VERDICT: ${failed.length === 0 ? 'ACCEPTED' : 'REJECTED'} (${checks.length - failed.length}/${checks.length}) =====`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
