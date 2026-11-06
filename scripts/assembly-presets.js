/**
 * assembly-presets.js —— 装配预设（模板库雏形 · M1-2）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 一个 preset = 一套「墙 + 门窗 + 楼板 + 屋顶（+ 山墙）」的成套组合。
 * ★ 尺寸不是自由的：屋顶件的比例决定了房子长宽比（见 M1 文档 R1）。
 *
 * 字段说明
 *   width/depth   墙中线尺寸（米），必须能被 wall 件宽度整除
 *   wallHeight    层高（取墙件高度，避免堆叠补足）
 *   edges[]       四条边的分段计划，plan 数组长度 = 边长 / 件宽
 *   roof.mode     whole=整块单件（比例固定，需配尺寸） | tile=按件平铺
 *   gable         可选，三角山墙（这套件里属于 roof 类，不在 wall 类）
 */

const MEDIEVAL_PACK = 'gltf_2';
const DOWNTOWN_PACK = 'downtown_city_megakit';

module.exports = {
  /** 例 1 · 已验证（2026-11-06）：接缝 0.0000m，出檐 0.92/0.91m */
  medieval_6x10: {
    name: '中世纪小屋 · 6×10m',
    note: '出檐 0.92/0.91m · 山墙封闭 · 墙面 0 缝',
    width: 6,
    depth: 10,
    wallHeight: 3.12,
    pack: MEDIEVAL_PACK,
    parts: {
      wall: 'Wall_Plaster_Straight',
      door: 'Wall_Plaster_Door_Flat',
      window: 'Wall_Plaster_Window_Wide_Round',
      floor: 'Floor_WoodDark',
      roof: 'Roof_RoundTiles_6x10',
      gable: 'Roof_Front_Brick6',
    },
    edges: [
      { name: '南 +X', a: [-3, -5], b: [3, -5], plan: ['window', 'door', 'window'] },
      { name: '东 +Z', a: [3, -5], b: [3, 5], plan: ['wall', 'window', 'wall', 'wall', 'wall'] },
      { name: '北 −X', a: [3, 5], b: [-3, 5], plan: ['wall', 'window', 'wall'] },
      { name: '西 −Z', a: [-3, 5], b: [-3, -5], plan: ['wall', 'wall', 'window', 'wall', 'wall'] },
    ],
    roof: { mode: 'whole', dropY: 0.15 },
    gable: { y: 3.12, zOffset: 0.55, stretchToRidge: true },
  },

  /** 例 2 · 现代平房：验证「规则能否跨风格通用」 */
  downtown_8x6: {
    name: '现代平房 · 8×6m',
    note: '平顶 · 墙 2m 模数 · 门框墙同尺寸可替换',
    width: 8,
    depth: 6,
    wallHeight: 3.0,
    pack: DOWNTOWN_PACK,
    parts: {
      wall: 'Metal_FirstFloor_Wall',
      door: 'DoorFrame_Metal_Single',
      window: 'Metal_FullWindow',
      floor: 'Floor_2x2',
      roof: 'Roof_2x2',
    },
    edges: [
      { name: '南 +X', a: [-4, -3], b: [4, -3], plan: ['window', 'door', 'window', 'wall'] },
      { name: '东 +Z', a: [4, -3], b: [4, 3], plan: ['wall', 'window', 'wall'] },
      { name: '北 −X', a: [4, 3], b: [-4, 3], plan: ['window', 'wall', 'wall', 'window'] },
      { name: '西 −Z', a: [-4, 3], b: [-4, -3], plan: ['wall', 'window', 'wall'] },
    ],
    roof: { mode: 'tile', dropY: 0.05, eave: 0.31 },
  },

  /** 例 3 · Kenney 模块化：1m 宽 × 0.625m 高的积木式模数，层高需堆 4 排 */
  kenney_8x6: {
    name: 'Kenney 模块化 · 8×6m',
    note: '1m 模数 · 墙块 0.625m 高需堆 4 排 · 无 floor 件',
    width: 8,
    depth: 6,
    wallHeight: 2.5,
    pack: 'kenney_modular_buildings',
    parts: {
      wall: 'building_block',
      door: 'building_door',
      roof: 'roof_flat_center',
    },
    edges: [
      { name: '南 +X', a: [-4, -3], b: [4, -3], plan: Array(8).fill('wall') },
      { name: '东 +Z', a: [4, -3], b: [4, 3], plan: Array(6).fill('wall') },
      { name: '北 −X', a: [4, 3], b: [-4, 3], plan: Array(8).fill('wall') },
      { name: '西 −Z', a: [-4, 3], b: [-4, -3], plan: Array(6).fill('wall') },
    ],
    doorSlot: { edge: '南 +X', index: 3, rows: [0, 1, 2, 3] },
    roof: { mode: 'tile', dropY: 0.02, eave: 0.8 },
  },
};
