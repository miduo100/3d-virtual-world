/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 *
 * routes.js — 安装向导的四个接口
 *   POST /api/install/test-db   测试数据库连接 + 探查库内现状
 *   POST /api/install/run       执行安装（异步，前端轮询 status）
 *   GET  /api/install/status    查询安装阶段
 *   POST /api/install/dismiss   清掉上次的失败状态（重试前调用）
 *
 * 安全设计：
 * 1. 只在"未安装"状态下由 index.js 挂载，装完即不可达
 * 2. 单实例锁：同一时间只允许一个安装流程，防止并发把库搞乱
 * 3. 库非空时必须原样输入库名确认，防误点清空数据
 */
'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const { testConnection, runInitSql, withClient } = require('./sqlRunner');
const { writeEnv } = require('./envWriter');

const SQL_PATH = path.join(__dirname, '..', '..', 'database', '00_init_all.sql');
const SERVICE_URL_DEFAULT = 'https://miduo100.com';

// 安装阶段的中文描述（前端直接显示）
const STAGE_TEXT = {
  idle: '待开始',
  connecting: '正在连接数据库…',
  begin: '开启事务…',
  executing: '正在建表并写入初始数据（约 10-30 秒）…',
  commit: '提交事务…',
  admin: '正在创建管理员…',
  world: '正在生成世界身份（ID + 密钥对）…',
  env: '正在写入配置文件…',
  restarting: '安装完成，正在重启服务…',
  done: '安装完成',
  failed: '安装失败'
};

/** 安装器的全局状态（单实例） */
const state = {
  running: false,
  stage: 'idle',
  message: '',
  error: null,
  startedAt: null,
  finishedAt: null,
  worldId: null,
  worldIdReused: false,
  adminUser: null,
  siteUrl: null,
  rolledBack: false
};

function setStage(stage, extra) {
  state.stage = stage;
  state.message = STAGE_TEXT[stage] || stage;
  if (extra) Object.assign(state, extra);
}

/** 与 src/routes/federation.js 的 generateWorldId 完全一致 */
function generateWorldId() {
  return `world_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

/** 与 federationSystem.generateKeyPair 完全一致（spki/pkcs8 PEM，RSA 2048） */
function generateKeyPair() {
  return crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });
}

/** 表单校验，返回错误字符串或 null */
function validate(body) {
  const db = body.db || {};
  const world = body.world || {};
  const admin = body.admin || {};

  if (!db.host || !String(db.host).trim()) return '数据库地址不能为空';
  if (!db.port || !/^\d+$/.test(String(db.port))) return '端口必须是数字';
  if (!db.database || !/^[A-Za-z0-9_]+$/.test(String(db.database))) {
    return '库名只能包含字母、数字、下划线（PostgreSQL 不建引号建库会转小写，建议全小写）';
  }
  if (!db.user || !String(db.user).trim()) return '数据库用户名不能为空';

  if (!world.name || !String(world.name).trim()) return '世界名称不能为空';
  if (String(world.name).length > 50) return '世界名称不要超过 50 个字';
  if (!world.url || !/^https?:\/\/[^\s]+$/i.test(String(world.url))) {
    return '对外地址必须以 http:// 或 https:// 开头';
  }

  if (!admin.username || !/^[A-Za-z0-9_.-]{3,30}$/.test(String(admin.username))) {
    return '管理员账号 3-30 位，只能用字母、数字、下划线、点、横线';
  }
  if (!admin.password || String(admin.password).length < 6) {
    return '管理员密码至少 6 位';
  }

  return null;
}

/** 把一个连接池操作包成"改管理员"逻辑 */
async function applyAdmin(dbCfg, admin) {
  const hash = await bcrypt.hash(String(admin.password), 10);
  return withClient(dbCfg, async (client) => {
    const up = await client.query(
      `UPDATE admin_users
          SET username = $1, password_hash = $2, email = $3, is_active = true, updated_at = NOW()
        WHERE id = 1`,
      [admin.username, hash, admin.email || '']
    );
    if (up.rowCount === 0) {
      await client.query(
        `INSERT INTO admin_users (id, username, password_hash, email, full_name, role, is_active)
         VALUES (1, $1, $2, $3, '系统管理员', 'admin', true)
         ON CONFLICT (id) DO NOTHING`,
        [admin.username, hash, admin.email || '']
      );
      await client.query(
        `SELECT setval(pg_get_serial_sequence('public.admin_users','id'),
                COALESCE((SELECT MAX(id) FROM public.admin_users), 1), true)`
      );
    }
  });
}

/**
 * 写世界身份：world_config 的 federation_config + system_config 的 name/url
 *
 * @param {boolean} reuse 复用模式：库里已有世界身份时保留原 worldId 和密钥对，
 *                        只同步名称与地址。换掉 worldId 等于这个世界在联邦里"换了个人"，
 *                        已有的互信关系会全部失效，所以复用场景绝不能重新生成。
 * @returns {Promise<{worldId:string, reused:boolean}>}
 */
async function applyWorld(dbCfg, world, reuse) {
  if (reuse) {
    const exist = await withClient(dbCfg, (client) => client.query(
      `SELECT value FROM public.world_config WHERE key = 'federation_config'`
    ));
    if (exist.rows.length) {
      try {
        const cfg = JSON.parse(exist.rows[0].value);
        if (cfg.worldId && cfg.privateKey && cfg.publicKey) {
          cfg.worldName = world.name;
          cfg.worldUrl = world.url;
          cfg.url_source = 'manual';
          await withClient(dbCfg, (client) => client.query(
            `UPDATE public.world_config SET value = $1, updated_at = NOW() WHERE key = 'federation_config'`,
            [JSON.stringify(cfg)]
          ));
          await withClient(dbCfg, async (client) => {
            await client.query(
              `UPDATE public.system_config SET config_value = $1, updated_at = NOW() WHERE config_key = 'world_name'`,
              [world.name]
            );
            await client.query(
              `UPDATE public.system_config SET config_value = $1, updated_at = NOW() WHERE config_key = 'world_url'`,
              [world.url]
            );
          });
          return { worldId: cfg.worldId, reused: true };
        }
      } catch (e) {
        console.warn('[安装向导] 已有世界身份解析失败，将重新生成:', e.message);
      }
    }
  }

  const worldId = generateWorldId();
  const { publicKey, privateKey } = generateKeyPair();
  const fedConfig = {
    worldId,
    worldName: world.name,
    worldUrl: world.url,
    privateKey,
    publicKey,
    trustRequiresApproval: false,
    // 关键：标记为人工设置，否则启动自检会把公网地址改回内网 IP
    url_source: 'manual'
  };

  await withClient(dbCfg, async (client) => {
    await client.query(
      `INSERT INTO world_config (key, value, created_at, updated_at)
       VALUES ('federation_config', $1, NOW(), NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [JSON.stringify(fedConfig)]
    );
    await client.query(
      `UPDATE system_config SET config_value = $1, updated_at = NOW() WHERE config_key = 'world_name'`,
      [world.name]
    );
    await client.query(
      `UPDATE system_config SET config_value = $1, updated_at = NOW() WHERE config_key = 'world_url'`,
      [world.url]
    );
  });

  return { worldId, reused: false };
}

