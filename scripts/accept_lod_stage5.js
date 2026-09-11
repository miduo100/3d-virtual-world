/**
 * accept_lod_stage5.js — LOD 三版模型方案【阶段 5：全量转换 + 收尾】可重跑验收脚本
 *
 * 用法：node scripts/accept_lod_stage5.js                  （需先启动 3002 服务器）
 *       node scripts/accept_lod_stage5.js --no-regression  只跑离线部分（快速）
 *       node scripts/accept_lod_stage5.js --no-convert     跳过全量转换（用当前磁盘状态判据）
 *
 * 判据：
 *   E1 全量转换跑通且幂等：连续两次 `node scripts/lod_convert_all.js` 退出码 0，第二次 generated=0
 *   E2 存量清零可解释：pending 只剩「结构性剩余」——中模已有但低模被收益闸门拦下（no-benefit-vs-mid）、
 *      或工具链无法处理的输入（Draco 压缩 GLB）；两类均抽样复现原因
 *   E3 中模达成率：按变体去重后 中模/源 中位数 ≤40%（规范 2.2 相对达成口径）
 *   E4 低模价值（本阶段要回答的问题）：去重后 低模/中模 **汇总** ≤70%（即真实降幅 ≥30%），
 *      且 ≥70% 的模型低模比中模轻 ≥30%；低模/源 中位数 ≤22%
 *   E5 幂等抽样：对 8 个已生成模型重跑 → 全部 exists 且 mtime 不变
 *   E6 生成源修复：同名 _dec.glb 存在时以它为源（规范 2.2），两条入口落到同一变体文件
 *   E7 无垃圾文件：上传目录无 .tmp.glb 残留
 *   E8 全项目回归：调用 accept_lod_stage5_regression.js，其 VERDICT 必须 ACCEPTED
 *   INFO 转换成本与磁盘增量：取首次全量转换归档报告 lod_convert_report_first.json
 *
 * 设计说明：**分布统计直接扫磁盘构建全语料**（不以某次运行的报告为准）——
 *   转换脚本是增量幂等的，第二次只处理剩余条目，用它统计会得到被截断的样本。
 *
 * 产物：Screenshot/accept_lod_stage5/{lod_convert_report.json, lod_convert_report_first.json,
 *       regression_checks.json, conversion_stats.json}
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  scanStatus, generateLodVariants, countTrisExact, lodPaths, resolveLodSource,
  UPLOAD_DIR, MIN_SOURCE_TRIS,
} = require('../src/services/modelLod');

const ARGS = process.argv.slice(2);
const SKIP_CONVERT = ARGS.includes('--no-convert');
const SKIP_REGRESSION = ARGS.includes('--no-regression');
const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'Screenshot', 'accept_lod_stage5');
const REPORT = path.join(OUT_DIR, 'lod_convert_report.json');
const FIRST_REPORT = path.join(OUT_DIR, 'lod_convert_report_first.json');

const mb = (b) => (b / 1048576).toFixed(1);
const median = (arr) => {
  if (!arr.length) return 0;
  const s = arr.slice().sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
const checks = [];
function check(id, title, pass, detail) {
  checks.push({ id, title, pass: !!pass, detail: detail === undefined ? '' : String(detail) });
}

function runNode(script, extra) {
  const r = spawnSync(process.execPath, [path.join('scripts', script)].concat(extra || []), {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  return { status: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

/** 递归收集上传目录下的 .glb（跳过备份目录与 .tmp） */
function collectGlb(dir, depth, out) {
  if (depth > 3) return out;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return out; }
  entries.forEach((ent) => {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) { if (!/^_?backup/i.test(ent.name)) collectGlb(full, depth + 1, out); return; }
    if (/\.glb$/i.test(ent.name) && !/\.tmp\.glb$/i.test(ent.name)) out.push(full);
  });
  return out;
}

/**
 * 全语料统计：以「变体基准名（目录+基准名）」为唯一身份。
 * lodPaths 对 X.glb 与 X_dec.glb 推出同一组变体 → 二者是同一件产物的两个入口，取其一（优先 _dec）。
 */
