'use strict';
/** 从 LDraw 库按标题关键词挑选建筑常用件 → ldraw_parts_manifest.json */
const fs = require('fs');
const path = require('path');
const LIB = process.argv[2] || '.tmp_ldraw/ldraw/ldraw';
const partsDir = path.join(LIB, 'parts');
const RULES = [
  { role: 'wall',   re: /^Brick\s+\d+\s*[x×]\s*\d+/i, max: 40 },          // 标准砖（墙主体）
  { role: 'floor',  re: /^Plate\s+\d+\s*[x×]\s*\d+/i, max: 30 },          // 板（地板/屋面）
  { role: 'roof',   re: /^Slope(?!.*Inverted)|^Roof/i, max: 30 },         // 斜坡/屋顶
  { role: 'door',   re: /^Door|^Garage/i, max: 12 },
  { role: 'window', re: /^Window|^Traped/i, max: 12 },
  { role: 'column', re: /^Brick\s+\d+\s*[x×]\s*\d+\s*(Round|Column)|^Round Brick/i, max: 10 },
  { role: 'railing',re: /Fence|Railing|Pickup/i, max: 8 },
  { role: 'trim',   re: /^Tile\s+\d+\s*[x×]\s*\d+/i, max: 15 },
];
const EXCLUDE = /Sticker|Pattern|Printed|with\s+(Dark|Light|White|Black|Red|Blue)/i;  // 贴纸/印刷件对拼装无用
// ★ 经典编号优先内置（2026-10-14）：这些是最通用的建筑件，正则搜索可能漏掉
const CLASSIC = [
  ['3001', 'wall'], ['3003', 'wall'], ['3004', 'wall'], ['3010', 'wall'], ['2456', 'wall'],
  ['3011', 'wall'], ['3005', 'wall'], ['2357', 'wall'], ['2450', 'column'], ['3062b', 'column'],
  ['3941', 'column'], ['3020', 'floor'], ['3021', 'floor'], ['3022', 'floor'], ['3710', 'floor'], ['3666', 'floor'],
  ['3039', 'roof'], ['3040', 'roof'], ['3298', 'roof'], ['4871', 'roof'], ['30499', 'roof'],
];
const pickedMap = new Map();
for (const [num, role] of CLASSIC) {
  const f = num + '.dat';
  if (fs.existsSync(path.join(partsDir, f))) pickedMap.set(f, { part: f, title: num + ' (classic)', role: role });
}
const files = fs.readdirSync(partsDir).filter((f) => f.endsWith('.dat'));
for (const f of files) {
  if (pickedMap.size >= 200) break;
  let title = '';
  try {
    const head = fs.readFileSync(path.join(partsDir, f), 'utf8').split('\n').slice(0, 3).join('\n');
    const m = head.match(/^0\s+(.+)$/m);
    if (m) title = m[1].trim();
  } catch (e) { continue; }
  if (EXCLUDE.test(title)) continue;
  if (pickedMap.has(f)) continue;
  for (const r of RULES) {
    if (r.count >= r.max) continue;
    if (r.re.test(title)) {
      pickedMap.set(f, { part: f, title: title, role: r.role });
      r.count = (r.count || 0) + 1;
      break;
    }
  }
}
const picked = Array.from(pickedMap.values());   // ★ 循环后从 map 重建（快照 bug）
const byRole = {};
picked.forEach((p) => { byRole[p.role] = (byRole[p.role] || 0) + 1; });
console.log('挑选 ' + picked.length + ' 件: ' + JSON.stringify(byRole));
fs.writeFileSync('scripts/ldraw_parts_manifest.json', JSON.stringify({ generatedAt: new Date().toISOString(), scale: 17.5, items: picked }, null, 1));
console.log('清单: scripts/ldraw_parts_manifest.json');
picked.slice(0, 10).forEach((p) => console.log('  ' + p.role.padEnd(8) + p.part.padEnd(16) + p.title));
