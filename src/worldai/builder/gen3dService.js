/**
 * gen3dService —— 3D 资产生成编排（AI World Brain · Phase 8 · §F.2 路径 4）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * ★ 铁律 1：任务状态**必须落表**（world_gen3d_jobs），绝不用内存 Map
 *          —— aiSceneGenerator:2310 的教训：内存态重启即失，轮询不到（P7-8）。
 * ★ 铁律 2：未启用 → `GEN3D_DISABLED` + suggest，**绝不静默降级**为程序化。
 * ★ 铁律 3：产物入世界前**必须过 assetValidator**（面数/体积阈值），超阈值 → failed 且不放置；
 *          放置只走 `executor`（守卫/预算/账本/审批一个不落），本模块不写 world_objects。
 *
 * 本阶段（用户决策①）**不接真实服务**：tripo / hunyuan3d 适配器返回 PROVIDER_NOT_WIRED，
 * 接真服务时只改本文件的 providers 表（契约：submit/poll 两个函数）。
 * 验收与联调用内置 `stub` provider（需 env WORLD_AI_GEN3D_STUB=1 显式开启）。
 */
'use strict';

const { query } = require('../../database/db');
const strategy = require('../strategy/gen3d');
const assetValidator = require('./assetValidator');

/** 产物入世界前的体积硬阈值（面数沿用 §G.5④ 的 60k） */
const MAX_MODEL_BYTES = 50 * 1024 * 1024;
const MAX_MODEL_TRIS = assetValidator.HARD_LIMITS.maxTriangles;

const STATUSES = ['queued', 'running', 'succeeded', 'failed', 'cancelled'];

// ── Provider 适配器（submit / poll 两个函数即全部契约）──────────────────
const providers = {
  /**
   * 桩 provider：确定性返回，供验收与联调使用（零外部请求、零花费）。
   * 必须显式 env WORLD_AI_GEN3D_STUB=1 才可用，避免生产误用。
   */
  stub: {
    name: 'stub',
    submit(o) {
      const p = o || {};
      return { ok: true, taskId: 'stub-' + Date.now() + '-' + Math.random().toString(16).slice(2, 8), meta: { stub: true, prompt: String(p.prompt || '').slice(0, 40) } };
    },
    poll(o) {
      const p = o || {};
      const m = p.meta || {};
      return {
        ok: true, status: 'succeeded',
        model: {
          url: String(m.modelUrl || '/models/uploaded/gen3d-stub.glb'),
          triangles: Number.isFinite(Number(m.triangles)) ? Number(m.triangles) : 1200,
          fileSizeBytes: Number.isFinite(Number(m.fileSizeBytes)) ? Number(m.fileSizeBytes) : 1024 * 1024,
          format: 'glb',
        },
      };
    },
  },
  /** Tripo：Phase 8 不接真服务（用户决策①），接时只改这里 */
  tripo: {
    name: 'tripo',
    submit() { return { ok: false, code: 'PROVIDER_NOT_WIRED', reason: 'Tripo 适配器未接线（src/services/tripo.js 需在此暴露 submit/poll 契约）' }; },
    poll() { return { ok: false, code: 'PROVIDER_NOT_WIRED', reason: 'Tripo 适配器未接线' }; },
  },
  /** 混元 3D：同上 */
  hunyuan3d: {
    name: 'hunyuan3d',
    submit() { return { ok: false, code: 'PROVIDER_NOT_WIRED', reason: '混元3D 适配器未接线' }; },
    poll() { return { ok: false, code: 'PROVIDER_NOT_WIRED', reason: '混元3D 适配器未接线' }; },
  },
};

function resolveProvider(name) {
  const key = String(name || '').toLowerCase();
  const p = providers[key];
  if (!p) return null;
  if (key === 'stub' && process.env.WORLD_AI_GEN3D_STUB !== '1') return null;
  return p;
}

function bad(code, reason, extra) { return Object.assign({ ok: false, code, reason }, extra || {}); }

// ── 落表：提交任务 ────────────────────────────────────────────────────
/**
 * @param {object} o { worldId, prompt, spec, provider, params, createdBy, idempotencyKey }
 * @returns {Promise<{ok:boolean, jobId?, status?, deduped?, code?, suggest?, reason?}>}
 */
