/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 *
 * JWT 密钥自动修复模块
 * 作用：启动时检测 JWT_SECRET / ADMIN_JWT_SECRET 是否为弱密钥（默认占位符、空值、过短），
 *       若是则自动生成安全随机密钥并写回 .env 文件，实现"零配置安全部署"。
 * 使用：在 dotenv.config() 之后立即 require 并调用 autoFixSecrets()
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// 已知的弱密钥/占位符模式（不区分大小写匹配）
const WEAK_PATTERNS = [
  'your_secret_key_change_this',
  'your_admin_secret_key_change_this',
  'your_jwt_secret_change_this',
  'your_admin_jwt_secret_change_this',
  'change_this_in_production',
  'your_secret_key',
  'your_jwt_secret',
  'admin_secret',
  'jwt_secret',
  'secret',
  'password',
  '123456'
];

// 需要保护的密钥配置项
const PROTECTED_KEYS = ['JWT_SECRET', 'ADMIN_JWT_SECRET'];

/**
 * 判断一个密钥值是否为弱密钥
 * @param {string} value 密钥值
 * @returns {boolean}
 */
function isWeakSecret(value) {
  if (!value || value.trim() === '') return true;
  if (value.length < 16) return true; // 太短不安全
  const lower = value.toLowerCase();
  for (const pattern of WEAK_PATTERNS) {
    if (lower.includes(pattern)) return true;
  }
  return false;
}

/**
 * 生成安全随机密钥（64位十六进制字符串）
 * @returns {string}
 */
function generateSecureSecret() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * 在 .env 内容中替换指定键的值；若键不存在则追加到末尾
 * @param {string} envContent .env 文件内容
 * @param {string} key 键名
 * @param {string} newValue 新值
 * @returns {string} 更新后的内容
 */
function replaceEnvValue(envContent, key, newValue) {
  const regex = new RegExp(`^${key}=.*$`, 'm');
  if (regex.test(envContent)) {
    return envContent.replace(regex, `${key}=${newValue}`);
  }
  // 键不存在，追加到文件末尾
  const suffix = envContent.endsWith('\n') ? '' : '\n';
  return `${envContent}${suffix}${key}=${newValue}\n`;
}

/**
 * 自动检测并修复弱密钥
 * 在 dotenv.config() 之后调用
 */
function autoFixSecrets() {
  const envPath = path.join(__dirname, '..', '..', '.env');
  const examplePath = path.join(__dirname, '..', '..', '.env.example');

  // 找出所有弱密钥
  const weakKeys = PROTECTED_KEYS.filter(key => isWeakSecret(process.env[key]));
  if (weakKeys.length === 0) return; // 全部安全，直接返回

  // 读取 .env 内容；不存在则从 .env.example 创建
  // 注意：读取后统一剥离 UTF-8 BOM（﻿），避免首行键名匹配失败
  // （Windows 记事本、PowerShell Set-Content -Encoding UTF8 均可能写入 BOM）
  const stripBOM = (text) => (text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text);
  let envContent = '';
  if (fs.existsSync(envPath)) {
    try {
      envContent = stripBOM(fs.readFileSync(envPath, 'utf-8'));
    } catch (err) {
      console.warn('[密钥修复] 无法读取 .env 文件:', err.message);
    }
  }
  if (!envContent && fs.existsSync(examplePath)) {
    try {
      envContent = stripBOM(fs.readFileSync(examplePath, 'utf-8'));
    } catch (err) {
      console.warn('[密钥修复] 无法读取 .env.example 文件:', err.message);
    }
  }

  // 为每个弱密钥生成新的随机值
  const newSecrets = {};
  for (const key of weakKeys) {
    newSecrets[key] = generateSecureSecret();
    process.env[key] = newSecrets[key]; // 立即在内存中生效
    console.log(`[密钥修复] 检测到 ${key} 为弱密钥或缺失，已自动生成安全随机密钥`);
  }

  // 尝试写回 .env 文件
  if (!envContent) {
    // 没有任何模板可用，手工构建最小配置
    envContent = weakKeys.map(key => `${key}=${newSecrets[key]}`).join('\n') + '\n';
  } else {
    for (const key of weakKeys) {
      envContent = replaceEnvValue(envContent, key, newSecrets[key]);
    }
  }

  try {
    fs.writeFileSync(envPath, envContent, 'utf-8');
    console.log('[密钥修复] .env 文件已自动更新，密钥已替换为安全随机值');
    console.log('[密钥修复] 后续重启将直接使用新密钥，不会再触发此提示');
  } catch (err) {
    console.warn('[密钥修复] 无法写入 .env 文件（可能是只读权限），新密钥仅在本次运行中生效');
    console.warn('[密钥修复] 请手动更新 .env 文件中的以下配置：');
    for (const key of weakKeys) {
      console.warn(`[密钥修复]   ${key}=${newSecrets[key]}`);
    }
  }
}

module.exports = { autoFixSecrets, isWeakSecret };
