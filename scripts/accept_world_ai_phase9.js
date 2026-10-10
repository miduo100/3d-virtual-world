/**
 * accept_world_ai_phase9 —— Phase 9 验收（判据 P8-1 ~ P8-8）
 * AI World Brain · Phase 9 · gen3d 接真实 3D 生成服务（Tripo）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 运行（三段式，烧钱纪律：真实调用全程 ≤2 次）：
 *   node scripts/accept_world_ai_phase9.js                → A 组（stub 免费判据：P8-1/4/6/7）
 *   node scripts/accept_world_ai_phase9.js --stage1       → 真实提交 1 个最小任务（P8-2），落表即退出
 *   node scripts/accept_world_ai_phase9.js --stage2 [--job <id>] [--interval-s 30] [--timeout-min 20]
 *                                                         → 真实轮询→下载→校验→落库→放置（P8-3/5/6）
 * 纪律：
 *   ①幂等键固定 'p9_real'：stage1 FATAL 重跑绝不重复提交（deduped 直接打印既有 jobId）；
 *   ②stub 桩不删（P7-7/P7-8 判据由 phase8 回归兜底 + 本脚本 P8-6 stub 链）；
 *   ③测试数据 accept_p9 前缀；清理每条 SQL 独立 try/catch；
 *   ④stage2 成功产物：placed world_objects 清理，uploaded_models 行 + GLB 保留（真钱产物）；
 *   ⑤诚实优先：欠费/审核拒绝 → 可读中文诊断 + 判 FAIL（绝不伪装成功）。
 */
'use strict';

process.env.WORLD_AI_GEN3D_STUB = '1';

const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const BASE = process.env.ACCEPT_BASE || 'http://127.0.0.1:3002';
const ADMIN = { username: 'baseline_shot', password: 'Baseline#185' };
const P = 'accept_p9';
const R_KEY = P + '_region';
const IDEM_KEY = 'p9_real';

const args = process.argv.slice(2);
const STAGE1 = args.includes('--stage1');
const STAGE2 = args.includes('--stage2');
function argVal(name, dflt) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
}

let pass = 0, fail = 0;
const fails = [];
function log(name, ok, note) {
  if (ok) { pass++; console.log('PASS  ' + name + (note ? '  —— ' + note : '')); }
  else { fail++; fails.push(name); console.log('FAIL  ' + name + (note ? '  —— ' + note : '')); }
}
function FATAL(msg) { console.log('FATAL ' + msg); finish(); return false; }

let T = null, W = null;

const { query, pool } = require('../src/database/db');
const configService = require('../src/services/configService');
const gen3dService = require('../src/worldai/builder/gen3dService');
const gen3dTools = require('../src/worldai/tools/gen3dTools');
const tripoProvider = require('../src/worldai/builder/gen3dTripoProvider');
const longTermMission = require('../src/worldai/missions/longTermMission');

const snap = {};
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function api(p, opts) {
  const o = opts || {};
  const headers = Object.assign({ 'Content-Type': 'application/json' }, o.headers || {});
  if (o.token) headers['Authorization'] = 'Bearer ' + o.token;
  else if (T && !o.noAuth) headers['Authorization'] = 'Bearer ' + T;
  const r = await fetch(BASE + p, {
    method: o.method || 'GET', headers,
    body: o.body !== undefined ? JSON.stringify(o.body) : undefined,
  });
  let j = null; try { j = await r.json(); } catch (e) { /* 空 body */ }
  return { status: r.status, j: j || {} };
}

async function cleanup() {
  const sqls = [
    [`DELETE FROM ai_call_log WHERE caller = 'accept_p9_budget'`, []],
    [`DELETE FROM world_gen3d_jobs WHERE prompt LIKE $1 OR idempotency_key = $2`, [P + '%', IDEM_KEY]],
    [`DELETE FROM world_objects WHERE name LIKE $1`, [P + '%']],
    [`DELETE FROM world_tool_executions WHERE actor LIKE $1 OR params::text LIKE $2`, [P + '%', '%' + P + '%']],
    [`DELETE FROM world_events WHERE actor_id LIKE $1 OR target_id = $2`, [P + '%', R_KEY]],
    [`DELETE FROM world_regions WHERE region_key = $1`, [R_KEY]],
  ];
  for (const [sql, params] of sqls) {
    try { await query(sql, params); } catch (e) { console.log('  (cleanup warn) ' + e.message); }
  }
  // 注意：uploaded_models 行与 public/models/uploaded/gen3d-*/ 产物**刻意保留**（真钱产物，见文件头④）
}

