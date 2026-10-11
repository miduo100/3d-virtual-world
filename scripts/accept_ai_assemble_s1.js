/**
 * accept_ai_assemble_s1.js —— AI 自由拼装 · 阶段1 会话1 验收（R1-1 / R1-2 / R1-3）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 规格来源：《AI自由拼装建设-开发规划与规范.md》§7.1。
 * 本套件是**纯函数判据**（recipe 引擎零 IO、partResolver 注入假零件表）：
 * 不连数据库、不起服务器、不烧 LLM 额度 → 任意环境可反复重跑。
 *
 * 判据：
 *   R1-1 path 直线：2 点 → 铺 N 块砖、间距 = tile 尺寸、ry = 段方向角
 *   R1-2 path S 弯：4 点 → 沿折线铺、拐角用 cornerTile、ry 随段变
 *   R1-3 path 确定性：同种子同输入 → 逐字段相同输出（两次 JSON 比对）
 *   附加（本会话顺带覆盖，R1-5/R1-6 的前置能力）：未知 recipe 拒绝带可用清单 / 预算截断
 *
 * 用法：node scripts/accept_ai_assemble_s1.js
 */
'use strict';

const path = require('path');

const registry = require(path.join(__dirname, '..', 'src', 'worldai', 'recipes'));
const geometry = require(path.join(__dirname, '..', 'src', 'worldai', 'recipes', 'geometry'));

// ── 假零件库（role=road，2m×2m 路面砖；partResolver 注入 → 引擎零 IO）
const PARTS = {
  roadTile_001: { part_key: 'roadTile_001', part_role: 'road', grid: [2, 0.2, 2], model_path: '/models/uploaded/roadTile_001.glb' },
  roadTile_003: { part_key: 'roadTile_003', part_role: 'road', grid: [2, 0.2, 2], model_path: '/models/uploaded/roadTile_003.glb' },
  roadTile_corner: { part_key: 'roadTile_corner', part_role: 'road', grid: [2, 0.2, 2], model_path: '/models/uploaded/roadTile_corner.glb' },
};
async function resolver(k) { return PARTS[k] || null; }

const results = [];
let failed = 0;
function check(id, title, ok, detail) {
  results.push({ id, title, ok: !!ok, detail: detail || '' });
  if (!ok) failed++;
  console.log((ok ? '  PASS  ' : '! FAIL  ') + id + '  ' + title + (detail ? '  —— ' + detail : ''));
}
function near(a, b, eps) { return Math.abs(Number(a) - Number(b)) <= (eps == null ? 0.011 : eps); }
/** 点是否落在任一折线段上（容差 0.02m） */
function onPolyline(pt, segs, eps) {
  const t = eps == null ? 0.02 : eps;
  for (const s of segs) {
    const vx = s.bx - s.ax, vz = s.bz - s.az;
    const len2 = vx * vx + vz * vz;
    if (!len2) continue;
    let u = ((pt.dx - s.ax) * vx + (pt.dz - s.az) * vz) / len2;
    u = Math.max(0, Math.min(1, u));
    const px = s.ax + vx * u, pz = s.az + vz * u;
    if (Math.hypot(pt.dx - px, pt.dz - pz) <= t) return true;
  }
  return false;
}

