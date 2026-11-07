/**
 * templatePlanner —— 「模板契约」规划器（M1-7）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 为什么要新写一个，而不是改 missionPlanner：
 *   现有 plan() 的契约是「零件清单 + recipe 骨架」，LLM 要逐字记住 partKey、
 *   手写 footprint 多边形、还得理解 fence/forest/garden/path 五个 recipe 的 spec。
 *   那套契约 3230 token，实测 plan 失败率约 11%。
 *   而工具层已经有 build_from_template / pave / scatter 了 —— 只要 LLM 说
 *   「哪个模板、放哪、朝哪」，坐标和件数全部由代码算。
 *
 *   ★ 这是**并行实现**，不改 missionPlanner：legacy 委托仍走旧契约，互不影响。
 *     等模板契约跑顺、失败率实测比旧的低，再决定要不要切默认。
 *
 * 分工（与 scripts/village_from_intent.js 一致）：
 *   LLM 只输出「意图」；坐标合法性、件数预算、模板是否存在，全由 validateIntent 兜住。
 */
'use strict';

const registry = require('../assembly/templateRegistry');
const { estimateTokens } = require('../llm/tokenEstimate');

/** 合法朝向（度）。0 = 门朝 −Z（求解器的 south 边） */
const FACINGS = [0, 90, 180, 270];

/**
 * 生成「模板契约」文本。刻意保持短：模板清单按风格压成一行，规则只留会被违反的那几条。
 * @param {object} region 区域行（含 bounds）
 * @param {object} [opts] { maxObjects }
 * @returns {{text:string, tokens:number, templates:string[]}}
 */
function buildContract(region, opts) {
  const o = opts || {};
  const b = (region && region.bounds) || {};
  const x0 = Number(b.x) || 0, z0 = Number(b.z) || 0;
  const w = Number(b.width) || 0, d = Number(b.depth) || 0;

  // 模板按风格压行：id(件数) —— 让 LLM 一眼看到"有哪些、多大、多少件"
  const byStyle = {};
  registry.listTemplates().forEach((t) => {
    const key = t.style || 'misc';
    byStyle[key] = byStyle[key] || [];
    byStyle[key].push(t.id + '(' + (t.pieceCount || 0) + '件)');
  });
  const catalogue = Object.keys(byStyle)
    .map((s) => '  ' + s + ': ' + byStyle[s].join(' '))
    .join('\n');

  const budget = Number(o.maxObjects) > 0 ? Number(o.maxObjects) : 0;
  const lines = [
    '【模板契约】只输出 JSON：',
    '{"style":"","summary":"","buildings":[{"template":"id","x":0,"z":0,"facing":0}],'
      + '"props":[{"kind":"trees","count":8}]}',
    `区域左上角 (${x0}, ${z0})，宽 ${w}m 深 ${d}m。x/z 是世界坐标（米），须在区域内且距边界 ≥2m。`,
    '模板（id(件数)）：',
    catalogue,
    '1. facing 取 0/90/180/270（0=门朝−Z，90=+X，180=+Z，270=−X）；街道两侧的房子面对面。',
    '2. 建筑按「占地+2m 出檐」占位，相邻中心距 ≥(两者宽和/2+3)m，否则互相穿插。',
    '3. **不要给 roads**：街道由引擎按房屋排布自动生成（位置、长度、宽度全部引擎算）。',
    '4. props 只给 kind + count（kind ∈ trees / bushes / flowers / rocks），**不要给坐标**：位置由引擎按建筑之外的空带生成。',
    '5. 房屋要成排（同一排的 z 相同或相近），把排与排之间留 8~20m 当街——引擎会在那里铺街。',
    '6. 禁止编造模板 id / partKey。' + (budget > 0 ? `总件数（含铺装）≤${budget}。` : ''),
    '7. 诉求不是建造类（清空/删除/改已有物件/纯提问）时只输出 {"decline":"原因"}，不要硬凑建筑。',
    '【村庄骨架示例】设区域中心 (cx,cz)=' + ((x0 + w / 2) | 0) + ',' + ((z0 + d / 2) | 0) + '，沿 X 轴建街：',
    '{"buildings":[{"template":"medieval_6x10","x":cx-20,"z":cz-7,"facing":180},'
      + '{"template":"medieval_8x8","x":cx,"z":cz-8,"facing":180},'
      + '{"template":"medieval_6x10","x":cx-20,"z":cz+7,"facing":0},'
      + '{"template":"medieval_8x8","x":cx,"z":cz+8,"facing":0}]}',
    '↑北排 z<cz、facing180；南排 z>cz、facing0；同排间距≥14m。照此加减栋数（街道会自动铺在两排之间）。',
  ];
  const text = lines.join('\n');
  return {
    text,
    tokens: estimateTokens(text),
    templates: registry.listTemplates().map((t) => t.id),
  };
}