async function restore() {
  try {
    if (snap.gen3dEnabled !== undefined) {
      await configService.setConfig('world_ai_gen3d_enabled', snap.gen3dEnabled === null ? '' : String(snap.gen3dEnabled));
    }
    if (snap.gen3dProvider !== undefined) {
      await configService.setConfig('world_ai_gen3d_provider', snap.gen3dProvider === null ? '' : String(snap.gen3dProvider));
    }
    if (T && snap.autonomy) await api('/api/world-ai/config', { method: 'PUT', body: { autonomy: snap.autonomy } });
  } catch (e) { console.log('  (restore warn) ' + e.message); }
}

function finish() {
  const done = () => {
    console.log('\n===== Phase 9 验收结果：' + pass + ' PASS / ' + fail + ' FAIL =====');
    if (fails.length) console.log('失败项：' + fails.join(' | '));
    console.log(fail === 0 ? 'VERDICT ACCEPTED' : 'VERDICT FAILED');
    try { pool.end().then(() => process.exit(fail ? 1 : 0)); } catch (e) { process.exit(fail ? 1 : 0); }
    setTimeout(() => process.exit(fail ? 1 : 0), 1500);
  };
  restore().then(() => cleanup()).then(done).catch(done);
}

async function countObjects() {
  const r = await query(`SELECT count(1)::int AS c FROM world_objects`);
  return Number(r.rows[0].c);
}
async function countGen3dLog() {
  const r = await query(`SELECT count(1)::int AS c FROM ai_call_log WHERE purpose='gen3d'`);
  return Number(r.rows[0].c);
}

// ── 构造测试 GLB（P8-4 用，不烧钱）────────────────────────────────────
function buildGlb(indicesCount, posCount, withIndices) {
  const prims = [{ attributes: { POSITION: withIndices ? 1 : 0 }, mode: 4 }];
  const accessors = [{ bufferView: 1, componentType: 5126, count: posCount, type: 'VEC3' }];
  const bufferViews = [{ buffer: 0, byteOffset: 0, byteLength: 0 }, { buffer: 0, byteOffset: 0, byteLength: posCount * 12 }];
  if (withIndices) {
    prims[0].indices = 0;
    accessors.unshift({ bufferView: 0, componentType: 5125, count: indicesCount, type: 'SCALAR' });
    bufferViews[0].byteLength = indicesCount * 4;
    bufferViews[1].byteOffset = indicesCount * 4;
  }
  const binLen = indicesCount * 4 + posCount * 12;
  const gltf = {
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: prims }], accessors, bufferViews, buffers: [{ byteLength: binLen }],
  };
  const jsonBuf = Buffer.from(JSON.stringify(gltf), 'utf8');
  const jsonPad = (4 - (jsonBuf.length % 4)) % 4;
  const jsonPadded = Buffer.concat([jsonBuf, Buffer.alloc(jsonPad, 0x20)]);
  const bin = Buffer.alloc(binLen);
  const binPad = (4 - (bin.length % 4)) % 4;
  const binPadded = Buffer.concat([bin, Buffer.alloc(binPad)]);
  const total = 12 + 8 + jsonPadded.length + 8 + binPadded.length;
  const out = Buffer.alloc(total);
  out.writeUInt32LE(0x46546c67, 0); out.writeUInt32LE(2, 4); out.writeUInt32LE(total, 8);
  out.writeUInt32LE(jsonPadded.length, 12); out.writeUInt32LE(0x4e4f534a, 16);
  jsonPadded.copy(out, 20);
  const binOff = 20 + jsonPadded.length;
  out.writeUInt32LE(binPadded.length, binOff); out.writeUInt32LE(0x004e4942, binOff + 4);
  binPadded.copy(out, binOff + 8);
  return out;
}

