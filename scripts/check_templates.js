/**
 * check_templates.js —— 模板自检（零依赖、不连数据库、不渲染）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 用途：每次改模板后跑一遍，确认「段数 / 接缝 / 件数」没有漂移。
 * 这是模板库的回归基线 —— 不用起服务器、不用开浏览器、不用查询数据库。
 *
 * 用法：node scripts/check_templates.js
 * 退出码：0 全通过 / 1 有失败
 */
'use strict';

const registry = require('../src/worldai/assembly/templateRegistry');

const r4 = (v) => Number(v.toFixed(4));

/** 纯计算模拟求解器的「累计推进」：返回段数、收尾余量、最后一段宽度 */
function simulateEdge(spec, edge) {
  const unit = Number(spec.module && spec.module.wallWidth) || 0;
  const [ax, az] = edge.a;
  const [bx, bz] = edge.b;
  const len = Math.hypot(bx - ax, bz - az);
  const pieceW = unit > 0 ? unit : len / edge.plan.length;
  const rows = Number(spec.module && spec.module.rows) || 1;

  let cursor = 0, segs = 0, lastW = 0;
  while (len - cursor > 0.02) {
    const segW = Math.min(pieceW, len - cursor);   // 最后一段不足件宽时自动收窄 = 收边
    lastW = segW;
    cursor += segW;
    segs++;
    if (segs > 500) break;
  }
  return { len: r4(len), segs, rows, tail: r4(len - cursor), lastSegW: r4(lastW) };
}

let failed = 0;
const list = registry.listTemplates();

console.log('模板自检 · 共 ' + list.length + ' 个\n');

for (const brief of list) {
  const t = registry.getTemplate(brief.id);
  const v = registry.validate(t);
  const built = registry.buildSpec(t.id);

  console.log('── ' + t.id + '  「' + t.name + '」');
  console.log('   能力 ' + t.capability + ' · 风格 ' + t.style + ' · 尺寸 ' +
    t.dimensions.width + '×' + t.dimensions.depth + 'm · 层高 ' + t.dimensions.wallHeight + 'm');

  if (!v.ok) {
    failed++;
    console.log('   ✗ 校验失败');
    v.errors.forEach((e) => console.log('     · ' + e));
    console.log('');
    continue;
  }
  console.log('   ✓ 校验通过（模数 / 段数 / 层高 / 件引用）');

  v.warnings.forEach((w) => console.log('   ⚠ ' + w));

  if (!built.ok) {
    failed++;
    console.log('   ✗ buildSpec 失败：' + built.code + ' — ' + built.reason + '\n');
    continue;
  }

  const spec = built.spec;
  let worstTail = 0, worstSegW = Infinity, totalSegs = 0;
  for (const e of spec.edges) {
    const s = simulateEdge(spec, e);
    worstTail = Math.max(worstTail, s.tail);
    worstSegW = Math.min(worstSegW, s.lastSegW);
    totalSegs += s.segs * s.rows;
    const flag = s.tail > 0.02 ? '✗' : s.lastSegW < 0.5 ? '⚠' : '✓';
    console.log(`   ${flag} ${e.name.padEnd(6)} ${s.len}m ÷ ${(s.len / e.plan.length).toFixed(3)}m = ${s.segs} 段` +
      (s.rows > 1 ? ` × ${s.rows} 排` : '') + `　收尾余量 ${s.tail}m　末段 ${s.lastSegW}m`);
  }

  const okSeam = worstTail < 0.02;
  if (!okSeam) failed++;
  console.log(`   ${okSeam ? '✓' : '✗'} 收尾余量 ${worstTail}m · 最窄收边段 ${worstSegW === Infinity ? '—' : worstSegW + 'm'} · 墙件 ${totalSegs} 件（实测 ${t.metrics ? t.metrics.pieceCount : '—'} 总件数）`);
  if (worstSegW < 0.5) {
    console.log('   ⚠ 存在 <0.5m 的收边段，视觉上可能像缺口（需收边件或改尺寸吸附）');
  }

  // 检索路径冒烟
  const found = registry.findByRequirement({
    width: t.dimensions.width, depth: t.dimensions.depth, capability: t.capability, style: t.style,
  });
  if (!found.ok || !found.exact) {
    failed++;
    console.log('   ✗ 检索未能精确命中自身：' + (found.reason || found.code));
  } else {
    console.log('   ✓ 检索精确命中自身');
  }
  console.log('');
}

console.log(failed === 0 ? '全部通过（' + list.length + '/' + list.length + '）' : '有 ' + failed + ' 处失败');
process.exit(failed === 0 ? 0 : 1);
