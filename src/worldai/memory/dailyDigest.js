/**
 * dailyDigest —— 「昨日摘要」（AI World Brain · Phase 7 · 判据 P6-11）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 用途：把「昨天发生了什么」压成 3~5 行文字，进 prompt 的 [MEMORY] 段顶部。
 * 数据源（全部聚合表，零 LLM、零原始轨迹）：
 *   world_metrics_daily（前一天：visits / interactions / chat_count / task_completion / economy）
 *   world_events（前一天：AI 建了几件东西、工具成败、活动与任务数）
 * 口径纪律：
 *   ①**不写任何玩家原文**（聊天只取条数，§H.6/P3-12 同款隐私红线）；
 *   ②生成结果经调用方传入 promptBuilder，由 [MEMORY] 行统一过 sanitizeUntrusted（双保险）；
 *   ③取不到数据就返回空串（调用方据此不写该行，绝不编造"昨天很平静"）。
 */
'use strict';

const { query } = require('../../database/db');

function dayStr(d) { return new Date(d).toISOString().slice(0, 10); }

/** 构造「昨日摘要」文本（无数据返回空串） */
async function buildYesterdayDigest(worldId) {
  const w = String(worldId || '');
  if (!w) return '';
  const yesterday = dayStr(Date.now() - 86400000);
  const lines = [];
  try {
    const g = (await query(
      `SELECT metric_key, COALESCE(sum(metric_value),0) AS v
         FROM world_metrics_daily
        WHERE world_id=$1 AND day = $2::date AND region_id = '00000000-0000-0000-0000-000000000000'
        GROUP BY 1`, [w, yesterday])).rows || [];
    const map = {};
    for (const r of g) map[String(r.metric_key)] = Number(r.v) || 0;
    lines.push('昨日（' + yesterday + '）全界：访问 ' + (map.visits || 0) + ' 次 · 交互 '
      + (map.interactions || 0) + ' 次 · 聊天 ' + (map.chat_count || 0) + ' 条 · 任务完成 '
      + (map.task_completion || 0) + ' 个 · 消费 ' + (map.economy || 0));
    const ev = (await query(
      `SELECT type, count(*)::int AS n FROM world_events
        WHERE world_id=$1 AND created_at::date = $2::date
          AND type IN ('object_created','object_removed','entity_created','task_completed',
                       'activity_started','activity_finished','tool_denied')
        GROUP BY 1`, [w, yesterday])).rows || [];
    if (ev.length) {
      lines.push('昨日变更：' + ev.map((r) => String(r.type) + '=' + r.n).join(' · '));
    }
    const hot = (await query(
      `SELECT region_id, COALESCE(sum(metric_value),0) AS v
         FROM world_metrics_daily
        WHERE world_id=$1 AND day = $2::date AND metric_key='visits'
          AND region_id <> '00000000-0000-0000-0000-000000000000'
        GROUP BY 1 ORDER BY 2 DESC LIMIT 3`, [w, yesterday])).rows || [];
    if (hot.length) {
      lines.push('昨日热门区域（region_id）：' + hot.map((r) => String(r.region_id).slice(0, 8) + '=' + Number(r.v)).join(' · '));
    }
    const stuck = (await query(
      `SELECT count(*)::int AS n FROM world_events
        WHERE world_id=$1 AND created_at::date = $2::date AND type='tool_denied'`, [w, yesterday])).rows[0];
    if (stuck && stuck.n > 0) lines.push('昨日被拒动作 ' + stuck.n + ' 次（守卫/预算/审批），值得反思');
    return lines.join('\n').slice(0, 1200);
  } catch (e) {
    return '';                                   // 取不到就当作没有摘要，绝不编造
  }
}

module.exports = { buildYesterdayDigest };