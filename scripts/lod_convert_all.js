/**
 * lod_convert_all.js — LOD 三版模型方案【阶段 5】全量转换执行脚本
 *
 * 用途：把 uploaded_models + 上传目录里所有「待生成」的存量模型补齐 _mid.glb / _lod.glb。
 *       走的是与上传管线 / 管理接口完全相同的服务（src/services/modelLod.js），
 *       只是跳过 HTTP 分批（每批 3 个）带来的 49 次往返，便于统计耗时与磁盘增量。
 *
 * 用法：
 *   node scripts/lod_convert_all.js --dry          只扫描并打印工作量，不生成任何文件
 *   node scripts/lod_convert_all.js                全量转换（幂等，可重复执行续做）
 *   node scripts/lod_convert_all.js --limit 20     只处理前 20 个（调试用）
 *
 * 输出：
 *   1. 控制台逐条进度（中文一律用 unicode escape，避免 PowerShell GBK 问题）
 *   2. JSON 报告 Screenshot/accept_lod_stage5/lod_convert_report.json
 *      （含 pendingBefore / 每个模型的 src-mid-low 面数与字节数 / 失败跳过清单 / 磁盘前后）
 *
 * 失败策略：单个模型失败只记录，不中断；不留垃圾文件（服务内部 .tmp.glb + 原子 rename）。
 */
const fs = require('fs');
const path = require('path');
const {
  scanStatus, generateLodVariants, countTrisExact, lodPaths, lowSkipPath,
  resolveLodSource, UPLOAD_DIR, MIN_SOURCE_TRIS, LOW_BENEFIT_MARGIN,
} = require('../src/services/modelLod');

const args = process.argv.slice(2);
const DRY = args.includes('--dry');
// --prune-low：按 LOW_BENEFIT_MARGIN（+5%）回收「低模相对中模无收益」的历史低模文件，
// 并写入 _lod.skip.json 标记让 scanStatus 不再把它们算作待生成（2026-09-11 用户决策 follow-through）
const PRUNE_LOW = args.includes('--prune-low');
const limitIdx = args.indexOf('--limit');
const LIMIT = limitIdx >= 0 ? (parseInt(args[limitIdx + 1], 10) || 0) : 0;

const REPORT_DIR = path.join(__dirname, '..', 'Screenshot', 'accept_lod_stage5');
const REPORT_PATH = path.join(REPORT_DIR, 'lod_convert_report.json');

/** 递归统计上传目录下 .glb 的总字节数与文件数（跳过备份目录与临时文件） */
function measureGlbFootprint(dir, depth, acc) {
  if (depth > 3) return acc;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return acc; }
  entries.forEach((ent) => {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (/^_?backup/i.test(ent.name)) return;
      measureGlbFootprint(full, depth + 1, acc);
      return;
    }
    if (!/\.glb$/i.test(ent.name) || /\.tmp\.glb$/i.test(ent.name)) return;
    try {
      acc.bytes += fs.statSync(full).size;
      acc.files += 1;
      if (/_mid\.glb$/i.test(ent.name)) { acc.midFiles += 1; acc.midBytes += fs.statSync(full).size; }
      else if (/_lod\.glb$/i.test(ent.name)) { acc.lowFiles += 1; acc.lowBytes += fs.statSync(full).size; }
      else { acc.srcFiles += 1; acc.srcBytes += fs.statSync(full).size; }
    } catch (_) { /* ignore */ }
  });
  return acc;
}

const mb = (b) => (b / 1048576).toFixed(1);
const pct = (n, d) => (d > 0 ? ((n / d) * 100).toFixed(1) : '?');

/** 递归收集 .glb（跳过备份目录与 .tmp） */
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
 * 按收益余量回收「低模相对中模无收益」的历史低模文件，并写 _lod.skip.json 标记。
 *
 * ⚠️ 当前策略下是 **no-op**（LOW_BENEFIT_MARGIN = 1）：
 *   阶段 5 实测过 +5% 余量，发现低模文件缺失会让该组合批组远界由 400m 回落到 200m
 *   （200~400m 变蓝方块，影响 16 组 / 381 实例），用户已决定撤销，故余量回到 1。
 *   本函数保留作为「若未来渲染端改成低模缺失时用中模兜底、远界按中模就绪判定」后的配套工具。
 */