function buildCorpus() {
  const byBase = new Map();
  collectGlb(UPLOAD_DIR, 0, []).forEach((abs) => {
    if (/(_mid|_lod)\.glb$/i.test(abs)) return;
    const p = lodPaths(abs);
    const key = (path.dirname(abs) + '|' + p.base).toLowerCase();
    const isDec = /_dec\.glb$/i.test(abs);
    const prev = byBase.get(key);
    if (!prev || (isDec && !prev.isDec)) {
      byBase.set(key, { abs, isDec, base: p.base, midPath: p.midPath, lowPath: p.lowPath });
    }
  });
  return [...byBase.values()].map((e) => {
    const srcAbs = resolveLodSource(e.abs);
    const srcTris = countTrisExact(srcAbs);
    const midTris = fs.existsSync(e.midPath) ? countTrisExact(e.midPath) : 0;
    const lowTris = fs.existsSync(e.lowPath) ? countTrisExact(e.lowPath) : 0;
    return {
      base: e.base, entry: path.basename(e.abs), entryAbs: e.abs, src: path.basename(srcAbs),
      hasSkip: fs.existsSync(e.lowPath.replace(/\.glb$/i, '') + '.skip.json'),
      srcTris, midTris, lowTris,
      midPct: srcTris ? +(midTris / srcTris * 100).toFixed(1) : 0,
      lowPct: srcTris ? +(lowTris / srcTris * 100).toFixed(1) : 0,
      lowVsMidPct: midTris ? +(lowTris / midTris * 100).toFixed(1) : 0,
      eligible: srcTris >= MIN_SOURCE_TRIS,
    };
  });
}