/**
 * 执行安装（异步串行）
 *
 * 两种模式：
 *   full   空库完整安装：建 105 表 + 写配置 + 生成世界身份 + 写 .env
 *   quick  复用已初始化的库：跳过建表，只写配置 / 管理员 / 世界身份 / .env
 */
async function runInstall(ctx, body) {
  const mode = body.mode === 'quick' ? 'quick' : 'full';
  const dbCfg = {
    host: String(body.db.host).trim(),
    port: Number(body.db.port),
    database: String(body.db.database).trim(),
    user: String(body.db.user).trim(),
    password: String(body.db.password == null ? '' : body.db.password)
  };
  const world = {
    name: String(body.world.name).trim(),
    url: String(body.world.url).trim().replace(/\/+$/, ''),
    centralUrl: String(body.world.centralUrl || SERVICE_URL_DEFAULT).trim().replace(/\/+$/, ''),
    autoConnect: body.world.autoConnect !== false
  };
  const admin = {
    username: String(body.admin.username).trim(),
    password: String(body.admin.password),
    email: String(body.admin.email || '').trim()
  };

  try {
    // 1) 连接 + 探查
    setStage('connecting');
    const info = await testConnection(dbCfg);

    // 2) 库状态校验（两种模式的准入条件完全不同）
    if (info.state === 'foreign') {
      throw new Error(
        `这个库里有 ${info.tableCount} 张表，但没有本程序的标志性表，看起来是别的系统的库。`
        + '请换一个空库，或在数据库面板里新建一个专用库。'
      );
    }

    if (mode === 'full') {
      if (info.state !== 'empty') {
        throw new Error(
          `这个库里已经有 ${info.tableCount} 张表，无法重复建表（数据不会丢，但会装不进去）。`
          + '请改用「复用已有库」模式，或换一个空库。'
        );
      }
    } else {
      // quick：必须已经初始化过
      if (info.state !== 'initialized') {
        throw new Error('这个库还不是本程序的库，无法使用复用模式，请走完整安装或换一个库。');
      }
      const confirm = String(body.confirmName || '').trim();
      if (confirm !== dbCfg.database) {
        throw new Error(`请在确认框中原样输入库名「${dbCfg.database}」。`);
      }
      if (info.userCount > 0) {
        throw new Error(
          `这个库里已经有 ${info.userCount} 个用户，说明它是正在使用的库。`
          + '继续会覆盖管理员账号和世界配置，请换一个库，或确认这是你要覆盖的库。'
        );
      }
    }

    // 3) 建表（仅完整模式）
    if (mode === 'full') {
      if (!fs.existsSync(SQL_PATH)) {
        throw new Error(`找不到初始化脚本：${SQL_PATH}`);
      }
      await runInitSql(dbCfg, SQL_PATH, setStage);
    }

    // 4) 管理员
    setStage('admin');
    await applyAdmin(dbCfg, admin);

    // 5) 世界身份（复用模式保留原有 worldId 和密钥）
    setStage('world');
    const w = await applyWorld(dbCfg, world, mode === 'quick');

    // 5.5) 安装时选的语言 → 写进系统默认语言，装完世界就用这个语言
    const lang = String(body.language || '').trim();
    if (lang === 'zh-CN' || lang === 'en-US') {
      await withClient(dbCfg, async (client) => {
        const up = await client.query(
          `UPDATE public.system_config SET config_value = $1, updated_at = NOW() WHERE config_key = 'default_language'`,
          [lang]
        );
        if (up.rowCount === 0) {
          await client.query(
            `INSERT INTO public.system_config (config_key, config_value, description, is_sensitive)
             VALUES ('default_language', $1, '默认语言', false)
             ON CONFLICT DO NOTHING`,
            [lang]
          );
        }
      });
    }

    // 6) 写 .env（放最后：前面的步骤全成功才落地"已安装"标记）
    setStage('env');
    const port = Number(body.port) || 3002;
    writeEnv({
      db: dbCfg,
      world,
      port
    });

    setStage('restarting', {
      worldId: w.worldId,
      worldIdReused: w.reused,
      adminUser: admin.username,
      siteUrl: world.url,
      finishedAt: Date.now(),
      running: false
    });

    // 7) 延迟重启，让响应先发出去
    setTimeout(() => ctx.restart(), 900);
  } catch (err) {
    state.running = false;
    state.error = err.message || String(err);
    state.rolledBack = !!err.rolledBack;
    state.finishedAt = Date.now();
    setStage('failed');
    console.error('[安装向导] 失败:', err.message);
  }
}

