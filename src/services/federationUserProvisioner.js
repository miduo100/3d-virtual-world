/**
 * 联邦用户供给器（Federated User Provisioner）
 *
 * 背景 / 修复的问题：
 *   跨世界传送的接收端（POST /api/federation/teleport/receive）原本只用 email 查重：
 *
 *     SELECT * FROM users WHERE email = $1;      -- 找不到
 *     INSERT INTO users (id, username, email, ...) -- 直接插入
 *
 *   但 users 表同时有两条唯一约束：
 *     username VARCHAR(50) UNIQUE NOT NULL
 *     email    VARCHAR(100) UNIQUE NOT NULL
 *
 *   当目标世界已经存在「同名 username 但不同邮箱」的用户时（最常见场景：
 *   同一个玩家在两个世界用了相同昵称），INSERT 会抛出
 *     duplicate key value violates unique constraint "users_username_key"
 *   → receive 返回 500「创建用户失败」→ 前端 main.js 判定传送失败 →
 *   showLoginScreen() 弹出登录框，玩家点「游客跳过」后就是游客状态。
 *
 * 本模块的职责：
 *   按 email 复用已有用户；否则解析一个不与本地冲突的昵称后创建。
 *   昵称冲突时自动改名（base → base_源世界名 → base_随机码），
 *   并发竞争导致的唯一约束冲突会自动重试，绝不把 500 抛给传送流程。
 */

const { v4: uuidv4 } = require('uuid');
const { query } = require('../database/db');

const MAX_USERNAME_LEN = 50;   // users.username VARCHAR(50)
const MAX_ATTEMPTS = 6;
const RANDOM_LEN = 4;

/** 按字符数裁剪，兼容中文（不上字节数，VARCHAR(50) 是字符数） */
function clip(value, max) {
  if (typeof value !== 'string') return '';
  const s = value.trim();
  if (s.length <= max) return s;
  return s.slice(0, max);
}

/** world_1770800924268_ptbh0p39m → ptbh0p39m */
function worldIdTail(worldId) {
  if (!worldId || typeof worldId !== 'string') return '';
  const parts = worldId.split('_').filter(Boolean);
  return (parts[parts.length - 1] || worldId).slice(-8);
}

/** 生成候选昵称列表（第一个是玩家原名） */
function buildCandidates(baseUsername, worldName, worldId) {
  const base = clip(baseUsername, MAX_USERNAME_LEN) || '旅行者';
  const candidates = [base];

  const named = clip(worldName || '', 10);
  if (named) {
    const suffix = '_' + named;
    candidates.push(clip(base, MAX_USERNAME_LEN - suffix.length) + suffix);
  }

  const tail = worldIdTail(worldId);
  if (tail) {
    const suffix = '_' + tail;
    candidates.push(clip(base, MAX_USERNAME_LEN - suffix.length) + suffix);
  }

  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const suffix = '_' + Math.random().toString(36).slice(2, 2 + RANDOM_LEN);
    candidates.push(clip(base, MAX_USERNAME_LEN - suffix.length) + suffix);
  }

  return [...new Set(candidates)];
}

async function isUsernameTaken(username) {
  const r = await query('SELECT 1 FROM users WHERE username = $1 LIMIT 1', [username]);
  return r.rows.length > 0;
}

/**
 * 解析出一个本地未被占用的昵称
 * @returns {{ username: string, renamed: boolean, original: string }}
 */
async function resolveUniqueUsername(baseUsername, worldName, worldId) {
  const original = clip(baseUsername, MAX_USERNAME_LEN) || '旅行者';
  const candidates = buildCandidates(baseUsername, worldName, worldId);

  for (const candidate of candidates) {
    if (!(await isUsernameTaken(candidate))) {
      return { username: candidate, renamed: candidate !== original, original };
    }
  }

  // 极端兜底：随机 uuid 片段，几乎不可能冲突
  for (let i = 0; i < 5; i++) {
    const fallback = ('u_' + uuidv4().replace(/-/g, '')).slice(0, 18);
    if (!(await isUsernameTaken(fallback))) {
      return { username: fallback, renamed: true, original };
    }
  }

  return { username: original + '_' + Date.now().toString(36).slice(-6), renamed: true, original };
}

/**
 * 按 email 复用，否则创建；昵称冲突时自动改名
 *
 * @param {object} params
 * @param {string} params.email        源世界用户邮箱（必填，唯一）
 * @param {string} params.username     源世界用户昵称
 * @param {string} [params.worldName]  源世界名称（用于生成不冲突昵称）
 * @param {string} [params.worldId]    源世界 ID（用于生成不冲突昵称）
 * @returns {Promise<{user: object, created: boolean, renamed: boolean, finalUsername: string, originalUsername: string}>}
 */
async function findOrCreateFederatedUser({ email, username, worldName, worldId }) {
  if (!email) {
    throw new Error('缺少邮箱，无法创建联邦用户');
  }

  // 1) 同一邮箱 = 同一玩家，直接复用本地账号（这是跨世界身份延续的正解）
  const existing = await query('SELECT * FROM users WHERE email = $1', [email]);
  if (existing.rows.length > 0) {
    const u = existing.rows[0];
    return {
      user: u,
      created: false,
      renamed: false,
      finalUsername: u.username,
      originalUsername: username || u.username
    };
  }

  // 2) 新建：解析唯一昵称后插入；并发撞车时重试
  let lastError = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const resolved = await resolveUniqueUsername(username, worldName, worldId);
    try {
      // 字段集与原有实现保持一致 —— 不写 federation_user，
      // 避免旧部署的 users 表尚未迁移该列时抛 "column does not exist"
      const inserted = await query(
        `INSERT INTO users (id, username, email, password_hash)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [uuidv4(), resolved.username, email, 'FEDERATED_USER']
      );
      return {
        user: inserted.rows[0],
        created: true,
        renamed: resolved.renamed,
        finalUsername: resolved.username,
        originalUsername: resolved.original
      };
    } catch (error) {
      // 23505 = unique_violation：昵称或邮箱被并发抢占了
      if (error && error.code === '23505') {
        const again = await query('SELECT * FROM users WHERE email = $1', [email]);
        if (again.rows.length > 0) {
          const u = again.rows[0];
          return {
            user: u,
            created: false,
            renamed: false,
            finalUsername: u.username,
            originalUsername: username || u.username
          };
        }
        lastError = error;
        continue; // 换个候选昵称重试
      }
      throw error;
    }
  }

  throw lastError || new Error('无法创建联邦用户（昵称冲突重试耗尽）');
}

module.exports = {
  findOrCreateFederatedUser,
  resolveUniqueUsername,
  worldIdTail,
  MAX_USERNAME_LEN
};
