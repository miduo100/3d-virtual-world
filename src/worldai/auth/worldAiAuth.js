/**
 * World AI Credential（world_ai_credentials）
 * Phase 2a · 队列项 1 —— 设计来源：AI-World-Brain-架构审查与改造方案.md §C.3 ⑰ / §G.2
 *
 * 语义（§B.2）：与 Agent Key 严格分离 —— 绑定 world + 独立 world:* scope，
 * 可单独 rotate/pause/revoke，且**不能**升级成玩家或管理员身份。
 * 明文 Key 只在创建/轮换响应里出现一次；库里只有 bcrypt hash + 前缀。
 * 内部 JWT 用 ADMIN_JWT_SECRET 签发，payload.type='world_ai'（adminAuth 只认 type='admin'，无越权面）。
 */
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query } = require('../../database/db');
const { getWorldId, filterScopes } = require('../config');

const { ADMIN_JWT_SECRET } = require('../../middleware/adminAuth');
const TOKEN_TTL_SECONDS = 30 * 60; // 内部 JWT 30 分钟；runtime（2b）到期前自行换发

const KEY_PREFIX_LEN = 16; // key_prefix 列长度口径，如 'waik_a1b2c3d4e5f6'

function generateKey() {
  const secret = crypto.randomBytes(24).toString('base64url');
  const key = 'waik_' + secret;
  return { key, prefix: key.slice(0, KEY_PREFIX_LEN) };
}

/** 创建凭证：返回 { credential, key(明文仅此一次), rejected } */
async function createCredential({ worldId, name, scopes, createdBy }) {
  const wid = worldId || await getWorldId();
  if (!name || typeof name !== 'string' || name.length > 120) {
    const err = new Error('name 必填且 ≤120 字符');
    err.statusCode = 400;
    throw err;
  }
  const { kept, rejected } = filterScopes(scopes);
  const { key, prefix } = generateKey();
  const hash = await bcrypt.hash(key, 10);
  const r = await query(
    `INSERT INTO world_ai_credentials (world_id, name, key_hash, key_prefix, scopes, created_by)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [wid, name.trim(), hash, prefix, kept, createdBy || 'admin']
  );
  return { credential: r.rows[0], key, rejected };
}

/** 轮换：旧 Key 立即失效（hash 被替换）；返回新明文 Key 仅此一次 */
async function rotateCredential(id, worldId) {
  const wid = worldId || await getWorldId();
  const cur = await query(
    `SELECT * FROM world_ai_credentials WHERE id = $1 AND world_id = $2 AND status <> 'revoked'`,
    [id, wid]
  );
  if (!cur.rows.length) {
    const err = new Error('凭证不存在或已吊销');
    err.statusCode = 404;
    throw err;
  }
  const { key, prefix } = generateKey();
  const hash = await bcrypt.hash(key, 10);
  const r = await query(
    `UPDATE world_ai_credentials SET key_hash = $1, key_prefix = $2 WHERE id = $3 RETURNING *`,
    [hash, prefix, id]
  );
  return { credential: r.rows[0], key };
}

async function setStatus(id, status, worldId) {
  const wid = worldId || await getWorldId();
  const r = await query(
    `UPDATE world_ai_credentials SET status = $1::varchar,
       revoked_at = CASE WHEN $1::varchar = 'revoked' THEN now() ELSE revoked_at END
     WHERE id = $2 AND world_id = $3 RETURNING *`,
    [status, id, wid]
  );
  if (!r.rows.length) {
    const err = new Error('凭证不存在');
    err.statusCode = 404;
    throw err;
  }
  return r.rows[0];
}

async function listCredentials(worldId) {
  const wid = worldId || await getWorldId();
  const r = await query(
    `SELECT id, name, key_prefix, scopes, status, expires_at, last_used_at, usage_count, revoked_at, created_at, created_by
     FROM world_ai_credentials WHERE world_id = $1 ORDER BY created_at DESC`,
    [wid]
  );
  return r.rows;
}

/**
 * 用明文 Key 换内部 JWT（2a 的"使用"路径；2b 起 runtime 也走这里拿 token）。
 * - 未命中 / hash 不匹配 → 401（rotate 后旧 Key 即此路径失效）
 * - paused / revoked / 过期 → 403
 */
async function exchangeKeyForToken(plaintextKey) {
  if (!plaintextKey || typeof plaintextKey !== 'string' || !plaintextKey.startsWith('waik_')) {
    const err = new Error('缺少有效的 World AI 凭证 Key');
    err.statusCode = 401;
    throw err;
  }
  const prefix = plaintextKey.slice(0, KEY_PREFIX_LEN);
  const r = await query(
    `SELECT * FROM world_ai_credentials WHERE key_prefix = $1 AND status <> 'revoked'`,
    [prefix]
  );
  let matched = null;
  for (const row of r.rows) {
    if (await bcrypt.compare(plaintextKey, row.key_hash)) { matched = row; break; }
  }
  if (!matched) {
    const err = new Error('World AI 凭证无效或已轮换');
    err.statusCode = 401;
    throw err;
  }
  if (matched.status !== 'active') {
    const err = new Error('World AI 凭证已暂停或吊销');
    err.statusCode = 403;
    throw err;
  }
  if (matched.expires_at && new Date(matched.expires_at).getTime() < Date.now()) {
    const err = new Error('World AI 凭证已过期');
    err.statusCode = 403;
    throw err;
  }
  const token = jwt.sign(
    {
      type: 'world_ai',
      wid: matched.world_id,
      cid: matched.id,
      scopes: matched.scopes || [],
    },
    ADMIN_JWT_SECRET,
    { expiresIn: TOKEN_TTL_SECONDS }
  );
  // 记账：last_used / usage_count（失败不阻断换发）
  try {
    await query(
      `UPDATE world_ai_credentials SET last_used_at = now(), usage_count = usage_count + 1 WHERE id = $1`,
      [matched.id]
    );
  } catch (e) { /* ignore */ }
  return {
    token,
    tokenType: 'Bearer',
    expiresIn: TOKEN_TTL_SECONDS,
    worldId: matched.world_id,
    credentialId: matched.id,
    scopes: matched.scopes || [],
  };
}

/** 校验内部 JWT（runtime/工具层用；HTTP 侧 2a 仅 exchange 出票） */
function verifyWorldAiToken(token) {
  const decoded = jwt.verify(token, ADMIN_JWT_SECRET); // 失败抛 jwt 异常
  if (!decoded || decoded.type !== 'world_ai') {
    const err = new Error('非 World AI token');
    err.statusCode = 403;
    throw err;
  }
  return decoded;
}

module.exports = {
  createCredential,
  rotateCredential,
  setStatus,
  listCredentials,
  exchangeKeyForToken,
  verifyWorldAiToken,
  TOKEN_TTL_SECONDS,
  KEY_PREFIX_LEN,
};
