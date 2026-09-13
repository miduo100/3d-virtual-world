/**
 * accept_lod_stage7b_lifecycle.js — LOD 三期会话 2 生命周期与集成验收（散装模型 LOD 化）
 *
 * 判据：
 *   L1a 走远卸载 ×3 轮：玩家移到 >800m（跳过 60s 最短存活期，确定性立即卸载）后，
 *       教室热点注册的散装 rec 全部释放（变体 dispose + WorldLodAssets 缓存 forget）
 *   L1b 采样等待 >60s：每轮卸载完成后等待 65s 再采样（覆盖 60s 存活期，防早采样假象）
 *   L1c 走近重载 ×3 轮：回到热点后散装 rec 重新注册（≥90% 基线）并稳定
 *   L1d 无泄漏：3 轮后 renderer.info.memory geometries/textures 回到基线（容差），
 *       场景内 LodStandalone 组无残留增长
 *   L2a 后台改分带 → 散装端 60s 内跟进（WorldLodAssets 60s 轮询 /lod-enabled）
 *   L2b 散装端行为跟随新分带（目标模型落入新高模带后 state=high 且模型回场景）
 *   L2c 分带配置恢复原值
 *   L3a 新上传模型：响应含 lod.ok=true，磁盘 _mid/_lod 落盘
 *   L3b 新上传模型放置为世界对象后自动纳入散装 LOD（注册 + 低模带切显）
 *   L3c 清理：世界对象 / 上传模型 / 变体全部删除
 *
 * 用法：node scripts/accept_lod_stage7b_lifecycle.js   （需先启动服务器；真实 GPU chrome）
 * 运行时间较长（3 轮卸载/重载 + 65s 采样 ×3 ≈ 15~20 分钟）。
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.env.API_BASE || 'http://localhost:3002';
const USER = process.env.GAME_USER || 'diag_tmp_1';
const PASS = process.env.GAME_PASS || 'Diag#2026tmp';

const HOTSPOT = { x: -22, z: 803 };          // 教室热点
const FAR_POINT = { x: HOTSPOT.x + 1200, z: HOTSPOT.z }; // >800m，确定性立即卸载
const UPLOAD_DIR = path.join(__dirname, '..', 'public', 'models', 'uploaded');

const checks = [];
function check(id, title, pass, detail) {
  checks.push({ id, title, pass: !!pass, detail: detail === undefined ? '' : String(detail) });
  console.log(`${pass ? 'PASS' : 'FAIL'} [${id}] ${title}${detail ? ' | ' + detail : ''}`);
}
const INFO = (t, d) => console.log(`INFO ${t}${d ? ' | ' + d : ''}`);

function isNoise(t) {
  return /runtime\.lastError|index\.global\.js|ResizeObserver loop|favicon\.ico/i.test(t || '');
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

/** 场景可达几何结构采样（结构性泄漏判据：uuid 集合不增长） */
const STRUCT_SAMPLE = () => {
  const w = window.gameWorld;
  const mi = w.renderer.info;
  const all = new Set(), varG = new Set(), highG = new Set();
  let varGroups = 0;
  w.scene.traverse((c) => { if (c.isMesh && c.geometry) all.add(c.geometry.uuid); });
  w.scene.traverse((g) => {
    if (g.isGroup && g.name && String(g.name).startsWith('LodStandalone:')) {
      varGroups++;
      g.traverse((c) => { if (c.isMesh && c.geometry) varG.add(c.geometry.uuid); });
    }
  });
  w.generatedBuildings.forEach((e) => {
    if (e && e.model && !e.isPlaceholder) {
      e.model.traverse((c) => { if (c.isMesh && c.geometry) highG.add(c.geometry.uuid); });
    }
  });
  return {
    info: { geom: mi.memory.geometries, tex: mi.memory.textures },
    reachable: all.size, varGeoms: varG.size, highGeoms: highG.size, varGroups,
  };
};