// ══════════════════ A 组（stub 免费判据）════════════════════════════
async function suiteA() {
  console.log('=== Phase 9 · A 组（stub 免费判据：P8-1 / P8-4 / P8-6 / P8-7）===');

  const login = await api('/api/admin-auth/login', { method: 'POST', body: ADMIN, noAuth: true });
  if (!login.j || !login.j.token) return FATAL('管理员登录失败：' + JSON.stringify(login.j).slice(0, 200));
  T = login.j.token;
  const cfg0 = await api('/api/world-ai/config');
  const c0 = (cfg0.j && cfg0.j.config) || cfg0.j || {};
  snap.autonomy = c0.autonomy;
  snap.gen3dEnabled = await configService.getConfig('world_ai_gen3d_enabled');
  snap.gen3dProvider = await configService.getConfig('world_ai_gen3d_provider');
  const wk = await api('/.well-known/virtual-world-agent.json', { noAuth: true });
  W = (wk.j && wk.j.world && wk.j.world.id) || c0.world_id || c0.worldId;
  console.log('  world=' + W + ' autonomy=' + snap.autonomy);

  // ── P8-1 availability() 判定改真 ────────────────────────────────
  await configService.setConfig('world_ai_gen3d_enabled', 'false');
  const plan1 = await gen3dTools.planGen3d({ assembly: 'gen3d', prompt: P + ' house' });
  log('P8-1a enabled=false → planGen3d GEN3D_DISABLED（回归 P7-7 口径）',
    plan1.ok === false && plan1.code === 'GEN3D_DISABLED' && Array.isArray(plan1.suggest) && plan1.suggest.length === 2,
    'code=' + plan1.code);
  const av1 = await gen3dTools.availability();
  log('P8-1a availability: enabled=false → wired=false + note 可读',
    av1.enabled === false && av1.wired === false && /composite|procedural/.test(av1.note || ''), 'note=' + (av1.note || '').slice(0, 60));

  await configService.setConfig('world_ai_gen3d_enabled', 'true');
  await configService.setConfig('world_ai_gen3d_provider', 'tripo');
  const av2 = await gen3dTools.availability();
  log('P8-1b enabled+tripo 无密钥 → wired=false + note 指出 TRIPO_API_KEY',
    av2.enabled === true && av2.wired === false && /TRIPO_API_KEY/.test(av2.note || ''), 'note=' + (av2.note || '').slice(0, 80));

  await configService.setConfig('world_ai_gen3d_provider', 'stub');
  const av3 = await gen3dTools.availability();
  log('P8-1c enabled+stub（env 已开）→ wired=true',
    av3.enabled === true && av3.wired === true, 'provider=' + av3.provider);

  // ── P8-4 真文件校验器（构造 GLB，不烧钱）────────────────────────
  const tiny = buildGlb(30, 9, true);
  const tinyStats = tripoProvider.parseGlbStats(tiny);
  log('P8-4a GLB 实解析面数 = indices/3（30 索引 → 10 面）',
    tinyStats.ok === true && tinyStats.triangles === 10 && tinyStats.meshes === 1,
    'tris=' + tinyStats.triangles + ' meshes=' + tinyStats.meshes);

  const noIdx = buildGlb(0, 9, false);
  const noIdxStats = tripoProvider.parseGlbStats(noIdx);
  log('P8-4a 无索引退化 POSITION/3（9 顶点 → 3 面）',
    noIdxStats.ok === true && noIdxStats.triangles === 3, 'tris=' + noIdxStats.triangles);

  const tmpDir = path.join(__dirname, '_tmp_p9');
  try { fs.mkdirSync(tmpDir, { recursive: true }); } catch (e) { /* ignore */ }
  const tinyPath = path.join(tmpDir, 'tiny.glb');
  fs.writeFileSync(tinyPath, tiny);
  const vf = await tripoProvider.validateRealFile(tinyPath);
  log('P8-4a validateRealFile（文件口径）：体积 = 字节数',
    vf.ok === true && vf.stats.fileSizeBytes === tiny.length && vf.stats.triangles === 10,
    'bytes=' + vf.stats.fileSizeBytes + ' tris=' + vf.stats.triangles);

  const huge = buildGlb(600000, 3, true);
  const hugeStats = tripoProvider.parseGlbStats(huge);
  const hugeVal = gen3dService.validateModel({ url: 'x.glb', triangles: hugeStats.triangles, fileSizeBytes: huge.length });
  log('P8-4b 超限 GLB（200k 面 > 60k）→ validateModel DENY',
    hugeStats.triangles === 200000 && hugeVal.ok === false && hugeVal.code === 'ASSET_VALIDATOR_DENY',
    'tris=' + hugeStats.triangles + ' code=' + hugeVal.code);
  const bigBytes = gen3dService.validateModel({ url: 'x.glb', triangles: 10, fileSizeBytes: 50 * 1024 * 1024 + 1 });
  log('P8-4b 超限体积（>50MB）→ DENY', bigBytes.ok === false && bigBytes.code === 'ASSET_VALIDATOR_DENY', 'code=' + bigBytes.code);

  // ── P8-6 stub place 链（复用 Phase 8 P7-8 口径，保回归不退化）────
  await api('/api/world-ai/config', { method: 'PUT', body: { autonomy: 'semi_autonomous' } });
  await query(
    `INSERT INTO world_regions (region_key, world_id, name, bounds, autonomy, status, origin, created_by)
     VALUES ($1,$2,$3,$4::jsonb,'semi_autonomous','active','ai',$5)
     ON CONFLICT (region_key) DO UPDATE SET bounds=EXCLUDED.bounds`,
    [R_KEY, W, P + ' 测试区', JSON.stringify({ kind: 'rect', minX: 900, maxX: 940, minZ: 900, maxZ: 940 }), P]);

  const logBefore = await countGen3dLog();
  const jOk = await gen3dService.submitJob({
    worldId: W, prompt: P + '_stub_ok', spec: { assembly: 'gen3d' },
    params: { stub: { triangles: 1200, fileSizeBytes: 1024 } }, createdBy: P, idempotencyKey: P + '_stub_ok',
  });
  if (!jOk.ok) return FATAL('stub 提交失败：' + JSON.stringify(jOk).slice(0, 200));
  const pOk = await gen3dService.pollJob(jOk.jobId);
  const before = await countObjects();
  const placed = await gen3dService.place({ jobId: jOk.jobId, x: 920, z: 920, regionKey: R_KEY, name: P + '_stub_placed' },
    { worldId: W, regionKey: R_KEY });
  const after = await countObjects();
  log('P8-6 stub 正常产物 place 走 executor（world_objects +1）',
    pOk.status === 'succeeded' && placed.ok === true && after === before + 1,
    'ok=' + placed.ok + ' code=' + placed.code + ' objects ' + before + '→' + after);

  const logAfterStub = await countGen3dLog();
  log('P8-7 stub 零花费：不写 ai_call_log（purpose=gen3d 行数不变）',
    logAfterStub === logBefore, logBefore + ' → ' + logAfterStub);

  const jHeavy = await gen3dService.submitJob({
    worldId: W, prompt: P + '_stub_heavy', spec: { assembly: 'gen3d' },
    params: { stub: { triangles: 200000, fileSizeBytes: 1024 } }, createdBy: P, idempotencyKey: P + '_stub_heavy',
  });
  const pHeavy = await gen3dService.pollJob(jHeavy.jobId);
  const afterHeavy = await countObjects();
  const placeHeavy = await gen3dService.place({ jobId: jHeavy.jobId, x: 930, z: 930, regionKey: R_KEY }, { worldId: W, regionKey: R_KEY });
  log('P8-6 超阈值 stub 产物：poll DENY + place 拒（world_objects 不变）',
    pHeavy.status === 'failed' && pHeavy.code === 'ASSET_VALIDATOR_DENY' && placeHeavy.ok === false && afterHeavy === after,
    'status=' + pHeavy.status + ' place=' + placeHeavy.code);

  // ── P8-7 预算：limits.gen3d 达上限 → budget_exhausted ────────────
  await query(`INSERT INTO ai_call_log (purpose, provider_name, caller, ok, total_tokens)
               VALUES ('gen3d','tripo','accept_p9_budget',true,0)`);
  const usage = await longTermMission.getMonthlyUsage(W);
  log('P8-7a getMonthlyUsage 聚含 gen3d（purpose=gen3d 当月次数）',
    Number.isFinite(usage.gen3d) && usage.gen3d >= 1, 'usage.gen3d=' + usage.gen3d);
  const fakeMission = { world_id: W, monthly_budget: { limits: { gen3d: usage.gen3d } } };
  const over = await longTermMission.checkMonthlyBudget(fakeMission);
  log('P8-7b limits.gen3d 达上限 → checkMonthlyBudget ok=false + over 含 gen3d',
    over.ok === false && (over.over || []).some((s) => /^gen3d /.test(s)),
    'over=' + (over.over || []).join(';'));
  const under = await longTermMission.checkMonthlyBudget({ world_id: W, monthly_budget: { limits: { gen3d: usage.gen3d + 1 } } });
  log('P8-7c 未达上限 → ok=true', under.ok === true, 'limits=' + (usage.gen3d + 1) + ' usage=' + usage.gen3d);
  const dl = longTermMission.DEFAULT_LIMITS;
  log('P8-7d DEFAULT_LIMITS 含 gen3d 默认 5', dl.gen3d === 5, 'gen3d=' + dl.gen3d);
}