/** 数值容错：接受 "180" / 180.0 / 缺省 */
function num(v, dflt) {
  const n = Number(v);
  return isFinite(n) ? n : dflt;
}

/**
 * 校验 LLM 输出的意图。
 * 不做「猜你想要」的修补：模板不存在、朝向非法、装不下、超预算 —— 一律明确报错，
 * 并把可行的替代（候选模板 / 可用范围）带回去，让下一轮 LLM 能改对。
 *
 * @param {object} intent LLM 的 JSON
 * @param {object} region 区域行
 * @param {object} [opts] { maxObjects }
 * @returns {{ok:true, plan:object, stats:object} | {ok:false, code:string, reason:string, hints?:object}}
 */
function validateIntent(intent, region, opts) {
  const o = opts || {};
  const b = (region && region.bounds) || {};
  const minX = num(b.minX, num(b.x, 0));
  const minZ = num(b.minZ, num(b.z, 0));
  const maxX = num(b.maxX, minX + num(b.width, 0));
  const maxZ = num(b.maxZ, minZ + num(b.depth, 0));
  const EDGE = 2;   // 距边界最小距离（契约里承诺过的）

  const it = intent || {};
  // ★ 终止性拒绝（2026-11-07）：实测模型不跟否定指令 —— prompt 写「不要盖房子」它照建 438 件。
  //   根因不在模型，在契约：规划器**没有"这条诉求不需要建造"的出口**，buildings 空还会被判错重试，
  //   它只能硬凑建筑。所以给一个显式 decline 通道：terminal=true 表示「不重试」，
  //   上层（templateRunner）据此**直接失败，不回落 legacy**（回落会把它本来不该建的东西建出来）。
  if (it && typeof it.decline === 'string' && it.decline.trim()) {
    return {
      ok: false, code: 'INTENT_DECLINED', terminal: true,
      reason: '模型判断该诉求不是建造类：' + it.decline.trim().slice(0, 200),
    };
  }

  const buildings = Array.isArray(it.buildings) ? it.buildings : [];
  if (!buildings.length) {
    return { ok: false, code: 'INTENT_EMPTY', reason: 'buildings 为空：至少给一栋（只写 style/summary 不算方案）' };
  }

  const all = registry.listTemplates();
  const ids = all.map((t) => t.id);
  const styleOf = {};
  all.forEach((t) => { styleOf[t.id] = t.style; });

  const out = { style: String(it.style || ''), summary: String(it.summary || ''), buildings: [], roads: [], props: [] };
  const notes = [];   // 「代码替你修了什么」——不静默改，让人能看见
  const r3 = (v) => Math.round(Number(v) * 1000) / 1000;
  let pieces = 0;
  const placed = [];   // 已接受的建筑占地，用于互撞检测

  for (let i = 0; i < buildings.length; i++) {
    const raw = buildings[i] || {};
    const id = String(raw.template || '').trim();
    if (!id) return { ok: false, code: 'BUILDING_NO_TEMPLATE', reason: `buildings[${i}] 缺 template` };
    if (ids.indexOf(id) < 0) {
      // 候选：先按 LLM 自己声明的风格筛；声明缺失/风格也编了，就给全量前 8 个
      //   （2026-11-07 实测：风格未知时若只按 styleOf[id] 过滤，候选会是空数组 ——
      //    对 LLM 等于"没有任何提示"，下一轮只能继续瞎猜）
      const wantStyle = String(it.style || '').trim();
      const styleKnown = wantStyle && all.some((t) => t.style === wantStyle);
      const sameStyle = styleKnown ? all.filter((t) => t.style === wantStyle) : all;
      return {
        ok: false, code: 'TEMPLATE_UNKNOWN',
        reason: `buildings[${i}] 的模板「${id}」不存在。可用：${ids.slice(0, 12).join(', ')} …`,
        hints: { availableTemplates: ids, sameStyle: sameStyle.map((t) => t.id).slice(0, 8) },
      };
    }
    const t = registry.getTemplate(id);
    const facing = raw.facing == null ? 0 : num(raw.facing, NaN);
    if (FACINGS.indexOf(facing) < 0) {
      return { ok: false, code: 'FACING_INVALID', reason: `buildings[${i}].facing=${raw.facing} 非法，只接受 0/90/180/270` };
    }
    const x = num(raw.x, NaN), z = num(raw.z, NaN);
    if (!isFinite(x) || !isFinite(z)) {
      return { ok: false, code: 'ANCHOR_INVALID', reason: `buildings[${i}] 的 x/z 必须是数字` };
    }
    // 旋转后的半宽半深 + 1m 出檐余量
    const swap = Math.abs(Math.round(facing / 90) % 2) === 1;
    const halfW = (swap ? t.dimensions.depth : t.dimensions.width) / 2 + 1;
    const halfD = (swap ? t.dimensions.width : t.dimensions.depth) / 2 + 1;

    // ★ 越界不拒，**挪进来**（2026-11-07 30 次统计实测：BUILDING_OUT_OF_BOUNDS 占了
    //   改完街道之后仅剩的 2 次失败）。模型常把边排房"贴着边界"摆，探出去 1~3m ——
    //   这是坐标问题，不是设计意图，跟越界的路/道具一样交给代码。
    //   只有「区域本身装不下这栋」才拒（那时挪也挪不进来）。
    let bx = x, bz = z;
    const loX = minX + EDGE + halfW, hiX = maxX - EDGE - halfW;
    const loZ = minZ + EDGE + halfD, hiZ = maxZ - EDGE - halfD;
    if (loX > hiX || loZ > hiZ) {
      return {
        ok: false, code: 'BUILDING_TOO_BIG',
        reason: `buildings[${i}]（${id}，facing=${facing}）含出檐需要 ${(halfW * 2).toFixed(0)}×${(halfD * 2).toFixed(0)}m，`
          + `比区域可用范围 ${(maxX - minX - EDGE * 2).toFixed(0)}×${(maxZ - minZ - EDGE * 2).toFixed(0)}m 还大 —— 换小模板`,
        hints: { need: { width: halfW * 2, depth: halfD * 2 }, available: { width: maxX - minX - EDGE * 2, depth: maxZ - minZ - EDGE * 2 } },
      };
    }
    if (bx < loX) { notes.push(`buildings[${i}] 左移 ${r3(loX - bx)}m 使其完整落在区域内`); bx = loX; }
    if (bx > hiX) { notes.push(`buildings[${i}] 右移 ${r3(bx - hiX)}m 使其完整落在区域内`); bx = hiX; }
    if (bz < loZ) { notes.push(`buildings[${i}] 下移 ${r3(loZ - bz)}m 使其完整落在区域内`); bz = loZ; }
    if (bz > hiZ) { notes.push(`buildings[${i}] 上移 ${r3(bz - hiZ)}m 使其完整落在区域内`); bz = hiZ; }
    bx = r3(bx); bz = r3(bz);

    // 互撞：只拦"真的重叠"，留 1m 容差（契约要求 3m 间距，这里不苛求）
    for (const p of placed) {
      if (Math.abs(p.x - bx) < (p.halfW + halfW - 1) && Math.abs(p.z - bz) < (p.halfD + halfD - 1)) {
        return {
          ok: false, code: 'BUILDING_OVERLAP',
          reason: `buildings[${i}] 与 buildings[${p.i}] 重叠（中心距 ${Math.hypot(p.x - x, p.z - z).toFixed(1)}m 太近）`,
        };
      }
    }
    placed.push({ i, x: bx, z: bz, halfW, halfD });
    pieces += Number((t.metrics && t.metrics.pieceCount) || 0);
    out.buildings.push({ template: id, x: bx, z: bz, facing });
  }

  // ── 街道：完全由代码生成（2026-11-07 结构性决定）───────────────────
  //   三次 20 次统计里 **100% 的失败都在"路与房子的几何关系"**（ROAD_HITS_BUILDING）；
  //   给可操作数字 → 85%，自动推导 → 80%。结论不是"再修一次"，而是让这个失败类别
  //   **在构造上不可能发生**：模型不再提供 roads，街道位置一律由代码按房屋排布算，
  //   并用所有房子的 AABB 逐个校验，冲突就换下一条候选带。
  if (Array.isArray(it.roads) && it.roads.length) {
    notes.push('模型给的 roads 已忽略：街道位置由代码按房屋排布生成（避免路压房）');
  }

  /** 房子实体 AABB（出檐那 1m 不算实体） */
  const solidOf = (p) => ({
    x0: p.x - p.halfW + 1, x1: p.x + p.halfW - 1,
    z0: p.z - p.halfD + 1, z1: p.z + p.halfD - 1,
  });
  const hitsAny = (r) => placed.some((p) => {
    const s0 = solidOf(p);
    return (r.x - r.width / 2) < s0.x1 && (r.x + r.width / 2) > s0.x0
      && (r.z - r.depth / 2) < s0.z1 && (r.z + r.depth / 2) > s0.z0;
  });

  if (placed.length >= 2) {
    const zsSorted = placed.map((p) => p.z).sort((a, b) => a - b);
    const xsAll = placed.map((p) => p.x);
    const maxHalfD = Math.max.apply(null, placed.map((p) => p.halfD));
    const spanX = (Math.max.apply(null, xsAll) - Math.min.apply(null, xsAll)) + 10;
    const streetW = Math.max(10, Math.min(spanX, (maxX - minX) - 6));
    const cx = Math.max(minX + streetW / 2 + 2, Math.min(maxX - streetW / 2 - 2,
      (Math.min.apply(null, xsAll) + Math.max.apply(null, xsAll)) / 2));

    const cands = [];
    let gap = null;
    for (let i = 1; i < zsSorted.length; i++) {
      const g = zsSorted[i] - zsSorted[i - 1];
      if (g >= 6 && (!gap || g > gap.g)) gap = { g, mid: (zsSorted[i - 1] + zsSorted[i]) / 2 };
    }
    if (gap) cands.push(gap.mid);
    cands.push(Math.max.apply(null, zsSorted) + maxHalfD + 3);
    cands.push(Math.min.apply(null, zsSorted) - maxHalfD - 3);
    for (let z = minZ + 3; z <= maxZ - 3; z += 1) cands.push(z);

    const DEPTH = 5;
    let street = null;
    for (const z of cands) {
      if (z - DEPTH / 2 < minZ || z + DEPTH / 2 > maxZ) continue;
      const r = { x: r3(cx), z: r3(z), width: r3(streetW), depth: DEPTH };
      if (!hitsAny(r)) { street = r; break; }
    }
    if (street) {
      out.roads.push(street);
      pieces += Math.round(street.width) * Math.round(street.depth);
      notes.push('街道由代码生成：X 向 ' + r3(street.width) + '×' + r3(street.depth)
        + 'm @' + r3(street.x) + ',' + r3(street.z)
        + (gap && Math.abs(street.z - gap.mid) < 1e-6 ? '（落在两排房之间的间隙）' : '（置于房群外侧）'));
    } else {
      notes.push('区域被房子塞满，找不到 5m 空带 → 本村不铺街（不报错）');
    }
  }

  // ── 房屋「拉近街道」（2026-11-07 实建实测）──────────────────────────
  //   模型把两排房摆到区域两端，实测相距 60m —— 村口变成一片空地，不像街。
  //   契约里写的"排间 8~20m"它不遵守（同一类问题第三次出现），所以由代码统一退线：
  //   房前留 FRONT 米院子，明显偏远（>SNAP_OVER）才拉，避免把正常布局也拧动。
  if (out.roads.length && placed.length) {
    const st0 = out.roads[0];
    const FRONT = 4;        // 房前院子
    const SNAP_OVER = 10;   // 只处理明显偏远的
    const stN = st0.z - st0.depth / 2, stS = st0.z + st0.depth / 2;
    let moved = 0;
    placed.forEach((p) => {
      const solidN = p.z - p.halfD + 1, solidS = p.z + p.halfD - 1;
      if (solidS < stN && stN - solidS > SNAP_OVER) {            // 北侧：向南拉
        const nz = r3(stN - FRONT - p.halfD + 1);
        if (nz - p.halfD + 1 >= minZ) { p.z = nz; out.buildings[p.i].z = nz; moved++; }
      } else if (solidN > stS && solidN - stS > SNAP_OVER) {     // 南侧：向北拉
        const nz = r3(stS + FRONT + p.halfD - 1);
        if (nz + p.halfD - 1 <= maxZ) { p.z = nz; out.buildings[p.i].z = nz; moved++; }
      }
    });
    if (moved) {
      notes.push('有 ' + moved + ' 栋房离街太远（>' + SNAP_OVER + 'm），已按房前 ' + FRONT + 'm 退线拉近街道');
    }
  }

  // ── 路灯：沿街布设（2026-11-07）──────────────────────────────────
  //   原始需求里明确写了「路灯布局」，但 AI 建的村里一盏都没有（props 只有树石花草）。
  //   位置同样是纯几何：按街的中线等距布，每 12m 一对（两侧各一盏），
  //   灯杆离街沿 0.8m（落在房前院子里）。压到房子的直接跳过，不硬塞。
  //   灯件是「杆 + 灯头」两件同点 —— 这是全库唯一能看出灯头的组合（2026-11-07 对照实测）。
  if (out.roads.length && out.buildings.length >= 3) {
    const stL = out.roads[0];
    const LAMP_STEP = 12, LAMP_OFF = 0.8;
    const xa = stL.x - stL.width / 2 + 6, xb = stL.x + stL.width / 2 - 6;
    const zN = stL.z - stL.depth / 2 - LAMP_OFF, zS = stL.z + stL.depth / 2 + LAMP_OFF;
    const hitsBuilding = (lx, lz) => placed.some((p) => {
      const s0 = solidOf(p);
      return lx > s0.x0 - 0.5 && lx < s0.x1 + 0.5 && lz > s0.z0 - 0.5 && lz < s0.z1 + 0.5;
    });
    const lamps = [];
    for (let lx = xa; lx <= xb + 1e-6; lx += LAMP_STEP) {
      for (const pair of [[zN, 0], [zS, Math.PI]]) {
        const lz = pair[0], ry = pair[1];
        if (lz < minZ + 1 || lz > maxZ - 1) continue;
        if (hitsBuilding(lx, lz)) continue;
        lamps.push({ x: r3(lx), z: r3(lz), ry });
      }
    }
    if (lamps.length) {
      out.lamps = lamps;
      pieces += lamps.length * 2;      // 每盏 = 杆 + 灯头
      notes.push('路灯 ' + lamps.length + ' 盏（沿街每 ' + LAMP_STEP + 'm 一对，位置由代码布设）');
    }
  }

  // ── 绿化：模型只给「种类 + 数量」，位置由代码在空带里生成 ─────────────
  //   2026-11-07 实建实测：模型给的 props 矩形基本压在房子上，15 组树只落下 1 棵。
  //   和街道/坐标同一结论 —— **几何归代码**。所以 props 不再接受 x/z/width/depth，
  //   只接受 {kind, count}；具体放哪由代码按"建筑之外的空带"算。
  //
  //   空带规则（越自然越好）：
  //     trees / rocks → 两排房的**外侧**各一条带（房后种树最自然）
  //     bushes / flowers → **街道两侧**各一条窄带（沿街花坛）
  //   每条带交给 scatter 去撒（它已有多倍采样 + 饱和扩容 + 与已有对象避让）。
  // 种类 → 零件 + 缩放（2026-11-07 实建实测：Kenney 的树件只有 1.7m，
  //   站在 3m 墙边像灌木；缩放在这里定死，别指望模型给）
  //   ★ 非等比缩放（2026-11-07 树件对照实测）：Kenney 的树全是窄锥形（tree_default 宽高比 0.4），
  //     等比放大到 3m 高就是一根细杆。把 X/Z 拉到比 Y 大 1.4 倍，树冠才像树 ——
  //     这是这批素材上唯一有效的办法，换成 tree_plateau/tree_thin 同样是窄的。
  const KIND_PARTS = {
    trees: { key: 'tree_default', scale: 3.4, scaleY: 2.4 },
    bushes: { key: 'plant_bush', scale: 1.6 },
    flowers: { key: 'flower_redA', scale: 1.3 },
    rocks: { key: 'rock_smallA', scale: 1.6 },
  };
  const KINDS = Object.keys(KIND_PARTS);

  // 密度下限（2026-11-07 实建实测：模型只给 8 棵树 + 12 丛花，1148 件的村子里几乎看不见）。
  //   **数量也属于「代码该兜的事」**：每栋房至少这么多，模型要得多就按模型的。
  //   密度目标 ≈ 全村的 10%（10 栋房 ≈ 1000 件 → 约 120 件绿化）。
  //   2026-11-07 两轮实建校准：2 棵/栋 时 100m 长的街只有 20 棵，看着还是荒。
  const MIN_PER_BUILDING = { trees: 3, bushes: 4, flowers: 4, rocks: 1 };
  const nB = out.buildings.length;

  // 模型一件绿化都没给，但房子 ≥3 栋 → 自动补最基础的树 + 灌木（记 note，不静默）
  let propList = Array.isArray(it.props) ? it.props.slice() : [];
  if (!propList.length && nB >= 3) {
    // 石头也补上：原始需求是「石头、树木、花草等环境要素的分布」，只补树和灌木会缺石头
    propList = [{ kind: 'trees' }, { kind: 'bushes' }, { kind: 'rocks' }];
    notes.push('模型未给任何绿化 → 按村庄规模自动补「树 + 灌木 + 石」');
  }

  if (propList.length) {
    // 房子的 z 分布与街的位置决定空带
    const szs = placed.map((p) => p.z).sort((a, b) => a - b);
    const northEdge = placed.length ? Math.min.apply(null, placed.map((p) => solidOf(p).z0)) : null;
    const southEdge = placed.length ? Math.max.apply(null, placed.map((p) => solidOf(p).z1)) : null;
    const xsAll2 = placed.map((p) => p.x);
    const bandW = placed.length ? (Math.max.apply(null, xsAll2) - Math.min.apply(null, xsAll2)) + 12 : (maxX - minX) - 8;
    const bandCx = placed.length ? (Math.min.apply(null, xsAll2) + Math.max.apply(null, xsAll2)) / 2 : (minX + maxX) / 2;
    const st = out.roads[0] || null;
    const stHalf = st ? st.depth / 2 : 2.5;
    const stZ = st ? st.z : (northEdge !== null ? (northEdge + southEdge) / 2 : (minZ + maxZ) / 2);

    /** 生成若干条可用的散布带（clamp 到区域，太薄就丢） */
    const bandsFor = (kind) => {
      const raw = [];
      if (kind === 'trees' || kind === 'rocks') {
        const depth = kind === 'trees' ? 12 : 7;
        if (northEdge !== null) raw.push([northEdge - depth - 2, northEdge - 2]);
        if (southEdge !== null) raw.push([southEdge + 2, southEdge + 2 + depth]);
      } else {
        const depth = 2.5;
        raw.push([stZ - stHalf - 1 - depth, stZ - stHalf - 1]);
        raw.push([stZ + stHalf + 1, stZ + stHalf + 1 + depth]);
      }
      const outBands = [];
      for (const [z0, z1] of raw) {
        const a = Math.max(minZ + 1, z0), b = Math.min(maxZ - 1, z1);
        if (b - a < 1.5) continue;
        outBands.push({ x: r3(bandCx), z: r3((a + b) / 2), width: r3(bandW), depth: r3(b - a) });
      }
      return outBands;
    };

    let propErr2 = null;
    propList.forEach((p) => {
      if (propErr2) return;
      const rawKind = String((p && p.kind) || '').trim().toLowerCase();
      // 兼容老格式：模型若还给 partKey，按名字反推种类（位置仍然不用它的）
      let kind = rawKind;
      if (!kind && p && p.partKey) {
        const k2 = String(p.partKey);
        if (/tree/i.test(k2)) kind = 'trees';
        else if (/bush|plant/i.test(k2)) kind = 'bushes';
        else if (/flower/i.test(k2)) kind = 'flowers';
        else if (/rock/i.test(k2)) kind = 'rocks';
      }
      if (KINDS.indexOf(kind) < 0) {
        propErr2 = {
          ok: false, code: 'PROP_KIND_INVALID',
          reason: `props 只接受 kind ∈ ${KINDS.join('/')}（位置由引擎按空带生成，不要给坐标）`,
        };
        return;
      }
      // 数量 = max(模型给的数量, 密度下限)。必须在 kind 确定之后算（踩过：放前面报 TDZ 错）
      const asked = Math.max(0, Math.round(num(p && p.count, 0)));
      const floor = MIN_PER_BUILDING[kind] * nB;
      const count = Math.max(1, Math.max(asked, floor));
      if (count > asked) {
        notes.push(`绿化「${kind}」模型给 ${asked} → 低于密度下限（${MIN_PER_BUILDING[kind]}×${nB} 栋=${floor}）→ 提到 ${count}`);
      }
      const bands = bandsFor(kind);
      if (!bands.length) {
        notes.push(`props（${kind}）附近没有可用空带 → 本批不种`);
        return;
      }
      // 数量按空带均分，至少每带 1 件
      const per = Math.max(1, Math.round(count / bands.length));
      bands.forEach((b, bi) => {
        const n = bi === bands.length - 1 ? Math.max(1, count - per * (bands.length - 1)) : per;
        out.props.push(Object.assign(
          { partKey: KIND_PARTS[kind].key, kind, scale: KIND_PARTS[kind].scale, scaleY: KIND_PARTS[kind].scaleY },
          b, { count: n }));
        pieces += n;
      });
      notes.push(`绿化「${kind}」×${count} → 由代码放在 ${bands.length} 条空带（不采用模型给的矩形）`);
    });
    if (propErr2) return propErr2;
  }

  const maxObjects = num(o.maxObjects, 0);
  if (maxObjects > 0 && pieces > maxObjects) {
    return {
      ok: false, code: 'INTENT_EXCEEDS_BUDGET',
      reason: `按意图估算约 ${pieces} 件，超过预算 ${maxObjects}（铺装最占件数，缩小 roads 或减少建筑）`,
      hints: { pieces, maxObjects },
    };
  }

  return {
    ok: true,
    plan: out,
    notes,
    stats: { buildings: out.buildings.length, roads: out.roads.length, props: out.props.length, pieces },
  };
}

