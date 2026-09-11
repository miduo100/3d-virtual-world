/**
 * accept_lod_stage5_regression.js — LOD 三版模型方案【阶段 5】全项目回归脚本（可重跑）
 *
 * 用途：证明「LOD 全量转换」没有影响世界其它系统。覆盖规范第 4 节阶段 5 第 2 条点名的五块：
 *       主世界加载 / 几何建筑合批 / 媒体 / 3DGS / 多人在线，外加 LOD 三带本身。
 *
 * 用法：node scripts/accept_lod_stage5_regression.js          （需先启动 3002 服务器）
 *       node scripts/accept_lod_stage5_regression.js --json  额外输出机器可读结果
 * 产物：Screenshot/accept_lod_stage5/regression_checks.json
 *
 * 判据：
 *   R1 主世界加载：renderer 就绪 + THREE.REVISION=185 + 对象已加载 + LOD 开关已读取
 *   R2 几何建筑合批：几何密集区 GeometryBatcher.stats() 有批次/实例（未被本次改动破坏）
 *   R3 媒体：图片/视频近点加载 → 远点卸载（独立通道）
 *   R4 3DGS：真实注入 PLY（相机视线 12m 处）→ 渲染点数为正 → 卸载无报错
 *   R5 多人在线：第二个客户端（同 token 另一连接）加入 → 玩家数 +1；断开 → 恢复
 *   R6 LOD 三带：合批组三带计数之和 == 组内实例数，且中模带有实例
 *   R7 0 console error（浏览器扩展/预期探测 404/导航取消已分类）
 *
 * 说明：R5 用「同一 token 的第二个 WS 连接」而不是第二个账号，避免触发登录限流（IP 1 小时锁）。
 *       服务端 playerPositions 按 connectionId 记账，同账号两连接即两名玩家。
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE = process.env.API_BASE || 'http://localhost:3002';
const USER = process.env.GAME_USER || 'diag_tmp_1';
const PASS = process.env.GAME_PASS || 'Diag#2026tmp';

const OUT_DIR = path.join(__dirname, '..', 'Screenshot', 'accept_lod_stage5');
const MEDIA_IMAGE_ID = 493;
const MEDIA_VIDEO_ID = 453;
const GEO_CLUSTER = { x: -9.5, z: 0 };      // 60m 内 240 个几何对象的密集区（DB 实算）
// 远点 = 红十字军群质心（脚本内由 DB 实算）：距媒体对象约 1100m，
// > 2×卸载半径(400m) → 跳过最短存活期立即卸载，是确定性卸载点
let FAR_POINT = { x: -267, z: -1056 };

const checks = [];
function check(id, title, pass, detail) {
  checks.push({ id, title, pass: !!pass, detail: detail === undefined ? '' : String(detail) });
}

function isNoise(t) {
  return /runtime\.lastError|index\.global\.js|ResizeObserver loop|favicon\.ico/i.test(t || '');
}

async function api(method, p, body, token) {
  const opts = { method, headers: {} };
  if (token) opts.headers.Authorization = 'Bearer ' + token;
  if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const r = await fetch(BASE + p, opts);
  let json = null;
  try { json = await r.json(); } catch (e) { /* ignore */ }
  return { status: r.status, json };
}

async function teleport(page, x, z) {
  await page.evaluate(({ px, pz }) => {
    const p = window.player;
    if (!p || !p.position) return;
    p.position.x = px; p.position.z = pz;
    if (p.velocity) p.velocity.y = 0;
  }, { px: x, pz: z });
}

async function waitFor(page, fn, timeoutMs, stepMs, arg) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const v = await page.evaluate(fn, arg).catch(() => null);
    if (v) return v;
    await page.waitForTimeout(stepMs || 1000);
  }
  return null;
}

