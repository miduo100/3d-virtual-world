/**
 * accept_ai_assemble_e2e.js —— AI 自由拼装 · 真实端到端实测（真 LLM + 真落库 + 反测尺寸）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 回答三个问题（用户原话："实际跑一下，看他是不是进行了提前规划、能否按我们预设想那样，
 * 比如小路让他组装一个 20 米，看看是不是组装成了 20 米"）：
 *   Q1 AI 有没有"提前规划"？    → 打印 AI 原始 recipe 骨架（它只给 waypoints，不给零件坐标）
 *   Q2 骨架符不符合 20 米要求？  → 实测 AI 给的 waypoints 首尾直线距离
 *   Q3 落库后的路到底多长？      → 从 world_objects 真实坐标反测（跨度/覆盖长度/连续性）
 *
 * ★ 全链路真实：真区域/真委托/真 LLM(qwen-plus)/真零件库/真写库/真回滚清理。
 *   本套件会烧少量 LLM token（1~2 次调用）。
 *
 * 用法：node scripts/accept_ai_assemble_e2e.js ["需求文字，默认：搭一条20米长的小路"] [--keep]
 */
'use strict';

const path = require('path');
process.chdir(path.join(__dirname, '..'));
require('dotenv').config();

const { query } = require('../src/database/db');
const regionService = require('../src/worldai/regions/regionService');
const missionService = require('../src/worldai/missions/missionService');
const missionRunner = require('../src/worldai/missions/missionRunner');

const args = process.argv.slice(2);
const KEEP = args.includes('--keep');
const DEMAND = (args.filter((a) => !a.startsWith('--'))[0] || '搭一条20米长的小路').trim();
const STAMP = 'e2e_asm_' + Date.now().toString(36);
const REGION_KEY = STAMP;
// --at=x,z 指定测试区原点（默认 3200,3200 的空旷地；想让人走过去看到就传出生点附近的空地）
const AT = (function () {
  const a = args.filter((x) => x.indexOf('--at=') === 0)[0];
  if (!a) return { x: 3200, z: 3200 };
  const parts = a.slice(5).split(',').map(Number);
  return { x: isFinite(parts[0]) ? parts[0] : 3200, z: isFinite(parts[1]) ? parts[1] : 3200 };
})();
const ORIGIN = { x: AT.x, z: AT.z, width: 60, depth: 60, kind: 'rect' };
const WORLD_ID = process.env.E2E_WORLD_ID || '';
const TARGET = 20;
// --max=N 委托对象预算（默认 40；乐高积木件数多，建议 --max=200）
const MAX_OBJECTS = (function () {
  const a = args.filter((x) => x.indexOf('--max=') === 0)[0];
  const n = a ? Number(a.slice(6)) : NaN;
  return isFinite(n) && n > 0 ? Math.floor(n) : 40;
})();

// ---------- 测量工具 ----------
const r1 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

/** 从一串落点反测"路"的尺寸 */
function measure(pts, tileLen) {
  if (!pts.length) return null;
  const sorted = pts.slice().sort((a, b) => (a.x - b.x) || (a.z - b.z));
  const gaps = [];
  let poly = 0;
  for (let i = 1; i < sorted.length; i++) {
    const d = dist(sorted[i - 1], sorted[i]);
    gaps.push(r1(d));
    poly += d;
  }
  const span = dist(sorted[0], sorted[sorted.length - 1]);
  const half = (Number(tileLen) || 0) / 2;
  return {
    count: sorted.length, span: r1(span), polyline: r1(poly), cover: r1(poly + half * 2),
    maxGap: gaps.length ? Math.max.apply(null, gaps) : 0,
    minGap: gaps.length ? Math.min.apply(null, gaps) : 0,
    first: { x: r1(sorted[0].x), z: r1(sorted[0].z) },
    last: { x: r1(sorted[sorted.length - 1].x), z: r1(sorted[sorted.length - 1].z) },
  };
}

function measureSkeleton(spec) {
  const wps = (spec && spec.waypoints) || [];
  if (wps.length < 2) return null;
  const pts = wps.map((w) => ({ x: Number(w.dx) || 0, z: Number(w.dz) || 0 }));
  const m = measure(pts, 0);
  return { points: pts.length, span: m.span, polyline: m.polyline };
}

function line(t) { console.log('\n──────── ' + t + ' ────────'); }
function kv(k, v) { console.log('   ' + k + '：' + v); }