async function pruneUselessLow(dry) {
  const byBase = new Map();
  collectGlb(UPLOAD_DIR, 0, []).forEach((abs) => {
    if (/(_mid|_lod)\.glb$/i.test(abs)) return;
    const p = lodPaths(abs);
    const key = (path.dirname(abs) + '|' + p.base).toLowerCase();
    const isDec = /_dec\.glb$/i.test(abs);
    const prev = byBase.get(key);
    if (!prev || (isDec && !prev.isDec)) byBase.set(key, { abs, isDec, midPath: p.midPath, lowPath: p.lowPath });
  });

  if (LOW_BENEFIT_MARGIN <= 1) {
    console.log('prune-low: skipped — LOW_BENEFIT_MARGIN = ' + LOW_BENEFIT_MARGIN
      + '（当前策略：低模缺失会把该组远界从 400m 回落到 200m，不允许回收）');
    return { count: 0, freed: 0, skipped: true };
  }

  const hits = [];
  byBase.forEach((e) => {
    if (!fs.existsSync(e.midPath) || !fs.existsSync(e.lowPath)) return;
    const midTris = countTrisExact(e.midPath);
    const lowTris = countTrisExact(e.lowPath);
    if (midTris <= 0 || lowTris < midTris * LOW_BENEFIT_MARGIN) return;
    hits.push({
      base: path.basename(e.lowPath), midTris, lowTris,
      lowVsMidPct: +(lowTris / midTris * 100).toFixed(1),
      size: fs.statSync(e.lowPath).size, lowPath: e.lowPath,
    });
  });

  let freed = 0;
  for (const h of hits) {
    freed += h.size;
    if (dry) { console.log(`  PRUNE(dry) ${h.base} mid=${h.midTris} low=${h.lowTris} (${h.lowVsMidPct}% of mid) -${mb(h.size)}MB`); continue; }
    try {
      fs.unlinkSync(h.lowPath);
      fs.writeFileSync(lowSkipPath(h.lowPath), JSON.stringify({
        reason: 'no-benefit-vs-mid', midTris: h.midTris, lowTris: h.lowTris,
        note: `pruned at margin ${LOW_BENEFIT_MARGIN}`, at: new Date().toISOString(),
      }), 'utf8');
      console.log(`  PRUNED ${h.base} mid=${h.midTris} low=${h.lowTris} (${h.lowVsMidPct}% of mid) -${mb(h.size)}MB`);
    } catch (err) {
      console.log(`  PRUNE-FAIL ${h.base}: ${err.message}`);
    }
  }
  console.log(`prune-low: ${hits.length} useless low models${dry ? ' (dry run, nothing deleted)' : ''}, freed ${mb(freed)}MB`);
  return { count: hits.length, freed };
}

