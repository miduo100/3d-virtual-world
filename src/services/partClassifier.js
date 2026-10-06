/**
 * 零件归类器（Phase 1 · 零件库）
 *
 * 职责：把一个已落盘的 bundle 目录，变成 part_libraries + part_library_items 记录。
 *   · 由目录名派生库名（pack_key / display_name）
 *   · 由文件名推断 part_role / 碰撞 / 堆叠规则 / LOD 策略
 *   · 由 GLB/gltf 的 POSITION accessor min/max 读出包围盒 → 模数尺寸
 *
 * 设计要点：
 *   ① 归类规则是**数据表 + 顺序匹配**，不是 if-else 链 —— 加新规则只改表。
 *   ② 包围盒直接读 glTF JSON，不做完整解析（2336 件也只要几秒）。
 *   ③ 单件失败不阻断整库（返回 warnings）。
 *
 * 纯 Node 模块，无外部依赖。
 */
const fs = require('fs');
const path = require('path');

/** 低于此面数的零件不生成 LOD 变体（与 modelLod.MIN_SOURCE_TRIS 对齐） */
const LOD_MIN_TRIS = 5000;

/**
 * 归类规则表。顺序敏感 —— 第一个命中即采用。
 * test 匹配的是：part_key 小写化并去掉 _ - 空格 后的字符串。
 * collidable: 是否阻挡玩家。lodNever: 极小件不生成变体。
 */
const RULES = [
  // ── 地面 / 路面（放最前）──────────────────────────────────────────
  { role: 'road',   test: /^(road|street|sidewalk|path|trail|track|railroad|pavement|asphalt|cobble)/, collidable: false, lodNever: true },
  { role: 'ground', test: /(ground|terrain|floorplate|dirtplane|patch)/, collidable: false, lodNever: true },
  // ⚠ arrow 必须带方向后缀，否则 "narrow"（窄）会被子串误命中
  { role: 'road',   test: /(decal|crosswalk|roadmark|manhole|stormdrain|arrow(left|right|straight|forward|turn))/i, collidable: false, lodNever: true },

  // ── 开口 / 装饰（不挡人）───────────────────────────────────────────
  { role: 'window',  test: /(window|glazing|skylight)/,                           collidable: false },
  { role: 'awning',  test: /(awning|canopy|balcony|overhang|porch)/,              collidable: false },
  { role: 'cornice', test: /(cornice|trim|molding|moulding|eaves|fascia|soffit|lintel|flatborder|roofborder)/, collidable: false, lodNever: true },
  { role: 'railing', test: /(railing|rail|balustrade|fence|barrier|border|guardrail|handrail)/, collidable: false, lodNever: true },
  { role: 'stairs',  test: /(stair|step|ramp)/,                                   collidable: true },

  // ── 结构（顺序敏感）────────────────────────────────────────────────
  //   door  先于 wall：wall-narrow-gate / wall-doorway → door
  //   column 先于 wall：wall-pillar → column ；tower-base → column
  //   wall   含 building：building-block / building-corner → wall
  //            （building-window / building-door 已被上面的规则先捕获）
  { role: 'door',   test: /(door|gate|doorway|entrance)/,                         collidable: true },
  { role: 'column', test: /(column|pillar|beam|pole|strut|antenna|mast|tower(base|mid|hexagonbase|siege)|siegetower)/, collidable: true },
  { role: 'wall',   test: /(wall|partition|panel|facade|screen|block|building)/,   collidable: true },
  { role: 'floor',  test: /(floor|deck|platform|terrace|slab|ceiling|baseline|bridge)/, collidable: true },
  { role: 'roof',   test: /(roof|rooftop|spire|dome|chimney|cap|top|tower(roof|square|slant|hexagon)?$)/, collidable: false },

  // ── 自然 ───────────────────────────────────────────────────────────
  { role: 'nature', test: /(tree|trunk|log|branch|plant|bush|shrub|fern|moss|reed|cactus|rock|stone|boulder|pebble|cliff|hill|mountain)/, collidable: true },
  { role: 'nature', test: /(grass|flower|mushroom|petal|clover|lilypad)/,        collidable: false, lodNever: true },

  // ── 陈设 / 道具（兜底）────────────────────────────────────────────
  { role: 'prop',   test: /(chair|table|desk|bed|sofa|cabinet|shelf|bench|counter|barrel|crate|chest|container|trash|lamp|light|lantern|sign|board|planter|clock|painting|rug|carpet|book|pillow|tool|weapon|toy|hydrant|bollard|fencepost|generator|ac|vent|traffic|cone|vehicle|car|truck|boat|plane)/, collidable: true, lodNever: true },
];