async function cleanup(missionId) {
  if (KEEP) { console.log('\n[KEEP] 保留测试数据：region=' + REGION_KEY + ' mission=' + missionId); return; }
  try { if (missionId) await query(`DELETE FROM world_objects WHERE created_by = $1 AND origin='ai'`, [missionId]); } catch (e) { console.log('  清理 world_objects 失败：' + e.message); }
  try { if (missionId) await query(`DELETE FROM world_build_missions WHERE id = $1`, [missionId]); } catch (e) { console.log('  清理 missions 失败：' + e.message); }
  try { await query(`DELETE FROM world_regions WHERE region_key = $1`, [REGION_KEY]); } catch (e) { console.log('  清理 regions 失败：' + e.message); }
  console.log('\n[清理] 已删除测试区域/委托/AI 落件');
}

(async function main() {
  console.log('\n══════════════════════════════════════════════════════════');
  console.log('  AI 自由拼装 · 真实端到端实测');
  console.log('  需求原文：「' + DEMAND + '」');
  console.log('  目标尺寸：' + TARGET + ' 米（小路）');
  console.log('══════════════════════════════════════════════════════════');

  let missionId = null;
  try {
    line('阶段0：建区域 + 建委托（真实数据库）');
    const occ = await query(
      `SELECT count(*)::int n FROM world_objects WHERE position_x BETWEEN $1 AND $2 AND position_z BETWEEN $3 AND $4`,
      [ORIGIN.x, ORIGIN.x + ORIGIN.width, ORIGIN.z, ORIGIN.z + ORIGIN.depth]);
    kv('目标区域占用对象', occ.rows[0].n + ' 个（应为 0，避让真人资产）');

    const rg = await regionService.createRegion({
      regionKey: REGION_KEY, name: 'E2E 拼装实测区', worldId: WORLD_ID,
      autonomy: 'autonomous', bounds: ORIGIN,
      notes: 'E2E 端到端实测（accept_ai_assemble_e2e.js 自动创建，测完自动清理）' });
    if (!rg.ok) throw new Error('建区域失败：' + rg.code + ' ' + rg.reason);
    kv('区域', REGION_KEY + ' autonomy=autonomous');

    const ms = await missionService.createMission({
      regionKey: REGION_KEY, prompt: DEMAND, createdBy: 'e2e_assemble',
      worldId: WORLD_ID, constraints: { max_objects: MAX_OBJECTS, placement_policy: 'avoid' } });
    if (!ms.ok) throw new Error('建委托失败：' + ms.code + ' ' + ms.reason);
    missionId = ms.mission.id;
    kv('委托', missionId + ' status=' + ms.mission.status + ' snapshot=' + ms.mission.autonomy_snapshot);

    line('阶段1：真实 LLM 规划 + recipe 展开 + 落库（missionRunner.run）');
    kv('LLM', 'providerRouter → promptBuilder → llmClient（真实调用，落 ai_call_log 账）');
    const t0 = Date.now();
    const run = await missionRunner.run(missionId);
    kv('runner 结果', 'ok=' + run.ok + ' code=' + (run.code || '-') + ' 用时 ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
    if (run.reason) kv('原因', run.reason);

    line('阶段2：Q1 —— AI 有没有提前规划？（只看它输出的骨架）');
    const mrow = await query(
      `SELECT executed_stats, status FROM world_build_missions WHERE id=$1`, [missionId]);
    const ex = (mrow.rows[0] && mrow.rows[0].executed_stats) || {};
    kv('委托状态', mrow.rows[0] ? mrow.rows[0].status : '?');
    const blocks = (ex.plan && ex.plan.blocks) || (run.plan && run.plan.blocks) || [];
    if (!blocks.length) {
      kv('⚠ 未取到 blocks', 'executed_stats=' + JSON.stringify(ex).slice(0, 320));
    } else {
      for (const b of blocks) {
        kv('块 kind=' + b.kind, 'mode=' + (b.mode || '(普通块)') + '  recipe=' + (b.recipe || '-'));
        if (b.mode === 'recipe' && b.spec) {
          console.log('      ★ AI 给的骨架 spec = ' + JSON.stringify(b.spec));
          const sk = measureSkeleton(b.spec);
          if (sk) kv('      ★ 骨架尺寸', sk.points + ' 个航点 / 首尾跨度 ' + sk.span + ' 米 / 折线长 ' + sk.polyline + ' 米');
        }
        if (b.recipeStats) {
          kv('      引擎展开', b.recipeStats.count + ' 件（拐角 ' + (b.recipeStats.corners || 0)
            + ' / 排数 ' + (b.recipeStats.rows || '-') + ' / 步长 ' + (b.recipeStats.step || '-') + 'm'
            + (b.recipeStats.truncated ? ' / 已按预算截断' : '') + '）');
        }
        if ((b.parts || []).length) {
          const tileLen = (b.parts[0].grid && b.parts[0].grid[0]) || 0;
          const m2 = measure(b.parts.map((p) => ({ x: p.dx, z: p.dz })), tileLen);
          kv('      落件坐标反测', m2.count + ' 件 / 首尾跨度 ' + m2.span + ' 米 / 折线长 ' + m2.polyline
            + ' 米 / 实体覆盖约 ' + m2.cover + ' 米 / 相邻间距 ' + m2.minGap + '~' + m2.maxGap + ' 米');
        }
      }
    }

    line('阶段3：Q3 —— 世界里真实落下来的路有多长？（读 world_objects）');
    const objs = await query(
      `SELECT id, name, position_x, position_z, rotation_y FROM world_objects
        WHERE created_by = $1 ORDER BY id`, [missionId]);
    kv('落库件数', objs.rows.length);
    let span = null;
    if (objs.rows.length) {
      // ★ 按零件键分组测量：混合需求（如"小路 + 种树"）里树不能算进"路的长度"
      const byKey = {};
      for (const o of objs.rows) {
        const k = String(o.name);
        if (!byKey[k]) byKey[k] = [];
        byKey[k].push({ x: Number(o.position_x), z: Number(o.position_z) });
      }
      const tileKey = (blocks[0] && blocks[0].spec && (blocks[0].spec.tile || [])[0]) || null;
      let mainKey = null;
      for (const k of Object.keys(byKey)) if (byKey[k].length > 1 && !mainKey) mainKey = k;
      if (tileKey && byKey[tileKey]) mainKey = tileKey;
      console.log('   落件按零件键分组：');
      for (const k of Object.keys(byKey)) {
        const g = byKey[k];
        const mm = measure(g, 2.94);
        const mark = k === mainKey ? '  ← 主体结构' : '  （附属散点，不计入主体尺寸）';
        console.log('     ' + k + ' × ' + mm.count + ' 件 / 跨度 ' + mm.span + ' 米 / 折线 ' + mm.polyline + ' 米' + mark);
      }
      if (mainKey && byKey[mainKey]) {
        const m3 = measure(byKey[mainKey], 2.94);
        span = m3.span;
        console.log('   ┌──────────────── 主体结构尺寸实测结论 ────────────────');
        console.log('   │ 目标（用户要求）      ：' + TARGET + ' 米');
        console.log('   │ 真实落件首尾跨度      ：' + m3.span + ' 米   ← 与目标对比看这个');
        console.log('   │ 真实落件折线累计长度  ：' + m3.polyline + ' 米' + (blocks[0] && blocks[0].spec && blocks[0].spec.waypoints && blocks[0].spec.waypoints.length > 2 ? '（弯道：路径长 > 跨度，属几何必然）' : ''));
        console.log('   │ 实体覆盖长度          ：' + m3.cover + ' 米（含首尾各半块）');
        console.log('   │ 件数 / 相邻间距       ：' + m3.count + ' 件 / ' + m3.minGap + '~' + m3.maxGap + ' 米');
        console.log('   │ 起点 →终点            ：(' + m3.first.x + ',' + m3.first.z + ')→(' + m3.last.x + ',' + m3.last.z + ')');
        console.log('   └───────────────────────────────────────────────────────');
        console.log('   主体前 8 件落点：');
        for (const o of objs.rows.filter((x) => String(x.name) === mainKey).slice(0, 8)) {
          console.log('     #' + o.id, o.name, 'pos=(' + r1(o.position_x) + ',' + r1(o.position_z) + ') ry=' + r1(o.rotation_y));
        }
      }
    }

    line('阶段4：Q2 汇总判定');
    const dev = span == null ? null : Math.abs(span - TARGET);
    kv('真实落件与 ' + TARGET + ' 米偏差', dev == null ? 'N/A（未落件）'
      : r1(dev) + ' 米 → ' + (dev <= 0.5 ? '✅ 达标' : dev <= 1.5 ? '⚠ 偏差可接受' : '❌ 不达标'));

    console.log('\n══════════════════════════════════════════════════════════');
    console.log('  三个问题的答案见上面阶段2/3/4。');
    console.log('══════════════════════════════════════════════════════════');
  } catch (e) {
    console.error('\n[异常]', (e && e.stack) || e);
  } finally {
    await cleanup(missionId);
  }
  process.exit(0);
})();