// ══════════════════ Stage 1（真实提交 1 次）════════════════════════
async function stage1() {
  console.log('=== Phase 9 · Stage 1（真实提交最小任务 · P8-2）===');
  const wired = await tripoProvider.checkWired();
  if (!wired.wired) { console.log('FATAL ' + wired.reason + '（未烧钱，安全退出）'); process.exit(2); }

  const login = await api('/api/admin-auth/login', { method: 'POST', body: ADMIN, noAuth: true });
  if (!login.j || !login.j.token) return FATAL('管理员登录失败');
  T = login.j.token;
  snap.gen3dEnabled = await configService.getConfig('world_ai_gen3d_enabled');
  snap.gen3dProvider = await configService.getConfig('world_ai_gen3d_provider');
  const wk = await api('/.well-known/virtual-world-agent.json', { noAuth: true });
  W = (wk.j && wk.j.world && wk.j.world.id) || '';
  await configService.setConfig('world_ai_gen3d_enabled', 'true');
  await configService.setConfig('world_ai_gen3d_provider', 'tripo');

  const logBefore = await countGen3dLog();
  const sub = await gen3dService.submitJob({
    worldId: W,
    prompt: P + ' real: a simple wooden crate, low poly game asset',
    spec: { assembly: 'gen3d', buildingType: 'crate' },
    params: { mode: 'preview' },
    provider: 'tripo', createdBy: P, idempotencyKey: IDEM_KEY,
  });
  if (sub.deduped) {
    console.log('  幂等命中：本任务已存在（jobId=' + sub.jobId + ' status=' + sub.status + '），不重复提交');
    log('P8-2 幂等键固定：重跑不重复提交', true, 'jobId=' + sub.jobId);
    return;
  }
  if (!sub.ok) {
    console.log('FATAL 真实提交失败（外部状态，诚实报告）：' + (sub.code || '') + ' ' + (sub.reason || ''));
    log('P8-2 真实提交成功', false, (sub.code || '') + ' ' + (sub.reason || '').slice(0, 120));
    return;
  }
  const job = await gen3dService.getJob(sub.jobId);
  log('P8-2a 真实提交 → provider_task_id 落表 status=running',
    job && job.status === 'running' && job.provider === 'tripo' && !!job.provider_task_id,
    'jobId=' + sub.jobId + ' task=' + (job && job.provider_task_id));
  const logAfter = await countGen3dLog();
  const lastLog = await query(`SELECT ok, provider_name, error_code, error_message FROM ai_call_log
    WHERE purpose='gen3d' ORDER BY created_at DESC LIMIT 1`);
  const lg = lastLog.rows[0] || {};
  log('P8-2b 费用可见：ai_call_log 落一笔 purpose=gen3d（tokens=0）',
    logAfter === logBefore + 1 && lg.ok === true && lg.provider_name === 'tripo',
    'rows ' + logBefore + '→' + logAfter);
  console.log('\n  >>> jobId = ' + sub.jobId);
  console.log('  >>> 几分钟后运行：node scripts/accept_world_ai_phase9.js --stage2 --job ' + sub.jobId);
}

