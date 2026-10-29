/**
 * accept_world_doors.js —— 门的开关（按 F）验收
 * 覆盖：识别 / 提示 / 开关 / 碰撞刷新 / 持久化（刷新保持）/ 多人同步 / 游客只读 / 免合批
 *
 * 用法：node scripts/accept_world_doors.js
 * 前置：本地 3002 在跑；对象 30053(Streamline Diner Car) 与 30052(Signal Box) 在世界里
 * 清理：脚本自动把 custom_config 复位为 NULL（这两个对象原本就是 NULL）
 */
const { chromium } = require('playwright');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const { Pool } = require('pg');

const BASE = process.env.BASE || 'http://127.0.0.1:3002';
const DINER = 30053;          // Streamline Diner Car 门（door-mount > door > door-leaf）
const SIGNAL = 30052;         // Signal Box 门（door > door-leaf）
const NEAR_DOOR = { x: -116.8, y: 3, z: -282.0 };   // 站在 diner 门口约 2.2m

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost', port: 5432,
  database: process.env.DB_NAME || 'virtual_world',
  user: process.env.DB_USER || 'postgres', password: process.env.DB_PASSWORD,
});

const results = [];
function check(id, title, pass, detail) {
  results.push({ id, title, pass: !!pass, detail: detail === undefined ? '' : String(detail) });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${id} ${title}${detail !== undefined ? ' → ' + detail : ''}`);
}

// 已知噪音（与本次无关）：favicon 404、历史坏贴图、无变体 404
const NOISE_RE = /favicon|Couldn't load texture|_lod\.glb|_mid\.glb/i;

async function resetCustomConfig() {
  await pool.query('UPDATE world_objects SET custom_config = NULL WHERE id IN ($1,$2)', [DINER, SIGNAL]);
}
async function readDoors(id) {
  const r = await pool.query("SELECT custom_config->'doors' AS doors FROM world_objects WHERE id=$1", [id]);
  return (r.rows[0] && r.rows[0].doors) || {};
}

async function newPage(browser, auth) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 820 } });
  const page = await ctx.newPage();
  const errs = [];
  const notFound = [];   // 404 的 URL（Chrome 的 console 文案不含 URL，必须按 response 判来源）
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  page.on('response', (r) => { if (r.status() === 404) notFound.push(r.url()); });
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const u = (m.location() || {}).url || '';
    const txt = m.text() || '';
    if (/favicon/.test(u)) return;
    // 无 URL 的「Failed to load resource: 404」一律由 response 事件归类，这里跳过
    if (/Failed to load resource/i.test(txt) && /404/.test(txt)) return;
    if (NOISE_RE.test(txt)) return;
    errs.push('console: ' + txt.slice(0, 160));
  });
  if (auth) {
    await page.addInitScript(([t, uid, cid]) => {
      localStorage.setItem('token', t);
      localStorage.setItem('userId', uid);
      localStorage.setItem('characterId', cid);
    }, [auth.token, auth.userId, auth.characterId]);
  }
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.gameWorld && window.player && window.player.position, null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  return { page, ctx, errs, notFound };
}

/** 等某对象上的门被识别（模型加载有先后，别用固定 sleep） */
async function waitDoorReady(page, objectId, timeoutMs) {
  const deadline = Date.now() + (timeoutMs || 30000);
  while (Date.now() < deadline) {
    const ok = await page.evaluate((id) => {
      if (!window.WorldDoors) return false;
      return window.WorldDoors.list().some((d) => d.objectId === id);
    }, objectId);
    if (ok) return true;
    await page.waitForTimeout(800);
  }
  return false;
}

/** 读门板实测指标：材质是否双面、门板中心离玩家多远 */
async function doorMetrics(page, objectId) {
  return page.evaluate((id) => {
    const gb = window.gameWorld.generatedBuildings;
    const e = gb.get(id) || gb.get(String(id));
    if (!e || !e.model) return null;
    const THREE = window.THREE;
    let doorNode = null;
    e.model.traverse((o) => { if (!doorNode && o.name && /^door$/i.test(o.name)) doorNode = o; });
    if (!doorNode) return null;
    let side = null, meshCount = 0;
    doorNode.traverse((o) => {
      if (!o.isMesh) return;
      meshCount++;
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      if (side === null && m) side = m.side;
    });
    const box = new THREE.Box3().setFromObject(doorNode);
    const c = box.isEmpty() ? doorNode.getWorldPosition(new THREE.Vector3()) : box.getCenter(new THREE.Vector3());
    const p = window.player.position;
    return {
      side, meshCount,
      doubleSide: side === THREE.DoubleSide,
      dist: +Math.hypot(c.x - p.x, c.z - p.z).toFixed(2),
    };
  }, objectId);
}

/** 确保门处于目标状态（必要时按 F） */
async function ensureDoor(page, objectId, wantOpen) {
  for (let i = 0; i < 3; i++) {
    const cur = await page.evaluate((id) => {
      const d = window.WorldDoors.list().find((x) => x.objectId === id);
      return d ? d.open : null;
    }, objectId);
    if (cur === wantOpen) return true;
    await page.keyboard.press('f');
    await page.waitForTimeout(1300);
  }
  const fin = await page.evaluate((id) => {
    const d = window.WorldDoors.list().find((x) => x.objectId === id);
    return d ? d.open : null;
  }, objectId);
  return fin === wantOpen;
}

async function teleport(page, pos) {
  await page.evaluate((p) => { window.player.position.set(p.x, p.y, p.z); }, pos);
}

(async () => {
  let browser;
  try {
    await resetCustomConfig();

    // ── 准备登录账号 ────────────────────────────────────────────────
    const u = await pool.query("SELECT id, username FROM users WHERE username='diag_tmp_1' LIMIT 1");
    if (!u.rows.length) throw new Error('缺少测试账号 diag_tmp_1');
    const user = u.rows[0];
    const ch = await pool.query('SELECT id FROM characters WHERE user_id=$1 LIMIT 1', [user.id]);
    if (!ch.rows.length) throw new Error('测试账号没有角色');
    const characterId = ch.rows[0].id;
    const auth = {
      userId: user.id, characterId,
      token: jwt.sign({ userId: user.id, username: user.username }, process.env.JWT_SECRET, { expiresIn: '2h' }),
    };

    browser = await chromium.launch({
      channel: 'chrome', headless: true,
      args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'],
    });

    // ══════════ A 组：登录玩家单端 ══════════
    const A = await newPage(browser, auth);
    const page = A.page;

    const loaded = await page.evaluate(() => !!(window.WorldDoors && window.WorldDoors.version));
    check('A1', '门模块已加载', loaded, await page.evaluate(() => window.WorldDoors && window.WorldDoors.version));

    await teleport(page, NEAR_DOOR);
    await page.waitForTimeout(6000);

    const d1 = await page.evaluate(() => window.WorldDoors._diag());
    check('A2', '识别到门节点', d1.doors >= 1, `doors=${d1.doors} objects=${d1.objects}`);

    const list1 = await page.evaluate(() => window.WorldDoors.list());
    const diner1 = list1.find((d) => d.objectId === DINER);
    check('A3', '两个房子各识别 1 扇 door', !!diner1 && list1.some((d) => d.objectId === SIGNAL),
      JSON.stringify(list1.map((d) => d.objectId + ':' + d.id)));

    const prompt = await page.evaluate(() => {
      const el = document.getElementById('wd-prompt');
      if (!el) return null;
      return { display: getComputedStyle(el).display, text: el.textContent.trim() };
    });
    check('A4', '走近显示「F 开门」提示', prompt && prompt.display === 'block' && /开门/.test(prompt.text),
      prompt && prompt.text);

    // 碰撞几何快照（关闭状态）
    const dumpBefore = await page.evaluate((id) => (
      window.CapsuleCollision && window.CapsuleCollision._dump ? window.CapsuleCollision._dump(id) : null
    ), DINER);

    // 门板状态快照（材质双面/离玩家距离）
    const metricsBefore = await doorMetrics(page, DINER);

    // 开门动画期间逐帧记录「门板中心 ↔ 玩家」距离（判断门板会不会扫到角色身上）
    await page.evaluate((id) => {
      const gb = window.gameWorld.generatedBuildings;
      const e = gb.get(id) || gb.get(String(id));
      let doorNode = null;
      if (e && e.model) e.model.traverse((o) => { if (!doorNode && o.name && /^door$/i.test(o.name)) doorNode = o; });
      window.__doorSweep = { on: !!doorNode, min: Infinity, samples: 0 };
      if (!doorNode) return;
      const THREE = window.THREE;
      const loop = () => {
        if (!window.__doorSweep.on) return;
        const b = new THREE.Box3().setFromObject(doorNode);
        const c = b.isEmpty() ? doorNode.getWorldPosition(new THREE.Vector3()) : b.getCenter(new THREE.Vector3());
        const p = window.player.position;
        const d = Math.hypot(c.x - p.x, c.z - p.z);
        if (d < window.__doorSweep.min) window.__doorSweep.min = d;
        window.__doorSweep.samples++;
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    }, DINER);

    // 碰撞刷新计数
    await page.evaluate(() => {
      window.__capRefresh = 0;
      const C = window.CapsuleCollision;
      if (C && typeof C.refresh === 'function') {
        const orig = C.refresh;
        C.refresh = function () { window.__capRefresh++; return orig.apply(this, arguments); };
      }
    });

    await page.keyboard.press('f');
    await page.waitForTimeout(1400);
    const opened = await page.evaluate(() => ({ list: window.WorldDoors.list(), refresh: window.__capRefresh }));
    const dOpen = opened.list.find((d) => d.objectId === DINER);
    check('A5', '按 F 后门转到 90°', dOpen && dOpen.open === true && Math.abs(Math.abs(dOpen.angle) - Math.PI / 2) < 0.05,
      `angle=${dOpen && dOpen.angle}`);
    check('A6', '开门后刷新碰撞（人才能走进去）', opened.refresh >= 1, `refresh=${opened.refresh}`);

    const db1 = await readDoors(DINER);
    check('A7', '门状态落库（custom_config.doors）', db1.door && db1.door.open === true && db1.door.by === characterId,
      JSON.stringify(db1));

    // 等 BVH 分帧重建完成，比对门板碰撞 AABB 是否换向（门洞真的打开，不是只转了视觉）
    await page.waitForTimeout(2600);
    const dumpAfter = await page.evaluate((id) => (
      window.CapsuleCollision && window.CapsuleCollision._dump ? window.CapsuleCollision._dump(id) : null
    ), DINER);
    const changedMeshes = (dumpBefore && dumpAfter && dumpBefore.length === dumpAfter.length)
      ? dumpBefore.filter((m, i) => JSON.stringify(m.aabb) !== JSON.stringify(dumpAfter[i].aabb)).length
      : -1;
    check('A12', '碰撞几何跟着门转（门板 AABB 换向 → 人真的能走进去）',
      changedMeshes >= 1,
      `changed=${changedMeshes}/${dumpBefore ? dumpBefore.length : 0}`);

    // 门板指标（开门状态）
    const metricsAfter = await doorMetrics(page, DINER);
    check('A13', '门材质已改双面（否则转到背面会"消失/闪"）',
      metricsBefore && metricsBefore.doubleSide && metricsAfter && metricsAfter.doubleSide,
      `before=${metricsBefore && metricsBefore.side} after=${metricsAfter && metricsAfter.side}(DoubleSide=2) meshes=${metricsAfter && metricsAfter.meshCount}`);
    const sweep = await page.evaluate(() => { const s = window.__doorSweep; if (s) s.on = false; return s; });
    check('A14', '开门扫掠不经过角色（门板不往人身上转）',
      sweep && sweep.samples > 5 && sweep.min > 0.9,
      `最小间距=${sweep && sweep.min !== Infinity ? sweep.min.toFixed(2) : 'inf'}m 采样=${sweep && sweep.samples}`);

    // F 键共享：远离门时按 F 不应该误开门（应让给 main.js 的"视频声音"功能）
    const stateBeforeFar = await page.evaluate(() => window.WorldDoors.list());
    await page.evaluate(() => {
      const p = window.player.position;
      window.player.position.set(p.x, p.y, p.z + 25);   // 离开门的 5m 范围
    });
    await page.waitForTimeout(1200);
    const promptFar = await page.evaluate(() => {
      const el = document.getElementById('wd-prompt');
      return el ? getComputedStyle(el).display : null;
    });
    await page.keyboard.press('f');
    await page.waitForTimeout(1200);
    const stateAfterFar = await page.evaluate(() => window.WorldDoors.list());
    check('A15', '远离门时按 F 不误触（F 让给视频声音功能）',
      promptFar === 'none' && JSON.stringify(stateBeforeFar) === JSON.stringify(stateAfterFar),
      `提示=${promptFar} 状态不变=${JSON.stringify(stateBeforeFar) === JSON.stringify(stateAfterFar)}`);
    await teleport(page, NEAR_DOOR);
    await page.waitForTimeout(1500);

    await page.keyboard.press('f');
    await page.waitForTimeout(1400);
    const closed = await page.evaluate(() => ({ list: window.WorldDoors.list(), refresh: window.__capRefresh }));
    const dClosed = closed.list.find((d) => d.objectId === DINER);
    check('A8', '再按 F 关门回到原角度', dClosed && !dClosed.open && Math.abs(dClosed.angle - dClosed.baseY) < 0.02,
      `angle=${dClosed && dClosed.angle}`);
    const db2 = await readDoors(DINER);
    check('A9', '关门也落库', db2.door && db2.door.open === false, JSON.stringify(db2));
    check('A10', '两个动作各刷一次碰撞', closed.refresh >= 2, `refresh=${closed.refresh}`);

    const excludeOk = await page.evaluate((id) => {
      const gb = window.gameWorld.generatedBuildings;
      const e = gb.get(id) || gb.get(String(id));
      return !!(e && e.model && e.model.userData.__excludeFromMerge === true);
    }, DINER);
    check('A11', '带门模型被排除合批（防 InstancedMesh 后门转不动）', excludeOk);

    // ══════════ B 组：持久化（刷新保持）══════════
    await page.keyboard.press('f');           // 开门
    await page.waitForTimeout(1200);
    const savedOpen = (await readDoors(DINER)).door;
    check('B1', '开门状态已入库（刷新前）', savedOpen && savedOpen.open === true);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.gameWorld && window.player && window.player.position, null, { timeout: 60000 });
    await page.waitForTimeout(1200);
    await teleport(page, NEAR_DOOR);
    const reloadReady = await waitDoorReady(page, DINER, 35000);
    const afterReload = await page.evaluate(() => window.WorldDoors.list());
    const dReload = afterReload.find((d) => d.objectId === DINER);
    check('B2', '刷新后门仍为开（持久化恢复）',
      reloadReady && dReload && dReload.open === true && Math.abs(Math.abs(dReload.angle) - Math.PI / 2) < 0.05,
      `ready=${reloadReady} open=${dReload && dReload.open} angle=${dReload && dReload.angle}`);

    // ══════════ C 组：多人同步 + 游客只读 ══════════
    const G = await newPage(browser, null);   // 游客
    await teleport(G.page, NEAR_DOOR);
    const guestReady = await waitDoorReady(G.page, DINER, 35000);
    const guestDiag = await G.page.evaluate(() => window.WorldDoors && window.WorldDoors._diag());
    check('C1', '游客端也识别到门', guestReady && guestDiag && guestDiag.doors >= 1, `doors=${guestDiag && guestDiag.doors}`);

    // 先确保 A 端门是关的，再开 → 游客端应同步为开
    const closedOk = await ensureDoor(page, DINER, false);
    await G.page.waitForTimeout(1500);
    const gBefore = (await G.page.evaluate(() => window.WorldDoors.list())).find((d) => d.objectId === DINER);
    const openOk = await ensureDoor(page, DINER, true);
    await G.page.waitForTimeout(1800);
    const guestAfter = await G.page.evaluate(() => ({ list: window.WorldDoors.list(), diag: window.WorldDoors._diag() }));
    const gDoor = guestAfter.list.find((d) => d.objectId === DINER);
    check('C2', 'A 端开门后游客端同步为开',
      closedOk && openOk && gBefore && gBefore.open === false && gDoor && gDoor.open === true,
      `A开放前=${gBefore && gBefore.open} A开=${openOk} 游客=${gDoor && gDoor.open} remoteApplied=${guestAfter.diag.remoteApplied}`);

    // 游客按 F → 提示需登录，DB 不变
    const beforeGuest = await readDoors(DINER);
    await G.page.bringToFront();
    await G.page.waitForTimeout(600);
    const guestDiagBefore = await G.page.evaluate(() => window.WorldDoors._diag());
    await G.page.keyboard.press('f');
    await G.page.waitForTimeout(1200);
    const guestToast = await G.page.evaluate(() => {
      const el = document.getElementById('wd-toast');
      return el ? { display: getComputedStyle(el).display, text: el.textContent.trim() } : null;
    });
    const afterGuest = await readDoors(DINER);
    check('C3', '游客按 F 被提示登录且不改状态',
      guestToast && guestToast.display === 'block' && /登录/.test(guestToast.text) &&
      JSON.stringify(beforeGuest) === JSON.stringify(afterGuest),
      `toast=${guestToast && guestToast.display}/${guestToast && guestToast.text} nearest=` +
      JSON.stringify(guestDiagBefore.nearest) + ' db不变=' + (JSON.stringify(beforeGuest) === JSON.stringify(afterGuest)));
    await page.bringToFront();

    // ══════════ E 组：交互点统一到 F（worldInteractions v2）══════════
    // 用法：走到世界交互点（world_interactions）旁按 F 触发互动；E 不再触发。
    // 互动请求用 route mock 掉，避免写奖励/污染数据。
    let interactHits = 0;
    await page.route('**/api/gameplay/interact', (route) => {
      interactHits++;
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
    });
    await page.bringToFront();
    await teleport(page, { x: 210, y: 5, z: 210 });   // 世界里现成的交互点（radius 5）
    await page.waitForTimeout(6000);
    const iprompt = await page.evaluate(() => {
      const el = document.getElementById('wi-prompt');
      return el ? { display: getComputedStyle(el).display, text: el.textContent.trim() } : null;
    });
    check('E1', '走近交互点提示改用 F', iprompt && iprompt.display === 'block' && /^F/.test(iprompt.text),
      iprompt && iprompt.text);

    const beforeHits = interactHits;
    await page.keyboard.press('e');
    await page.waitForTimeout(1500);
    const afterE = interactHits;
    check('E2', 'E 键不再触发交互点', afterE === beforeHits, `E 后请求数=${afterE}`);

    await page.keyboard.press('f');
    await page.waitForTimeout(1800);
    check('E3', 'F 键触发交互点互动', interactHits > afterE, `F 后请求数=${interactHits}`);
    await page.unroute('**/api/gameplay/interact');

    // ══════════ D 组：回归 ══════════
    // 404 按 URL 归类：favicon / LOD 变体（小模型本来就不生成）/ 历史坏贴图 属已知噪音
    const noise404 = (list) => list.filter((u) => /favicon|_lod\.glb|_mid\.glb|\.jpg$|\.jpeg$|\.png$/i.test(u));
    const real404 = (list) => list.filter((u) => !/favicon|_lod\.glb|_mid\.glb|\.jpg$|\.jpeg$|\.png$/i.test(u));
    check('D1', 'A 页面 0 未预期错误', A.errs.length === 0 && real404(A.notFound).length === 0,
      `console=${A.errs.length} 404=${real404(A.notFound).length} 噪音404=${noise404(A.notFound).length}` +
      (real404(A.notFound).length ? ' url=' + real404(A.notFound).slice(0, 3).join(',') : ''));
    check('D2', '游客页面 0 未预期错误', G.errs.length === 0 && real404(G.notFound).length === 0,
      `console=${G.errs.length} 404=${real404(G.notFound).length} 噪音404=${noise404(G.notFound).length}`);

    await A.ctx.close();
    await G.ctx.close();
  } catch (e) {
    check('X1', '脚本执行', false, e.message);
  } finally {
    try { await resetCustomConfig(); } catch (e) { /* 忽略 */ }
    try { if (browser) await browser.close(); } catch (e) { /* 忽略 */ }
    await pool.end();

    const failed = results.filter((r) => !r.pass);
    console.log('\n================ 结果 ================');
    console.log(`合计 ${results.length} 项，通过 ${results.length - failed.length}，失败 ${failed.length}`);
    if (failed.length) console.log('失败项：' + failed.map((f) => f.id).join(', '));
    console.log(failed.length === 0 ? 'VERDICT ACCEPTED' : 'VERDICT FAILED');
    process.exit(failed.length === 0 ? 0 : 1);
  }
})();
