/**
 * Phase 1 零件库 · 真实素材验收（可重跑）
 *   node scripts/accept_asset_library_scan.js              # 验收 + 自动清理
 *   node scripts/accept_asset_library_scan.js --keep       # 验收后保留库
 *   node scripts/accept_asset_library_scan.js --import-all # 正式导入 H:\kenney 全部 kit（不清理）
 *
 * 覆盖判据（主文档 §F.6.8）：
 *   AL-1 预检统计 / AL-2 路径无空格 / AL-4 库表 / AL-5 零件行数 / AL-6 归类分布
 *   AL-7 模数 / AL-8 碰撞 / AL-9 LOD=never / AL-10 缩略图 / AL-11 说明书
 *   AL-12/13 见 --import-all 后的检索与归档 / AL-15 幂等 / AL-16 隔离
 *   ★ AL-3（贴图在世界内渲染）由 scripts/accept_part_render_world.js 判定
 *
 * 依赖：本地 3002 在跑；管理员 baseline_shot；素材源 H:\kenney（可用 --src 覆盖）
 */
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { Pool } = require('pg');

const BASE = process.env.WORLD_AI_BASE || 'http://localhost:3002';
const SRC_ROOT = argVal('--src') || 'H:\\kenney';
const SAMPLE_DIR = argVal('--sample') || path.join(SRC_ROOT, 'kenney_modular-buildings');
const KEEP = process.argv.includes('--keep');
const IMPORT_ALL = process.argv.includes('--import-all');
const UPLOAD_ROOT = path.join(__dirname, '..', 'public', 'models', 'uploaded');
const SAMPLE_PACK = 'kenney_modular_buildings';
const SHOTS = path.join(__dirname, '..', 'Screenshot');

function argVal(flag) {
  const i = process.argv.indexOf(flag);
  return i > 0 ? process.argv[i + 1] : null;
}

const pool = new Pool({
  host: process.env.DB_HOST, port: process.env.DB_PORT, database: process.env.DB_NAME,
  user: process.env.DB_USER, password: process.env.DB_PASSWORD,
});

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

