/**
 * accept_lod_stage1.js — LOD 三版模型方案【阶段 1：后端 LOD 生成服务】可重跑验收脚本
 *
 * 用法：node scripts/accept_lod_stage1.js [可选：指定一个真实 GLB 绝对路径作为样本]
 *
 * 判据（对应规范文档第 4 节 阶段 1）：
 *   A1 对 1 个真实模型生成成功：_mid.glb / _lod.glb 存在
 *   A2 面数相对达成（2026-09-11 用户确认调整口径）：中模 < 源且 ≤40%；低模 < 中模且 ≤22%
 *   A2b 语料抽检：低模必须严格小于中模，或由收益闸门正确拦下（no-benefit-vs-mid）
 *   A3 幂等：再跑一次返回 exists，文件 mtime 不变
 *   A4 低面数模型（<5000 面）跳过，reason = low-poly-source
 *   A5 源文件不存在 / 非 GLB → 返回 skipped，不抛异常
 *   A6 失败后不留垃圾文件
 *
 * 注意：所有产物都生成在临时目录 scripts/_tmp_lod_stage1/ 内，运行结束自动删除，
 *       不污染 public/models/uploaded/（全量转换属阶段 5）。
 */
const fs = require('fs');
const path = require('path');

const TMP_DIR = path.join(__dirname, '_tmp_lod_stage1');
const lod = require('../src/services/modelLod');
const UPLOAD_DIR = lod.UPLOAD_DIR;

const checks = [];
function check(id, title, pass, detail) {
  checks.push({ id, title, pass: !!pass, detail: detail === undefined ? '' : String(detail) });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 独立的面数读取（与 modelLod 内部实现隔离，用于交叉验证输出） */
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

/** 构造一个合法的极简 GLB（1 个三角形，用于 A4 低面数样本） */
function buildTinyGlb() {
  const json = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 1] }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }],
    buffers: [{ byteLength: 36 }],
  };
  let jsonStr = JSON.stringify(json);
  while (jsonStr.length % 4 !== 0) jsonStr += ' ';
  const jsonBuf = Buffer.from(jsonStr, 'utf8');
  const binBuf = Buffer.alloc(36);
  const total = 12 + 8 + jsonBuf.length + 8 + binBuf.length;
  const out = Buffer.alloc(total);
  out.write('glTF', 0, 'ascii');
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(total, 8);
  out.writeUInt32LE(jsonBuf.length, 12);
  out.write('JSON', 16, 'ascii');
  jsonBuf.copy(out, 20);
  const o = 20 + jsonBuf.length;
  out.writeUInt32LE(binBuf.length, o);
  out.write('BIN\0', o + 4, 'ascii');
  binBuf.copy(out, o + 8);
  return out;
}

function pickSample(minTris) {
  const files = fs.readdirSync(UPLOAD_DIR).filter((f) => /\.glb$/i.test(f) && !/_(mid|lod)\.glb$/i.test(f) && !/\.tmp\.glb$/i.test(f));
  const cands = [];
  files.forEach((f) => {
    const full = path.join(UPLOAD_DIR, f);
    let size = 0;
    try { size = fs.statSync(full).size; } catch (_) { return; }
    const tris = readTris(full);
    if (tris >= minTris) cands.push({ full, name: f, tris, size });
  });
  cands.sort((a, b) => a.size - b.size);
  return cands;
}

