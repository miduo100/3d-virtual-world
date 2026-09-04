/**
 * r185 阶段 4：基线（r128）vs 对照（r185）截图 PSNR 对比
 * ------------------------------------------------------------------
 * 用法：node scripts/compare_baseline_psnr.js
 * 读取 Screenshot/baseline_r128/ 与 Screenshot/baseline_r185/ 同名 PNG，
 * 输出每张图的 PSNR(dB)、差异像素比例（|Δ|>10 计为差异）、平均通道偏差，
 * 以及差异最大的前 5 个像素的位置（帮助定位差异区域）。
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const DIR_A = path.join(__dirname, '..', 'Screenshot', 'baseline_r128');
const DIR_B = path.join(__dirname, '..', 'Screenshot', 'baseline_r185');
const DIFF_THRESHOLD = 10; // 通道差绝对值超过此值计为差异像素
const TOP_N = 5;

async function load(file) {
  const img = sharp(file);
  const { width, height, channels } = await img.metadata();
  // 统一拉平为 3 通道 RGB，保证对比口径一致
  const data = await img.removeAlpha().raw().toBuffer();
  return { data, width, height, channels: 3 };
}

async function compare(name) {
  const a = await load(path.join(DIR_A, name));
  const b = await load(path.join(DIR_B, name));
  if (a.width !== b.width || a.height !== b.height) {
    return { name, error: `size mismatch ${a.width}x${a.height} vs ${b.width}x${b.height}` };
  }
  const n = a.width * a.height;
  let se = 0;
  let diffPixels = 0;
  let sumAbs = 0;
  const hot = [];
  for (let i = 0; i < n; i++) {
    let pse = 0, pAbs = 0;
    for (let c = 0; c < 3; c++) {
      const va = a.data[i * 3 + c];
      const vb = b.data[i * 3 + c];
      const d = va - vb;
      pse += d * d;
      pAbs += Math.abs(d);
    }
    se += pse;
    sumAbs += pAbs / 3;
    if (pse / 3 > DIFF_THRESHOLD * DIFF_THRESHOLD) {
      diffPixels++;
      hot.push({ x: i % a.width, y: (i / a.width) | 0, se: pse / 3 });
    }
  }
  const mse = se / (n * 3);
  const psnr = mse === 0 ? Infinity : 10 * Math.log10((255 * 255) / mse);
  hot.sort((p, q) => q.se - p.se);
  return {
    name,
    psnr: psnr === Infinity ? 'INF' : psnr.toFixed(2),
    diffPct: ((diffPixels / n) * 100).toFixed(3),
    meanAbs: (sumAbs / n).toFixed(3),
    hot: hot.slice(0, TOP_N).map((p) => `(${p.x},${p.y})`),
  };
}

(async () => {
  const files = fs.readdirSync(DIR_A).filter((f) => f.endsWith('.png'))
    .filter((f) => fs.existsSync(path.join(DIR_B, f)));
  console.log('comparing ' + files.length + ' pairs (threshold |diff|>' + DIFF_THRESHOLD + ')\n');
  console.log('name                        | PSNR(dB) | diff%  | meanAbs | hot pixels');
  console.log('----------------------------|----------|--------|---------|---------------------------');
  for (const f of files) {
    const r = await compare(f);
    if (r.error) {
      console.log(f.padEnd(28) + ' | ERROR: ' + r.error);
      continue;
    }
    console.log(
      r.name.padEnd(28) + ' | ' +
      String(r.psnr).padStart(8) + ' | ' +
      String(r.diffPct).padStart(6) + ' | ' +
      String(r.meanAbs).padStart(7) + ' | ' +
      r.hot.join(' ')
    );
  }
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