async function submitJob(o) {
  const p = o || {};
  const cfg = await strategy.config();
  if (!cfg.enabled) {
    return bad('GEN3D_DISABLED', 'gen3d 未启用（system_config.world_ai_gen3d_enabled ≠ true）；建议改用 composite 或 procedural',
      { unsupported: true, suggest: strategy.SUGGEST.slice() });
  }
  const providerName = String(p.provider || cfg.provider || 'tripo').toLowerCase();
  const provider = resolveProvider(providerName);
  if (!provider) {
    return bad('PROVIDER_NOT_WIRED', '3D 生成厂商「' + providerName + '」不可用（未接线；stub 需 env WORLD_AI_GEN3D_STUB=1）',
      { suggest: strategy.SUGGEST.slice() });
  }
  const prompt = String(p.prompt || '').trim().slice(0, 1000);
  if (!prompt) return bad('GEN3D_PROMPT_REQUIRED', '缺少 prompt');

  // 幂等：同 key 只落一条（重跑安全）
  if (p.idempotencyKey) {
    const prev = (await query(`SELECT * FROM world_gen3d_jobs WHERE idempotency_key = $1`, [String(p.idempotencyKey)])).rows[0];
    if (prev) return { ok: true, deduped: true, jobId: prev.id, status: prev.status, job: prev };
  }

  const ins = await query(
    `INSERT INTO world_gen3d_jobs (world_id, status, provider, prompt, spec, params, idempotency_key, created_by)
     VALUES ($1,'queued',$2,$3,$4::jsonb,$5::jsonb,$6,$7) RETURNING *`,
    [String(p.worldId || ''), providerName, prompt,
      JSON.stringify(p.spec || {}), JSON.stringify(p.params || {}),
      p.idempotencyKey ? String(p.idempotencyKey) : null, p.createdBy ? String(p.createdBy).slice(0, 120) : null]
  );
  const job = ins.rows[0];

  const sub = await provider.submit({ prompt, spec: p.spec || {}, params: p.params || {}, meta: (p.params && p.params.stub) || {} });
  if (!sub || sub.ok !== true) {
    await query(`UPDATE world_gen3d_jobs SET status='failed', error=$2, attempts=attempts+1, updated_at=NOW() WHERE id=$1`,
      [job.id, String((sub && sub.reason) || '提交失败').slice(0, 500)]);
    return bad((sub && sub.code) || 'PROVIDER_SUBMIT_FAILED', (sub && sub.reason) || '提交到 3D 生成服务失败', { jobId: job.id, status: 'failed' });
  }
  const up = await query(
    `UPDATE world_gen3d_jobs SET status='running', provider_task_id=$2, result=$3::jsonb, attempts=attempts+1, updated_at=NOW()
      WHERE id=$1 RETURNING *`,
    [job.id, String(sub.taskId || '').slice(0, 200), JSON.stringify({ submit: sub.meta || {} })]);
  return { ok: true, deduped: false, jobId: job.id, status: up.rows[0].status, provider: providerName, job: up.rows[0] };
}

/** 读取任务（落表口径：任何进程重启后都能查到同一行） */
async function getJob(jobId) {
  const r = await query(`SELECT * FROM world_gen3d_jobs WHERE id = $1`, [String(jobId || '')]);
  return r.rows[0] || null;
}

async function listJobs(o) {
  const p = o || {};
  const limit = Math.min(50, Math.max(1, Math.floor(Number(p.limit) || 20)));
  const r = await query(
    `SELECT * FROM world_gen3d_jobs WHERE world_id=$1 ORDER BY created_at DESC LIMIT $2`,
    [String(p.worldId || ''), limit]);
  return r.rows || [];
}

/** 产物校验：生成物入世界前的最后一道结构闸（面数 + 体积） */
function validateModel(model, opts) {
  const o = opts || {};
  const m = model || {};
  const tris = Math.floor(Number(m.triangles) || 0);
  const bytes = Math.floor(Number(m.fileSizeBytes) || 0);
  const maxTri = Math.min(MAX_MODEL_TRIS, Math.max(100, Math.floor(Number(o.maxTriangles) || MAX_MODEL_TRIS)));
  const maxBytes = Math.min(MAX_MODEL_BYTES, Math.max(1, Math.floor(Number(o.maxFileBytes) || MAX_MODEL_BYTES)));
  const errors = [];
  if (!String(m.url || '')) errors.push({ path: 'model.url', message: '产物缺少模型 URL', got: null });
  if (tris > maxTri) errors.push({ path: 'model.triangles', message: '面数 ' + tris + ' 超过预算 ' + maxTri, got: tris });
  if (bytes > maxBytes) errors.push({ path: 'model.fileSizeBytes', message: '体积 ' + bytes + ' 超过预算 ' + maxBytes, got: bytes });
  return {
    ok: errors.length === 0,
    code: errors.length ? 'ASSET_VALIDATOR_DENY' : null,
    errors, hint: errors.length ? 'AssetValidator DENY（gen3d 产物）：' + errors.map((e) => e.message).join('；') : '',
    stats: { triangles: tris, fileSizeBytes: bytes },
  };
}

/**
 * 轮询任务（落表 + 重启安全）：running 时调 provider.poll，成功后先过 AssetValidator。
 * @returns {Promise<{ok:boolean, jobId, status, model?, validation?, code?, reason?}>}
 */