function createRouter(ctx) {
  const router = express.Router();

  router.post('/test-db', async (req, res) => {
    try {
      const b = req.body || {};
      const db = b.db || b;
      if (!db.host || !db.database || !db.user) {
        return res.status(400).json({ ok: false, error: '请先填写数据库地址、库名和用户名' });
      }
      // PostgreSQL 的 SCRAM 认证要求密码必须是字符串，空密码会抛出难懂的技术错误，
      // 这里提前拦下并给一句人话
      if (db.password == null || String(db.password) === '') {
        return res.status(400).json({
          ok: false,
          error: '请填写数据库密码。如果这个用户确实没有密码，请先在数据库面板里给它设一个。'
        });
      }
      const info = await testConnection({
        host: String(db.host).trim(),
        port: Number(db.port) || 5432,
        database: String(db.database).trim(),
        user: String(db.user).trim(),
        password: String(db.password)
      });
      res.json({ ok: true, ...info });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message });
    }
  });

  router.post('/run', (req, res) => {
    if (state.running) {
      return res.status(409).json({ ok: false, error: '安装正在进行中，请稍候' });
    }
    const body = req.body || {};
    const bad = validate(body);
    if (bad) return res.status(400).json({ ok: false, error: bad });

    state.running = true;
    state.error = null;
    state.stage = 'idle';
    state.message = '';
    state.startedAt = Date.now();
    state.finishedAt = null;
    state.worldId = null;
    state.rolledBack = false;

    runInstall(ctx, body);
    res.json({ ok: true, started: true });
  });

  router.get('/status', (req, res) => {
    res.json({
      ok: true,
      running: state.running,
      stage: state.stage,
      message: state.message,
      error: state.error,
      rolledBack: state.rolledBack,
      worldId: state.worldId,
      worldIdReused: state.worldIdReused,
      adminUser: state.adminUser,
      siteUrl: state.siteUrl,
      startedAt: state.startedAt,
      finishedAt: state.finishedAt
    });
  });

  router.post('/dismiss', (req, res) => {
    if (state.running) return res.status(409).json({ ok: false, error: '安装仍在进行中' });
    state.stage = 'idle';
    state.error = null;
    state.message = '';
    state.rolledBack = false;
    res.json({ ok: true });
  });

  return router;
}

module.exports = {
  createRouter,
  STAGE_TEXT,
  // 供自动化测试直接调用，避免只能靠 HTTP 走完整流程
  _internal: { applyAdmin, applyWorld, validate, state }
};