/** 从模型输出里抠 JSON（容忍围栏与前后解释） */
function parseIntent(text) {
  let s = String(text || '').trim();
  s = s.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const i = s.indexOf('{'), j = s.lastIndexOf('}');
  if (i < 0 || j <= i) return null;
  try { return JSON.parse(s.slice(i, j + 1)); } catch (e) { return null; }
}

/**
 * 调一次模型拿意图（真 LLM 路径）。
 * ★ o.chat 可注入：验收脚本用它跑"假模型"，所以这条路径的逻辑（解析/校验/重试）
 *   在没有网络、不花 token 的情况下也能被测到。真调模型的行为仍标注为待实测。
 *
 * @param {object} mission
 * @param {object} region
 * @param {object} opts { chat, provider, maxObjects, maxRounds }
 */
async function planTemplates(mission, region, opts) {
  const o = opts || {};
  const maxObjects = num(o.maxObjects, num((mission.constraints || {}).max_objects, 0));
  const contract = buildContract(region, { maxObjects });
  const maxRounds = Math.max(1, num(o.maxRounds, 2));

  const chat = o.chat || (async (messages) => {
    const providerRouter = require('../llm/providerRouter');
    const providerFallback = require('../llm/providerFallback');
    const provider = o.provider || (await providerRouter.resolve('plan', { worldId: mission.world_id })).provider;
    if (!provider) throw new Error('没有可用 provider');
    const r = await providerFallback.chatWithFallback({
      messages,
      temperature: 0.2,
      maxTokens: 2000,
      timeoutMs: 120000,
      purpose: 'plan',
      caller: 'world_ai_template_planner',
      missionId: String(mission.id),
      regionKey: String(mission.region_key),
      retries: 1,
    }, { primary: provider });
    return r.content;
  });

  const messages = [
    { role: 'system', content: '你是虚拟世界里的建造规划器。只做决策，不算坐标细节，不编造 id。' },
    { role: 'user', content: '【委托】' + String(mission.prompt || mission.title || '') + '\n\n' + contract.text },
  ];

  let lastErr = null;
  let lastRaw = null;   // 失败时把模型最后一版原样带回，便于诊断（不看原文只能瞎猜）
  for (let round = 1; round <= maxRounds; round++) {
    const content = await chat(messages);
    lastRaw = String(content || '').slice(0, 1500);
    const intent = parseIntent(content);
    if (!intent) {
      lastErr = { ok: false, code: 'INTENT_UNPARSEABLE', reason: '模型没输出合法 JSON' };
      messages.push({ role: 'assistant', content: String(content || '').slice(0, 2000) });
      messages.push({ role: 'user', content: '上一条不是合法 JSON，请只输出契约要求的 JSON 对象。' });
      continue;
    }
    let v;
    let lastIntent = null;
    try {
      lastIntent = JSON.stringify(intent).slice(0, 1600);   // 失败时带回去，便于复现（别靠猜）
      v = validateIntent(intent, region, { maxObjects });
    } catch (e) {
      v = { ok: false, code: 'VALIDATE_THREW', reason: String((e && e.message) || e) };
    }
    if (v.ok) return { ok: true, rounds: round, plan: v.plan, stats: v.stats, contractTokens: contract.tokens };
    // 终止性拒绝：重试没有意义（再问它一次还是"不该建"），直接把结论带回上层
    if (v.terminal) {
      return {
        ok: false, rounds: round, plan: null, code: v.code, reason: v.reason,
        terminal: true, contractTokens: contract.tokens, lastRaw,
      };
    }
    lastErr = v;
    lastErr.lastIntent = lastIntent;
    // 把"哪里不合法 + 可行范围"喂回去，让下一轮改对（这是失败率能不能降下来的关键）
    messages.push({ role: 'assistant', content: String(content || '').slice(0, 2000) });
    messages.push({
      role: 'user',
      content: '上一版被拒：' + v.code + ' — ' + v.reason
        + (v.hints ? '\n可用信息：' + JSON.stringify(v.hints) : '')
        + '\n请按契约修正后重新输出 JSON。',
    });
  }
  return Object.assign({ ok: false, rounds: maxRounds, contractTokens: contract.tokens, lastRaw }, lastErr || {});
}

module.exports = { buildContract, validateIntent, parseIntent, planTemplates, FACINGS };