/** 从文件名派生 part_key：去扩展名、去 (副本)/_dec/_mid 等后缀 */
function derivePartKey(fileName) {
  let s = path.basename(fileName, path.extname(fileName));
  s = s.replace(/\s*\(\d+\)\s*$/, '');
  s = s.replace(/[（(]\d+[）)]\s*$/, '');
  s = s.replace(/_(dec|mid|lod|low|optimized|final|v\d+)$/i, '');
  s = s.replace(/[_\-\s]+/g, '_').replace(/^_+|_+$/g, '');
  return (s || path.basename(fileName)).slice(0, 80);
}

/** 规则匹配 → { role, collidable, lodNever } */
function classifyByName(partKey) {
  const k = String(partKey || '').toLowerCase().replace(/[_\-\s]/g, '');
  for (const r of RULES) {
    if (r.test.test(k)) return { role: r.role, collidable: !!r.collidable, lodNever: !!r.lodNever };
  }
  return { role: 'prop', collidable: true, lodNever: false };
}

/** 堆叠规则：Bottom/Base/Lower/Start → vertical；Top/Cap/Upper/Peak → vertical；Middle/Center → vertical */
function inferStackRule(partKey) {
  const k = String(partKey || '').toLowerCase();
  if (/(bottom|base|lower|start|first)$/.test(k)) return 'vertical';
  if (/(top|cap|upper|peak|finial)$/.test(k)) return 'vertical';
  if (/(middle|center|mid|section)/.test(k)) return 'vertical';
  return 'none';
}

/** 细分类型（人类可读） */
function deriveSubtype(partKey, role) {
  const k = String(partKey || '').toLowerCase();
  if (role === 'window') {
    if (/arch|curve|round/.test(k)) return 'window_arched';
    if (/narrow|slit/.test(k)) return 'window_narrow';
    if (/large|big|wide/.test(k)) return 'window_large';
    if (/door/.test(k)) return 'window_door';
    return 'window';
  }
  if (role === 'door') {
    if (/double/.test(k)) return 'door_double';
    if (/frame|trim/.test(k)) return 'door_frame';
    if (/slide/.test(k)) return 'door_slide';
    return 'door';
  }
  if (role === 'wall') {
    if (/corner/.test(k)) return 'wall_corner';
    if (/narrow/.test(k)) return 'wall_narrow';
    if (/half/.test(k)) return 'wall_half';
    if (/low/.test(k)) return 'wall_low';
    if (/pillar/.test(k)) return 'wall_pillar';
    if (/slant/.test(k)) return 'wall_slant';
    if (/interior|inner/.test(k)) return 'wall_inner';
    return 'wall';
  }
  if (role === 'roof') {
    if (/flat/.test(k)) return 'roof_flat';
    if (/gable/.test(k)) return 'roof_gable';
    if (/dome|round/.test(k)) return 'roof_dome';
    if (/pyramid/.test(k)) return 'roof_pyramid';
    if (/cornice|trim|edge/.test(k)) return 'roof_trim';
    return 'roof';
  }
  if (role === 'column') {
    if (/corner/.test(k)) return 'column_corner';
    if (/round|cylind/.test(k)) return 'column_round';
    if (/square|box/.test(k)) return 'column_square';
    if (/half/.test(k)) return 'column_half';
    return 'column';
  }
  if (role === 'stairs') return /corner/.test(k) ? 'stairs_corner' : /narrow/.test(k) ? 'stairs_narrow' : 'stairs';
  if (role === 'nature') {
    if (/log|trunk|stump/.test(k)) return 'tree_trunk';
    if (/tree/.test(k)) return /large|big/.test(k) ? 'tree_large' : /small/.test(k) ? 'tree_small' : 'tree';
    if (/rock|boulder|pebble/.test(k)) return 'rock';
    if (/grass/.test(k)) return 'grass';
    if (/bush|shrub/.test(k)) return 'bush';
    if (/flower|petal/.test(k)) return 'flower';
    if (/mushroom/.test(k)) return 'mushroom';
    return 'nature';
  }
  if (role === 'prop') {
    if (/chair|seat/.test(k)) return 'chair';
    if (/table|desk/.test(k)) return 'table';
    if (/bed/.test(k)) return 'bed';
    if (/lamp|light|lantern/.test(k)) return 'lamp';
    if (/barrel/.test(k)) return 'barrel';
    if (/crate|container|box/.test(k)) return 'crate';
    if (/sign|board/.test(k)) return 'sign';
    if (/plant|planter/.test(k)) return 'planter';
    if (/fence|barrier|railing/.test(k)) return 'barrier';
    return 'prop';
  }
  return role;
}

