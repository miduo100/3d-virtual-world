/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
/**
 * sfxGenerateRoute.js —— AI 音效生成 + 入库
 *
 * 挂载：server.js  app.use('/api/sound-scenes/sfx', require('./routes/sfxGenerateRoute'))
 * 鉴权：全部管理员 token（音效库是后台功能）
 *
 * 为什么「生成」和「入库」分成两步：
 *   sounds 目录是全局共享素材池，文件名即引用键（soundAssetsRoute 靠这个建引用明细）。
 *   如果生成就直接入库，一轮出 4 个变体，目录里就多 4 个文件，其中 3 个可能是废的，
 *   还会全被资产清单列出来、算进「未被引用」里 —— 越用越脏。
 *   所以：生成 → 临时目录（.tmp/，不在扫描白名单里）→ 用户试听挑选 → 显式「入库」→ 写正式目录。
 *
 * 入库同时做压缩：上游给的是 WAV（3 秒约 280KB），压成 MP3 单声道 32kbps（3 秒约 12KB）。
 */
'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { query } = require('../database/db');
const { authenticateAdminToken } = require('../middleware/adminAuth');
const sfxClient = require('../services/sfxClient');
const audioCompress = require('../services/audioCompress');

const router = express.Router();

const SOUNDS_DIR = path.join(__dirname, '../../public/uploads/character-templates/sounds');
const TMP_DIR = path.join(SOUNDS_DIR, '.tmp');
// 素材名允许的字符：中文、字母、数字、下划线、连字符（文件名即引用键，不能带路径分隔符）
const SAFE_NAME = /[一-龥a-zA-Z0-9_-]/g;

