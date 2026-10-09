/**
 * token 估算与截断（AI World Brain · Phase 2a · 队列项 2a-2）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 唯一规格来源：AI-World-Brain-架构审查与改造方案.md §H.9.2（上下文预算与装配）
 *
 * 为什么单独成文件（§K.3 提取法）：promptBuilder 只管"分段与裁剪顺序"，
 * "这段文本值多少 token / 怎么按预算截断"是可独立复用的纯函数，便于单测与被 3.5 复用。
 *
 * 估算口径（刻意不装 tiktoken，§五·成本纪律）：
 *   - CJK / 全角字符 ≈ 1 token（汉字在 BPE 里基本一字一 token）
 *   - 其它字符 ≈ 0.25 token（英文 4 字符 ≈ 1 token 的经验值）
 *   误差通过"预算留 15% 余量"吸收（见 SAFETY_MARGIN），本项目不追求精确。
 */
'use strict';

/** 窗口未知时的保守回退（§H.9.2 硬约束 3） */
const DEFAULT_WINDOW_TOKENS = 16000;

/** 估算安全余量：估算值 × (1 - 0.15) 作为可用预算，防高估 token 数导致超窗 */
const SAFETY_MARGIN = 0.15;

const CJK_RE = /[\u2E80-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF\uFF00-\uFFEF\u3000-\u303F]/;

/** 文本 → 估算 token 数 */
function estimateTokens(text) {
  const s = String(text == null ? '' : text);
  if (!s) return 0;
  let cjk = 0;
  for (const ch of s) if (CJK_RE.test(ch)) cjk++;
  const other = s.length - cjk;
  return Math.ceil(cjk + other / 4);
}

/** 预算 → 实际可用 token（扣安全余量） */
function usableBudget(tokens) {
  const n = Number(tokens);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n * (1 - SAFETY_MARGIN));
}

/**
 * 按 token 预算截断文本（超预算时尾部补省略标记）。
 * 用于"连降级都放不下"的最后兜底 —— 绝不抛错（§H.9.2：优先降级，仅 ROLE+TASK+输出都放不下才报错）。
 * @returns {string}
 */
function clampText(text, maxTokens) {
  const s = String(text == null ? '' : text);
  const cap = usableBudget(maxTokens);
  if (cap <= 0) return '';
  if (estimateTokens(s) <= cap) return s;
  // 二分找可保留的字符数（估算函数单调，误差远小于 15% 余量）
  let lo = 0, hi = s.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (estimateTokens(s.slice(0, mid)) <= cap - 8) lo = mid;
    else hi = mid - 1;
  }
  return s.slice(0, lo) + '\n…（已按预算截断）';
}

/** 归一窗口：未知/非法一律回退 16k（§H.9.2） */
function resolveWindowTokens(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1024) return DEFAULT_WINDOW_TOKENS;
  return Math.floor(n);
}

module.exports = {
  DEFAULT_WINDOW_TOKENS,
  SAFETY_MARGIN,
  estimateTokens,
  usableBudget,
  clampText,
  resolveWindowTokens,
};