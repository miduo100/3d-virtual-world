/**
 * memoryCompressor —— 7 天低重要度合并 + 封顶淘汰（AI World Brain · Phase 7 · 分册 §6.3/§6.4 · 判据 P6-9 / P6-10）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 规格来源：分册 §6.3「压缩：每天跑一次 —— 把过去 7 天同 tag 的 importance<=2 记忆合并成 1 条
 *   kind='summary'（LLM 一次调用）」+ §6.4 遗忘表（importance≤2 超 7 天压缩后删除 / 总量上限 5000）。
 *
 * ★ 三条实现口径（本阶段刻意与文档的差异，已在 §J.3 声明）：
 *   1) **零 LLM 调用**：摘要是确定性拼接（原文按时间序 + 截断 2000 字），不是模型改写——
 *      验收纪律「LLM 零调用」优先，且合并动作不该烧钱（§H.10.3 省钱的唯一做法）。
 *   2) **按 (scope, subject_id, kind) 分组合并**，不按 tag（tag 集合不稳定，按 tag 合并会漏）。
 *      kind='summary' 的行不再参与合并（否则摘要会自我套娃）。
 *   3) **必须排在 memoryMaintenance 的去重压缩之前**：既有去重会先删掉同 kind 的旧行，
 *      若顺序反了，待合并的低重要度记忆已经被删掉，P6-9 永远无法观察到。
 */
'use strict';

const { query } = require('../../database/db');

const CAP = 5000;              // §6.4 单世界记忆总量上限
const WINDOW_DAYS = 7;         // §6.4 importance<=2 且超过 7 天
const MAX_SUMMARY_CHARS = 2000;// 与 memoryService.write 的截断一致

/**
 * 合并 7 天窗口内 importance<=2 的记忆：每组生成 1 条 kind='summary'，随后删原行。
 * @returns {{ok, groups, merged, deleted}}
 */
async function compressLowImportance(worldId, opts) {
  const o = opts || {};
  const days = Math.max(1, Math.floor(Number(o.windowDays) || WINDOW_DAYS));
  const params = [String(worldId), days];
  const rows = (await query(
    `SELECT id, scope, subject_id, kind, content, importance, created_at
       FROM world_memories
      WHERE world_id = $1
        AND importance <= 2
        AND kind <> 'summary'
        AND created_at < NOW() - ($2::int * INTERVAL '1 day')
      ORDER BY scope, subject_id, kind, created_at ASC
      LIMIT 2000`, params)).rows || [];
  if (!rows.length) return { ok: true, groups: 0, merged: 0, deleted: 0 };

  // 分组
  const groups = new Map();
  for (const r of rows) {
    const key = [r.scope, r.subject_id === null ? '' : String(r.subject_id), r.kind].join('|');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }

  let merged = 0;
  let deleted = 0;
  for (const [, list] of groups) {
    // 每组只留 1 条摘要；单条组直接原地升级为 summary（省一次写删）
    const body = list.map((r) => '- [' + String(r.created_at).slice(0, 10) + '] '
      + String(r.content || '').replace(/\s+/g, ' ').slice(0, 160)).join('\n');
    const content = ('[' + list.length + ' 条低重要度记忆合并 ' + days + ' 天窗口]\n' + body).slice(0, MAX_SUMMARY_CHARS);
    const first = list[0];
    const ins = await query(
      `INSERT INTO world_memories (world_id, scope, subject_id, kind, content, importance, tags, source)
       VALUES ($1,$2,$3,'summary',$4,2,ARRAY['compressed'],'operator')
       RETURNING id`,
      [String(worldId), first.scope, first.subject_id, content]);
    merged += ins.rows.length;
    if (list.length === 1) {
      // 单条组：删掉刚插的摘要行，直接把原行升级为摘要（少一行、语义相同）
      if (ins.rows.length) {
        await query(`DELETE FROM world_memories WHERE id = $1`, [ins.rows[0].id]);
        merged -= 1;
      }
      await query(`UPDATE world_memories SET kind='summary', content=$2, importance=2, tags=ARRAY['compressed'] WHERE id=$1`,
        [first.id, content]);
      deleted += 1;
    } else {
      const ids = list.map((r) => r.id);
      const d = await query(`DELETE FROM world_memories WHERE id = ANY($1::bigint[])`, [ids]);
      deleted += d.rowCount || 0;
    }
  }
  return { ok: true, groups: groups.size, merged, deleted, windowDays: days };
}

/** 封顶淘汰：超出 CAP 时**先删最不重要的**（importance 最低、同重要度删最旧的）
 *  ★ 口径修正（Phase 7 P6-10 实测发现）：DELETE ... ORDER BY ... OFFSET N 保留的是排序后的前 N 行，
 *    所以必须按 importance DESC, created_at DESC 排序（=最重要的排前面并保留），
 *    升序排序会把「最不重要的」那批留在库里 —— 与 §6.4「importance>=4 永久保留」正相反。 */
async function evictOverCap(worldId, cap) {
  const limit = Math.max(1, Math.floor(Number(cap) || CAP));
  const cnt = (await query(`SELECT count(*)::int AS n FROM world_memories WHERE world_id = $1`, [String(worldId)])).rows[0];
  const total = cnt.n;
  if (total <= limit) return { ok: true, total, evicted: 0 };
  const d = await query(
    `DELETE FROM world_memories WHERE id IN (
        SELECT id FROM world_memories WHERE world_id = $1
         ORDER BY importance DESC, created_at DESC OFFSET $2)`,
    [String(worldId), limit]
  );
  return { ok: true, total, evicted: d.rowCount || 0, cap: limit };
}

/** 一轮：先合并 → 再封顶（与 memoryMaintenance.runOnce 同一趟，不另起定时器） */
async function runOnce(worldId, opts) {
  const o = opts || {};
  const w = String(worldId);
  const compressed = await compressLowImportance(w, o);
  const capped = await evictOverCap(w, o.cap);
  return { ok: true, compressed, capped };
}

module.exports = { CAP, WINDOW_DAYS, MAX_SUMMARY_CHARS, compressLowImportance, evictOverCap, runOnce };