/** 读 GLB 的 glTF JSON chunk 或纯 .gltf 文本（不做完整解析） */
function readGltfJson(absFile) {
  try {
    const buf = fs.readFileSync(absFile);
    if (buf.length < 12) return null;
    if (buf.readUInt32LE(0) === 0x46546c67) {          // 'glTF'
      const jsonLen = buf.readUInt32LE(12);
      if (20 + jsonLen > buf.length) return null;
      return JSON.parse(buf.slice(20, 20 + jsonLen).toString('utf8'));
    }
    if (/\.gltf$/i.test(absFile)) return JSON.parse(buf.toString('utf8'));
  } catch (e) { /* 解析失败 */ }
  return null;
}

/**
 * 提取统计与包围盒。
 * @returns {{tris,mats,textures,w,h,d,externalRefs,embeddedTextures,extensions}|null}
 */
function readModelStats(absFile) {
  const g = readGltfJson(absFile);
  if (!g || !Array.isArray(g.meshes)) return null;
  let tris = 0;
  const mn = [Infinity, Infinity, Infinity];
  const mx = [-Infinity, -Infinity, -Infinity];
  for (const mesh of g.meshes) {
    for (const prim of (mesh.primitives || [])) {
      const acc = g.accessors || [];
      if (prim.indices !== undefined && acc[prim.indices]) {
        tris += Math.floor((acc[prim.indices].count || 0) / 3);
      } else if (prim.attributes && prim.attributes.POSITION !== undefined && acc[prim.attributes.POSITION]) {
        tris += Math.floor((acc[prim.attributes.POSITION].count || 0) / 3);
      }
      const ai = prim.attributes && prim.attributes.POSITION;
      const a = ai !== undefined ? acc[ai] : null;
      if (a && a.min && a.max) {
        for (let i = 0; i < 3; i++) {
          if (a.min[i] < mn[i]) mn[i] = a.min[i];
          if (a.max[i] > mx[i]) mx[i] = a.max[i];
        }
      }
    }
  }
  const hasBounds = mn[0] !== Infinity;
  let externalRefs = 0;
  let embedded = 0;
  for (const img of (g.images || [])) {
    if (img.uri && !img.uri.startsWith('data:')) externalRefs++;
    else if (img.bufferView !== undefined) embedded++;
  }
  const r4 = n => Math.round(n * 10000) / 10000;
  return {
    tris,
    mats: (g.materials || []).length,
    textures: (g.textures || []).length,
    w: hasBounds ? r4(mx[0] - mn[0]) : null,
    h: hasBounds ? r4(mx[1] - mn[1]) : null,
    d: hasBounds ? r4(mx[2] - mn[2]) : null,
    externalRefs,
    embeddedTextures: embedded,
    extensions: g.extensionsUsed || [],
  };
}

