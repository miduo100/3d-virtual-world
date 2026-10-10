/**
 * gen3dTripoProvider —— gen3d 第 4 路径的 Tripo 真实适配器（AI World Brain · Phase 9 · §F.2 路径 4）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * providers 契约（与 gen3dService 一致）：
 *   submit(o)  → { ok, taskId, meta }                       真实提交（烧钱，调用方负责预算/幂等/账本）
 *   poll(o)    → { ok, status:'running'|'succeeded'|'failed', model?, error? }
 *   checkWired() → { wired, reason }                        密钥存在性判定（零外部请求）
 *
 * 成功链：远程 GLB 下载落盘（public/models/uploaded/gen3d-<jobId>/）
 *   → 真文件校验器（面数 = indices/3 实解析，体积 = 文件字节）
 *   → 落 uploaded_models（part_category='model'，按 path 幂等）
 *   → 返回本地 URL 交给 gen3dService 的 AssetValidator（阈值 60k 面 / 50MB）。
 *
 * ★ 组件版 assetValidator 不动（它服务 Phase 5 预算闸）；本文件只做"真文件统计"。
 * ★ 诚实优先：欠费 / Key 无效 / 审核拒绝是外部状态 → 翻译成可读中文诊断，绝不伪装成功。
 */
'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { query } = require('../../database/db');
const configService = require('../../services/configService');
const tripoService = require('../../services/tripo');

const PUBLIC_MODELS_DIR = path.join(__dirname, '..', '..', '..', 'public', 'models', 'uploaded');
const DEFAULT_MODEL_VERSION = 'v2.0-20240919';

function bad(code, reason, extra) { return Object.assign({ ok: false, code, reason }, extra || {}); }

/** 上游错误方言 → 可执行中文诊断（余额 / Key / 审核 / 网络 / 其他） */
function diagnose(raw) {
  const s = String(raw || '').slice(0, 300);
  const low = s.toLowerCase();
  if (/insufficient|balance|余额|欠费|quota|arrears/.test(low)) {
    return { code: 'INSUFFICIENT_BALANCE', reason: 'Tripo 账户余额不足，请充值后重试（原始信息：' + s + '）' };
  }
  if (/invalid.*key|unauthorized|401|authentication|api key|密钥/.test(low)) {
    return { code: 'KEY_INVALID', reason: 'Tripo API Key 无效或未生效，请到后台系统配置检查 TRIPO_API_KEY（原始信息：' + s + '）' };
  }
  if (/403|forbidden|permission|无权限/.test(low)) {
    return { code: 'NO_PERMISSION', reason: 'Tripo 拒绝访问（Key 无该接口权限或被封禁）（原始信息：' + s + '）' };
  }
  if (/review|censor|nsfw|审核|敏感|compliance/.test(low)) {
    return { code: 'CONTENT_REJECTED', reason: 'Tripo 内容审核拒绝该提示词，请调整 prompt 后重试（原始信息：' + s + '）' };
  }
  if (/timeout|etimedout|超时/.test(low)) {
    return { code: 'PROVIDER_TIMEOUT', reason: 'Tripo 请求超时，可稍后重试（原始信息：' + s + '）' };
  }
  if (/rate|429|限流|too many/.test(low)) {
    return { code: 'PROVIDER_RATE_LIMITED', reason: 'Tripo 限流，请降低提交频率（原始信息：' + s + '）' };
  }
  return { code: 'PROVIDER_ERROR', reason: 'Tripo 返回错误（原始信息：' + s + '）' };
}

// ── 真文件校验器（GLB 实解析；独立导出供验收用）──────────────────────────
/**
 * 解析 GLB 二进制 → 统计真实面数（Σ primitive.indices.count/3，无索引退化 POSITION.count/3）。
 * 参考 modelLod.countTrisExact 口径（★ pr.indices 复数，不是 pr.index 的历史坑）。
 * @returns {{ ok:boolean, triangles:number, meshes:number, reason?:string }}
 */