(async () => {
  console.log('=== LOD Stage 1 Acceptance ===');
  console.log('temp dir:', TMP_DIR);

  try {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
    fs.mkdirSync(TMP_DIR, { recursive: true });

    // ---------- 选样本 ----------
    const argSample = process.argv[2];
    let sample = null;
    if (argSample) {
      sample = { full: path.resolve(argSample), name: path.basename(argSample), tris: readTris(path.resolve(argSample)), size: 0 };
    } else {
      const cands = pickSample(20000);
      const fallback = cands.length ? cands : pickSample(5000);
      sample = fallback[0];
    }
    if (!sample) {
      check('A1', 'real model sample found', false, 'no .glb with >=5000 tris in uploads');
      throw new Error('no eligible sample');
    }
    console.log(`sample: ${sample.name} (tris=${sample.tris}, size=${(fs.statSync(sample.full).size / 1048576).toFixed(2)}MB)`);

    const workSrc = path.join(TMP_DIR, path.basename(sample.full));
    fs.copyFileSync(sample.full, workSrc);
    const multi = path.join(TMP_DIR, 'multi');
    fs.mkdirSync(multi, { recursive: true });
    const multiSrc = path.join(multi, path.basename(sample.full));
    fs.copyFileSync(sample.full, multiSrc);
    const paths = lod.lodPaths(multiSrc);

    // ---------- A1 生成成功 ----------
    const t0 = Date.now();
    const r1 = await lod.generateLodVariants(multiSrc);
    const ms1 = Date.now() - t0;
    const midExists = fs.existsSync(paths.midPath);
    const lowExists = fs.existsSync(paths.lowPath);
    check('A1', 'generate _mid.glb + _lod.glb', midExists && lowExists && r1.ok,
      `ok=${r1.ok} mid=${r1.variants.mid && r1.variants.mid.status}(${midExists}) low=${r1.variants.low && r1.variants.low.status}(${lowExists}) ${ms1}ms`);
    console.log('  paths:', paths.base, '|', path.basename(paths.midPath), '|', path.basename(paths.lowPath));
    console.log('  variants:', JSON.stringify(r1.variants));

    // ---------- A2 面数比例（相对达成口径，2026-09-11 用户确认调整）----------
    const srcTris = readTris(multiSrc);
    const midTris = midExists ? readTris(paths.midPath) : 0;
    const lowTris = lowExists ? readTris(paths.lowPath) : 0;
    const midRatio = midTris / srcTris;
    const lowRatio = lowTris / srcTris;
    check('A2', 'mid < source and mid <= 40%', midTris > 0 && midTris < srcTris && midRatio <= 0.40,
      `${midTris}/${srcTris}=${(midRatio * 100).toFixed(1)}%`);
    check('A2', 'low < mid and low <= 22%', lowTris > 0 && lowTris < midTris && lowRatio <= 0.22,
      `${lowTris}/${srcTris}=${(lowRatio * 100).toFixed(1)}% (vs mid ${(lowTris / (midTris || 1) * 100).toFixed(1)}%)`);

    // ---------- A3 幂等 ----------
    const midMtime = midExists ? fs.statSync(paths.midPath).mtimeMs : 0;
    const lowMtime = lowExists ? fs.statSync(paths.lowPath).mtimeMs : 0;
    await sleep(1100);
    const r2 = await lod.generateLodVariants(multiSrc);
    const midMtime2 = fs.existsSync(paths.midPath) ? fs.statSync(paths.midPath).mtimeMs : 0;
    const lowMtime2 = fs.existsSync(paths.lowPath) ? fs.statSync(paths.lowPath).mtimeMs : 0;
    const idem = r2.variants.mid.status === 'exists' && r2.variants.low.status === 'exists'
      && midMtime === midMtime2 && lowMtime === lowMtime2;
    check('A3', 'idempotent -> exists + mtime unchanged', idem,
      `mid=${r2.variants.mid.status} low=${r2.variants.low.status} mtimeSame=${midMtime === midMtime2 && lowMtime === lowMtime2}`);

    // ---------- A4 低面数跳过 ----------
    const tinyPath = path.join(TMP_DIR, 'tiny_model.glb');
    fs.writeFileSync(tinyPath, buildTinyGlb());
    const tinyTris = readTris(tinyPath);
    const r4 = await lod.generateLodVariants(tinyPath);
    const tinyPaths = lod.lodPaths(tinyPath);
    const noTinyOutput = !fs.existsSync(tinyPaths.midPath) && !fs.existsSync(tinyPaths.lowPath);
    check('A4', 'low-poly-source skipped (<5000 tris)', r4.skipped === true && r4.reason === 'low-poly-source' && noTinyOutput,
      `tris=${tinyTris} skipped=${r4.skipped} reason=${r4.reason} noOutput=${noTinyOutput}`);

    // ---------- A5 不存在 / 非 GLB ----------
    const ghost = path.join(TMP_DIR, 'ghost_model.glb');
    let rGhost = null;
    let threw1 = false;
    try { rGhost = await lod.generateLodVariants(ghost); } catch (e) { threw1 = true; }
    check('A5', 'missing source -> skipped(not-found), no throw', !threw1 && rGhost && rGhost.skipped === true && rGhost.reason === 'not-found',
      `threw=${threw1} reason=${rGhost && rGhost.reason}`);

    const objPath = path.join(TMP_DIR, 'not_a_glb.obj');
    fs.writeFileSync(objPath, 'v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n');
    let rObj = null;
    let threw2 = false;
    try { rObj = await lod.generateLodVariants(objPath); } catch (e) { threw2 = true; }
    check('A5', 'non-glb -> skipped(format), no throw', !threw2 && rObj && rObj.skipped === true && rObj.reason === 'format',
      `threw=${threw2} reason=${rObj && rObj.reason}`);

    let rNoArg = null;
    let threw3 = false;
    try { rNoArg = await lod.generateLodVariants(null); } catch (e) { threw3 = true; }
    check('A5', 'null source -> skipped(bad-path), no throw', !threw3 && rNoArg && rNoArg.reason === 'bad-path',
      `threw=${threw3} reason=${rNoArg && rNoArg.reason}`);

    // ---------- A6 失败不留垃圾 ----------
    const corruptPath = path.join(TMP_DIR, 'corrupt_model.glb');
    const corrupt = Buffer.alloc(64);
    corrupt.write('glTF', 0, 'ascii');
    corrupt.writeUInt32LE(2, 4);
    corrupt.writeUInt32LE(64, 8);
    corrupt.writeUInt32LE(0x7ffffff0, 12); // 荒谬的 JSON chunk 长度
    fs.writeFileSync(corruptPath, corrupt);
    const r6 = await lod.generateLodVariants(corruptPath);
    const corruptPaths = lod.lodPaths(corruptPath);
    const noCorruptOut = !fs.existsSync(corruptPaths.midPath) && !fs.existsSync(corruptPaths.lowPath);
    check('A6', 'corrupt glb -> skipped, no output', r6.skipped === true && r6.reason === 'not-glb-or-empty' && noCorruptOut,
      `skipped=${r6.skipped} reason=${r6.reason} noOutput=${noCorruptOut}`);

    // 全局扫描：临时目录不得残留 .tmp.glb
    const leftovers = [];
    (function walk(d) {
      fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.tmp\.glb$/i.test(e.name)) leftovers.push(p);
      });
    })(TMP_DIR);
    check('A6', 'no *.tmp.glb leftovers', leftovers.length === 0, leftovers.join(', ') || 'none');

    // 原始文件未被改动
    const origSame = fs.statSync(multiSrc).size === sample.size || sample.size === 0;
    const srcUnchanged = origSame && fs.statSync(multiSrc).size === fs.statSync(sample.full).size;
    check('A6', 'source .glb untouched', srcUnchanged, `work=${fs.statSync(multiSrc).size} origin=${fs.statSync(sample.full).size}`);

    // ---------- A2b 语料抽检：低模必须严格小于中模（收益闸门两种分支都要正确） ----------
    const corpusDir = path.join(TMP_DIR, 'corpus');
    fs.mkdirSync(corpusDir, { recursive: true });
    const pool = pickSample(5000);
    const seenPaths = new Set();
    const uniq = [];
    [0.2, 0.5, 0.75, 0.99].forEach((q) => {
      const p = pool[Math.min(pool.length - 1, Math.floor(pool.length * q))];
      if (p && !seenPaths.has(p.full)) { seenPaths.add(p.full); uniq.push(p); }
    });
    console.log('\n--- A2b corpus spot-check (benefit gate: low < mid) ---');
    let gateOk = 0;
    for (let i = 0; i < uniq.length; i += 1) {
      const p = uniq[i];
      const dst = path.join(corpusDir, `c${i}_${p.name}`);
      fs.copyFileSync(p.full, dst);
      const r = await lod.generateLodVariants(dst);
      const pp = lod.lodPaths(dst);
      const st = readTris(dst);
      const mt = fs.existsSync(pp.midPath) ? readTris(pp.midPath) : 0;
      const lt = fs.existsSync(pp.lowPath) ? readTris(pp.lowPath) : 0;
      const lowInfo = r.variants.low || {};
      let pass;
      if (lt > 0) pass = lt < mt; // 落盘的低模必须真的更轻
      else pass = lowInfo.status === 'failed' && /^no-benefit-vs-/.test(lowInfo.reason || ''); // 或闸门正确拦下
      if (pass) gateOk += 1;
      console.log(`  [${pass ? 'OK' : 'NG'}] ${p.name} src=${st} mid=${mt}(${(mt / st * 100).toFixed(1)}%) low=${lt}(${(lt / st * 100).toFixed(1)}%) low/mid=${(lt / (mt || 1) * 100).toFixed(1)}% status=${lowInfo.status}${lowInfo.reason ? '/' + lowInfo.reason : ''}`);
    }
    check('A2b', 'corpus: low strictly smaller than mid (benefit gate)', uniq.length > 0 && gateOk === uniq.length, `${gateOk}/${uniq.length}`);

    // ---------- 附加：scanStatus / batchGenerateMissing 冒烟（INFO） ----------
    console.log('\n--- INFO: scanStatus smoke ---');
    try {
      const st = await lod.scanStatus();
      console.log(`scanStatus: total=${st.total} mid=${st.midCount} low=${st.lowCount} pending=${st.pending} lowPolySkipped=${st.lowPolySkipped} missingSource=${st.missingSource} dbError=${st.dbError || 'none'}`);
      check('INFO', 'scanStatus returns counts', st.ok === true && st.total > 0, `total=${st.total} pending=${st.pending}`);

      // batchGenerateMissing 会真实写入 public/models/uploaded/（产品预期行为、幂等），
      // 但为避免大模型拖慢脚本，仅在首个待生成模型 <30MB 时实跑。
      const first = st.pendingList[0];
      const firstSize = first && fs.existsSync(first.absPath) ? fs.statSync(first.absPath).size : 0;
      if (first && firstSize < 30 * 1024 * 1024) {
        // 记录运行前状态：只清理本次新产生的变体，绝不动原有文件，保持验收无副作用
        const fp = lod.lodPaths(first.absPath);
        const beforeMid = fs.existsSync(fp.midPath);
        const beforeLow = fs.existsSync(fp.lowPath);
        const bg = await lod.batchGenerateMissing({ limit: 1 });
        let removed = 0;
        if (!beforeMid && fs.existsSync(fp.midPath)) { fs.rmSync(fp.midPath, { force: true }); removed += 1; }
        if (!beforeLow && fs.existsSync(fp.lowPath)) { fs.rmSync(fp.lowPath, { force: true }); removed += 1; }
        console.log(`batchGenerateMissing(limit=1): target=${first.name} processed=${bg.processed} succeeded=${bg.succeeded} failed=${bg.failed} remaining=${bg.remaining} (cleaned ${removed} new variant files)`);
        check('INFO', 'batchGenerateMissing runs on real pending model', bg.ok === true && bg.processed === 1, `processed=${bg.processed} succeeded=${bg.succeeded} remaining=${bg.remaining} cleaned=${removed}`);
      } else {
        console.log(`batchGenerateMissing: skipped (largest-first guard, firstSize=${(firstSize / 1048576).toFixed(1)}MB)`);
        check('INFO', 'batchGenerateMissing skipped (guard)', true, 'first pending model too large / none');
      }
    } catch (e) {
      check('INFO', 'scanStatus / batch smoke', false, 'error: ' + e.message);
    }
  } catch (e) {
    check('FATAL', 'acceptance run', false, e.message);
  } finally {
    try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  }

  // ---------- 汇总 ----------
  console.log('\n=== Results ===');
  checks.forEach((c) => console.log(`${c.pass ? 'PASS' : 'FAIL'} [${c.id}] ${c.title} -- ${c.detail}`));
  const failed = checks.filter((c) => !c.pass && c.id !== 'INFO');
  const info = checks.filter((c) => c.id === 'INFO');
  console.log(`\nSUMMARY: ${checks.filter((c) => c.pass).length}/${checks.length} passed`
    + ` (${info.length} info), failed=${failed.length}`);
  console.log(failed.length === 0 ? 'VERDICT: ACCEPTED' : 'VERDICT: REJECTED');
  process.exit(failed.length === 0 ? 0 : 1);
})();