/** 删除一个库及其零件行 + uploaded_models 行 + 磁盘 bundle 目录（幂等） */
async function purgePack(packKey) {
  const libs = await pool.query('SELECT id FROM part_libraries WHERE pack_key = $1', [packKey]);
  for (const l of libs.rows) await pool.query('DELETE FROM part_library_items WHERE library_id = $1', [l.id]);
  await pool.query('DELETE FROM part_libraries WHERE pack_key = $1', [packKey]);
  const models = await pool.query(`SELECT path FROM uploaded_models WHERE part_category = 'part'`);
  const bundles = [...new Set(models.rows.map(r => {
    const m = String(r.path).match(/^\/models\/uploaded\/([^/]+)\//); return m ? m[1] : null;
  }).filter(Boolean))];
  await pool.query(`DELETE FROM uploaded_models WHERE part_category = 'part'`);
  let dirs = 0;
  for (const b of bundles) {
    const d = path.join(UPLOAD_ROOT, b);
    if (fs.existsSync(d) && (b.startsWith('bundle-') || /kenney/i.test(b))) { fs.rmSync(d, { recursive: true, force: true }); dirs++; }
  }
  return { libs: libs.rowCount, bundles: bundles.length, dirs };
}

(async () => {
  const login = await api('/api/admin-auth/login', { method: 'POST', body: { username: 'baseline_shot', password: 'Baseline#185' } });
  if (login.status !== 200) { console.log('LOGIN FAIL', login.status, JSON.stringify(login.j).slice(0, 200)); process.exit(1); }
  const token = login.j.token;
  console.log('✔ 管理员登录\n');

  // ── 模式二：正式导入全部 kit ────────────────────────────────────
  if (IMPORT_ALL) {
    if (!fs.existsSync(SRC_ROOT)) { console.log('素材根目录不存在：' + SRC_ROOT); process.exit(1); }
    const pv = await api('/api/asset-library/scan/preview', { method: 'POST', token, body: { sourceDir: SRC_ROOT, target: 'part', splitSubdirs: true } });
    if (pv.status !== 200) { console.log('PREVIEW FAIL', pv.status, JSON.stringify(pv.j).slice(0, 300)); process.exit(1); }
    log(pv.j.mode === 'multi-pack', 'F1 splitSubdirs 下根目录被识别为多包', `packs=${pv.j.packCount} 合计模型=${pv.j.totalModel} 面=${pv.j.totalTris}`);
    log(pv.j.packCount >= 19, 'F2 识别到 19 个 Kenney kit', 'packCount=' + pv.j.packCount);
    const t0 = Date.now();
    const sc = await api('/api/asset-library/scan', { method: 'POST', token, body: { sourceDir: SRC_ROOT, target: 'part', compressTextures: false, variants: false, splitSubdirs: true } });
    console.log(`   扫描耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    if (sc.status !== 200) { console.log('SCAN FAIL', sc.status, JSON.stringify(sc.j).slice(0, 300)); process.exit(1); }
    log(sc.j.imported >= 19, 'F3 全部包导入成功', `imported=${sc.j.imported} skipped=${sc.j.skipped}`);
    const agg = await pool.query(
      `SELECT (SELECT COUNT(*)::int FROM part_libraries WHERE status='active') AS libs,
              (SELECT COUNT(*)::int FROM part_library_items) AS items,
              (SELECT COALESCE(SUM((metadata->>'tris')::bigint),0) FROM part_library_items) AS tris,
              (SELECT COUNT(*)::int FROM part_library_items WHERE lod_policy='never') AS never_,
              (SELECT COUNT(*)::int FROM part_library_items WHERE thumbnail IS NOT NULL) AS thumbs,
              (SELECT COUNT(*)::int FROM uploaded_models WHERE part_category='part') AS part_models`);
    const a = agg.rows[0];
    console.log(`   库=${a.libs} 零件=${a.items} 面=${a.tris} lod_never=${a.never_} 缩略图=${a.thumbs} part模型行=${a.part_models}`);
    log(a.libs >= 19, 'F4 库数 ≥ 19', 'libs=' + a.libs);
    log(a.items > 1500, 'F5 零件行 ≥ 1500', 'items=' + a.items);
    const lodQ = await pool.query(
      `SELECT COUNT(*) FILTER (WHERE COALESCE((metadata->>'tris')::bigint,0) < 5000)::int AS should_never,
              COUNT(*) FILTER (WHERE lod_policy='never')::int AS is_never,
              COUNT(*) FILTER (WHERE COALESCE((metadata->>'tris')::bigint,-1) = 0)::int AS zero_tris
         FROM part_library_items`);
    log(lodQ.rows[0].should_never === lodQ.rows[0].is_never, 'F6 ★lod_policy 规则一致（tris<5000 → never）',
      `应 never=${lodQ.rows[0].should_never} 实 never=${lodQ.rows[0].is_never}（auto=${lodQ.rows[0].should_never === lodQ.rows[0].is_never ? '' : 'x'}）`);
    log(lodQ.rows[0].zero_tris === 0, 'F6b ★无 tris=0 的零件（OBJ 覆盖残留会造出这个）', 'zero_tris=' + lodQ.rows[0].zero_tris);
    log(a.part_models === a.items, 'F7 ★零件行与 uploaded_models 一一对应（无 OBJ 副本残留）', `${a.part_models} vs ${a.items}`);
    // 检索可用（AI 侧 partSearch 的等价物）
    const se = await api('/api/part-library/search?role=wall&limit=5', { token });
    log(se.j.count > 0, 'F8 检索 role=wall 命中（AL-6/AL-12 基础）', 'count=' + se.j.count);
    // 归档 → 检索消失 → 恢复（AL-13）
    const lib = (await api('/api/part-library/libraries', { token })).j.libraries.find(l => l.pack_key === SAMPLE_PACK);
    if (lib) {
      await api(`/api/part-library/libraries/${lib.id}/status`, { method: 'POST', token, body: { status: 'archived' } });
      const afterHide = await api(`/api/part-library/search?packKey=${SAMPLE_PACK}`, { token });
      log(afterHide.j.count === 0, 'F9 归档库的零件从检索层消失（AL-13）', 'count=' + afterHide.j.count);
      await api(`/api/part-library/libraries/${lib.id}/status`, { method: 'POST', token, body: { status: 'active' } });
      const afterShow = await api(`/api/part-library/search?packKey=${SAMPLE_PACK}`, { token });
      log(afterShow.j.count > 0, 'F10 恢复后重新可检索', 'count=' + afterShow.j.count);
    }
    // 库卡片汇总（doc 期望：库数 = 库、零件数 = 件）
    const libsAll = await api('/api/part-library/libraries', { token });
    const t = libsAll.j.totals || {};
    console.log(`   totals: active=${t.active_libs} pending=${t.pending_libs} archived=${t.archived_libs} items=${t.total_items} tris=${t.total_tris}`);
    console.log(`\n共 ${pass + fail} 条：PASS ${pass} / FAIL ${fail}`);
    console.log(fail === 0 ? 'VERDICT: ACCEPTED' : 'VERDICT: REJECTED');
    process.exit(fail === 0 ? 0 : 1);
  }

  // ── 模式一：单包验收 ───────────────────────────────────────────
  if (!fs.existsSync(SAMPLE_DIR)) { console.log('样本目录不存在：' + SAMPLE_DIR + '（用 --sample 指定）'); process.exit(1); }
  await purgePack(SAMPLE_PACK);

  // K1 预检
  const pv = await api('/api/asset-library/scan/preview', { method: 'POST', token, body: { sourceDir: SAMPLE_DIR, target: 'part' } });
  if (pv.status !== 200) { console.log('PREVIEW FAIL', pv.status, JSON.stringify(pv.j).slice(0, 300)); process.exit(1); }
  const P = pv.j.pack || {};
  log(pv.j.mode === 'single-pack', 'K1 预检识别为单包', 'mode=' + pv.j.mode);
  log(P.modelCount === 108, 'K2 预检模型数 = 108（多格式已去重，原始 216）', `modelCount=${P.modelCount} raw=${P.rawModelCount} dropped=${P.droppedModels}`);
  log(P.totalTris > 6000 && P.noStats === 0, 'K3 预检能读出几何统计', `tris=${P.totalTris} noStats=${P.noStats}`);
  log(P.externalRefs === P.modelCount, 'K4 每个零件一张外置贴图', `externalRefs=${P.externalRefs}/${P.modelCount}`);
  log(P.lodNever === P.modelCount, 'K5 预检判定全部免 LOD', `lodNever=${P.lodNever}`);
  log(!!(P.licenseInfo && P.licenseInfo.type === 'CC0' && /kenney/i.test(P.licenseInfo.author || '')), 'K6 CC0 授权提取', JSON.stringify(P.licenseInfo && { type: P.licenseInfo.type, author: P.licenseInfo.author }));
  const roles = P.roleCount || {};
  log(Object.keys(roles).length >= 6, 'K7 归类分布覆盖 6+ 类', JSON.stringify(roles));

  // K8 扫描
  const sc = await api('/api/asset-library/scan', { method: 'POST', token, body: { sourceDir: SAMPLE_DIR, target: 'part', compressTextures: false, variants: false } });
  if (sc.status !== 200) { console.log('SCAN FAIL', sc.status, JSON.stringify(sc.j).slice(0, 300)); process.exit(1); }
  const R = (sc.j.packs || [])[0] || {};
  log(sc.j.imported === 1 && R.modelCount === P.modelCount, 'K9 扫描入库数 = 预检数（口径一致）', `入库=${R.modelCount} 预检=${P.modelCount}`);
  log(R.fileCount === P.copyFileCount, 'K10 落盘文件数 = 预检选中数', `copy=${R.fileCount} expect=${P.copyFileCount}`);

  // K11 库表（AL-4）
  const libs = await api('/api/part-library/libraries', { token });
  const lib = (libs.j.libraries || []).find(l => l.pack_key === SAMPLE_PACK);
  log(!!lib, 'K11 库已建立', lib ? `${lib.pack_key} status=${lib.status} license=${lib.license_info && lib.license_info.type}` : '');
  if (!lib) process.exit(1);

  // K12 零件表（AL-5）
  const det = await api(`/api/part-library/libraries/${lib.id}`, { token });
  const items = det.j.items || [];
  log(items.length === 108, 'K12 零件行 = 108', 'items=' + items.length);
  // K13 全是 glb，无 obj 残留（Bug1 回归）
  const objRows = items.filter(x => /\.obj$/i.test(x.model_path || ''));
  const glbRows = items.filter(x => /\.glb$/i.test(x.model_path || ''));
  log(objRows.length === 0 && glbRows.length === 108, 'K13 ★零件全部指向 .glb（OBJ 副本不再覆盖）', `glb=${glbRows.length} obj=${objRows.length}`);
  // K14 面数（Bug1 回归）
  const triSum = items.reduce((s, x) => s + (Number(x.tris) || 0), 0);
  log(triSum > 6000, 'K14 ★零件面数非零（OBJ 覆盖曾把它清成 0）', 'sum(tris)=' + triSum);
  // K15 路径无空格（AL-2）
  log(items.every(x => !/\s/.test(x.model_path || '')), 'K15 入库路径无空格（AL-2）',
    items.filter(x => /\s/.test(x.model_path || '')).slice(0, 2).map(x => x.model_path).join(' | '));
  // K16 落盘结构无重复前缀（Bug2 回归）
  log(items.every(x => !/\/Models\/Models\/|Previews\/Previews\//.test(x.model_path || '')), 'K16 ★落盘路径无重复前缀段（Bug2 回归）',
    items.filter(x => /\/Models\/Models\/|Previews\/Previews\//.test(x.model_path || '')).slice(0, 2).map(x => x.model_path).join(' | '));
  // K17 模数（AL-7）
  // 口径说明：kit 里既有「模数件」（block/window/door/roof…，1×0.625×1），
  // 也有「整体预制件」（building-sample-house-* / sample-tower-*，尺寸自定，且因文件名含
  // building 被归为 wall）。因此判据用**众数模数**而不是"全部一致"。
  const gridCount = new Map();
  for (const x of items) {
    const k = `${x.grid_w}x${x.grid_h}x${x.grid_d}`;
    gridCount.set(k, (gridCount.get(k) || 0) + 1);
  }
  const modal = [...gridCount.entries()].sort((a, b) => b[1] - a[1])[0];
  const struct = items.filter(x => ['wall', 'column', 'door'].includes(x.part_role));
  const modalStruct = struct.filter(x => `${x.grid_w}x${x.grid_h}x${x.grid_d}` === modal[0]);
  log(items.every(x => Number(x.grid_w) > 0 && Number(x.grid_h) > 0), 'K17a 所有零件模数已填充',
    `未填=${items.filter(x => !(Number(x.grid_w) > 0)).length}，不同尺寸 ${gridCount.size} 种`);
  log(modal[0] === '1x0.625x1' && modal[1] >= 25,
    'K17b ★众数模数 = 1 × 0.625 × 1 且覆盖足够多零件（Kenney 模数体系）',
    `众数=${modal[0]} ×${modal[1]} 件；结构件中占 ${modalStruct.length}/${struct.length}`);
  // K18 碰撞（AL-8）
  const win = items.filter(x => x.part_role === 'window'), wall = items.filter(x => x.part_role === 'wall');
  log(win.length > 0 && win.every(x => x.collidable === false), 'K18a window 不可碰撞', `n=${win.length}`);
  log(wall.length > 0 && wall.every(x => x.collidable === true), 'K18b wall 可碰撞', `n=${wall.length}`);
  // K19 缩略图（AL-10）
  const thumbs = await pool.query('SELECT COUNT(*)::int n FROM part_library_items WHERE library_id=$1 AND thumbnail IS NOT NULL', [lib.id]);
  log(thumbs.rows[0].n === items.length, 'K19 ★缩略图 108/108（AL-10，Previews 顶层匹配）', thumbs.rows[0].n + '/' + items.length);
  // 缩略图静态可达
  const t0 = items.find(x => x.thumbnail);
  if (t0) {
    const r = await fetch(BASE + t0.thumbnail);
    log(r.status === 200, 'K20 缩略图静态可达', `HTTP ${r.status} ${t0.thumbnail.split('/').pop()}`);
  }
  // K21 检索（Bug3 回归 + AL-6）
  const se = await api('/api/part-library/search?role=wall', { token });
  log(se.j.count === wall.length, 'K21 ★search?role=wall 命中数正确（过滤参数不再失效）', `count=${se.j.count} expect=${wall.length}`);
  const se2 = await api('/api/part-library/search?q=window', { token });
  log(se2.j.count > 0, 'K22 关键字检索命中', 'count=' + se2.j.count);
  const se3 = await api('/api/part-library/search?role=wall&gridW=1', { token });
  log(se3.j.count > 0, 'K23 role+gridW 组合过滤可用', 'count=' + se3.j.count);
  // K24 说明书（AL-11）
  const spec = await api(`/api/part-library/libraries/${lib.id}/spec`, { token });
  const S = spec.j.spec || {};
  log(spec.status === 200 && !!S.gridSystem, 'K24 ★说明书 200 且含 gridSystem', JSON.stringify(S.gridSystem));
  log(S.gridSystem && Math.abs(Number(S.gridSystem.floorH) - 0.625) < 0.001, 'K25 说明书层高精确 = 0.625m（不得四舍五入成 0.63）', S.gridSystem && String(S.gridSystem.floorH));
  log(!!(S.rules && S.rules.length >= 4) && S.totals && S.totals.parts === 108, 'K26 说明书含规则与统计', `rules=${(S.rules || []).length} parts=${S.totals && S.totals.parts}`);
  // K27 静态资源：GLB + 外置贴图
  const one = items.find(x => x.part_key === 'building_block') || items[0];
  const gr = await fetch(BASE + one.model_path);
  const gbuf = Buffer.from(await gr.arrayBuffer());
  const jl = gbuf.readUInt32LE(12);
  const gj = JSON.parse(gbuf.slice(20, 20 + jl).toString('utf8'));
  const uri = (gj.images || [])[0] && gj.images[0].uri;
  const dir = one.model_path.slice(0, one.model_path.lastIndexOf('/') + 1);
  const tr = uri ? await fetch(new URL(uri, BASE + dir).toString()) : { status: 0 };
  log(gr.status === 200, 'K27a 零件 GLB 可达', 'HTTP ' + gr.status);
  log(tr.status === 200, 'K27b ★外置贴图按相对 uri 可达（AL-3 的静态前置）', `${uri} → HTTP ${tr.status}`);

  // K28 幂等（AL-15）
  const sc2 = await api('/api/asset-library/scan', { method: 'POST', token, body: { sourceDir: SAMPLE_DIR, target: 'part', compressTextures: false, variants: false } });
  const R2 = (sc2.j.packs || [])[0] || {};
  const items2 = await pool.query('SELECT COUNT(*)::int n FROM part_library_items WHERE library_id=$1', [lib.id]);
  const orphan = await pool.query(
    `SELECT COUNT(*)::int n FROM uploaded_models u WHERE u.part_category='part'
       AND NOT EXISTS (SELECT 1 FROM part_library_items i WHERE i.model_id=u.id)`);
  log(sc2.status === 200 && items2.rows[0].n === 108, 'K28a 重复扫描后零件行数不变（AL-15）', `items=${items2.rows[0].n}`);
  log(orphan.rows[0].n === 0, 'K28b 重复扫描不留孤儿 uploaded_models 行', 'orphans=' + orphan.rows[0].n);
  log(R2.library && R2.library.created === false, 'K28c 复用已有库（created=false）', 'created=' + (R2.library && R2.library.created));

  // K29 AL-16 隔离
  const sp = await api('/api/part-library/split', { token });
  const md = await api('/api/uploaded-models', { token });
  const mdPart = await api('/api/uploaded-models?category=part', { token });
  log(!(md.j.models || []).some(m => m.part_category === 'part'), 'K29a 上传模型列表不含零件（AL-16）', '默认=' + (md.j.models || []).length);
  log((mdPart.j.models || []).length === 108 && sp.j.part_count === 108, 'K29b 零件仅在零件库侧可见', `part=${(mdPart.j.models || []).length}`);

  // 清理
  if (!KEEP) {
    const p = await purgePack(SAMPLE_PACK);
    log(true, 'K30 验收后清理', `库${p.libs} 目录${p.dirs}`);
    const after = await pool.query(`SELECT COUNT(*)::int n FROM uploaded_models WHERE part_category='part'`);
    log(after.rows[0].n === 0, 'K31 清理彻底（零件行归零）', 'part_models=' + after.rows[0].n);
  } else {
    console.log('\n(已指定 --keep：保留 ' + SAMPLE_PACK + ' 库)');
  }

  console.log(`\n共 ${pass + fail} 条：PASS ${pass} / FAIL ${fail}`);
  console.log(fail === 0 ? 'VERDICT: ACCEPTED' : 'VERDICT: REJECTED');
  console.log('★ AL-3（世界里贴图渲染）请另跑：node scripts/accept_part_render_world.js');
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('FATAL', e && e.stack || e); process.exit(1); });
