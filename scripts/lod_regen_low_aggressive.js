/**
 * lod_regen_low_aggressive.js — 用激进参数（-si 0.01 -sa）重生成红军族低模
 *
 * 背景（2026-09-12 二期收尾实验，用户决策「方案 1 全量改」）：
 * 红军 _dec 已两次减面到 ~8k 面，旧低模（-si 0.1）只降到 ~3900 面（拓扑下限）；
 * -sa 激进简化实测可到 ~28~29 面（0.3~0.4%），让 10~50m 低模带 GPU 负载趋近归零。
 *
 * 做法：把现有红军族 _lod.glb 移入 _backup_low_aggressive_before/ 备份目录，
 * 再走 generateLodVariants（中模 exists 跳过，低模缺失 → 新参数重生成 + 自动剥贴图）。
 * 只处理 UPLOAD_DIR 顶层的 model-1787128*_dec.glb（红军族命名段），不动其他模型。
 *
 * 用法：node scripts/lod_regen_low_aggressive.js [--dry]
 */
const path = require('path');
const fs = require('fs');
const { generateLodVariants, lodPaths, UPLOAD_DIR } = require('../src/services/modelLod');

const DRY = process.argv.includes('--dry');
const BACKUP_DIR = path.join(UPLOAD_DIR, '_backup_low_aggressive_before');
const REDARMY_DEC = /^model-1787128\d+-\d+_dec\.glb$/i;

async function main() {
  const decFiles = fs.readdirSync(UPLOAD_DIR).filter((n) => REDARMY_DEC.test(n));
  console.log(`[regen-low] redarmy _dec files: ${decFiles.length}`);

  let ok = 0; let fail = 0;
  let trisBefore = 0; let trisAfter = 0;
  for (const name of decFiles) {
    const decAbs = path.join(UPLOAD_DIR, name);
    const { lowPath } = lodPaths(decAbs);
    const lowName = path.basename(lowPath);

    if (!DRY && fs.existsSync(lowPath)) {
      if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
      fs.renameSync(lowPath, path.join(BACKUP_DIR, lowName));
    }
    const oldTris = fs.existsSync(path.join(BACKUP_DIR, lowName))
      ? require('../src/services/modelLod').countTrisExact(path.join(BACKUP_DIR, lowName)) : 0;

    if (DRY) {
      console.log(`[regen-low][dry] ${lowName} (old tris=${oldTris})`);
      continue;
    }
    const r = await generateLodVariants(decAbs, { force: false });
    const low = r.variants && r.variants.low;
    const lowOk = low && (low.status === 'generated' || low.status === 'exists');
    if (lowOk) {
      ok++;
      trisBefore += oldTris; trisAfter += (low.tris || 0);
      console.log(`[regen-low] OK ${lowName}: ${oldTris} -> ${low.tris} tris (${low.status})`);
    } else {
      fail++;
      console.log(`[regen-low] FAIL ${lowName}: status=${low && low.status} reason=${low && low.reason} err=${low && low.error}`);
    }
  }
  console.log(`[regen-low] DONE ok=${ok} fail=${fail} tris ${trisBefore} -> ${trisAfter}`);
  if (!DRY && ok > 0) {
    console.log(`[regen-low] old low variants backed up in ${BACKUP_DIR}`);
  }
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