async function pollJob(jobId) {
  const job = await getJob(jobId);
  if (!job) return bad('JOB_NOT_FOUND', '生成任务不存在：' + jobId);
  if (job.status === 'succeeded' || job.status === 'failed' || job.status === 'cancelled') {
    return { ok: true, jobId: job.id, status: job.status, model: (job.result || {}).model || null, result: job.result || {}, error: job.error };
  }
  const provider = resolveProvider(job.provider);
  if (!provider) {
    return bad('PROVIDER_NOT_WIRED', '厂商「' + job.provider + '」在当前进程不可用（stub 需 env WORLD_AI_GEN3D_STUB=1）',
      { jobId: job.id, status: job.status });
  }
  const pr = await provider.poll({ taskId: job.provider_task_id, prompt: job.prompt, meta: (job.params && job.params.stub) || {} });
  if (!pr || pr.ok !== true) {
    await query(`UPDATE world_gen3d_jobs SET attempts=attempts+1, updated_at=NOW(), error=$2 WHERE id=$1`,
      [job.id, String((pr && pr.reason) || '轮询失败').slice(0, 500)]);
    return bad((pr && pr.code) || 'PROVIDER_POLL_FAILED', (pr && pr.reason) || '轮询 3D 生成服务失败', { jobId: job.id, status: job.status });
  }
  if (pr.status === 'running' || pr.status === 'queued') {
    await query(`UPDATE world_gen3d_jobs SET attempts=attempts+1, updated_at=NOW() WHERE id=$1`, [job.id]);
    const cur = await getJob(job.id);
    return { ok: true, jobId: job.id, status: cur.status, attempts: cur.attempts };
  }
  if (pr.status !== 'succeeded') {
    await query(`UPDATE world_gen3d_jobs SET status='failed', error=$2, attempts=attempts+1, updated_at=NOW() WHERE id=$1`,
      [job.id, String(pr.error || '生成失败').slice(0, 500)]);
    return { ok: false, code: 'GEN3D_FAILED', reason: String(pr.error || '生成失败'), jobId: job.id, status: 'failed' };
  }
  // ★ 完成 → 必须先过 AssetValidator，超阈值不进世界
  const val = validateModel(pr.model, (job.params && job.params.budget) || {});
  if (!val.ok) {
    await query(`UPDATE world_gen3d_jobs SET status='failed', error=$2, result=$3::jsonb, attempts=attempts+1, updated_at=NOW() WHERE id=$1`,
      [job.id, val.hint, JSON.stringify({ model: pr.model || null, validation: val })]);
    return { ok: false, code: 'ASSET_VALIDATOR_DENY', reason: val.hint, jobId: job.id, status: 'failed', validation: val };
  }
  const up = await query(
    `UPDATE world_gen3d_jobs SET status='succeeded', result=$2::jsonb, error=NULL, attempts=attempts+1, updated_at=NOW() WHERE id=$1 RETURNING *`,
    [job.id, JSON.stringify({ model: pr.model, validation: val })]);
  return { ok: true, jobId: job.id, status: 'succeeded', model: pr.model, validation: val, job: up.rows[0] };
}

/**
 * 放置：只走既有 executor（唯一写库路径）。前置：job 已 succeeded 且再过一次 AssetValidator。
 * @param {object} o { jobId, x, z, regionKey, worldId, name }
 * @param {object} ctx executor ctx（{worldId, actor, missionId, regionKey, ...}）
 */
async function place(o, ctx) {
  const p = o || {};
  const job = await getJob(p.jobId);
  if (!job) return bad('JOB_NOT_FOUND', '生成任务不存在：' + p.jobId);
  if (job.status !== 'succeeded') {
    return bad('JOB_NOT_SUCCEEDED', '该生成任务尚未成功完成（status=' + job.status + '），不允许放置',
      { jobId: job.id, status: job.status });
  }
  const model = (job.result || {}).model || {};
  const val = validateModel(model, (job.params && job.params.budget) || {});
  if (!val.ok) return bad('ASSET_VALIDATOR_DENY', val.hint, { jobId: job.id, validation: val });

  const executor = require('../runtime/executor');
  const c = Object.assign({}, ctx || {}, { worldId: String((ctx && ctx.worldId) || job.world_id || '') });
  const name = String(p.name || ('AI 生成模型 ' + String(job.prompt || '').slice(0, 20))).slice(0, 120);
  const r = await executor.execute('create_object', {
    type: 'uploaded_model',
    name,
    modelPath: String(model.url || ''),
    x: Number(p.x) || 0,
    z: Number(p.z) || 0,
    regionId: p.regionKey || null,
  }, c);
  return Object.assign({ jobId: job.id, validation: val, model }, r);
}

async function cancelJob(jobId, reason) {
  const r = await query(
    `UPDATE world_gen3d_jobs SET status='cancelled', error=$2, updated_at=NOW()
      WHERE id=$1 AND status IN ('queued','running') RETURNING id`,
    [String(jobId || ''), String(reason || '主动取消').slice(0, 200)]);
  if (!r.rows.length) return bad('NOT_CANCELLABLE', '任务不存在或已终态');
  return { ok: true, jobId: r.rows[0].id, status: 'cancelled' };
}

module.exports = {
  submitJob, getJob, listJobs, pollJob, place, cancelJob, validateModel,
  providers, STATUSES, MAX_MODEL_TRIS, MAX_MODEL_BYTES,
};