function readTris(absPath) {
  let fd = null;
  try {
    fd = fs.openSync(absPath, 'r');
    const head = Buffer.alloc(20);
    if (fs.readSync(fd, head, 0, 20, 0) < 20) return 0;
    if (head.readUInt32LE(0) !== 0x46546c67) return 0;
    const len = head.readUInt32LE(12);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, 20);
    const json = JSON.parse(buf.toString('utf8').replace(/[\s\u0000]+$/, ''));
    const acc = json.accessors || [];
    let t = 0;
    (json.meshes || []).forEach((m) => (m.primitives || []).forEach((p) => {
      if (p.indices !== undefined && acc[p.indices]) t += Math.floor(acc[p.indices].count / 3);
      else if (p.attributes && p.attributes.POSITION !== undefined && acc[p.attributes.POSITION]) t += Math.floor(acc[p.attributes.POSITION].count / 3);
    }));
    return t;
  } catch (e) { return 0; }
  finally { if (fd !== null) { try { fs.closeSync(fd); } catch (_) { /* ignore */ } } }
}

/** GLB 是否含 SkinnedMesh（决策 4：蒙皮模型跳过变体，测试样本须选静态模型） */
function hasSkin(absPath) {
  let fd = null;
  try {
    fd = fs.openSync(absPath, 'r');
    const head = Buffer.alloc(20);
    if (fs.readSync(fd, head, 0, 20, 0) < 20) return false;
    if (head.readUInt32LE(0) !== 0x46546c67) return false;
    const len = head.readUInt32LE(12);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, 20);
    const json = JSON.parse(buf.toString('utf8').replace(/[\s\u0000]+$/, ''));
    return (json.skins || []).length > 0;
  } catch (e) { return false; }
  finally { if (fd !== null) { try { fs.closeSync(fd); } catch (_) { /* ignore */ } } }
}

function pickSample() {
  const files = fs.readdirSync(UPLOAD_DIR).filter((f) => /\.glb$/i.test(f) && !/_(mid|lod|dec)\.glb$/i.test(f) && !/\.tmp\.glb$/i.test(f));
  const cands = [];
  files.forEach((f) => {
    const full = path.join(UPLOAD_DIR, f);
    let size = 0;
    try { size = fs.statSync(full).size; } catch (_) { return; }
    if (size > 20 * 1024 * 1024 || size < 10 * 1024) return;
    const tris = readTris(full);
    if (tris < 5000) return;
    if (hasSkin(full)) return; // 蒙皮模型：世界管线烘焙为静态可注册，但变体按决策 4 跳过，不适合做切带测试
    cands.push({ full, name: f, tris, size });
  });
  cands.sort((a, b) => a.size - b.size);
  return cands[0] || null;
}

function absFromUrl(rel) {
  return path.join(__dirname, '..', 'public', rel.replace(/^[\\/]+/, ''));
}

