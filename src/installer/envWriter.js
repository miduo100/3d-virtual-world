/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 *
 * envWriter.js — 安装向导的 .env 生成器
 *
 * 设计要点：
 * 1. 密钥在这里一次性生成（不依赖 secretAutoFix 的启动期修补），装完即是完整配置
 * 2. 写入 INSTALLED=1 作为"已安装"标记，安装向导据此永久关闭
 * 3. 密码等含特殊字符的值用单引号包裹（dotenv 按字面量解析）
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..', '..');
const ENV_PATH = path.join(ROOT, '.env');

/** 64 位十六进制随机串 */
function genSecret() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * dotenv 值转义：
 * 含空格 / # / 引号的用单引号包裹（单引号内所有字符按字面量解析）；
 * 值本身含单引号时无法安全写入，直接抛错让用户改密码，避免写出半截配置。
 */
function quoteValue(v) {
  const s = String(v == null ? '' : v);
  if (!/[ \t#"'`$\\]/.test(s)) return s;
  if (s.includes("'")) {
    throw new Error('该值包含单引号，无法写入配置，请修改后重试');
  }
  return `'${s}'`;
}

/**
 * 拼装 .env 内容
 * @param {object} cfg
 * @param {object} cfg.db      { host, port, database, user, password }
 * @param {object} cfg.world   { name, url, centralUrl, autoConnect }
 * @param {number} cfg.port    服务端口
 */
function buildEnvContent(cfg) {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} `
    + `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

  const lines = [
    '# ===========================================',
    '#  创世 Genesis · 世界配置',
    `#  由安装向导生成于 ${stamp}`,
    '#',
    '#  重要：首次启动后本文件中的 JWT 密钥即为此世界的身份，',
    '#        请备份，不要用模板覆盖，否则所有在线用户会被踢下线。',
    '# ===========================================',
    '',
    '# ---------- 数据库 ----------',
    `DB_HOST=${quoteValue(cfg.db.host)}`,
    `DB_PORT=${quoteValue(cfg.db.port)}`,
    `DB_NAME=${quoteValue(cfg.db.database)}`,
    `DB_USER=${quoteValue(cfg.db.user)}`,
    `DB_PASSWORD=${quoteValue(cfg.db.password)}`,
    '',
    '# ---------- 服务端口 ----------',
    `PORT=${quoteValue(cfg.port)}`,
    '',
    '# ---------- 世界身份 ----------',
    `WORLD_NAME=${quoteValue(cfg.world.name)}`,
    `WORLD_URL=${quoteValue(cfg.world.url)}`,
    '',
    '# ---------- 中心世界（联邦）----------',
    `CENTRAL_WORLD_URL=${quoteValue(cfg.world.centralUrl)}`,
    `AUTO_CONNECT_CENTRAL=${cfg.world.autoConnect ? 'true' : 'false'}`,
    '',
    '# ---------- 密钥（安装时一次性生成）----------',
    `JWT_SECRET=${genSecret()}`,
    `ADMIN_JWT_SECRET=${genSecret()}`,
    `AGENT_JWT_SECRET=${genSecret()}`,
    '',
    '# ---------- 运行环境 ----------',
    'NODE_ENV=production',
    '',
    '# ---------- 第三方服务（按需到管理后台填写）----------',
    'TENCENT_SECRET_ID=',
    'TENCENT_SECRET_KEY=',
    'TENCENT_REGION=ap-guangzhou',
    '',
    'QWEN_API_KEY=',
    'DOUBAO_API_KEY=',
    'HUNYUAN_SECRET_ID=',
    'HUNYUAN_SECRET_KEY=',
    '',
    '# ---------- 安装标记（勿手动删除，否则安装向导会重新出现）----------',
    'INSTALLED=1',
    ''
  ];
  return lines.join('\n');
}

/**
 * 写入 .env（覆盖旧文件；旧文件先备份为 .env.before-install）
 * @param {object} cfg
 * @param {string} [targetPath] 可选，指定写入路径（默认项目根 .env）。主要供测试使用。
 */
function writeEnv(cfg, targetPath) {
  const envPath = targetPath || ENV_PATH;
  const content = buildEnvContent(cfg);
  // 先校验能写（避免装了半小时最后一步失败）
  const probe = envPath + '.probe';
  fs.writeFileSync(probe, 'probe', 'utf-8');
  fs.unlinkSync(probe);

  if (fs.existsSync(envPath)) {
    fs.writeFileSync(envPath + '.before-install', fs.readFileSync(envPath), 'utf-8');
  }
  fs.writeFileSync(envPath, content, 'utf-8');
  return envPath;
}

module.exports = { buildEnvContent, writeEnv, genSecret, ENV_PATH };
