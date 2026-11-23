/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 *
 * sqlRunner.js — 安装向导的数据库执行器
 *
 * 为什么不复用 src/database/db.js：
 * 那个模块在 require 时就 `new Pool(DB_CFG)`，而安装阶段还没有可信的 DB_CFG，
 * 连接池会按空配置初始化并污染后续启动。安装器自己开临时 Client，用完即关。
 */
'use strict';

const fs = require('fs');
const { Client } = require('pg');

const CONNECT_TIMEOUT = 8000;

/** 拼 Client 配置（禁止 SSL：本地/内网直连，开了反而连不上） */
function clientConfig(dbCfg) {
  return {
    host: dbCfg.host,
    port: Number(dbCfg.port) || 5432,
    database: dbCfg.database,
    user: dbCfg.user,
    password: dbCfg.password,
    connectionTimeoutMillis: CONNECT_TIMEOUT,
    ssl: false
  };
}

/**
 * PostgreSQL 错误码 → 可执行的中文提示
 * 与 src/database/db.js 的 diagnoseDbError 保持同一套话术，避免用户看到两种说法
 */
function diagnose(err) {
  const code = err && err.code;
  const map = {
    '3D000': '数据库不存在。请确认已在宝塔/命令行里建好这个库，且库名大小写完全一致（PostgreSQL 建库不加引号会转小写）。',
    '28P01': '数据库密码错误。请核对宝塔里显示的那个密码，注意不要带首尾空格。',
    '28000': '数据库用户不存在。请确认用户名，宝塔建库时会给一个形如 xxx_db 的账号。',
    'ECONNREFUSED': '连不上数据库。请确认 PostgreSQL 服务已启动，端口正确。',
    'ENOTFOUND': '解析不到数据库主机。若数据库就在本机，建议 host 填 127.0.0.1 而不是 localhost（后者可能走 IPv6 被拒）。',
    '42501': '数据库权限不足。执行建表需要该用户对库有 CREATE 权限；部分语句还需要创建扩展的权限。',
    '42P07': '表已存在。这个库里可能已经装过或残留了部分表，建议换一个空库，或先清空 public schema。',
    '23505': '唯一键冲突。这个库里可能已有安装残留数据，建议换一个空库。',
    '53300': '数据库连接数已满。可以重启一下 PostgreSQL 再试。',
    '57P03': '数据库正在启动中，请稍等十几秒再试。'
  };
  if (code && map[code]) return map[code];

  const msg = (err && err.message) || '';
  if (/timeout/i.test(msg)) {
    return `连接数据库超时（${CONNECT_TIMEOUT / 1000} 秒）。请确认 host/端口正确、数据库服务正常、防火墙未拦截。`;
  }
  // 扩展相关：只做精确匹配，并且把原始错误带上——之前用宽匹配（只要含 pgcrypto 就套同一句提示），
  // 结果把真正的报错盖住了（例如 COMMENT ON EXTENSION 的 does not exist），排查时被误导。
  if (/permission denied to create extension/i.test(msg)) {
    return '数据库用户没有创建扩展的权限（该扩展对本程序非必需）：' + msg;
  }
  if (/extension "[^"]*" is not available|could not open extension control file/i.test(msg)) {
    return '数据库缺少扩展支持，需要安装 postgresql-contrib：' + msg;
  }

  // 其他错误一律带上原文，不用猜
  return msg || '未知错误';
}

/**
 * 测试连接 + 探查库内现状
 *
 * 除了版本和表数，还要判断这个库处于哪种状态，决定下一步怎么走：
 *   empty        空库            → 完整安装（建表 + 配置）
 *   initialized  已初始化过的库  → 可走"快速模式"，跳过建表只补配置
 *   foreign      有表但不是我们的 → 拒绝，让他换库
 *
 * @returns {Promise<{version, tableCount, dbName, state, userCount, adminCount, reservedWorldId}>}
 */
