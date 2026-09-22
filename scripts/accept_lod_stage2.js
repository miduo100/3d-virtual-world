/**
 * accept_lod_stage2.js — LOD 三版模型方案【阶段 2：上传管线挂钩 + 配置读写】可重跑验收脚本
 *
 * 用法：node scripts/accept_lod_stage2.js   （需先启动服务器：默认 http://localhost:3002，可用 API_BASE 覆盖）
 *
 * 判据（对应规范文档第 4 节 阶段 2）：
 *   B1 用 Node 脚本上传一个真实 GLB（fetch + FormData）→ 响应体含 lod 结果
 *   B2 磁盘出现 _mid.glb / _lod.glb
 *   B3 GET /api/config/lod-enabled 返回 { enabled: true }
 *   B4 PUT /world-settings 关闭后 GET 返回 { enabled: false }，再打开恢复 true
 *   B5 上传一个坏 GLB → 上传仍成功，lod 结果为 skipped（不阻断）
 *
 * 副作用控制：测试上传的模型与生成的变体在脚本结束时全部删除；lod_enabled 恢复原值。
 */
const fs = require('fs');
const path = require('path');

const BASE = process.env.API_BASE || 'http://localhost:3002';
const UPLOAD_DIR = path.join(__dirname, '..', 'public', 'models', 'uploaded');
const TMP_DIR = path.join(__dirname, '_tmp_lod_stage2');
const ADMIN_USER = process.env.ADMIN_USER || 'baseline_shot';
const ADMIN_PASS = process.env.ADMIN_PASS || 'Baseline#185';

const checks = [];
function check(id, title, pass, detail) {
  checks.push({ id, title, pass: !!pass, detail: detail === undefined ? '' : String(detail) });
}

async function req(method, p, body, token) {
  const opts = { method, headers: {} };
  if (token) opts.headers['Authorization'] = 'Bearer ' + token;
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const r = await fetch(BASE + p, opts);
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { /* non-json */ }
  return { status: r.status, json, text };
}

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
      if (p.index !== undefined && acc[p.index]) t += Math.floor(acc[p.index].count / 3);
      else if (p.attributes && p.attributes.POSITION !== undefined && acc[p.attributes.POSITION]) t += Math.floor(acc[p.attributes.POSITION].count / 3);
    }));
    return t;
  } catch (e) {
    return 0;
  } finally {
    if (fd !== null) { try { fs.closeSync(fd); } catch (_) { /* ignore */ } }
  }
}

function pickSample() {
  const files = fs.readdirSync(UPLOAD_DIR).filter((f) => /\.glb$/i.test(f) && !/_(mid|lod|dec)\.glb$/i.test(f) && !/\.tmp\.glb$/i.test(f));
  const cands = [];
  files.forEach((f) => {
    const full = path.join(UPLOAD_DIR, f);
    let size = 0;
    try { size = fs.statSync(full).size; } catch (_) { return; }
    if (size > 20 * 1024 * 1024) return; // 控制上传耗时
    const tris = readTris(full);
    if (tris >= 5000) cands.push({ full, name: f, tris, size });
  });
  cands.sort((a, b) => a.size - b.size);
  return cands[0] || null;
}

function buildCorruptGlb() {
  const buf = Buffer.alloc(128, 0);
  buf.write('glTF', 0, 'ascii');
  buf.writeUInt32LE(2, 4);
  buf.writeUInt32LE(128, 8);
  buf.writeUInt32LE(0x7ffffff0, 12); // 荒谬的 JSON chunk 长度
  return buf;
}

async function uploadModel(absPath, filename) {
  const buf = fs.readFileSync(absPath);
  const fd = new FormData();
  fd.append('decimate', 'off'); // 关掉减面，避免引入 _dec.glb 干扰路径断言
  fd.append('model', new Blob([buf]), filename);
  const r = await fetch(BASE + '/api/upload-model', { method: 'POST', body: fd });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { /* non-json */ }
  return { status: r.status, json, text };
}