/**
 * 收集一个 glTF/GLB 引用的**外置**文件（images + buffers 的 uri），已剔除 data: 内嵌。
 *
 * 用途：素材扫描器据此决定哪些附属文件必须一起复制。
 * Kenney 的贴图放在**子目录**里（`Models/GLB format/Textures/colormap.png`，
 * GLB 内 uri = `Textures/colormap.png`），只按「同目录」判断会把贴图全丢掉。
 *
 * @returns {string[]} 相对 URI 列表（未做路径解析，由调用方按主文件所在目录解析）
 */
function collectExternalRefs(absFile) {
  const g = readGltfJson(absFile);
  if (!g) return [];
  const out = new Set();
  const push = u => {
    if (!u || typeof u !== 'string') return;
    if (/^(data:|https?:|file:)/i.test(u)) return;      // 内嵌 / 远程 / 本机绝对路径
    try { out.add(decodeURI(u)); } catch (e) { out.add(u); }
  };
  for (const img of g.images || []) push(img && img.uri);
  for (const b of g.buffers || []) push(b && b.uri);
  return [...out];
}

/** 收集 bundle 目录内的所有文件（相对路径，带扩展名判断） */
function walkBundle(bundleDir) {
  const out = [];
  const walk = (d, rel, depth) => {
    if (depth > 10) return;
    let ents;
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    for (const e of ents) {
      if (e.name.startsWith('.')) continue;
      const abs = path.join(d, e.name);
      const relRaw = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) walk(abs, relRaw, depth + 1);
      else if (e.isFile()) out.push({ abs, rel: relRaw, ext: path.extname(e.name).toLowerCase() });
    }
  };
  walk(bundleDir, '', 0);
  return out;
}

/**
 * 预检一个 bundle 目录（只读）：统计零件数 / 面数 / 贴图 / 归类分布 / 模数。
 * 扫描与上传两个入口都用它做"执行前确认"。
 */
function previewBundle(bundleDir) {
  const all = walkBundle(bundleDir);
  const models = all.filter(f => ['.gltf', '.glb', '.obj'].includes(f.ext) && !/_(mid|lod)\.(gltf|glb|obj)$/i.test(f.rel));
  const textures = all.filter(f => ['.png', '.jpg', '.jpeg', '.webp'].includes(f.ext));
  let totalTris = 0;
  let noStats = 0;
  let externalRefs = 0;
  const roleCount = {};
  const samples = [];
  for (const m of models) {
    const st = readModelStats(m.abs);
    const key = derivePartKey(m.rel);
    const cls = classifyByName(key);
    roleCount[cls.role] = (roleCount[cls.role] || 0) + 1;
    if (st) { totalTris += st.tris; externalRefs += st.externalRefs; }
    else noStats++;
    if (samples.length < 8) {
      samples.push({
        partKey: key, role: cls.role, file: m.rel,
        tris: st ? st.tris : null,
        dims: st && st.w !== null ? `${st.w} x ${st.h} x ${st.d}` : null,
        externalTextures: st ? st.externalRefs : 0,
      });
    }
  }
  const bytes = all.reduce((s, f) => { try { return s + fs.statSync(f.abs).size; } catch (e) { return s; } }, 0);
  return {
    fileCount: all.length,
    modelCount: models.length,
    textureCount: textures.length,
    otherCount: all.length - models.length - textures.length,
    totalTris,
    noStats,
    externalRefs,
    bytes,
    roleCount,
    samples,
  };
}

module.exports = {
  LOD_MIN_TRIS,
  RULES,
  derivePartKey,
  classifyByName,
  inferStackRule,
  deriveSubtype,
  readGltfJson,
  readModelStats,
  collectExternalRefs,
  walkBundle,
  previewBundle,
};
