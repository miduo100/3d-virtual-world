/**
 * gen3dTools —— gen3d 第 4 条路径的工具面（AI World Brain · Phase 8 · §F.2 路径 4）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * ★ 刻意**不注册**进 verbRegistry：gen3d 未启用（默认）时没有任何可执行的世界动作，
 *   注册一个"永远 unsupported"的动词只会污染 LLM 的 function calling 清单，
 *   也会让 Phase 7 的 P6-15a（注册表规模 44）失去意义。接真服务后再评估注册。
 *
 * 本模块只提供：
 *   ① planGen3d   —— 规划（未启用 → unsupported + suggest，绝不静默降级）
 *   ② submit/poll —— 落表任务编排（委托 builder/gen3dService）
 *   ③ place       —— 放置（唯一写库路径 = executor，且必须先过 AssetValidator）
 */
'use strict';

const strategy = require('../strategy/gen3d');
const service = require('../builder/gen3dService');

function bad(code, reason, extra) { return Object.assign({ ok: false, code, reason }, extra || {}); }

/** ① 规划：spec.assembly='gen3d' 的门面（assetSelector 的 L3 分支也走它） */
async function planGen3d(spec) {
  const g = await strategy.plan(spec);
  if (g.strategy === 'gen3d') return { ok: true, strategy: 'gen3d', provider: g.provider, prompt: g.prompt, reason: g.reason };
  return { ok: false, strategy: 'unsupported', code: g.code, suggest: g.suggest, reason: g.reason };
}

/** ② 提交生成任务（落表；未启用 → GEN3D_DISABLED，零外部请求） */
async function submit(o) {
  const p = o || {};
  const plan = await planGen3d(Object.assign({}, p.spec || {}, { gen3d: { prompt: p.prompt } }));
  if (!plan.ok) return bad(plan.code, plan.reason, { suggest: plan.suggest, strategy: 'unsupported' });
  return await service.submitJob({
    worldId: p.worldId, prompt: p.prompt, spec: p.spec, params: p.params,
    provider: p.provider || plan.provider, createdBy: p.createdBy, idempotencyKey: p.idempotencyKey,
  });
}

/** ②b 轮询（落表口径，进程重启后仍可查到同一行） */
async function poll(jobId) { return await service.pollJob(jobId); }

/** ②c 任务列表 / 单条查询 */
async function list(o) { return { ok: true, jobs: await service.listJobs(o) }; }
async function get(jobId) {
  const job = await service.getJob(jobId);
  if (!job) return bad('JOB_NOT_FOUND', '生成任务不存在：' + jobId);
  return { ok: true, job };
}

/** ③ 放置：唯一写库路径 = executor，且必须先过 AssetValidator（service.place 内双重校验） */
async function place(o, ctx) { return await service.place(o, ctx); }

/** 供调用方判定"该路径是否可用"（不做任何外部请求；Phase 9 wired 判定改真） */
async function availability() {
  const c = await strategy.config();
  if (!c.enabled) {
    return {
      enabled: false, provider: c.provider, wired: false,
      suggest: strategy.SUGGEST.slice(),
      note: 'gen3d 未启用 → 返回 unsupported，请改用 composite / procedural',
    };
  }
  const p = service.providers[String(c.provider).toLowerCase()];
  if (!p) {
    return { enabled: true, provider: c.provider, wired: false, suggest: strategy.SUGGEST.slice(),
      note: '厂商「' + c.provider + '」未接线（providers 表无此适配器）' };
  }
  if (p.checkWired) {
    const w = await p.checkWired();
    return { enabled: true, provider: c.provider, wired: !!w.wired, suggest: w.wired ? [] : strategy.SUGGEST.slice(), note: w.reason || '' };
  }
  return { enabled: true, provider: c.provider, wired: true, suggest: [], note: '' };
}

module.exports = { planGen3d, submit, poll, list, get, place, availability, validateModel: service.validateModel };