(async function main() {
  console.log('\n===== AI 自由拼装 · 阶段1 会话1 验收（R1-1 / R1-2 / R1-3）=====\n');

  // ══════════════ R1-1 直线 ══════════════
  {
    const r1 = await registry.build('path', {
      waypoints: [{ dx: 0, dz: 0 }, { dx: 10, dz: 0 }], width: 1, tile: ['roadTile_001'], cornerTile: 'roadTile_corner',
    }, { partResolver: resolver, seedStr: 'r1-line' });

    check('R1-1a', '直线构建成功', r1.ok === true, r1.ok ? '' : (r1.code + ': ' + r1.reason));
    if (r1.ok) {
      const p = r1.parts;
      // 段长 10m / 步长 2m = 6 个采样点（含两端）
      check('R1-1b', '件数 = 段长/步长+1 = 6', p.length === 6, '实际 ' + p.length + ' 件');
      check('R1-1c', '全部沿路方向角 ry=0（沿 +X）', p.every((x) => near(x.ry, 0)), 'ry=' + JSON.stringify(p.map((x) => x.ry)));
      const dxs = p.map((x) => x.dx).sort((a, b) => a - b);
      let gapOk = dxs.length === 6, gaps = [];
      for (let i = 1; i < dxs.length; i++) { const g2 = dxs[i] - dxs[i - 1]; gaps.push(g2); if (!near(g2, 2)) gapOk = false; }
      check('R1-1d', '相邻间距 = tile 尺寸 2m', gapOk, '间距=' + JSON.stringify(gaps));
      check('R1-1e', '全部 z=0（单排）且 level=0', p.every((x) => near(x.dz, 0) && x.level === 0));
      check('R1-1f', '输出契约字段齐全（partKey/grid/modelPath/role）',
        p.every((x) => x.partKey && Array.isArray(x.grid) && x.grid.length === 3 && x.modelPath && x.role),
        '示例 ' + JSON.stringify(p[0]));
      check('R1-1g', '直线无拐角件', (r1.stats.corners || 0) === 0, 'corners=' + r1.stats.corners);
    }
  }

  // ══════════════ R1-1 补充：斜线 ry 与宽排 ══════════════
  {
    const diag = await registry.build('path', {
      waypoints: [{ dx: 0, dz: 0 }, { dx: 6, dz: 6 }], width: 4, tile: ['roadTile_001', 'roadTile_003'],
    }, { partResolver: resolver, seedStr: 'r1-diag' });
    check('R1-1h', '斜线(6,6) → ry=45°', diag.ok && diag.parts.every((x) => near(x.ry, 45)), 'ry=' + (diag.parts[0] && diag.parts[0].ry));
    check('R1-1i', 'width=4 / tile深2 → 2 排并铺', diag.ok && diag.stats.rows === 2, 'rows=' + (diag.stats && diag.stats.rows));
    check('R1-1j', '两排分居段法线两侧（带符号法向距 = ±1m）', diag.ok && (() => {
      const s0 = geometry.segments(geometry.normPoints([{ dx: 0, dz: 0 }, { dx: 6, dz: 6 }]))[0];
      const nor = geometry.segNormal(s0);
      const sd = diag.parts.map((x) => geometry.r2(x.dx * nor.dx + x.dz * nor.dz));
      const uniq = Array.from(new Set(sd)).sort((a, b) => a - b);
      return uniq.length === 2 && near(uniq[0], -1) && near(uniq[1], 1);
    })(), '带符号法向距=' + JSON.stringify(Array.from(new Set(diag.parts.map((x) => {
      const s0 = geometry.segments(geometry.normPoints([{ dx: 0, dz: 0 }, { dx: 6, dz: 6 }]))[0];
      const nor = geometry.segNormal(s0);
      return geometry.r2(x.dx * nor.dx + x.dz * nor.dz);
    })))));
  }

  // ══════════════ R1-2 S 弯 ══════════════
  {
    const wps = [{ dx: 0, dz: 0 }, { dx: 8, dz: 0 }, { dx: 8, dz: 6 }, { dx: 16, dz: 6 }];
    const r2 = await registry.build('path', {
      waypoints: wps, width: 1, tile: ['roadTile_001'], cornerTile: 'roadTile_corner',
    }, { partResolver: resolver, seedStr: 'r1-s' });

    check('R1-2a', 'S 弯（4 点 2 转折）构建成功', r2.ok === true, r2.ok ? '' : (r2.code + ': ' + r2.reason));
    if (r2.ok) {
      const cornerParts = r2.parts.filter((x) => x.partKey === 'roadTile_corner');
      const tiles = r2.parts.filter((x) => x.partKey === 'roadTile_001');
      check('R1-2b', '两个 90° 转折 → 2 块 cornerTile', cornerParts.length === 2, '实际 ' + cornerParts.length + ' 块');
      check('R1-2c', 'cornerTile 落在转折顶点 (8,0)/(8,6)',
        cornerParts.some((x) => near(x.dx, 8) && near(x.dz, 0)) && cornerParts.some((x) => near(x.dx, 8) && near(x.dz, 6)),
        JSON.stringify(cornerParts.map((x) => [x.dx, x.dz])));
      const segs = geometry.segments(geometry.normPoints(wps));
      const offLine = r2.parts.filter((x) => !onPolyline({ dx: x.dx, dz: x.dz }, segs, 0.05));
      check('R1-2d', '所有零件都落在折线上（≤5cm 容差）', offLine.length === 0, '离线零件 ' + JSON.stringify(offLine.map((x) => [x.dx, x.dz])));
      const rys = Array.from(new Set(tiles.map((x) => x.ry))).sort((a, b) => a - b);
      check('R1-2e', 'ry 随段变化 = {0, 90}', rys.length === 2 && near(rys[0], 0) && near(rys[1], 90), 'ry=' + JSON.stringify(rys));
      check('R1-2f', '拐角件 ry 取入/出段角均值 = 45°', cornerParts.length === 2 && cornerParts.every((x) => near(x.ry, 45)),
        'ry=' + JSON.stringify(cornerParts.map((x) => x.ry)));
      check('R1-2g', '顶点不重复落件（拐角占位后常规砖跳过）',
        (() => { const set = new Set(r2.parts.map((x) => Math.round(x.dx * 100) + ':' + Math.round(x.dz * 100))); return set.size === r2.parts.length; })(),
        '件数 ' + r2.parts.length + ' / 唯一坐标 ' + new Set(r2.parts.map((x) => Math.round(x.dx * 100) + ':' + Math.round(x.dz * 100))).size);
      check('R1-2h', '件数 = 3 段各(8,6,8)/2m+1 = 5+4+5 - 2拐角占位 = 12', r2.parts.length === 12, '实际 ' + r2.parts.length);
    }
  }

  // ══════════════ R1-2 补充：环型闭合 ══════════════
  {
    const loop = await registry.build('path', {
      waypoints: [{ dx: 0, dz: 0 }, { dx: 6, dz: 0 }, { dx: 6, dz: 6 }, { dx: 0, dz: 6 }, { dx: 0.5, dz: 0.2 }],
      width: 1, tile: ['roadTile_001'],
    }, { partResolver: resolver, seedStr: 'r1-loop' });
    check('R1-2i', '末点距首点 < tile 尺寸 → 自动闭合', loop.ok && loop.stats.closed === true, 'closed=' + (loop.stats && loop.stats.closed));
    check('R1-2j', '方形 5 点环 → 归一 4 段（尾点被首点取代，不产短段）', loop.ok && loop.stats.segments === 4, 'segments=' + (loop.stats && loop.stats.segments));
    check('R1-2k', '首尾接缝处不重复落件', loop.ok && (() => {
      const set = new Set(loop.parts.map((x) => Math.round(x.dx * 100) + ':' + Math.round(x.dz * 100)));
      return set.size === loop.parts.length;
    })());
  }

  // ══════════════ R1-3 确定性 ══════════════
  {
    const spec = {
      waypoints: [{ dx: 0, dz: 0 }, { dx: 8, dz: 0 }, { dx: 8, dz: 6 }, { dx: 16, dz: 6 }],
      width: 4, tile: ['roadTile_001', 'roadTile_003'], cornerTile: 'roadTile_corner',
    };
    const a = await registry.build('path', spec, { partResolver: resolver, seedStr: 'seed-A' });
    const b = await registry.build('path', spec, { partResolver: resolver, seedStr: 'seed-A' });
    const c = await registry.build('path', spec, { partResolver: resolver, seedStr: 'seed-B' });
    const ja = JSON.stringify(a.parts), jb = JSON.stringify(b.parts);
    check('R1-3a', '同种子同输入 → parts 逐字节相同（幂等重跑不产生重复件的前提）', ja === jb, ja === jb ? '' : '两次输出不一致');
    check('R1-3b', '两种 tile 的轮换确实用到（确定性打散，非单一砖）',
      a.ok && new Set(a.parts.map((x) => x.partKey)).size >= 3, '用到键=' + JSON.stringify(Array.from(new Set(a.parts.map((x) => x.partKey)))));
    check('R1-3c', '换种子仍确定性（结果可不同但不炸，且可重复）',
      c.ok && JSON.stringify(c.parts) === JSON.stringify((await registry.build('path', spec, { partResolver: resolver, seedStr: 'seed-B' })).parts));
    check('R1-3d', '输出全为 2 位小数（与 expandScatterBlocks 同口径）',
      a.ok && JSON.stringify(a.parts).indexOf('0.30000000000000004') < 0 && a.parts.every((x) => Number.isFinite(x.dx) && Number.isFinite(x.dz) && Number.isFinite(x.ry)));
  }

  // ══════════════ 附加：未知 recipe / 缺骨架 / 未知零件 / 预算截断 ══════════════
  {
    const u = await registry.build('road', { waypoints: [{ dx: 0, dz: 0 }, { dx: 4, dz: 0 }] }, { partResolver: resolver });
    check('X-1', '未知 recipe → UNKNOWN_RECIPE + 可用清单 hint',
      u.ok === false && u.code === 'UNKNOWN_RECIPE' && /path/.test(String(u.hint)), u.code + ' / ' + String(u.hint).slice(0, 60));

    const miss = await registry.build('path', { tile: ['roadTile_001'] }, { partResolver: resolver });
    check('X-2', '缺 waypoints → RECIPE_SPEC_INCOMPLETE（不静默产出 0 件）',
      miss.ok === false && miss.code === 'RECIPE_SPEC_INCOMPLETE', miss.code);

    const bad = await registry.build('path', {
      waypoints: [{ dx: 0, dz: 0 }, { dx: 0, dz: 0 }, { dx: 6, dz: 0 }], tile: ['roadTile_001'],
    }, { partResolver: resolver });
    check('X-3', '重复点被清理（(0,0),(0,0),(6,0) 归一为 2 点）', bad.ok === true && bad.parts.length === 4, '件数=' + (bad.parts.length));

    const unknown = await registry.build('path', {
      waypoints: [{ dx: 0, dz: 0 }, { dx: 6, dz: 0 }], tile: ['roadTile_999'],
    }, { partResolver: resolver });
    check('X-4', '零件全查不到 → RECIPE_ALL_PARTS_UNKNOWN 且 dropped.unknownPart 计数',
      unknown.ok === false && unknown.code === 'RECIPE_ALL_PARTS_UNKNOWN' && unknown.stats.dropped.unknownPart === 1, unknown.code);

    const cap = await registry.build('path', {
      waypoints: [{ dx: 0, dz: 0 }, { dx: 20, dz: 0 }], width: 1, tile: ['roadTile_001'],
    }, { partResolver: resolver, seedStr: 'cap', maxObjects: 5 });
    check('X-5', '预算截断：展开 8 件（20m/步长2 含补尾）→ 截到 5 件且 truncated=true',
      cap.ok === true && cap.parts.length === 5 && cap.stats.truncated === true, '件数=' + cap.parts.length + ' truncated=' + cap.stats.truncated);

    const tail = await registry.build('path', {
      waypoints: [{ dx: 0, dz: 0 }, { dx: 20, dz: 0 }], width: 1, tile: ['roadTile_001'],
    }, { partResolver: resolver, seedStr: 'tail' });
    check('X-7', '末端补齐：20m/步长2 → 11 件且最后一块落在 20（不短一截）',
      tail.ok === true && tail.parts.length === 11 && near(tail.parts[tail.parts.length - 1].dx, 20),
      '件数=' + tail.parts.length + ' 末点 dx=' + (tail.parts[tail.parts.length - 1] || {}).dx);

    const nocorner = await registry.build('path', {
      waypoints: [{ dx: 0, dz: 0 }, { dx: 6, dz: 0 }, { dx: 6, dz: 6 }], width: 1, tile: ['roadTile_001'], cornerTile: 'roadTile_missing',
    }, { partResolver: resolver, seedStr: 'nc' });
    check('X-6', 'cornerTile 不存在 → 退化为普通砖不报错（notes 留痕）',
      nocorner.ok === true && nocorner.stats.corners === 0 && /cornerTile 查不到/.test(nocorner.stats.notes.join('|')),
      nocorner.ok ? nocorner.stats.notes.join('|').slice(0, 60) : nocorner.code);
  }

  console.log('\n────────────────────────────────────────');
  console.log('合计 ' + results.length + ' 条，PASS ' + (results.length - failed) + ' / FAIL ' + failed);
  if (failed) {
    console.log('\n失败明细：');
    for (const r of results.filter((x) => !x.ok)) console.log('  ✗ ' + r.id + ' ' + r.title + '  —— ' + r.detail);
  }
  console.log(failed ? '\nVERDICT: FAIL' : '\nVERDICT: ACCEPTED');
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error('验收脚本异常：', e);
  process.exit(2);
});