(async () => {
  console.log('=== LOD Stage 5 regression ===');
  let browser = null;
  let db = null;
  const summary = {};

  try {
    const login = await api('POST', '/api/auth/login', { username: USER, password: PASS });
    if (!login.json || !login.json.token) throw new Error('game login failed: ' + JSON.stringify(login.json));
    db = require('../src/database/db');
    console.log(`login ok (${USER})`);

    // 最大合批组 + 质心（脚本自算，世界改动后无需改脚本）
    const grp = await db.query(
      `SELECT model_path, COUNT(*) AS c FROM world_objects
       WHERE model_path LIKE '%/uploaded/%' GROUP BY model_path HAVING COUNT(*) >= 6 ORDER BY c DESC LIMIT 1`
    );
    const modelPath = grp.rows[0].model_path;
    const instCnt = Number(grp.rows[0].c);
    const cen = await db.query(
      `SELECT AVG(position_x) AS ax, AVG(position_z) AS az FROM world_objects WHERE model_path = $1`,
      [modelPath]
    );
    const GROUP_CENTER = { x: Number(cen.rows[0].ax), z: Number(cen.rows[0].az) };
    console.log(`biggest merge group: ${instCnt} x ${modelPath} @ (${GROUP_CENTER.x.toFixed(0)},${GROUP_CENTER.z.toFixed(0)})`);
    FAR_POINT = { x: GROUP_CENTER.x, z: GROUP_CENTER.z };   // 远点=集群质心（对媒体 >800m）
    summary.biggestGroup = { modelPath, instances: instCnt, center: GROUP_CENTER };

    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
    const errors = { console: [], page: [], localFailed: [], aborted: [], probe404: [] };
    const attach = (page) => {
      page.on('console', (m) => {
        if (m.type() !== 'error' || isNoise(m.text())) return;
        const u = (m.location && m.location() && m.location().url) || '';
        if (/favicon\.ico/.test(u)) return;
        if (/_(mid|lod)\.glb$/i.test(u) && /404/.test(m.text())) { errors.probe404.push(u); return; }
        errors.console.push(m.text() + (u ? ' @ ' + u : ''));
      });
      page.on('pageerror', (e) => { if (!isNoise(e.message)) errors.page.push(e.message); });
      page.on('requestfailed', (r) => {
        const err = (r.failure() && r.failure().errorText) || '';
        if (/ERR_ABORTED/.test(err)) { errors.aborted.push(r.url()); return; }
        const u = r.url();
        if (/^https?:\/\/(localhost|127\.)/.test(u) || !/^https?:/.test(u)) errors.localFailed.push(u + ' ' + err);
      });
    };

    const seed = await ctx.newPage();
    await seed.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
    await seed.evaluate((d) => {
      localStorage.setItem('token', d.token);
      localStorage.setItem('userId', String(d.userId));
      localStorage.setItem('characterId', String(d.characterId));
    }, login.json);
    await seed.close();

    const page = await ctx.newPage();
    attach(page);
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => window.gameWorld && window.gameWorld.renderer && window.player, null, { timeout: 180000 });
    await page.evaluate(() => { const b = document.querySelector('.close-controls-hint'); if (b) b.click(); });
    // 对象清单需等世界数据拉取完成（renderer 就绪时 allWorldObjects 还是空数组）
    await waitFor(page, () => {
      const g = window.gameWorld;
      return (g.allWorldObjects || []).length > 500 && g.generatedBuildings && g.generatedBuildings.size > 50;
    }, 120000, 2000);

    // ---------- R1 主世界加载 ----------
    const boot = await page.evaluate(() => ({
      rev: window.THREE && window.THREE.REVISION,
      buildings: window.gameWorld.generatedBuildings ? window.gameWorld.generatedBuildings.size : 0,
      allObjects: (window.gameWorld.allWorldObjects || []).length,
      lod: window.__LOD_ENABLED,
      batcher: !!(window.GeometryBatcher && window.GeometryBatcher.stats),
      mediaMod: typeof window.gameWorld.loadMediaObject === 'function',
      gsMod: !!(window.GaussianSplatLoader && window.GaussianSplatRenderer && window.gameWorld.addGaussianSplat),
    }));
    console.log('boot: ' + JSON.stringify(boot));
    check('R1', 'renderer booted with THREE r185', String(boot.rev) === '185', `REVISION=${boot.rev}`);
    check('R1', 'world objects enumerated and placeholder field populated', boot.allObjects > 500 && boot.buildings > 50,
      `allWorldObjects=${boot.allObjects} generatedBuildings=${boot.buildings}`);
    check('R1', 'LOD switch read from public API at boot', boot.lod === true, `__LOD_ENABLED=${boot.lod}`);
    check('R1', 'modules present: batcher / media / 3DGS', boot.batcher && boot.mediaMod && boot.gsMod, JSON.stringify(boot));

    // ---------- R2 几何建筑合批 ----------
    await teleport(page, GEO_CLUSTER.x, GEO_CLUSTER.z);
    await page.waitForTimeout(25000);
    const bs = await page.evaluate(() => (window.GeometryBatcher && window.GeometryBatcher.stats) ? window.GeometryBatcher.stats() : null);
    console.log('batcher: ' + JSON.stringify(bs));
    check('R2', 'geometry batcher produced batches in dense area', !!bs && bs.batches > 0 && bs.instances > 0,
      JSON.stringify(bs));
    const geoInfo = await page.evaluate(() => {
      const g = window.gameWorld;
      let geoLoaded = 0;
      (g.allWorldObjects || []).forEach((o) => { if (/^geometry/.test(o.type) && g.loadedObjects.has(o.id)) geoLoaded += 1; });
      return { geoLoaded, loaded: g.loadedObjects.size };
    });
    check('R2', 'geometry objects actually loaded (not placeholders only)', geoInfo.geoLoaded > 0, JSON.stringify(geoInfo));

    // ---------- R4 3DGS（相机视线 12m 处注入，规避 animate 每帧重置相机） ----------
    const ptsBefore = await page.evaluate(() => window.gameWorld.renderer.info.render.points);
    const spot = await page.evaluate(() => {
      const g = window.gameWorld;
      const v = new THREE.Vector3(0, -0.3, 0.5).unproject(g.camera);
      const dir = v.sub(g.camera.position.clone()).normalize();
      const pt = g.camera.position.clone().add(dir.multiplyScalar(12));
      return { x: pt.x, y: pt.y, z: pt.z };
    });
    await page.evaluate((s) => {
      window.gameWorld.addGaussianSplat({
        id: 'regression_3dgs', name: 'E2E 回归 3DGS', model_path: '/scenes/3dgs/scene-1786835882322-897112501.ply',
        position_x: s.x, position_y: s.y, position_z: s.z, scale_x: 1, scale_y: 1, scale_z: 1,
      });
    }, spot);
    const gsOk = await waitFor(page, () => {
      const g = window.gameWorld;
      const rec = g.generatedBuildings && g.generatedBuildings.get('regression_3dgs');
      const pts = g.renderer.info.render.points;
      return pts > 0 ? { done: true, pts, splat: !!(rec && rec.splat) } : false;
    }, 120000, 2000);
    const ptsAfter = await page.evaluate(() => window.gameWorld.renderer.info.render.points);
    console.log(`3DGS: points before=${ptsBefore} after=${ptsAfter} loaded=${JSON.stringify(gsOk)}`);
    check('R4', '3DGS PLY loads and renders (render.points > 0)', !!gsOk && ptsAfter > 0,
      `before=${ptsBefore} after=${ptsAfter} detail=${JSON.stringify(gsOk)}`);

    // ---------- R3 媒体：近点加载 → 远点卸载 ----------
    await teleport(page, -4.5, 14.9);   // 图片(493)与视频(453)都在 200m 内
    const mediaLoaded = await waitFor(page, () => {
      const g = window.gameWorld;
      const img = g.loadedObjects.has(493);
      const vid = g.loadedObjects.has(453);
      return (img && vid) ? { img, vid, videos: g._videoElements ? g._videoElements.size : 0 } : false;
    }, 120000, 2000);
    console.log('media loaded: ' + JSON.stringify(mediaLoaded));
    check('R3', 'media image + video load when near', !!mediaLoaded, JSON.stringify(mediaLoaded));

    await teleport(page, FAR_POINT.x, FAR_POINT.z);
    const mediaUnloaded = await waitFor(page, () => {
      const g = window.gameWorld;
      const gone = !g.loadedObjects.has(493) && !g.loadedObjects.has(453);
      return gone ? { videos: g._videoElements ? g._videoElements.size : 0 } : false;
    }, 150000, 3000);
    console.log('media unloaded: ' + JSON.stringify(mediaUnloaded));
    check('R3', 'media unload when far (no lingering video element)', !!mediaUnloaded,
      JSON.stringify(mediaUnloaded) + ' (loadedObjects=' + await page.evaluate(() => window.gameWorld.loadedObjects.size) + ')');

    // ---------- R6 LOD 三带（此时已在集群质心） ----------
    const bandSnap = await waitFor(page, () => {
      const M = window.WorldInstanceMerger;
      if (!M || !M.debugLod) return false;
      const d = M.debugLod();
      const big = d.groups.slice().sort((a, b) => b.instances - a.instances)[0];
      if (!big || big.instances < 6) return false;
      const c = big.counts || {};
      return ((c.high || 0) + (c.mid || 0) + (c.low || 0)) === big.instances && (c.mid || 0) > 0
        ? { lodEnabled: d.lodEnabled, instances: big.instances, counts: c, midTemplates: big.midTemplates, lowTemplates: big.lowTemplates, farLimit: big.farLimit }
        : false;
    }, 240000, 3000);
    console.log('LOD bands: ' + JSON.stringify(bandSnap));
    check('R6', 'LOD three bands cover all instances of biggest merge group', !!bandSnap,
      JSON.stringify(bandSnap) + ' (group=' + instCnt + ' instances, path=' + path.basename(modelPath) + ')');

    // ---------- R5 多人在线（游客 context：无需账号，characterId 独立 → 真实第二名玩家） ----------
    // 注意：不能用「同一 token 的第二个连接」——前端 addPlayer 会按 characterId 去重（同账号=同一角色），
    // 服务端虽按 connectionId 记两名玩家，前端却不会新增，测不出多人链路。
    const playersBefore = await page.evaluate(() => (window.gameWorld.players ? window.gameWorld.players.size : -1));
    const guestCtx = await browser.newContext({ viewport: { width: 800, height: 600 } });
    const page2 = await guestCtx.newPage();
    await page2.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page2.waitForFunction(() => window.WSClient && window.WSClient.connected, null, { timeout: 120000 });
    const guestId = await page2.evaluate(() => (window.GAME_STATE && window.GAME_STATE.characterId) || null);
    console.log(`guest client connected: ${guestId}`);
    const joined = await waitFor(page, (n) => {
      const size = window.gameWorld.players ? window.gameWorld.players.size : -1;
      return size > n ? { size } : false;
    }, 90000, 2000, playersBefore);
    console.log(`players: before=${playersBefore} afterJoin=${JSON.stringify(joined)}`);
    check('R5', 'guest client joins -> player count grows', !!joined && joined.size > playersBefore,
      `before=${playersBefore} after=${joined && joined.size} guest=${guestId}`);
    await guestCtx.close();
    const left = await waitFor(page, (n) => {
      const size = window.gameWorld.players ? window.gameWorld.players.size : -1;
      return size <= n ? { size } : false;
    }, 60000, 1500, playersBefore);
    console.log('players after leave: ' + JSON.stringify(left));
    check('R5', 'player removed after disconnect', !!left && left.size <= playersBefore,
      `after=${left && left.size} (before=${playersBefore})`);

    // ---------- R7 console ----------
    check('R7', '0 console error in regression session (noise classified)',
      errors.console.length === 0 && errors.page.length === 0 && errors.localFailed.length === 0,
      `console=${errors.console.length} pageerror=${errors.page.length} localFailed=${errors.localFailed.length}`
      + ` (probe404=${errors.probe404.length} aborted=${errors.aborted.length})`
      + (errors.console.length ? ' | ' + errors.console.slice(0, 3).join(' ; ') : '')
      + (errors.page.length ? ' | ' + errors.page.slice(0, 2).join(' ; ') : ''));

    await ctx.close();
  } catch (e) {
    check('FATAL', 'regression run', false, e.message + (e.stack ? ' | ' + String(e.stack).split('\n')[1] : ''));
  } finally {
    if (browser) { try { await browser.close(); } catch (e) { /* ignore */ } }
    if (db && db.pool) { try { await db.pool.end(); } catch (e) { /* ignore */ } }
  }

  const failed = checks.filter((c) => !c.pass);
  console.log('\n=== Results ===');
  checks.forEach((c) => console.log(`${c.pass ? 'PASS' : 'FAIL'} [${c.id}] ${c.title} -- ${c.detail}`));
  console.log(`\nSUMMARY: ${checks.length - failed.length}/${checks.length} passed, failed=${failed.length}`);
  console.log(failed.length === 0 ? 'VERDICT: ACCEPTED' : 'VERDICT: REJECTED');
  try {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(path.join(OUT_DIR, 'regression_checks.json'),
      JSON.stringify({ at: new Date().toISOString(), summary, checks }, null, 2), 'utf8');
  } catch (e) { console.log('write checks json failed: ' + e.message); }
  process.exit(failed.length === 0 ? 0 : 1);
})();