// ══════════════════ Stage 2（真实轮询 → 全链）══════════════════════
async function stage2() {
  console.log('=== Phase 9 · Stage 2（真实轮询→下载→校验→落库→放置 · P8-3/5/6）===');
  const jobArg = argVal('--job', null);
  const intervalS = Math.max(30, parseInt(argVal('--interval-s', '30'), 10) || 30);
  const timeoutMin = Math.max(2, parseInt(argVal('--timeout-min', '20'), 10) || 20);

  let job = null;
  if (jobArg) job = await gen3dService.getJob(jobArg);
  else {
    const r = await query(
      `SELECT id FROM world_gen3d_jobs WHERE provider='tripo' AND idempotency_key=$1 ORDER BY created_at DESC LIMIT 1`,
      [IDEM_KEY]);
    if (r.rows.length) job = await gen3dService.getJob(r.rows[0].id);
  }
  if (!job) return FATAL('未找到 stage1 的真实任务 —— 先运行 --stage1');
  if (job.provider !== 'tripo') return FATAL('任务 provider=' + job.provider + '，本段只处理 tripo');
  console.log('  jobId=' + job.id + ' status=' + job.status + ' task=' + job.provider_task_id);

  const login = await api('/api/admin-auth/login', { method: 'POST', body: ADMIN, noAuth: true });
  if (!login.j || !login.j.token) return FATAL('管理员登录失败');
  T = login.j.token;
  const cfg0 = await api('/api/world-ai/config');
  snap.autonomy = ((cfg0.j && cfg0.j.config) || {}).autonomy;
  const wk = await api('/.well-known/virtual-world-agent.json', { noAuth: true });
  W = (wk.j && wk.j.world && wk.j.world.id) || '';
  await api('/api/world-ai/config', { method: 'PUT', body: { autonomy: 'semi_autonomous' } });

  // ── 轮询（≤1 次/intervalS；succeeded/failed 终态退出）───────────
  const startedAt = Date.now();
  let last = null;
  while (true) {
    last = await gen3dService.pollJob(job.id);
    console.log('  [' + Math.round((Date.now() - startedAt) / 1000) + 's] poll → ' +
      (last.ok ? last.status : (last.code || 'POLL_ERR')) +
      (last.ok && last.status === 'succeeded' ? ' tris=' + (last.model && last.model.triangles) : ''));
    if (last.ok && (last.status === 'succeeded' || last.status === 'failed')) break;
    if (!last.ok && last.code === 'JOB_NOT_FOUND') break;
    if ((Date.now() - startedAt) / 60000 > timeoutMin) {
      log('P8-3 真实轮询到终态', false, '超时 ' + timeoutMin + ' 分钟仍 status=' + (last.status || job.status) + '（外部生成未完成，稍后重跑本段）');
      return;
    }
    await sleep(intervalS * 1000);
  }

  if (last.status === 'failed') {
    const j2 = await gen3dService.getJob(job.id);
    log('P8-3 失败分支：last_error 可读中文诊断', !!j2.error && j2.error.length > 4,
      'error=' + String(j2.error || '').slice(0, 160));
    log('P8-5 产物落 uploaded_models（生成失败，无法验收）', false, '外部生成失败：' + String(j2.error || '').slice(0, 100));
    log('P8-6 真实产物 place 走 executor（生成失败，无法验收）', false, '依赖 P8-5');
    return;
  }

  // ── succeeded：校验 → 落库 → GET 200 → place ────────────────────
  const model = last.model || {};
  log('P8-3 succeeded：model.url 为本地 /models/uploaded/ 路径',
    /^\/models\/uploaded\/gen3d-[0-9a-f-]+\/model\.glb$/.test(model.url || ''), 'url=' + model.url);

  const absPath = path.join(__dirname, '..', 'public', model.url);
  const v = await tripoProvider.validateRealFile(absPath);
  log('P8-4 真产物实解析：面数/体积统计成功且 ≤ 阈值（60k 面 / 50MB）',
    v.ok === true && v.stats.triangles <= gen3dService.MAX_MODEL_TRIS && v.stats.fileSizeBytes <= gen3dService.MAX_MODEL_BYTES,
    'tris=' + (v.stats && v.stats.triangles) + ' bytes=' + (v.stats && v.stats.fileSizeBytes));

  const row = await query(`SELECT id, file_size, part_category, display_name FROM uploaded_models WHERE path=$1`, [model.url]);
  const um = row.rows[0];
  log('P8-5a uploaded_models 行存在：part_category=model + file_size=真实字节',
    !!um && um.part_category === 'model' && Number(um.file_size) === model.fileSizeBytes,
    um ? ('id=' + um.id + ' size=' + um.file_size) : 'row missing');

  let httpOk = false;
  try { const resp = await fetch(BASE + model.url); httpOk = resp.status === 200; } catch (e) { /* ignore */ }
  log('P8-5b 产物 URL 经静态服务 GET 200', httpOk, BASE + model.url);

  const before = await countObjects();
  const placed = await gen3dService.place({ jobId: job.id, x: 900, z: 900, name: P + '_real_placed' },
    { worldId: W, regionKey: null });
  const after = await countObjects();
  log('P8-6 真实产物 place 走 executor（world_objects +1，origin=ai）',
    placed.ok === true && after === before + 1,
    placed.ok ? ('objectId=' + (placed.result && placed.result.objectId || placed.entityId || placed.id)) :
      ('code=' + placed.code + ' reason=' + String(placed.reason || '').slice(0, 100)));
  console.log('\n  >>> 产物保留：uploaded_models #' + (um && um.id) + ' ' + model.url +
    '（放置测试对象已在收尾清理，可从模型库重新放置）');
}

// ══════════════════════════════════════════════════════════════════
(async () => {
  try {
    if (STAGE1) await stage1();
    else if (STAGE2) await stage2();
    else await suiteA();
  } catch (e) {
    console.log('FATAL ' + (e.stack || e.message));
    fail++;
  }
  finish();
})();
