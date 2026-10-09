/**
 * feedbackTools —— 接收真人反馈（AI World Brain · Phase 7 · 判据 P6-12）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 定位：**HTTP 端点不是 verb**，所以本模块不是注册到verbRegistry 的工具，而是
 *   POST /api/world-feedback 的业务实现（玩家 JWT）。反馈落world_memories：
 *   scope='feedback' / kind='preference' / importance=4 / source='human'。
 *
 * ★ 三条纪律：
 *   1) **反馈是玩家输入 = 不可信内容**：入库前先过 promptBuilder.sanitizeUntrusted
 *      （剥离伪造的 [UNTRUSTED] 标记与提示注入句式），渲染进 prompt 时再过一次（双保险）。
 *   2) **subject_id 带时间戳**：memoryMaintenance 的去重会按 (scope,subject_id,kind) 只留最新一条，
 *      若subject_id 固定为用户 ID，历史反馈会被去重吃掉（§6.4 只压 importance<=2，不适用于此）。
 *   3) **限频**：同一玩家 10 秒一条（防刷屏；不写内存计数器 —— 查最近一条记忆行即可，重启安全）。
 */
'use strict';

const { query } = require('../../database/db');
const memoryService = require('../memory/memoryService');
const promptBuilder = require('../llm/promptBuilder');

const MAX_CHARS = 1000;
const MIN_INTERVAL_SEC = 10;
const CATEGORIES = ['bug', 'suggestion', 'praise', 'other'];

/** 提交一条反馈（玩家身份由路由层从 JWT 派生，服务端不信任 body 里的 userId） */
async function submit(o) {
  const p = o || {};
  const userId = p.userId ? String(p.userId) : null;
  if (!userId) return { ok: false, code: 'USER_REQUIRED', reason: '缺少玩家身份（应由路由层从 token 派生）' };
  const raw = String(p.content || '').trim();
  if (!raw) return { ok: false, code: 'CONTENT_REQUIRED', reason: '反馈内容为空' };
  if (raw.length > MAX_CHARS) return { ok: false, code: 'CONTENT_TOO_LONG', reason: '反馈最多 ' + MAX_CHARS + ' 字' };
  // ① 限频（查最近一条，不依赖内存）
  const recent = (await query(
    `SELECT created_at FROM world_memories
      WHERE world_id=$1 AND scope='feedback' AND subject_id LIKE $2
      ORDER BY created_at DESC LIMIT 1`,
    [String(p.worldId || ''), 'fb:' + userId + ':%']
  )).rows[0];
  if (recent && (Date.now() - new Date(recent.created_at).getTime()) < MIN_INTERVAL_SEC * 1000) {
    return { ok: false, code: 'FEEDBACK_TOO_FREQUENT', reason: '提交太频繁，请 ' + MIN_INTERVAL_SEC + ' 秒后再试' };
  }
  // ② 不可信内容剥离（与 prompt 渲染同款规则）
  const content = promptBuilder.sanitizeUntrusted(raw).slice(0, MAX_CHARS);
  if (!content) return { ok: false, code: 'CONTENT_EMPTY_AFTER_SANITIZE', reason: '反馈内容在安全剥离后为空' };
  const category = CATEGORIES.indexOf(p.category) >= 0 ? p.category : 'other';
  // ③ 落记忆（subject_id 带时间戳，避免被去重吃掉历史）
  const subjectId = 'fb:' + userId + ':' + Date.now();
  const w = await memoryService.write({
    worldId: String(p.worldId || ''),
    scope: 'feedback', kind: 'preference', importance: 4, source: 'human',
    subject_id: subjectId,
    tags: ['feedback', category, p.regionKey ? String(p.regionKey).slice(0, 60) : 'nowhere'],
    content: '玩家反馈（' + category + '）：' + content,
  });
  if (!w.ok) return { ok: false, code: w.code || 'MEMORY_WRITE_FAILED', reason: w.reason || '写入记忆失败' };
  return {
    ok: true, memory: w.memory,
    note: '已写入 world_memories(scope=feedback, importance=4)；下一轮规划会召回它（玩家输入按不可信内容处理）',
  };
}

/** 召回某世界的反馈（管理面/调试用；结构化召回，不做向量） */
async function recall(worldId, limit) {
  const r = await memoryService.recall({
    worldId: String(worldId || ''), scope: 'feedback', limit: limit || 20,
  });
  return r;
}

module.exports = { submit, recall, MAX_CHARS, MIN_INTERVAL_SEC, CATEGORIES };