/**
 * lod_regen_low_100faces.js — 按用户决策「低模要有低模的样式：100 面以内」全量重生成低模
 *
 * 背景（2026-09-13）：全库 118 组三件套中仅红军 26 组是激进低模（二期 E），
 * 其余 92 组仍是一期旧参数（低=源 10%），教室等区域高中低视觉无差。
 * 本次按 modelLod 新逻辑（LOW_TARGET_FACES=100 定向比例 + 最多 4 轮 -sa 迭代）
 * 重生成【所有】现存低模；中模不动；贴图剥离自动执行（二期 A 口径）。
 *
 * 做法：枚举现存 *_lod.glb（天然去重 X.glb / X_dec.glb 同组）→ 旧低模移入
 * _backup_low_100faces_before/ → generateLodVariants（中模 exists 跳过，低模重生成）。
 * 用法：node scripts/lod_regen_low_100faces.js [--dry]
 */
const path = require('path');
const fs = require('fs');
const { generateLodVariants, UPLOAD_DIR, countTrisExact } = require('../src/services/modelLod');

const DRY = process.argv.includes('--dry');
const BACKUP_DIR = path.join(UPLOAD_DIR, '_backup_low_100faces_before');

async function main() {
  const lowFiles = fs.readdirSync(UPLOAD_DIR).filter((n) => /_lod\.glb$/i.test(n));
  console.log(`[regen100] existing low variants: ${lowFiles.length}`);

  let ok = 0, fail = 0, skipNoSource = 0;
  let trisBefore = 0, trisAfter = 0, reached100 = 0;
  const failures = [];

  for (const lowName of lowFiles) {
    const base = lowName.replace(/_lod\.glb$/i, '');
    // 生成源：有 _dec 用 _dec，否则原文件
    const srcName = fs.existsSync(path.join(UPLOAD_DIR, base + '_dec.glb'))
      ? base + '_dec.glb' : base + '.glb';
    const srcAbs = path.join(UPLOAD_DIR, srcName);
    if (!fs.existsSync(srcAbs)) { skipNoSource++; continue; }
    const srcTris = countTrisExact(srcAbs);
    if (srcTris <= 0) { skipNoSource++; continue; }

    const lowAbs = path.join(UPLOAD_DIR, lowName);
    const oldTris = fs.existsSync(lowAbs) ? countTrisExact(lowAbs) : 0;

    if (DRY) {
      console.log(`[regen100][dry] ${lowName} src=${srcTris} old=${oldTris}`);
      continue;
    }
    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
    if (fs.existsSync(lowAbs)) {
      const bak = path.join(BACKUP_DIR, lowName);
      if (!fs.existsSync(bak)) fs.renameSync(lowAbs, bak);
      else fs.unlinkSync(lowAbs);
    }

    const r = await generateLodVariants(srcAbs, { force: false });
    const low = r.variants && r.variants.low;
    if (low && (low.status === 'generated' || low.status === 'exists')) {
      ok++;
      trisBefore += oldTris; trisAfter += (low.tris || 0);
      if ((low.tris || 0) <= 100) reached100++;
      console.log(`[regen100] OK ${lowName}: ${oldTris} -> ${low.tris} tris (${low.status})`);
    } else {
      fail++;
      failures.push({ lowName, status: low && low.status, reason: low && low.reason, error: low && low.error });
      console.log(`[regen100] FAIL ${lowName}: status=${low && low.status} reason=${low && low.reason} err=${low && low.error}`);
      // 失败回滚旧低模，保证不比之前差
      const bak = path.join(BACKUP_DIR, lowName);
      if (fs.existsSync(bak) && !fs.existsSync(lowAbs)) fs.renameSync(bak, lowAbs);
    }
  }
  console.log(`\n[regen100] DONE ok=${ok} fail=${fail} noSource=${skipNoSource}`);

  // fixup：对仍 >100 面的现存低模（gltfpack 拓扑下限）用 glbFaceReducer 补压
  if (!DRY) {
    const { reduceGlbFaces } = require('../src/services/glbFaceReducer');
    let fixed = 0, fixFail = 0;
    for (const lowName of fs.readdirSync(UPLOAD_DIR).filter((n) => /_lod\.glb$/i.test(n))) {
      const lowAbs = path.join(UPLOAD_DIR, lowName);
      const t = countTrisExact(lowAbs);
      if (t <= 100) continue;
      try {
        // 先剥贴图（带贴图的低模无法直接坍缩——reducer 只接受纯几何文件）
        const base = lowName.replace(/_lod\.glb$/i, '');
        const srcAbs = fs.existsSync(path.join(UPLOAD_DIR, base + '_dec.glb'))
          ? path.join(UPLOAD_DIR, base + '_dec.glb') : path.join(UPLOAD_DIR, base + '.glb');
        const { stripVariantTextures } = require('../src/services/glbTextureStripper');
        if (fs.existsSync(srcAbs)) await stripVariantTextures(lowAbs, { sourcePath: srcAbs });
        const r = reduceGlbFaces(lowAbs, 100);
        if (r.ok && r.trisAfter <= 100) { fixed++; console.log(`[regen100][fixup] ${lowName}: ${t} -> ${r.trisAfter}`); }
        else { fixFail++; console.log(`[regen100][fixup] FAIL ${lowName}: ${JSON.stringify(r)}`); }
      } catch (e) { fixFail++; console.log(`[regen100][fixup] FAIL ${lowName}: ${e.message}`); }
    }
    console.log(`[regen100][fixup] fixed=${fixed} fail=${fixFail}`);
  }

  console.log(`[regen100] low tris total: ${trisBefore} -> ${trisAfter} (-${trisBefore ? Math.round((1 - trisAfter / trisBefore) * 100) : 0}%)`);
  console.log(`[regen100] <=100 faces: ${reached100}/${ok}（其余为工具下限：锁定边界顶点所致）`);
  if (failures.length) console.log('[regen100] failures:', JSON.stringify(failures, null, 1));
  if (!DRY && ok > 0) console.log(`[regen100] old low variants backed up in ${BACKUP_DIR}`);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