function parseGlbStats(buf) {
  try {
    if (!buf || buf.length < 20) return { ok: false, triangles: 0, meshes: 0, reason: 'GLB 文件过小或为空' };
    const magic = buf.readUInt32LE(0);
    if (magic !== 0x46546c67) return { ok: false, triangles: 0, meshes: 0, reason: '不是 GLB（magic 不符，可能是 .gltf 文本，暂不支持）' };
    const jsonLen = buf.readUInt32LE(12);
    const jsonType = buf.readUInt32LE(16);
    if (jsonType !== 0x4e4f534a) return { ok: false, triangles: 0, meshes: 0, reason: 'GLB 首 chunk 不是 JSON' };
    const gltf = JSON.parse(buf.slice(20, 20 + jsonLen).toString('utf8'));
    const acc = Array.isArray(gltf.accessors) ? gltf.accessors : [];
    let tris = 0, meshes = 0;
    const meshesArr = Array.isArray(gltf.meshes) ? gltf.meshes : [];
    for (const mesh of meshesArr) {
      meshes += 1;
      const prims = Array.isArray(mesh.primitives) ? mesh.primitives : [];
      for (const pr of prims) {
        if (pr.indices !== undefined && acc[pr.indices]) {
          tris += Math.floor((acc[pr.indices].count || 0) / 3);
        } else if (pr.attributes && pr.attributes.POSITION !== undefined && acc[pr.attributes.POSITION]) {
          tris += Math.floor((acc[pr.attributes.POSITION].count || 0) / 3);
        }
      }
    }
    return { ok: true, triangles: tris, meshes };
  } catch (e) {
    return { ok: false, triangles: 0, meshes: 0, reason: 'GLB 解析失败：' + String(e.message || e).slice(0, 200) };
  }
}

/** 真文件校验：结构可解析 + 面数/体积统计（阈值判定交回 gen3dService.validateModel） */
async function validateRealFile(filePath) {
  let buf;
  try {
    buf = await fsp.readFile(filePath);
  } catch (e) {
    return { ok: false, stats: null, reason: '产物文件不可读：' + String(e.message || e).slice(0, 200) };
  }
  const s = parseGlbStats(buf);
  if (!s.ok) return { ok: false, stats: null, reason: s.reason };
  return { ok: true, stats: { triangles: s.triangles, fileSizeBytes: buf.length, meshes: s.meshes, format: 'glb' } };
}