(async () => {
  console.log('=== LOD Stage 5 Acceptance ===');

  // ---------- E1 全量转换 + 幂等（连续两次；第一次带 --prune-low 落定 +5% 余量口径） ----------
  if (!SKIP_CONVERT) {
    console.log('running full conversion twice (run1 with --prune-low, run2 must generate nothing) ...');
    const r1 = runNode('lod_convert_all.js', ['--prune-low']);
    const r2 = runNode('lod_convert_all.js');
    console.log('--- run 1 (tail) ---\n' + r1.out.trim().split('\n').slice(-7).join('\n'));
    console.log('--- run 2 (tail) ---\n' + r2.out.trim().split('\n').slice(-7).join('\n'));
    check('E1', 'full conversion exits 0 (both runs)', r1.status === 0 && r2.status === 0,
      `exit1=${r1.status} exit2=${r2.status}`);
    const g2 = r2.out.match(/generated=(\d+)/);
    const sum2 = r2.out.match(/processed=(\d+) ok=(\d+) failed=(\d+) generated=(\d+)/);
    check('E1', 're-run of full conversion generates no new files (idempotent)', !!g2 && g2[1] === '0',
      sum2 ? sum2[0] : 'no summary line');
    const prSkip = r1.out.match(/prune-low: skipped[^\n]*/);
    const prDone = r1.out.match(/prune-low: (\d+) useless low models[^\n]*/);
    check('E1', 'prune-low is a guarded no-op under margin=1 (low models must exist for 200~400m band)',
      !!prSkip && !prDone,
      prSkip ? prSkip[0] : (prDone ? prDone[0] : 'no prune line'));
  } else {
    check('E1', 'full conversion skipped by flag (--no-convert)', true, 'asserting current disk state only');
  }

  // ---------- E2 pending 只剩结构性剩余 ----------
  const st = await scanStatus();
  const pending = st.models.filter((m) => m.pending);
  const pendMidOk = pending.filter((m) => m.hasMid);   // 中模已有、低模被闸门拦下（应已不出现，因标记文件）
  const pendNoMid = pending.filter((m) => !m.hasMid);  // 中模都生成不了（工具链限制）
  console.log(`\nscanStatus: total=${st.total} mid=${st.midCount} low=${st.lowCount} pending=${st.pending}`
    + ` (hasMid=${pendMidOk.length} noMid=${pendNoMid.length}) lowBenefitSkipped=${st.lowBenefitSkipped}`
    + ` superseded=${st.superseded} missingSource=${st.missingSource}`);

  const lowSamples = [];
  for (const m of pendMidOk.slice(0, 3)) {
    const r = await generateLodVariants(m.absPath);
    lowSamples.push({ name: m.name, mid: r.variants.mid && r.variants.mid.status, lowReason: r.variants.low && r.variants.low.reason });
  }
  check('E2', 'pending with mid but no low are blocked by no-benefit-vs-mid (sampled)',
    pendMidOk.length === 0 || (lowSamples.length > 0 && lowSamples.every((s) => s.lowReason === 'no-benefit-vs-mid')),
    `blocked=${pendMidOk.length} samples=${JSON.stringify(lowSamples)}`);

  const noMidSamples = [];
  for (const m of pendNoMid.slice(0, 2)) {
    const r = await generateLodVariants(m.absPath);
    noMidSamples.push({
      name: m.name, srcTris: countTrisExact(m.absPath),
      err: r.variants.mid && r.variants.mid.error ? String(r.variants.mid.error).split('\n')[0] : null,
    });
  }
  check('E2', 'pending without mid are toolchain-limited (Draco compressed input)',
    pendNoMid.length === 0 || (noMidSamples.length > 0 && noMidSamples.every((s) => /Draco/i.test(s.err || ''))),
    JSON.stringify(noMidSamples));
  check('E2', 'no pending entry is an unexplained failure',
    pendMidOk.length + pendNoMid.length === pending.length && pending.length <= 20,
    `pending=${pending.length} blocked(low)=${pendMidOk.length} unsupported(input)=${pendNoMid.length}`);

  // 修正后的统计口径（2026-09-11 用户确认）
  check('E2', 'scanStatus counts per variant base (no X.glb / X_dec.glb double counting)',
    st.total > 0 && st.total < 200 && st.superseded >= 20,
    `total=${st.total} (按文件计数时曾为 264) superseded aliases=${st.superseded}`);
  check('E2', 'DB-backed models are no longer misreported as missing source',
    st.missingSource === 0,
    `missingSource=${st.missingSource} (修复前为 113：path.isAbsolute 把 /models/... 当绝对路径)`);
  check('E2', 'low-benefit-rejected models carry skip marker and leave the pending list',
    st.lowBenefitSkipped >= 7 && pending.filter((m) => m.hasMid && !m.hasLow && m.hasLowSkip).length === 0,
    `lowBenefitSkipped=${st.lowBenefitSkipped} pending=${st.pending} (修复前恒为 15 且永远清不掉)`);

  // ---------- E3/E4 全语料分布（直接扫磁盘，不依赖任何一次运行的报告） ----------
  const corpus = buildCorpus();
  const eligible = corpus.filter((c) => c.eligible);
  const withMid = eligible.filter((c) => c.midTris > 0);
  const withLow = eligible.filter((c) => c.lowTris > 0);
  const midPcts = withMid.map((c) => c.midPct);
  const lowPcts = withLow.map((c) => c.lowPct);
  const sumMid = withLow.reduce((s, c) => s + c.midTris, 0);
  const sumLow = withLow.reduce((s, c) => s + c.lowTris, 0);
  const lowVsMidAgg = sumMid ? +(sumLow / sumMid * 100).toFixed(1) : 0;
  const lowMedian = median(lowPcts);
  const useful = withLow.filter((c) => c.lowVsMidPct <= 70).length;
  const uselessLow = withLow.filter((c) => c.lowVsMidPct >= 95).length;
  const lowRatioSum = withLow.reduce((s, c) => s + c.lowTris, 0);
  const srcSum = withLow.reduce((s, c) => s + c.srcTris, 0);
  console.log(`\ncorpus: distinct=${corpus.length} eligible=${eligible.length}`
    + ` withMid=${withMid.length} withLow=${withLow.length} lowPolySkipped=${corpus.length - eligible.length}`);
  console.log(`mid ratio: median=${median(midPcts)}% max=${midPcts.length ? Math.max(...midPcts) : 0}%`);
  console.log(`low: median(of src)=${lowMedian}% | low/mid aggregate=${lowVsMidAgg}% (drop ${(100 - lowVsMidAgg).toFixed(1)}%)`
    + ` | useful(<=70% of mid)=${useful}/${withLow.length} | useless(>=95%)=${uselessLow}`);

  check('E3', 'mid model ratio median <= 40% of source (spec 2.2 relative target)',
    median(midPcts) <= 40 && withMid.length > 50,
    `distinct eligible=${eligible.length} withMid=${withMid.length} median=${median(midPcts)}% max=${Math.max(...midPcts)}%`);
  check('E4', 'low model brings real gain: aggregate low/mid <= 70%', lowVsMidAgg > 0 && lowVsMidAgg <= 70,
    `sumMid=${sumMid} sumLow=${sumLow} aggregate=${lowVsMidAgg}% (drop ${(100 - lowVsMidAgg).toFixed(1)}%)`);
  check('E4', '>=70% of models get a low model at least 30% lighter than mid',
    withLow.length > 0 && useful / withLow.length >= 0.7,
    `${useful}/${withLow.length} (useless>=95%: ${uselessLow})`);
  check('E4', 'low ratio of source: median <= 22% (spec 2.2)', lowMedian > 0 && lowMedian <= 22, `median=${lowMedian}%`);
  // 低模「面数收益≈0」也**必须保留**（2026-09-11 用户决策，曾试 +5% 余量清理后回退）：
  //   前端 worldInstanceMerger_v2.js 的 farLimit = (lodOn && lowReady) ? 400 : 200，
  //   低模文件缺失会把该组合批组远界从 400m 回落到 200m → 200~400m 只剩蓝方块。
  //   实测受影响 16 组 / 381 实例（红军群主力）。
  check('E4', 'low models with ~zero triangle gain are intentionally KEPT (they gate the 200~400m band)',
    uselessLow >= 16,
    `uselessLow(>=95% of mid)=${uselessLow}，其中 16 件对应 381 个红军群实例的 200~400m 带渲染`);
  const noLowNoMarker = eligible.filter((c) => c.midTris > 0 && c.lowTris === 0 && !c.hasSkip);
  check('E4', 'every model with a mid model either has a low model or a skip marker (complete coverage)',
    noLowNoMarker.length === 0,
    `mid但无低模且无标记的=${noLowNoMarker.length} (有标记=真实收益闸门拦下 ${eligible.filter((c) => c.hasSkip).length} 件)`);
  check('E4', 'low band vs mid band is a real GPU win (aggregate low tris share of source <= 22%)',
    srcSum > 0 && (lowRatioSum / srcSum * 100) <= 22, `lowTris/srcTris=${(lowRatioSum / srcSum * 100).toFixed(1)}%`);

  // ---------- E5 幂等抽样 ----------
  const sample = withMid.slice(0, 8);
  const idem = [];
  for (const s of sample) {
    const p = lodPaths(s.entryAbs);
    const m0 = fs.existsSync(p.midPath) ? fs.statSync(p.midPath).mtimeMs : 0;
    const l0 = fs.existsSync(p.lowPath) ? fs.statSync(p.lowPath).mtimeMs : 0;
    const r = await generateLodVariants(s.entryAbs);
    const m1 = fs.existsSync(p.midPath) ? fs.statSync(p.midPath).mtimeMs : 0;
    const l1 = fs.existsSync(p.lowPath) ? fs.statSync(p.lowPath).mtimeMs : 0;
    idem.push({
      name: s.entry, mid: r.variants.mid && r.variants.mid.status, low: r.variants.low && r.variants.low.status,
      midUnchanged: m0 === m1, lowUnchanged: l0 === l1,
    });
  }
  check('E5', 'idempotent: sampled variants report exists with unchanged mtime',
    idem.length === 8 && idem.every((x) => x.mid === 'exists' && x.midUnchanged && (x.low === 'exists' ? x.lowUnchanged : true)),
    `${idem.length} sampled, sample=${JSON.stringify(idem[0])}`);

  // ---------- E6 生成源修复 ----------
  const pairs = [];
  fs.readdirSync(UPLOAD_DIR).filter((f) => /_dec\.glb$/i.test(f)).slice(0, 6).forEach((f) => {
    const plainAbs = path.join(UPLOAD_DIR, f.replace(/_dec\.glb$/i, '.glb'));
    if (!fs.existsSync(plainAbs)) return;
    const decAbs = path.join(UPLOAD_DIR, f);
    pairs.push({
      plain: path.basename(plainAbs), fromPlain: path.basename(resolveLodSource(plainAbs)),
      fromDec: path.basename(resolveLodSource(decAbs)), sameVariant: lodPaths(plainAbs).midPath === lodPaths(decAbs).midPath,
    });
  });
  check('E6', 'generation source prefers sibling _dec.glb (spec 2.2); both entries share one variant file',
    pairs.length > 0 && pairs.every((p) => p.fromPlain.endsWith('_dec.glb') && p.fromDec.endsWith('_dec.glb') && p.sameVariant),
    `pairs=${pairs.length} sample=${JSON.stringify(pairs[0])}`);
  const report = fs.existsSync(REPORT) ? JSON.parse(fs.readFileSync(REPORT, 'utf8')) : null;
  const first = fs.existsSync(FIRST_REPORT) ? JSON.parse(fs.readFileSync(FIRST_REPORT, 'utf8')) : null;
  check('E6', 'full conversion actually applied the _dec source switch (report evidence)',
    !!first && (first.decSourceSwitched || 0) > 0,
    `first-run decSourceSwitched=${first ? first.decSourceSwitched : 'n/a'} of ${first ? first.processed : 'n/a'} entries`);

  // ---------- E7 无垃圾文件 ----------
  const tmpLeft = collectGlb(UPLOAD_DIR, 0, []).filter((f) => /\.tmp\.glb$/i.test(f));
  const tmpLeft2 = fs.readdirSync(UPLOAD_DIR).filter((f) => /\.tmp\.glb$/i.test(f));
  check('E7', 'no .tmp.glb leftovers in upload dir', tmpLeft.length === 0 && tmpLeft2.length === 0,
    `leftovers=${tmpLeft.length + tmpLeft2.length}`);

  // ---------- E8 回归 ----------
  if (!SKIP_REGRESSION) {
    console.log('\nrunning full regression (browser) ...');
    const r3 = runNode('accept_lod_stage5_regression.js');
    const lines = r3.out.trim().split('\n');
    console.log(lines.slice(-Math.min(lines.length, 20)).join('\n'));
    const sumLine = (r3.out.match(/SUMMARY: \d+\/\d+ passed[^\n]*/) || [])[0] || 'n/a';
    check('E8', 'full-project regression ACCEPTED (world/geometry-batch/media/3DGS/multiplayer/LOD bands)',
      r3.status === 0 && /VERDICT: ACCEPTED/.test(r3.out), `exit=${r3.status} ${sumLine}`);
  } else {
    check('E8', 'regression skipped by flag (--no-regression)', true, 'run accept_lod_stage5_regression.js separately');
  }

  // ---------- INFO：成本与磁盘 ----------
  const disk = first ? {
    beforeMB: mb(first.diskBefore.bytes), afterMB: mb(first.diskAfter.bytes),
    deltaMB: mb(first.diskDeltaBytes), deltaPct: first.diskDeltaPct,
    midDeltaMB: mb(first.diskAfter.midBytes - first.diskBefore.midBytes),
    lowDeltaMB: mb(first.diskAfter.lowBytes - first.diskBefore.lowBytes),
  } : null;
  check('INFO', 'disk footprint growth recorded (first full conversion)', true,
    disk ? `${disk.beforeMB}MB -> ${disk.afterMB}MB (+${disk.deltaMB}MB, +${disk.deltaPct}%)`
      + ` [mid +${disk.midDeltaMB}MB, low +${disk.lowDeltaMB}MB]` : 'no first-run report');
  check('INFO', 'conversion cost recorded (first full conversion)', true,
    first ? `elapsed=${first.elapsedSec}s (${(first.elapsedSec / Math.max(first.processed, 1)).toFixed(2)}s/entry)`
      + ` processed=${first.processed} ok=${first.ok} failed=${first.failed}` : 'no first-run report');
  const nowBytes = collectGlb(UPLOAD_DIR, 0, []).reduce((s, f) => {
    try { return s + fs.statSync(f).size; } catch (_) { return s; }
  }, 0);
  const netDelta = first ? nowBytes - first.diskBefore.bytes : 0;
  check('INFO', 'current .glb footprint (all variants included, margin kept at 1)', true,
    first ? `${mb(first.diskBefore.bytes)}MB -> ${mb(nowBytes)}MB (net +${mb(netDelta)}MB,`
      + ` +${(netDelta / first.diskBefore.bytes * 100).toFixed(1)}%)` : `${mb(nowBytes)}MB`);

  // ---------- 输出 ----------
  try {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(path.join(OUT_DIR, 'conversion_stats.json'), JSON.stringify({
      at: new Date().toISOString(),
      corpus: { distinct: corpus.length, eligible: eligible.length, withMid: withMid.length, withLow: withLow.length },
      distribution: {
        midRatioMedian: median(midPcts), midRatioMax: Math.max(...midPcts),
        lowRatioMedian: lowMedian, lowVsMidAggregate: lowVsMidAgg,
        usefulLow_lt70pctOfMid: useful, uselessLow_ge95pct: uselessLow,
      },
      pendingAfter: { total: st.pending, blockedLow: pendMidOk.length, unsupportedInput: pendNoMid.length },
      firstRun: first ? {
        elapsedSec: first.elapsedSec, processed: first.processed, ok: first.ok, failed: first.failed,
        decSourceSwitched: first.decSourceSwitched, disk, failures: first.failures || [],
      } : null,
    }, null, 2), 'utf8');
  } catch (e) { console.log('write stats failed: ' + e.message); }

  const failed = checks.filter((c) => !c.pass);
  console.log('\n=== Results ===');
  checks.forEach((c) => console.log(`${c.pass ? 'PASS' : 'FAIL'} [${c.id}] ${c.title} -- ${c.detail}`));
  console.log(`\nSUMMARY: ${checks.length - failed.length}/${checks.length} passed, failed=${failed.length}`);
  console.log(failed.length === 0 ? 'VERDICT: ACCEPTED' : 'VERDICT: REJECTED');
  process.exit(failed.length === 0 ? 0 : 1);
})();
