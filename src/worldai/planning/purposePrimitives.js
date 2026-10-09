/**
 * purposePrimitives —— 预置目的原语表（AI World Brain · Phase 3）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 规格来源：§Phase 3 文件清单「预置目的原语表（base/social/commerce/explore/coop/optimize + 前置依赖）」。
 *
 * 作用：给 worldPlanner 的 LLM 一个**封闭的目的词表**（§H.9 装配契约的 parts 位），
 * 规划不许发明表外 purpose；planValidator 据此校验（引用完整性 + 前置依赖）。
 * 5 阶段固定骨架：base → social/explore → commerce/coop → optimize 收尾（LLM 只做填充与取舍）。
 */
'use strict';

const PRIMITIVES = [
  { key: 'base',     title: '基础盘',   dependsOn: [],                 desc: '地标/广场/路网/区域划分，一切的前提' },
  { key: 'social',   title: '社交',     dependsOn: ['base'],           desc: '聚集点/活动场/聊天触点，依赖基础盘' },
  { key: 'explore',  title: '探索',     dependsOn: ['base'],           desc: '隐藏点/任务/宝藏/引导，依赖基础盘' },
  { key: 'commerce', title: '商业',     dependsOn: ['base', 'social'], desc: '商店/奖励/交易，依赖人流（社交）' },
  { key: 'coop',     title: '协作',     dependsOn: ['base', 'social'], desc: '多人协作玩法/共创活动，依赖社交' },
  { key: 'optimize', title: '优化',     dependsOn: ['base'],           desc: '行为分析/冷区激活/内容调优，收尾与迭代' },
];

const KEYS = PRIMITIVES.map((p) => p.key);

/** 依赖是否满足：purpose 的全部 dependsOn 必须出现在更早（no 更小）的 phase 里 */
function depsSatisfied(phases) {
  const seen = [];
  for (const ph of phases) {
    const p = PRIMITIVES.find((x) => x.key === ph.purpose);
    if (!p) return { ok: false, error: '未知目的原语: ' + ph.purpose + '（只允许 ' + KEYS.join('/') + '）' };
    for (const d of p.dependsOn) {
      if (seen.indexOf(d) < 0) {
        return { ok: false, error: '阶段「' + ph.title + '」目的 ' + ph.purpose + ' 依赖 ' + d + '，必须安排在更早阶段' };
      }
    }
    seen.push(ph.purpose);
  }
  return { ok: true };
}

module.exports = { PRIMITIVES, KEYS, depsSatisfied };
