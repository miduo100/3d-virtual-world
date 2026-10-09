/**
 * World AI 用量与健康度（AI World Brain · Phase 2a · 队列项 2a-2 · P1-2 配套）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 规格来源：主文档 §H.9.4「用账本实测定预算，不要猜」+ Phase 2 的「后台 UI：用量与健康度」。
 *
 * 数据源只有一个：**ai_call_log**（Phase 0 已建，llmClient 每次调用都写）。
 * 本文件只做只读聚合，不写库、不改任何既有表。
 *
 * ★ 口径：
 *   - "今日"按服务器本地时区（Asia/Shanghai）切日，与后台「每日预算」的直觉一致；
 *   - 预算是 world_ai_configs.budget 里的 llmCallsPerDay / tokensPerDay，这里同时回传，
 *     让前端能直接算"今日已用 / 上限"，不必在前端再抄一份上限常量。
 */
'use strict';

const { query } = require('../database/db');

const TZ = 'Asia/Shanghai';
const MAX_DAYS = 30;

/** 单行聚合 → 对象数组 */
function rows(r) { return (r && r.rows) || []; }

async function getUsage(opts) {
  const days = Math.min(MAX_DAYS, Math.max(1, Number((opts && opts.days) || 7)));

  // 1) 概览：今日 / 全期
  const overview = rows(await query(
    `SELECT
       count(*) FILTER (WHERE to_char(created_at AT TIME ZONE $1,'YYYY-MM-DD') = to_char(now() AT TIME ZONE $1,'YYYY-MM-DD'))::int AS today_calls,
       count(*) FILTER (WHERE to_char(created_at AT TIME ZONE $1,'YYYY-MM-DD') = to_char(now() AT TIME ZONE $1,'YYYY-MM-DD') AND ok = FALSE)::int AS today_failed,
       coalesce(sum(total_tokens) FILTER (WHERE to_char(created_at AT TIME ZONE $1,'YYYY-MM-DD') = to_char(now() AT TIME ZONE $1,'YYYY-MM-DD')),0)::bigint AS today_tokens,
       coalesce(avg(latency_ms) FILTER (WHERE to_char(created_at AT TIME ZONE $1,'YYYY-MM-DD') = to_char(now() AT TIME ZONE $1,'YYYY-MM-DD')),0)::int AS today_avg_latency,
       count(*)::int AS total_calls,
       count(*) FILTER (WHERE ok = FALSE)::int AS total_failed,
       coalesce(sum(total_tokens),0)::bigint AS total_tokens,
       max(created_at) AS last_call_at
     FROM ai_call_log`,
    [TZ]
  ))[0] || {};

  // 2) 按天（近 N 天）
  const byDay = rows(await query(
    `SELECT to_char(created_at AT TIME ZONE $1,'YYYY-MM-DD') AS date,
            count(*)::int AS calls,
            count(*) FILTER (WHERE ok = FALSE)::int AS failed,
            coalesce(sum(total_tokens),0)::bigint AS tokens
       FROM ai_call_log
      WHERE created_at >= now() - ($2 || ' days')::interval
      GROUP BY 1 ORDER BY 1 DESC`,
    [TZ, String(days)]
  ));

  // 3) 按用途
  const byPurpose = rows(await query(
    `SELECT coalesce(purpose,'(未标注)') AS purpose, count(*)::int AS calls,
            count(*) FILTER (WHERE ok = FALSE)::int AS failed,
            coalesce(sum(total_tokens),0)::bigint AS tokens
       FROM ai_call_log
      WHERE created_at >= now() - ($1 || ' days')::interval
      GROUP BY 1 ORDER BY calls DESC`,
    [String(days)]
  ));

  // 4) 按厂商
  const byProvider = rows(await query(
    `SELECT provider_id, coalesce(provider_name,'(未知)') AS provider_name, count(*)::int AS calls,
            count(*) FILTER (WHERE ok = FALSE)::int AS failed,
            coalesce(sum(total_tokens),0)::bigint AS tokens
       FROM ai_call_log
      WHERE created_at >= now() - ($1 || ' days')::interval
      GROUP BY 1,2 ORDER BY calls DESC`,
    [String(days)]
  ));

  // 5) 近端错误（健康度：连续失败会触发 2b 的熔断，这里提前让人看见）
  const recentErrors = rows(await query(
    `SELECT created_at, purpose, provider_name, error_code, left(error_message, 200) AS error_message
       FROM ai_call_log
      WHERE ok = FALSE
      ORDER BY created_at DESC LIMIT 10`
  ));

  // 6) 预算上限（只读 world_ai_configs，供前端算占比）
  let budgets = {};
  try {
    const cfg = rows(await query(`SELECT budget FROM world_ai_configs ORDER BY id LIMIT 1`))[0];
    if (cfg && cfg.budget && typeof cfg.budget === 'object') budgets = cfg.budget;
  } catch (e) { /* 表不存在等：留空，不影响用量展示 */ }

  const today = {
    calls: overview.today_calls || 0,
    failed: overview.today_failed || 0,
    tokens: Number(overview.today_tokens || 0),
    avgLatencyMs: overview.today_avg_latency || 0,
  };

  return {
    generatedAt: new Date().toISOString(),
    timezone: TZ,
    windowDays: days,
    today,
    totals: {
      calls: overview.total_calls || 0,
      failed: overview.total_failed || 0,
      tokens: Number(overview.total_tokens || 0),
      lastCallAt: overview.last_call_at || null,
    },
    byDay,
    byPurpose,
    byProvider,
    recentErrors,
    budgets: {
      llmCallsPerDay: Number(budgets.llmCallsPerDay || 0),
      tokensPerDay: Number(budgets.tokensPerDay || 0),
    },
    health: {
      todayFailRate: today.calls ? Math.round((today.failed / today.calls) * 100) : 0,
      recentErrorCount: recentErrors.length,
      // 供 UI 一眼判断；不替代 2b 的熔断器
      status: today.calls === 0 ? 'idle' : (today.failed / today.calls >= 0.5 ? 'degraded' : 'ok'),
    },
  };
}

module.exports = { getUsage, TZ };