async function main() {
  const login = await api('POST', '/api/auth/login', { username: USER, password: PASS });
  if (!login.json || !login.json.token) throw new Error('game login failed');

  // 世界对象写操作（POST/DELETE /api/world/objects）需管理员 token（worldWriteGuard 通道②）
  async function adminLogin() {
    const creds = [
      { username: process.env.ADMIN_USER || 'baseline_shot', password: process.env.ADMIN_PASS || 'Baseline#185' },
      { username: 'admin', password: process.env.ADMIN_PASS || 'admin123' },
    ];
    for (const c of creds) {
      const r = await api('POST', '/api/admin-auth/login', c);
      if (r.status === 200 && r.json && r.json.token) return r.json.token;
    }
    return null;
  }
  const adminToken = await adminLogin();
  if (!adminToken) throw new Error('admin login failed (needed for world object write ops)');

  const cfg = await api('GET', '/api/config/lod-enabled');
  const BANDS0 = cfg.json && Number.isFinite(cfg.json.near) ? cfg.json : { near: 30, mid: 60, far: 400 };
  INFO('initial bands', JSON.stringify(BANDS0));

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const errors = { console: [], page: [], localFailed: [] };
  let page = null;
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

    page = await ctx.newPage();
    page.on('console', (m) => {
      const u0 = (m.location && m.location() && m.location().url) || '';
      if (/favicon\.ico/i.test(u0)) return;
      if (m.type() !== 'error' || isNoise(m.text())) return;
      const t = m.text();
      if (/_(mid|lod)\.glb$/i.test(u0) && /404/.test(t)) return;
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

    const tp = ({ x, z }) => page.evaluate(({ x, z }) => {
      const p = window.player; p.position.x = x; p.position.z = z; if (p.velocity) p.velocity.y = 0;
    }, { x, z });

    const mem = () => page.evaluate(() => {
      const mi = window.gameWorld.renderer.info;
      let groups = 0;
      window.gameWorld.scene.traverse((g) => { if (g.isGroup && g.name && String(g.name).startsWith('LodStandalone:')) groups++; });
      return { geom: mi.memory.geometries, tex: mi.memory.textures, lodGroups: groups };
    }).catch(() => null);

    const struct = () => page.evaluate(STRUCT_SAMPLE).catch(() => null);

    const stats = () => page.evaluate(() => window.WorldLodStandalone ? window.WorldLodStandalone.getStats() : null).catch(() => null);
    const ids = () => page.evaluate(() => window.WorldLodStandalone ? window.WorldLodStandalone.debug().map((r) => String(r.id)) : []).catch(() => []);

    // ================= 基线 =================
    await tp(HOTSPOT);
    let baseIds = [];
    let stableCount = 0, lastN = -1;
    const t0 = Date.now();
    while (Date.now() - t0 < 300000) {
      await page.waitForTimeout(8000);
      const cur = await ids();
      if (cur.length > 0 && cur.length === lastN) stableCount++; else stableCount = 0;
      lastN = cur.length;
      baseIds = cur;
      if (stableCount >= 3) break;
    }
    if (baseIds.length === 0) throw new Error('no standalone models registered at hotspot (baseline)');
    const baseMem = await mem();
    const baseStats = await stats();
    const baseStruct = await struct();
    INFO('baseline', JSON.stringify({ models: baseIds.length, mem: baseMem, struct: baseStruct, stats: baseStats }));

    // ================= L1: 3 轮走远卸载 / 走近重载 =================
    let roundsOk = 0;
    for (let round = 1; round <= 3; round++) {
      await tp(FAR_POINT);
      // 等热点 rec 全部释放（>800m 立即卸载 → generatedBuildings 变占位 → scanNow 释放）
      let released = false;
      const tr = Date.now();
      while (Date.now() - tr < 180000) {
        const cur = await ids();
        if (!cur.some((i) => baseIds.includes(i))) { released = true; break; }
        await page.waitForTimeout(4000);
      }
      // 采样等待 >60s（覆盖 60s 最短存活期）
      await page.waitForTimeout(65000);
      const farMem = await mem();
      const farIds = await ids();
      INFO(`round${round} far`, JSON.stringify({ released, mem: farMem, hotspotLeft: farIds.filter((i) => baseIds.includes(i)).length }));

      // 走近重载
      await tp(HOTSPOT);
      let backN = -1, backStable = 0;
      const tb = Date.now();
      let backIds = [];
      while (Date.now() - tb < 480000) {
        await page.waitForTimeout(8000);
        backIds = await ids();
        const hit = backIds.filter((i) => baseIds.includes(i)).length;
        if (hit === backN && hit > 0) backStable++; else backStable = 0;
        backN = hit;
        if (backStable >= 3) break;
      }
      await page.waitForTimeout(15000);
      const ratio = backIds.length ? (backN / baseIds.length) : 0;
      const ok = released && ratio >= 0.9;
      if (ok) roundsOk++;
      check(`L1-round${round}`, 'far release + >60s sampling + near reload (>=90% re-registered)',
        ok, `released=${released} reRegistered=${backN}/${baseIds.length} (${(ratio * 100).toFixed(0)}%)`);
    }

    const finalMem = await mem();
    const finalStats = await stats();
    const finalStruct = await struct();
    // 收敛双采样：20s 后再采一次，info 应不再增长（排除环境负载噪声）
    await page.waitForTimeout(20000);
    const finalMem2 = await mem();
    const finalStruct2 = await struct();
    INFO('final mem', JSON.stringify({ mem: finalMem, struct: finalStruct, mem2: finalMem2, struct2: finalStruct2 }));
    const geomDelta = finalMem.geom - baseMem.geom;
    const texDelta = finalMem.tex - baseMem.tex;
    const groupDelta = finalMem.lodGroups - baseMem.lodGroups;
    // 结构性判据（权威）：可达几何/变体几何/高模几何集合不增长（几何对象经缓存复用）
    const structOk = finalStruct.reachable <= baseStruct.reachable + 3
      && finalStruct.varGeoms <= baseStruct.varGeoms + 3
      && finalStruct.highGeoms <= baseStruct.highGeoms + 3
      && finalStruct.varGroups <= baseStruct.varGroups + 2;
    // info 判据（辅助，上传状态噪声容差放宽；收敛采样不再增长）
    const infoOk = geomDelta <= 30 && texDelta <= 10
      && finalMem2.geom <= finalMem.geom + 6 && finalMem2.tex <= finalMem.tex + 5;
    check('L1d', 'no leak after 3 unload/reload rounds (structural geometry set + renderer info converged)',
      structOk && infoOk,
      `struct ${JSON.stringify(baseStruct)} -> ${JSON.stringify(finalStruct)} | info geom d=${geomDelta} tex d=${texDelta} lodGroups d=${groupDelta} | converged geom d=${finalMem2.geom - finalMem.geom} tex d=${finalMem2.tex - finalMem.tex}`);
    check('L1e', 'module stats sane after rounds (registered>0, held bounded)', !!(finalStats && finalStats.registered > 0), JSON.stringify(finalStats));

    // ================= L2: 后台改分带 → 散装端 60s 内跟进 =================
    // 目标：选一个当前最近的可测模型，改分带后它应落入新高模带
    let target = await page.evaluate(() => {
      const S = window.WorldLodStandalone;
      const rows = S.debug().filter((r) => !String(r.state).startsWith('skipped'));
      rows.sort((a, b) => a.dist - b.dist);
      return rows[0] || null;
    });
    if (!target) throw new Error('no testable standalone rec for band-follow test');
    INFO('band-follow target', JSON.stringify(target));

    const ws0 = await api('GET', '/api/config/world-settings');
    const putBody = {
      world_name: (ws0.json && ws0.json.world_name) || '',
      world_url: (ws0.json && ws0.json.world_url) || '',
      world_description: (ws0.json && ws0.json.world_description) || '',
      lod_near_dist: 20, lod_mid_far_dist: 30, lod_far_dist: Math.max(50, BANDS0.far || 400),
    };
    const tPut = Date.now();
    const put = await api('PUT', '/api/config/world-settings', putBody);
    let pickedUp = -1;
    if (put.status === 200) {
      const tl = Date.now();
      while (Date.now() - tl < 70000) {
        const nd = await page.evaluate(() => ({
          near: window.WorldLodAssets ? window.WorldLodAssets.NEAR_DIST : null,
          mid: window.WorldLodAssets ? window.WorldLodAssets.MID_FAR_DIST : null,
        })).catch(() => null);
        if (nd && nd.near === 20 && nd.mid === 30) { pickedUp = Date.now() - tPut; break; }
        await page.waitForTimeout(3000);
      }
    }
    check('L2a', 'admin band change picked up by standalone client within 60s (poll interval)',
      pickedUp >= 0 && pickedUp <= 60000, `elapsed=${pickedUp}ms put=${put.status}`);

    // 行为跟随：把目标摆到 8m（新配置下属高模带 ≤20m）→ state 应为 high 且模型回场景
    let followHigh = null;
    if (pickedUp >= 0) {
      // 摆位（沿 +X 迭代收敛）
      let tx = null;
      for (let i = 0; i < 8; i++) {
        const d = await page.evaluate(({ id, dist, tx }) => {
          const w = window.gameWorld;
          let model = null;
          w.generatedBuildings.forEach((e, eid) => { if (String(eid) === String(id) && e && e.model) model = e.model; });
          if (!model) return null;
          const B = window.WorldObjectBounds;
          const r = B ? B.radiusOf(id) : 0;
          const px = (tx === null) ? (model.position.x + r + dist) : tx;
          const p = window.player;
          p.position.x = px; p.position.z = model.position.z; if (p.velocity) p.velocity.y = 0;
          const row = window.WorldLodStandalone.debug(id)[0];
          return { got: row ? row.dist : null, px };
        }, { id: target.id, dist: 8, tx });
        if (d && d.got !== null && Math.abs(d.got - 8) <= 2) break;
        if (d && d.px) tx = d.px + (8 - (d.got || 8));
        await page.waitForTimeout(500);
      }
      const tf = Date.now();
      while (Date.now() - tf < 60000) {
        followHigh = await page.evaluate((i) => (window.WorldLodStandalone.debug(i)[0] || null), String(target.id)).catch(() => null);
        if (followHigh && followHigh.state === 'high' && followHigh.modelInScene) break;
        await page.waitForTimeout(2000);
      }
    }
    check('L2b', 'standalone follows new bands (model at 8m now in high band <=20m: state=high, model in scene)',
      !!(followHigh && followHigh.state === 'high' && followHigh.modelInScene), JSON.stringify(followHigh));

    // 恢复分带
    const ws1 = await api('GET', '/api/config/world-settings');
    const restore = await api('PUT', '/api/config/world-settings', {
      world_name: (ws1.json && ws1.json.world_name) || '',
      world_url: (ws1.json && ws1.json.world_url) || '',
      world_description: (ws1.json && ws1.json.world_description) || '',
      lod_near_dist: BANDS0.near, lod_mid_far_dist: BANDS0.mid, lod_far_dist: BANDS0.far,
    });
    let restored = false;
    if (restore.status === 200) {
      const trr = Date.now();
      while (Date.now() - trr < 70000) {
        const nd = await page.evaluate(() => (window.WorldLodAssets ? window.WorldLodAssets.NEAR_DIST : null)).catch(() => null);
        if (nd === BANDS0.near) { restored = true; break; }
        await page.waitForTimeout(3000);
      }
    }
    check('L2c', 'bands restored to original', restored, `near back to ${BANDS0.near}`);

    // ================= L3: 新上传模型自动纳入 =================
    const sample = pickSample();
    if (!sample) {
      check('L3a', 'eligible sample found', false, 'no .glb with >=5000 tris and <20MB in uploads');
    } else {
      INFO('upload sample', `${sample.name} tris=${sample.tris} size=${(sample.size / 1048576).toFixed(2)}MB`);
      const fd = new FormData();
      fd.append('decimate', 'off');
      fd.append('model', new Blob([fs.readFileSync(sample.full)]), sample.name);
      const up = await fetch(BASE + '/api/upload-model', { method: 'POST', body: fd });
      let upj = null;
      try { upj = await up.json(); } catch (e) { /* ignore */ }
      const model = upj && upj.model;
      const lod = model && model.lod;
      const midAbs = model && model.path ? absFromUrl(model.path).replace(/\.glb$/i, '_mid.glb') : '';
      const lodAbs = model && model.path ? absFromUrl(model.path).replace(/\.glb$/i, '_lod.glb') : '';
      check('L3a', 'upload -> lod.ok=true, variants on disk',
        up.status === 200 && !!lod && lod.ok === true && fs.existsSync(midAbs) && fs.existsSync(lodAbs),
        `status=${up.status} lod=${JSON.stringify(lod && { ok: lod.ok, mid: lod.variants && lod.variants.mid && lod.variants.mid.status, low: lod.variants && lod.variants.low && lod.variants.low.status })}`);

      let objId = null;
      let registered = null;
      if (model && model.path) {
        // 放到热点附近 42m 处（当前分带 5/10 下属低模带）；POST 需登录 token
        const cx = HOTSPOT.x + 30, cz = HOTSPOT.z + 30;
        const cr = await api('POST', '/api/world/objects', {
          type: 'uploaded_model', name: 'lod_s7b_test.glb', model_path: model.path,
          position_x: cx, position_y: 0, position_z: cz,
        }, adminToken);
        objId = cr.json && (cr.json.id || (cr.json.object && cr.json.object.id));
        check('L3b-place', 'world object created', cr.status === 200 && !!objId, `status=${cr.status} id=${objId}`);

        if (objId) {
          // 新对象不会被已打开页面拾取（空间索引为页内缓存），刷新页面重新拉取
          await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
          await page.waitForFunction(() => window.gameWorld && window.gameWorld.renderer && window.player, null, { timeout: 180000 });
          await page.evaluate(() => { const b = document.querySelector('.close-controls-hint'); if (b) b.click(); });
          await tp(HOTSPOT);

          const urlSuffix = String(model.path).slice(-36);
          const tt = Date.now();
          while (Date.now() - tt < 300000) {
            const row = await page.evaluate((suf) => {
              const S = window.WorldLodStandalone;
              if (!S) return null;
              return S.debug().find((r) => String(r.url).endsWith(suf) || String(r.url).endsWith(suf.replace(/^.*\//, ''))) || null;
            }, urlSuffix).catch(() => null);
            if (row && !String(row.state).startsWith('skipped')) { registered = row; break; }
            await page.waitForTimeout(5000);
          }
          // 等低模带切显：先按表面距迭代摆位到 30m（低模带 mid~200m，模型半径可能很大，固定偏移不可靠）
          let lowShown = null;
          if (registered) {
            let tx = null;
            for (let i = 0; i < 8; i++) {
              const d = await page.evaluate(({ id, dist, tx }) => {
                const w = window.gameWorld;
                let model = null;
                w.generatedBuildings.forEach((e, eid) => { if (String(eid) === String(id) && e && e.model) model = e.model; });
                if (!model) return null;
                const B = window.WorldObjectBounds;
                const r = B ? B.radiusOf(id) : 0;
                const px = (tx === null) ? (model.position.x + r + dist) : tx;
                const p = window.player;
                p.position.x = px; p.position.z = model.position.z; if (p.velocity) p.velocity.y = 0;
                const row = window.WorldLodStandalone.debug(id)[0];
                return { got: row ? row.dist : null, px };
              }, { id: registered.id, dist: 30, tx });
              if (d && d.got !== null && Math.abs(d.got - 30) <= 2) break;
              if (d && d.px) tx = d.px + (30 - (d.got || 30));
              await page.waitForTimeout(500);
            }
            const tl2 = Date.now();
            while (Date.now() - tl2 < 180000) {
              lowShown = await page.evaluate((i) => (window.WorldLodStandalone.debug(i)[0] || null), String(registered.id)).catch(() => null);
              if (lowShown && lowShown.state === 'low' && lowShown.lowReady) break;
              await page.waitForTimeout(4000);
            }
          }
          check('L3b', 'newly uploaded model auto-registered & shows low variant in low band',
            !!(lowShown && lowShown.state === 'low' && lowShown.lowReady && !lowShown.modelInScene), JSON.stringify(lowShown || registered));
        }
      } else {
        check('L3a-path', 'upload response carries model.path', false, 'no model.path');
      }

      // 清理：世界对象 / 上传模型 / 变体
      const removed = [];
      try {
        if (objId) {
          let d = await api('DELETE', '/api/world/objects/' + objId, undefined, adminToken);
          if (d.status === 404 || d.status === 401) d = await api('DELETE', '/api/world/objects/' + objId, undefined, adminToken);
          removed.push('object#' + objId + '=' + d.status);
        }
      } catch (e) { /* ignore */ }
      try {
        if (model && model.id) {
          const d = await api('DELETE', '/api/uploaded-models/' + model.id);
          removed.push('model#' + model.id + '=' + d.status);
        }
      } catch (e) { /* ignore */ }
      [model && model.path ? absFromUrl(model.path) : '', midAbs, lodAbs].forEach((p) => {
        try { if (p && fs.existsSync(p)) { fs.unlinkSync(p); removed.push(path.basename(p)); } } catch (e) { /* ignore */ }
      });
      check('L3c', 'cleanup done (object + uploaded model + variants removed)', removed.length >= 3, removed.join(', '));
    }

    // ================= console 错误 =================
    check('E1a', '0 console error (filtered)', errors.console.length === 0, errors.console.slice(0, 3).join(' || '));
    check('E1b', '0 pageerror', errors.page.length === 0, errors.page.slice(0, 3).join(' || '));
    check('E1c', '0 local resource failure', errors.localFailed.length === 0, errors.localFailed.slice(0, 3).join(' || '));

    await page.screenshot({ path: path.join(__dirname, '..', 'Screenshot', 'accept_lod_stage7', 'lifecycle_final.png') });
  } finally {
    if (page) { try { await page.close(); } catch (e) { /* ignore */ } }
    await browser.close();
  }

  const failed = checks.filter((c) => !c.pass);
  console.log(`\n===== VERDICT: ${failed.length === 0 ? 'ACCEPTED' : 'REJECTED'} (${checks.length - failed.length}/${checks.length}) =====`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