function ensureDir(dir) {
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { /* 目录已存在 */ }
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** 素材名清洗：去掉路径分隔符和扩展名残留 */
function safeName(input, fallback) {
  const raw = String(input || '').replace(/\.[^.]+$/, '');
  const cleaned = raw.replace(/[^一-龥a-zA-Z0-9_-]/g, '_').replace(/_{2,}/g, '_').slice(0, 60);
  return cleaned || fallback;
}

/** 统一格式的 job 行 → 前端对象 */
function jobRow(r) {
  return {
    id: r.id,
    status: r.status,
    provider: r.provider,
    model: r.model,
    prompt: r.prompt,
    durationSec: r.duration_sec == null ? null : Number(r.duration_sec),
    sampleRate: r.sample_rate,
    format: r.format,
    previewUrl: r.imported ? r.asset_url : r.preview_url,
    sizeBytes: r.imported ? r.asset_size : r.size_bytes,
    actualDuration: r.actual_duration == null ? null : Number(r.actual_duration),
    imported: r.imported,
    assetUrl: r.asset_url,
    assetName: r.asset_name,
    compressRatio: r.compress_ratio == null ? null : Number(r.compress_ratio),
    error: r.error,
    errorHint: r.error_hint,
    latencyMs: r.latency_ms,
    createdAt: r.created_at,
  };
}

// ─── 接入诊断：一次跑完所有可能性，直接给出「下一步做什么」──
router.use('/', require('./sfxDiagnoseRoute'));

// ─── 生成任务 ────────────────────────────────────────────────────

/**
 * POST /api/sound-scenes/sfx/generate
 * body: { prompt, durationSec?, sampleRate?, format?, count? }
 *
 * 注意：上游是同步接口（一次生成要等几秒到几十秒），这里同步等结果。
 * Seed-Audio 单次最长 120 秒，生成耗时可能不短，所以超时给到 120s。
 */
router.post('/generate', authenticateAdminToken, async (req, res) => {
  const body = req.body || {};
  const prompt = String(body.prompt || '').trim();
  if (!prompt) {
    return res.status(400).json({ success: false, error: '提示词不能为空' });
  }
  if (prompt.length > 3000) {
    return res.status(400).json({ success: false, error: '提示词过长（上限 3000 字符）' });
  }

  const durationSec = Math.max(0, Math.min(120, Number(body.durationSec) || 0)) || null;
  const sampleRate = [8000, 16000, 24000, 32000, 40000, 44100, 48000].includes(Number(body.sampleRate))
    ? Number(body.sampleRate) : 44100;
  const format = ['mp3', 'wav', 'pcm', 'ogg_opus'].includes(body.format) ? body.format : 'mp3';
  // 一次最多出 4 个变体（上游每次调用都是一次生成，4 次 = 4 份费用）
  const count = Math.max(1, Math.min(4, Number(body.count) || 1));

  ensureDir(TMP_DIR);

  const results = [];
  for (let i = 0; i < count; i++) {
    const started = Date.now();
    const jobId = crypto.randomUUID();
    let row = {
      id: jobId,
      status: 'running',
      provider: 'doubao_seed_audio',
      prompt,
      durationSec,
      sampleRate,
      format,
    };
    try {
      const r = await sfxClient.generate({
        prompt,
        durationSec,
        sampleRate,
        format,
        caller: 'soundLibrary',
        timeoutMs: 120000,
      });

      // 上游返回的可能是 mp3/wav/pcm —— pcm 是裸数据没头，转码要特殊处理
      const ext = format === 'pcm' ? 'pcm' : format;
      const tmpPath = path.join(TMP_DIR, jobId + '.' + ext);
      fs.writeFileSync(tmpPath, r.buffer);

      row = {
        status: 'succeeded',
        provider: r.providerName,
        model: r.model,
        previewPath: tmpPath,
        previewUrl: '/api/sound-scenes/sfx/preview/' + jobId,
        sizeBytes: r.buffer.length,
        actualDuration: r.durationSec,
        attempts: r.attempts,
        latencyMs: Date.now() - started,
      };
      results.push({ ok: true, job: row, buffer: r.buffer, format: r.format, sampleRate: r.sampleRate });
    } catch (e) {
      const diag = e && e.diagnosis ? e.diagnosis : '';
      const hint = e && e.hint ? e.hint : '';
      row = {
        status: 'failed',
        error: (diag ? diag + '：' : '') + (e && e.message ? e.message : '未知错误'),
        errorHint: hint,
        attempts: 1,
        latencyMs: Date.now() - started,
      };
      results.push({ ok: false, job: row, error: row.error, hint });
    }
  }

  // 落表（生成成功的都记一条）
  const saved = [];
  for (const item of results) {
    if (!item.ok) continue;
    const j = item.job;
    try {
      await query(
        `INSERT INTO world_sfx_jobs
           (id, status, provider, model, prompt, duration_sec, sample_rate, format,
            preview_path, preview_url, size_bytes, actual_duration, imported, params,
            attempts, latency_ms, created_by, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,false,$13,$14,$15,$16,NOW(),NOW())
         ON CONFLICT (id) DO NOTHING`,
        [j.id, j.status, j.provider || 'doubao_seed_audio', j.model || null, prompt, durationSec,
         sampleRate, format, j.previewPath || null, j.previewUrl || null,
         j.sizeBytes || null, j.actualDuration || null,
         JSON.stringify({ sampleRate, format, count }), j.attempts || 1, j.latencyMs || null,
         req.adminUser && req.adminUser.username || null]
      );
      saved.push(jobRow({ ...j, imported: false, created_at: new Date().toISOString() }));
    } catch (e) {
      console.error('[sfxGenerateRoute] 任务落表失败:', e.message);
      saved.push({ ...j, imported: false });
    }
  }

  const failed = results.filter(r => !r.ok);
  res.json({
    success: failed.length === 0,
    jobs: saved,
    failed: failed.map(f => ({ error: f.error, hint: f.hint })),
    // 部分成功也要给成功的结果
    ...(failed.length && !saved.length ? { error: failed[0].error, hint: failed[0].hint } : {}),
  });
});

/**
 * POST /api/sound-scenes/sfx/import
 * body: { jobId, name?, hint? }
 *
 * 入库：把临时产物压缩后写进 sounds 目录，正式成为可引用资产。
 */
router.post('/import', authenticateAdminToken, async (req, res) => {
  const body = req.body || {};
  const jobId = String(body.jobId || '').trim();
  if (!jobId) return res.status(400).json({ success: false, error: '缺少 jobId' });

  const jb = await query('SELECT * FROM world_sfx_jobs WHERE id=$1', [jobId]);
  if (!jb.rows.length) return res.status(404).json({ success: false, error: '任务不存在' });
  const job = jb.rows[0];
  if (job.imported) {
    return res.json({ success: true, alreadyImported: true, url: job.asset_url, name: job.asset_name, size: job.asset_size });
  }
  if (job.status !== 'succeeded' || !job.preview_path) {
    return res.status(400).json({ success: false, error: '该任务没有可入库的产物' });
  }

  ensureDir(SOUNDS_DIR);

  const base = safeName(body.name || job.prompt || 'ai-sfx', 'ai-sfx');
  const stamp = Date.now();
  const filename = 'sfx-' + stamp + '-' + base + '.wav';
  const targetPath = path.join(SOUNDS_DIR, filename);

  let raw;
  try {
    raw = fs.readFileSync(job.preview_path);
  } catch (e) {
    return res.status(404).json({ success: false, error: '临时文件已丢失，请重新生成' });
  }

  // 压缩：上游给的多半是 mp3/wav。WAV 能压；已经是 mp3 的就别压了（再压是 generational loss）
  let finalBuf = raw;
  let finalName = filename;
  let finalPath = targetPath;
  let compressRatio = null;

  if (/\.wav$/i.test(job.preview_path)) {
    const rate = audioCompress.suggestSampleRate(base, body.hint || job.prompt);
    const r = await audioCompress.compressAudio(raw, { sampleRate: rate });
    if (r.ok) {
      finalBuf = r.buffer;
      finalName = filename.replace(/\.wav$/, '.mp3');
      finalPath = path.join(SOUNDS_DIR, finalName);
      compressRatio = Number(r.ratio.toFixed(2));
    }
  }

  try {
    fs.writeFileSync(finalPath, finalBuf);
  } catch (e) {
    return res.status(500).json({ success: false, error: '写入素材目录失败：' + e.message });
  }

  const relUrl = '/uploads/character-templates/sounds/' + finalName;
  const size = finalBuf.length;

  // 更新任务为已入库
  await query(
    `UPDATE world_sfx_jobs
        SET imported=true, asset_url=$2, asset_name=$3, asset_size=$4,
            compress_ratio=$5, updated_at=NOW()
      WHERE id=$1`,
    [jobId, relUrl, finalName, size, compressRatio]
  );

  // 删临时文件
  try { fs.unlinkSync(job.preview_path); } catch (e) { /* 已删或不存在，忽略 */ }

  res.json({
    success: true,
    url: relUrl,
    name: finalName,
    size,
    compressRatio,
    // 原始体积 / 压缩后体积，给前端展示「省了多少」
    sizeBefore: job.size_bytes,
  });
});

/**
 * GET /api/sound-scenes/sfx/preview/:id
 * 试听未入库的生成结果。
 */
router.get('/preview/:id', authenticateAdminToken, async (req, res) => {
  const id = String(req.params.id || '');
  const jb = await query('SELECT * FROM world_sfx_jobs WHERE id=$1', [id]);
  if (!jb.rows.length) return res.status(404).json({ success: false, error: '任务不存在' });
  const job = jb.rows[0];
  const p = job.imported && job.asset_url ? null : job.preview_path;
  if (!p) return res.json({ success: true, url: job.asset_url, imported: true });
  if (!fs.existsSync(p)) return res.status(404).json({ success: false, error: '临时文件已过期，请重新生成' });

  const ext = path.extname(p).slice(1).toLowerCase();
  const mime = ext === 'mp3' ? 'audio/mpeg' : ext === 'wav' ? 'audio/wav' : ext === 'ogg' ? 'audio/ogg' : 'application/octet-stream';
  res.setHeader('Content-Type', mime);
  res.setHeader('Cache-Control', 'private, max-age=300');
  fs.createReadStream(p).pipe(res);
});

/**
 * GET /api/sound-scenes/sfx/jobs
 * 最近生成的任务列表。
 */
router.get('/jobs', authenticateAdminToken, async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 30));
    const r = await query(
      `SELECT * FROM world_sfx_jobs ORDER BY created_at DESC LIMIT $1`,
      [limit]
    );
    res.json({ success: true, jobs: r.rows.map(jobRow) });
  } catch (e) {
    console.error('[sfxGenerateRoute] 任务列表失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * DELETE /api/sound-scenes/sfx/jobs/:id
 * 丢弃一次生成结果（删临时文件 + 记为 cancelled）。
 */
router.delete('/jobs/:id', authenticateAdminToken, async (req, res) => {
  const id = String(req.params.id || '');
  const jb = await query('SELECT * FROM world_sfx_jobs WHERE id=$1', [id]);
  if (!jb.rows.length) return res.status(404).json({ success: false, error: '任务不存在' });
  const job = jb.rows[0];
  if (!job.imported && job.preview_path) {
    try { fs.unlinkSync(job.preview_path); } catch (e) { /* 忽略 */ }
  }
  await query(`UPDATE world_sfx_jobs SET status='cancelled', updated_at=NOW() WHERE id=$1`, [id]);
  res.json({ success: true });
});

module.exports = router;