(async () => {
  const t0 = Date.now();
  console.log('=== LOD Stage 5 full conversion ===');
  const status = await scanStatus();
  const pendingAll = status.pendingList || [];
  const pending = LIMIT > 0 ? pendingAll.slice(0, LIMIT) : pendingAll;

  const diskBefore = measureGlbFootprint(UPLOAD_DIR, 0, {
    bytes: 0, files: 0, srcFiles: 0, midFiles: 0, lowFiles: 0, srcBytes: 0, midBytes: 0, lowBytes: 0,
  });

  console.log(`scan: total=${status.total} mid=${status.midCount} low=${status.lowCount} pending=${status.pending}`
    + ` lowPolySkipped=${status.lowPolySkipped} missingSource=${status.missingSource}`);
  console.log(`disk before: ${mb(diskBefore.bytes)}MB / ${diskBefore.files} files`
    + ` (src=${diskBefore.srcFiles}/${mb(diskBefore.srcBytes)}MB mid=${diskBefore.midFiles}/${mb(diskBefore.midBytes)}MB low=${diskBefore.lowFiles}/${mb(diskBefore.lowBytes)}MB)`);
  console.log(`batch size: ${pending.length}${LIMIT > 0 ? ' (limited)' : ''}`);

  if (DRY) {
    let trisSum = 0;
    pending.forEach((p, i) => {
      const t = countTrisExact(p.absPath);
      trisSum += t;
      console.log(`  ${String(i + 1).padStart(3)} tris=${String(t).padStart(8)} ${p.name}`);
    });
    console.log(`\ndry summary: pending=${pending.length} sourceTris=${trisSum.toLocaleString('en-US')} (no file written)`);
    if (PRUNE_LOW) await pruneUselessLow(true);
    process.exit(0);
  }

  let prunedLow = null;
  if (PRUNE_LOW) prunedLow = await pruneUselessLow(false);

  const results = [];
  let ok = 0; let failed = 0; let generatedFiles = 0; let bytesAdded = 0;
  let midCount = 0; let lowCount = 0; let lowBlocked = 0;

  for (let i = 0; i < pending.length; i += 1) {
    const item = pending[i];
    const p = lodPaths(item.absPath);
    const t1 = Date.now();
    const res = await generateLodVariants(item.absPath);
    const ms = Date.now() - t1;
    // 生成源可能被规范 2.2 改判（同名 _dec.glb 优先），统计口径与实际源保持一致
    const usedPath = res.sourceUsed || item.absPath;
    const srcTris = res.sourceTris || countTrisExact(usedPath);
    const srcSize = (() => { try { return fs.statSync(usedPath).size; } catch (_) { return 0; } })();

    const midTris = fs.existsSync(p.midPath) ? countTrisExact(p.midPath) : 0;
    const lowTris = fs.existsSync(p.lowPath) ? countTrisExact(p.lowPath) : 0;
    const midSize = fs.existsSync(p.midPath) ? fs.statSync(p.midPath).size : 0;
    const lowSize = fs.existsSync(p.lowPath) ? fs.statSync(p.lowPath).size : 0;

    const midStatus = res.variants && res.variants.mid ? res.variants.mid.status : null;
    const lowStatus = res.variants && res.variants.low ? res.variants.low.status : null;
    const lowReason = res.variants && res.variants.low ? res.variants.low.reason || null : null;
    if (midStatus === 'generated') { generatedFiles += 1; bytesAdded += midSize; }
    if (lowStatus === 'generated') { generatedFiles += 1; bytesAdded += lowSize; }
    if (midTris > 0) midCount += 1;
    if (lowTris > 0) lowCount += 1;
    if (lowReason && /no-benefit-vs-mid/.test(lowReason)) lowBlocked += 1;

    const rec = {
      name: item.name, absPath: item.absPath, ok: !!res.ok,
      skipped: !!res.skipped, reason: res.reason || null, ms,
      sourceUsed: usedPath, usedDecSource: usedPath !== item.absPath,
      srcTris, srcSize, midTris, midSize, lowTris, lowSize,
      midStatus, lowStatus, lowReason,
      midPct: srcTris ? +(midTris / srcTris * 100).toFixed(1) : null,
      lowPct: srcTris ? +(lowTris / srcTris * 100).toFixed(1) : null,
      lowVsMidPct: midTris ? +(lowTris / midTris * 100).toFixed(1) : null,
    };
    results.push(rec);

    if (res.ok) ok += 1; else failed += 1;
    const tag = res.ok ? 'OK  ' : 'FAIL';
    console.log(`  ${tag} ${String(i + 1).padStart(3)}/${pending.length} src=${srcTris} mid=${midTris}(${rec.midPct}%)`
      + ` low=${lowTris}(${rec.lowPct}%, vsMid ${rec.lowVsMidPct}%) +${mb(midSize + lowSize)}MB ${ms}ms`
      + `${rec.usedDecSource ? ' [src=_dec]' : ''} ${item.name}${res.ok ? '' : ' reason=' + (lowReason || res.reason)}`);
  }

  const diskAfter = measureGlbFootprint(UPLOAD_DIR, 0, {
    bytes: 0, files: 0, srcFiles: 0, midFiles: 0, lowFiles: 0, srcBytes: 0, midBytes: 0, lowBytes: 0,
  });
  const elapsedSec = +((Date.now() - t0) / 1000).toFixed(1);
  const withVariants = results.filter((r) => r.midTris > 0);
  const avgMidPct = withVariants.length
    ? +(withVariants.reduce((s, r) => s + r.midPct, 0) / withVariants.length).toFixed(1) : 0;
  const withLow = results.filter((r) => r.lowTris > 0);
  const avgLowPct = withLow.length
    ? +(withLow.reduce((s, r) => s + r.lowPct, 0) / withLow.length).toFixed(1) : 0;
  const avgLowVsMid = withLow.length
    ? +(withLow.reduce((s, r) => s + r.lowVsMidPct, 0) / withLow.length).toFixed(1) : 0;

  const summary = {
    finishedAt: new Date().toISOString(),
    elapsedSec,
    pendingBefore: pendingAll.length,
    processed: results.length,
    ok, failed,
    generatedFiles, bytesAdded,
    diskBefore, diskAfter,
    diskDeltaBytes: diskAfter.bytes - diskBefore.bytes,
    diskDeltaPct: diskBefore.bytes ? +((diskAfter.bytes / diskBefore.bytes - 1) * 100).toFixed(1) : 0,
    midCount, lowCount, lowBlocked,
    prunedLow: prunedLow || null,
    decSourceSwitched: results.filter((r) => r.usedDecSource).length,
    avgMidPct, avgLowPct, avgLowVsMid,
    results,
    failures: results.filter((r) => !r.ok).map((r) => ({ name: r.name, reason: r.lowReason || r.reason })),
    lowBlockedList: results.filter((r) => r.lowReason && /no-benefit-vs-mid/.test(r.lowReason))
      .map((r) => ({ name: r.name, midTris: r.midTris, lowTris: r.lowTris })),
  };

  try {
    fs.mkdirSync(REPORT_DIR, { recursive: true });
    // 首次全量转换的报告单独归档（幂等重跑会覆盖 REPORT_PATH，但磁盘增量只在首次有意义）
    const firstPath = path.join(REPORT_DIR, 'lod_convert_report_first.json');
    if (!fs.existsSync(firstPath) && results.some((r) => r.midStatus === 'generated' || r.lowStatus === 'generated')) {
      fs.writeFileSync(firstPath, JSON.stringify(summary, null, 2), 'utf8');
      console.log('archived first-run report: ' + firstPath);
    }
    fs.writeFileSync(REPORT_PATH, JSON.stringify(summary, null, 2), 'utf8');
  } catch (e) { console.log('write report failed: ' + e.message); }

  // 转换后再扫一次，确认 pending 归零
  const after = await scanStatus();
  console.log('\n--- summary ---');
  console.log(`elapsed: ${elapsedSec}s (${(elapsedSec / Math.max(results.length, 1)).toFixed(2)}s/model)`);
  console.log(`processed=${results.length} ok=${ok} failed=${failed} generated=${generatedFiles}`
    + ` | haveMid=${midCount} haveLow=${lowCount} lowBlocked=${lowBlocked}`);
  console.log(`ratios: mid avg=${avgMidPct}% | low avg=${avgLowPct}% of source | low avg=${avgLowVsMid}% of mid`);
  console.log(`disk: ${mb(diskBefore.bytes)}MB -> ${mb(diskAfter.bytes)}MB`
    + ` (+${mb(summary.diskDeltaBytes)}MB, +${summary.diskDeltaPct}%)`);
  console.log(`disk detail: src ${diskBefore.srcFiles}->${diskAfter.srcFiles} files / ${mb(diskBefore.srcBytes)}->${mb(diskAfter.srcBytes)}MB`
    + ` | mid ${diskBefore.midFiles}->${diskAfter.midFiles} / ${mb(diskBefore.midBytes)}->${mb(diskAfter.midBytes)}MB`
    + ` | low ${diskBefore.lowFiles}->${diskAfter.lowFiles} / ${mb(diskBefore.lowBytes)}->${mb(diskAfter.lowBytes)}MB`);
  console.log(`rescan: total=${after.total} mid=${after.midCount} low=${after.lowCount} pending=${after.pending}`
    + ` lowPolySkipped=${after.lowPolySkipped} missingSource=${after.missingSource}`);
  console.log(`report: ${REPORT_PATH}`);
  console.log('=== done ===');
  process.exit(0);
})();