// ── Provider 实现 ────────────────────────────────────────────────────────
const tripoProvider = {
  name: 'tripo',

  /** wired 判定：密钥存在即可（不做外部请求；余额/有效性由真实调用时翻译） */
  async checkWired() {
    try {
      const key = await configService.getConfig('TRIPO_API_KEY');
      if (!key) {
        return { wired: false, reason: 'Tripo 未配置密钥：请在后台系统配置新增 TRIPO_API_KEY（configService 键名）' };
      }
      return { wired: true, reason: '' };
    } catch (e) {
      return { wired: false, reason: '读取 TRIPO_API_KEY 失败：' + String(e.message || e).slice(0, 160) };
    }
  },

  /** 真实提交（烧钱一次）；错误翻译成可读中文 */
  async submit(o) {
    const p = o || {};
    const prompt = String(p.prompt || '').trim();
    if (!prompt) return bad('GEN3D_PROMPT_REQUIRED', '缺少 prompt');
    const opts = {
      mode: (p.params && p.params.mode) || 'preview',
      modelVersion: (p.params && p.params.modelVersion) || DEFAULT_MODEL_VERSION,
    };
    try {
      const r = await tripoService.textToModel(prompt, opts);
      if (r && r.success && r.taskId) {
        return { ok: true, taskId: r.taskId, meta: { modelVersion: opts.modelVersion, mode: opts.mode } };
      }
      const d = diagnose(r && r.error);
      return bad(d.code, d.reason);
    } catch (e) {
      const d = diagnose(e.message);
      return bad(d.code, d.reason);
    }
  },

  /**
   * 真实轮询 + 成功后下载/校验/落库。
   * @param {object} o { taskId, job:{id} }  job.id 用于落盘目录与 uploaded_models.path
   */
  async poll(o) {
    const p = o || {};
    const taskId = String(p.taskId || '');
    const jobId = p.job && p.job.id ? String(p.job.id) : null;
    if (!taskId) return bad('PROVIDER_POLL_FAILED', '缺少 Tripo taskId');

    let r;
    try {
      r = await tripoService.queryTaskStatus(taskId);
    } catch (e) {
      const d = diagnose(e.message);
      return bad(d.code, d.reason);   // 瞬态错误：job 保持 running，下次轮询重试
    }
    if (!r || !r.success) {
      const d = diagnose(r && r.error);
      return bad(d.code, d.reason);
    }
    if (r.status === 'processing' || r.status === 'queued') {
      return { ok: true, status: 'running', progress: Number(r.progress) || 0 };
    }
    if (r.status !== 'completed') {
      // failed / cancelled → 终态，错误必须可读（诚实优先）
      const d = diagnose(r.error || ('Tripo 任务状态：' + (r.originalStatus || r.status)));
      return { ok: true, status: 'failed', error: d.reason, errorCode: d.code };
    }

    // ★ succeeded → 下载 → 真文件校验 → 落 uploaded_models；任何一步失败 = failed（绝不半成功）
    if (!jobId) return bad('PROVIDER_POLL_FAILED', '缺少 jobId（无法确定产物落盘目录）');
    const remoteUrl = String(r.modelUrl || '');
    if (!remoteUrl) {
      return { ok: true, status: 'failed', error: 'Tripo 任务完成但未返回模型下载地址（output.model 为空）', errorCode: 'NO_MODEL_URL' };
    }
    const dir = path.join(PUBLIC_MODELS_DIR, 'gen3d-' + jobId);
    const savePath = path.join(dir, 'model.glb');
    try { await fsp.mkdir(dir, { recursive: true }); } catch (e) { /* 已存在 */ }
    const dl = await tripoService.downloadModel(remoteUrl, savePath);
    if (!dl || dl.success !== true) {
      return { ok: true, status: 'failed', error: '产物下载失败：' + String((dl && dl.error) || '未知错误').slice(0, 240), errorCode: 'DOWNLOAD_FAILED' };
    }
    const v = await validateRealFile(savePath);
    if (!v.ok) {
      return { ok: true, status: 'failed', error: '产物文件校验失败：' + v.reason, errorCode: 'INVALID_MODEL_FILE' };
    }

    const url = '/models/uploaded/gen3d-' + jobId + '/model.glb';
    try {
      const exist = await query(`SELECT id FROM uploaded_models WHERE path = $1 LIMIT 1`, [url]);
      if (!exist.rows.length) {
        await query(
          `INSERT INTO uploaded_models
             (file_name, saved_file_name, path, file_type, file_size, display_name, part_category, created_at)
           VALUES ($1, 'model.glb', $2, 'glb', $3, $4, 'model', NOW())`,
          ['gen3d-' + jobId + '.glb', url, v.stats.fileSizeBytes,
            String((p.prompt || 'AI 生成模型')).slice(0, 60)]);
      }
    } catch (e) {
      return { ok: true, status: 'failed', error: '产物落库失败（uploaded_models）：' + String(e.message || e).slice(0, 240), errorCode: 'DB_INSERT_FAILED' };
    }
    return {
      ok: true, status: 'succeeded',
      model: { url, triangles: v.stats.triangles, fileSizeBytes: v.stats.fileSizeBytes, format: 'glb' },
      providerMeta: { remoteUrl, progress: 100 },
    };
  },
};

module.exports = tripoProvider;
module.exports.parseGlbStats = parseGlbStats;
module.exports.validateRealFile = validateRealFile;
module.exports.diagnose = diagnose;
module.exports.PUBLIC_MODELS_DIR = PUBLIC_MODELS_DIR;
module.exports.DEFAULT_MODEL_VERSION = DEFAULT_MODEL_VERSION;