/** 相对 URL（/models/uploaded/x.glb）→ 绝对路径 */
function absFromUrl(rel) {
  return path.join(__dirname, '..', 'public', rel.replace(/^[\\/]+/, ''));
}

const created = []; // { id, relPath }

async function cleanupCreated() {
  const removed = [];
  for (const item of created) {
    try {
      if (item.id) await fetch(BASE + '/api/uploaded-models/' + item.id, { method: 'DELETE' });
    } catch (e) { /* ignore */ }
    const abs = absFromUrl(item.relPath);
    [abs, abs.replace(/\.glb$/i, '_mid.glb'), abs.replace(/\.glb$/i, '_lod.glb')].forEach((p) => {
      try { if (fs.existsSync(p)) { fs.unlinkSync(p); removed.push(path.basename(p)); } } catch (e) { /* ignore */ }
    });
  }
  return removed;
}

(async () => {
  console.log('=== LOD Stage 2 Acceptance ===');
  console.log('API base:', BASE);
  let originalLod = null;
  let adminToken = '';

  try {
    // ---------- 前置：服务可达 ----------
    let boot = null;
    try { boot = await req('GET', '/api/config/lod-enabled'); } catch (e) { boot = null; }
    if (!boot || boot.status !== 200 || !boot.json) {
      check('FATAL', 'server reachable', false, 'API 不可达，请先启动服务器（node src/server.js）后重跑');
      throw new Error('server unreachable');
    }
    console.log('lod-enabled (initial):', boot.status, JSON.stringify(boot.json));

    // ---------- 管理员登录（2026-09-22 起 config.js 写接口需管理员 token） ----------
    const adminLoginRes = await req('POST', '/api/admin-auth/login', { username: ADMIN_USER, password: ADMIN_PASS });
    adminToken = (adminLoginRes.json && adminLoginRes.json.token) || '';
    if (!adminToken) {
      check('FATAL', 'admin login', false, `status=${adminLoginRes.status}`);
      throw new Error('admin login failed');
    }
    console.log('admin login ok');

    // 记录当前开关，便于收尾恢复
    const ws0 = await req('GET', '/api/config/world-settings');
    originalLod = !!(ws0.json && ws0.json.lod_enabled);
    console.log('world-settings (initial):', ws0.status, JSON.stringify(ws0.json));

    // ---------- B3 公开接口结构 ----------
    check('B3', 'GET /api/config/lod-enabled returns {enabled:boolean}',
      boot.status === 200 && boot.json && typeof boot.json.enabled === 'boolean',
      `status=${boot.status} body=${JSON.stringify(boot.json)}`);

    // ---------- B4 开关读写 ----------
    const needName = (ws0.json && ws0.json.world_name) || '';
    const needUrl = (ws0.json && ws0.json.world_url) || '';
    if (!needName || !needUrl) {
      check('B4', 'world-settings has world_name/world_url for PUT', false, `name="${needName}" url="${needUrl}"`);
    } else {
      const putOff = await req('PUT', '/api/config/world-settings',
        { world_name: needName, world_url: needUrl, world_description: (ws0.json.world_description || ''), lod_enabled: false }, adminToken);
      const getOff = await req('GET', '/api/config/lod-enabled');
      const getOffWs = await req('GET', '/api/config/world-settings');
      check('B4', 'PUT lod_enabled=false -> GET /lod-enabled {enabled:false}',
        putOff.status === 200 && putOff.json && putOff.json.success === true
        && getOff.json && getOff.json.enabled === false && getOffWs.json && getOffWs.json.lod_enabled === false,
        `put=${putOff.status} lodEnabled=${JSON.stringify(getOff.json)} worldSettings.lod_enabled=${getOffWs.json && getOffWs.json.lod_enabled}`);

      const putOn = await req('PUT', '/api/config/world-settings',
        { world_name: needName, world_url: needUrl, world_description: (ws0.json.world_description || ''), lod_enabled: true }, adminToken);
      const getOn = await req('GET', '/api/config/lod-enabled');
      check('B3', 'after PUT true -> GET /lod-enabled {enabled:true}',
        putOn.status === 200 && putOn.json && putOn.json.success === true && getOn.json && getOn.json.enabled === true,
        `put=${putOn.status} body=${JSON.stringify(getOn.json)}`);

      // 非法值应当被拒绝（不写库）
      const putBad = await req('PUT', '/api/config/world-settings',
        { world_name: needName, world_url: needUrl, lod_enabled: 'maybe' }, adminToken);
      const getAfterBad = await req('GET', '/api/config/lod-enabled');
      check('B4', 'invalid lod_enabled rejected (400) and state unchanged',
        putBad.status === 400 && getAfterBad.json && getAfterBad.json.enabled === true,
        `status=${putBad.status} enabled=${getAfterBad.json && getAfterBad.json.enabled}`);
    }

    // ---------- B1 真实模型上传 ----------
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
    fs.mkdirSync(TMP_DIR, { recursive: true });
    const sample = pickSample();
    if (!sample) {
      check('B1', 'eligible sample found', false, 'no .glb with >=5000 tris and <20MB in uploads');
    } else {
      console.log(`\nupload sample: ${sample.name} (tris=${sample.tris}, ${(sample.size / 1048576).toFixed(2)}MB)`);
      const t0 = Date.now();
      const up = await uploadModel(sample.full, sample.name);
      const ms = Date.now() - t0;
      const model = up.json && up.json.model;
      const lodRes = model && model.lod;
      check('B1', 'upload returns lod result in response body',
        up.status === 200 && up.json && up.json.success === true && !!lodRes,
        `status=${up.status} success=${up.json && up.json.success} lod=${JSON.stringify(lodRes)} ${ms}ms`);
      check('B1', 'lod.ok === true (mid/low generated)',
        !!lodRes && lodRes.ok === true && lodRes.variants && lodRes.variants.mid && lodRes.variants.low
        && ['generated', 'exists'].includes(lodRes.variants.mid.status)
        && ['generated', 'exists'].includes(lodRes.variants.low.status),
        lodRes ? `mid=${lodRes.variants && lodRes.variants.mid && lodRes.variants.mid.status} low=${lodRes.variants && lodRes.variants.low && lodRes.variants.low.status}` : 'no lod');

      if (model && model.path) {
        created.push({ id: model.id, relPath: model.path });
        const abs = absFromUrl(model.path);
        const midAbs = abs.replace(/\.glb$/i, '_mid.glb');
        const lodAbs = abs.replace(/\.glb$/i, '_lod.glb');
        check('B2', 'disk has _mid.glb and _lod.glb',
          fs.existsSync(midAbs) && fs.existsSync(lodAbs),
          `mid=${fs.existsSync(midAbs)} low=${fs.existsSync(lodAbs)} path=${model.path}`);
        if (fs.existsSync(midAbs) && fs.existsSync(lodAbs)) {
          const st = readTris(abs);
          const mt = readTris(midAbs);
          const lt = readTris(lodAbs);
          console.log(`  tris: src=${st} mid=${mt}(${(mt / st * 100).toFixed(1)}%) low=${lt}(${(lt / st * 100).toFixed(1)}%)`);
          check('B2', 'variants smaller than source (mid<=40%, low<mid)',
            mt > 0 && mt <= st * 0.4 && lt > 0 && lt < mt, `src=${st} mid=${mt} low=${lt}`);
        }
      } else {
        check('B2', 'response carries model.path', false, 'no model.path');
      }
    }

    // ---------- B5 坏 GLB 不阻断 ----------
    const corruptPath = path.join(TMP_DIR, 'corrupt_lod_test.glb');
    fs.writeFileSync(corruptPath, buildCorruptGlb());
    const bad = await uploadModel(corruptPath, 'corrupt_lod_test.glb');
    const badModel = bad.json && bad.json.model;
    const badLod = badModel && badModel.lod;
    check('B5', 'corrupt glb upload still succeeds',
      bad.status === 200 && bad.json && bad.json.success === true,
      `status=${bad.status} success=${bad.json && bad.json.success} body=${String(bad.text).slice(0, 160)}`);
    check('B5', 'corrupt glb lod result is skipped (not blocking)',
      !!badLod && badLod.skipped === true && badLod.reason === 'not-glb-or-empty',
      `lod=${JSON.stringify(badLod)}`);
    if (badModel && badModel.id) {
      created.push({ id: badModel.id, relPath: badModel.path });
    }

    // ---------- INFO 批量上传端点同样挂钩（本阶段改动文件含批量端点） ----------
    if (sample) {
      const bfd = new FormData();
      bfd.append('decimate', 'off');
      bfd.append('models', new Blob([fs.readFileSync(sample.full)]), sample.name);
      bfd.append('models', new Blob([buildCorruptGlb()]), 'corrupt_batch_lod.glb');
      const br = await fetch(BASE + '/api/upload-models-batch', { method: 'POST', body: bfd });
      let bj = null;
      try { bj = await br.json(); } catch (e) { /* ignore */ }
      const items = (bj && bj.results) || [];
      items.forEach((x) => { if (x.model && x.model.path) created.push({ id: x.model.id, relPath: x.model.path }); });
      const goodItem = items.find((x) => !/corrupt/i.test(x.fileName));
      const badItem = items.find((x) => /corrupt/i.test(x.fileName));
      console.log(`\nbatch upload: status=${br.status} success=${items.length} lod(good)=${JSON.stringify(goodItem && goodItem.lod && { ok: goodItem.lod.ok, mid: goodItem.lod.variants && goodItem.lod.variants.mid && goodItem.lod.variants.mid.status })} lod(bad)=${JSON.stringify(badItem && badItem.lod && { skipped: badItem.lod.skipped, reason: badItem.lod.reason })}`);
      check('INFO', 'batch endpoint returns lod per file (good=ok, corrupt=skipped)',
        br.status === 200 && !!goodItem && !!goodItem.lod && goodItem.lod.ok === true
        && !!badItem && !!badItem.lod && badItem.lod.skipped === true,
        `status=${br.status} items=${items.length}`);
    }
  } catch (e) {
    if (e.message !== 'server unreachable') check('FATAL', 'acceptance run', false, e.message);
  } finally {
    // ---------- 收尾：删测试模型与变体、恢复开关 ----------
    try {
      const removed = await cleanupCreated();
      console.log('\ncleanup: removed', removed.length ? removed.join(', ') : 'nothing');
    } catch (e) { console.log('cleanup error:', e.message); }
    try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch (e) { /* ignore */ }
    if (originalLod !== null) {
      try {
        const ws = await req('GET', '/api/config/world-settings');
        if (ws.json && ws.json.world_name && ws.json.world_url && ws.json.lod_enabled !== originalLod) {
          await req('PUT', '/api/config/world-settings', {
            world_name: ws.json.world_name, world_url: ws.json.world_url,
            world_description: ws.json.world_description || '', lod_enabled: originalLod,
          }, adminToken);
          console.log('restored lod_enabled =', originalLod);
        }
      } catch (e) { console.log('restore lod_enabled failed:', e.message); }
    }
  }

  console.log('\n=== Results ===');
  checks.forEach((c) => console.log(`${c.pass ? 'PASS' : 'FAIL'} [${c.id}] ${c.title} -- ${c.detail}`));
  const failed = checks.filter((c) => !c.pass && c.id !== 'INFO');
  console.log(`\nSUMMARY: ${checks.length - checks.filter((c) => !c.pass).length}/${checks.length} passed, failed=${failed.length}`);
  console.log(failed.length === 0 ? 'VERDICT: ACCEPTED' : 'VERDICT: REJECTED');
  process.exit(failed.length === 0 ? 0 : 1);
})();
