/**
 * coords —— 相对偏移 → 绝对坐标的唯一换算（自 missionRunner 拆出 · 2026-10-14）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 为什么存在：validatePlan 的区域裁剪与 runner 落件**必须用同一套换算**——
 * 旧裁剪只做 `bounds.x + anchor.dx + part.dx`，漏了 anchor 钳制/默认居中，
 * 与 absoluteOf 判定不一致 → 裁剪形同虚设（实测 path1 出界件直通 boundsGuard）。
 * 换算只有一处，两端永远一致。
 */
'use strict';

const gridsnap = require('../regions/gridsnap');

function num(v, def) { const n = Number(v); return isFinite(n) ? n : def; }

/** 相对偏移 → 绝对坐标（吸附后）。与 missionRunner.absoluteOf 同一函数（后者转发至此）。 */
function absoluteOf(region, block, part) {
  const b = region.bounds || {};
  const minX = num(b.minX, num(b.x, 0));
  const minZ = num(b.minZ, num(b.z, 0));
  const maxX = num(b.maxX, minX + num(b.width, 0));
  const maxZ = num(b.maxZ, minZ + num(b.depth, 0));
  // ★ 模型经常把 block.anchor 写成 (0,0) → 整块落点贴在区域角点 → 距边 0 < 半足迹
  //   → 全部 OUT_OF_BOUNDS、0 件落地（实测 3 连）。anchor 缺省/为 0 时默认放区域【中部】
  //   （否则所有委托都钳到同一个角点，历次 AI 资产在角落堆成密簇，换位螺旋全灭——实测"换位4建了1"）；
  //   非零 anchor 钳进区域内侧（留 3m 边距）。零件最终落点仍走 boundsGuard，围栏红线不变。
  const margin = 3;
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
  const anchorDx = num(block.anchor && block.anchor.dx, 0);
  const anchorDz = num(block.anchor && block.anchor.dz, 0);
  const midX = (minX + maxX) / 2, midZ = (minZ + maxZ) / 2;
  const rawX = (anchorDx === 0 && anchorDz === 0) ? midX : minX + anchorDx;
  const rawZ = (anchorDx === 0 && anchorDz === 0) ? midZ : minZ + anchorDz;
  const baseX = clamp(rawX, minX + margin, Math.max(minX + margin, maxX - margin));
  const baseZ = clamp(rawZ, minZ + margin, Math.max(minZ + margin, maxZ - margin));
  // ★ recipe 块（AI 自由拼装）：引擎已沿骨架**均分**出精确尺寸（实测 20m 骨架 → 间距 2.857m），
  //   若这里再按"零件自身尺寸"吸附（roadTile 3m），间距 < 模数必然有两块塌到同一格位
  //   → 被幂等去重吃掉 → 实测落库只剩 7 件、跨度 18m，短了整整 2m（E2E 实测 -2m）。
  //   吸附模数对齐模块化建筑是对的（判据 P35-8 的墙），但连续结构必须保住骨架尺寸 →
  //   recipe 块改用米级吸附（累计误差 ≤0.5m）。普通块行为**逐字节不变**。
  const unit = (block && block.mode === 'recipe')
    ? [1, 1, 1]
    : (Array.isArray(part.grid) && part.grid.length === 3 && part.grid[0] > 0 ? part.grid : gridsnap.unitOf(region.gridsnap));
  const snapped = gridsnap.snap({ x: baseX + num(part.dx, 0), z: baseZ + num(part.dz, 0), y: 0 }, unit, part.level);
  return { x: snapped.x, y: snapped.y, z: snapped.z, unit };
}

module.exports = { absoluteOf, num };