async function testConnection(dbCfg) {
  const client = new Client(clientConfig(dbCfg));
  try {
    await client.connect();
    const ver = await client.query('SHOW server_version');
    const name = await client.query('SELECT current_database() AS n');
    const cnt = await client.query(
      `SELECT count(*)::int AS n FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`
    );
    const tableCount = cnt.rows[0].n;

    const out = {
      version: (ver.rows[0] && ver.rows[0].server_version) || '',
      tableCount,
      dbName: name.rows[0].n,
      state: 'empty',
      userCount: 0,
      adminCount: 0,
      reservedWorldId: null
    };

    if (tableCount === 0) {
      return out;
    }

    // 判断是不是"我们这个程序的库"：看几张标志性表在不在
    const markers = ['admin_users', 'system_config', 'character_templates',
                     'world_objects', 'world_config', 'game_config'];
    const hit = await client.query(
      `SELECT count(*)::int AS n FROM information_schema.tables
        WHERE table_schema='public' AND table_name = ANY($1::text[])`,
      [markers]
    );
    if (hit.rows[0].n < 4) {
      out.state = 'foreign';
      return out;
    }

    out.state = 'initialized';

    // 有人用过没有
    try {
      const u = await client.query('SELECT count(*)::int AS n FROM public.users');
      out.userCount = u.rows[0].n;
    } catch (_) { /* 表不在就算了 */ }
    try {
      const a = await client.query('SELECT count(*)::int AS n FROM public.admin_users');
      out.adminCount = a.rows[0].n;
    } catch (_) {}

    // 是否已经有世界身份（有的话快速模式要保留，不能换掉）
    try {
      const w = await client.query(
        `SELECT value FROM public.world_config WHERE key = 'federation_config'`
      );
      if (w.rows.length) {
        const cfg = JSON.parse(w.rows[0].value);
        out.reservedWorldId = cfg.worldId || null;
      }
    } catch (_) {}

    return out;
  } catch (err) {
    const e = new Error(diagnose(err));
    e.code = err.code;
    throw e;
  } finally {
    try { await client.end(); } catch (_) {}
  }
}

/**
 * 在事务里执行初始化 SQL
 * 整个 00_init_all.sql 包在一个事务里：任何一步失败都 ROLLBACK，
 * 库回到干净状态，用户改完参数可以直接重试（不会留下半成品表）。
 *
 * @param {object} dbCfg
 * @param {string} sqlPath
 * @param {(stage:string)=>void} onStage
 * @returns {Promise<{statements:number, ms:number}>}
 */
async function runInitSql(dbCfg, sqlPath, onStage) {
  const sql = fs.readFileSync(sqlPath, 'utf-8');
  const client = new Client(clientConfig(dbCfg));
  const t0 = Date.now();

  onStage('connecting');
  try {
    await client.connect();
  } catch (err) {
    const e = new Error(diagnose(err));
    e.code = err.code;
    throw e;
  }

  try {
    onStage('begin');
    await client.query('BEGIN');

    onStage('executing');
    // pg 的 simple query 协议支持一次发送多条语句，PostgreSQL 按顺序执行
    await client.query(sql);

    onStage('commit');
    await client.query('COMMIT');

    return { statements: (sql.match(/;\s*$/gm) || []).length, ms: Date.now() - t0 };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    const e = new Error(diagnose(err));
    e.code = err.code;
    e.rolledBack = true;
    throw e;
  } finally {
    try { await client.end(); } catch (_) {}
  }
}

/**
 * 在一个短连接里执行收尾 SQL（改管理员、写世界身份）
 * @param {object} dbCfg
 * @param {(client)=>Promise<any>} fn
 */
async function withClient(dbCfg, fn) {
  const client = new Client(clientConfig(dbCfg));
  try {
    await client.connect();
    return await fn(client);
  } catch (err) {
    const e = new Error(diagnose(err));
    e.code = err.code;
    throw e;
  } finally {
    try { await client.end(); } catch (_) {}
  }
}

module.exports = { testConnection, runInitSql, withClient, diagnose };
