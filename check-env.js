/**
 * virtual-world 环境检测脚本
 * 检测当前设备是否能运行虚拟世界项目
 * 
 * 用法: node check-env.js
 * 
 * Copyright © 2026 济宁米多信息科技有限公司
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, spawnSync } = require('child_process');

// ====== 颜色输出 ======
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

const log = {
  ok: (msg) => console.log(`  ${colors.green}✓${colors.reset} ${msg}`),
  fail: (msg) => console.log(`  ${colors.red}✗${colors.reset} ${msg}`),
  warn: (msg) => console.log(`  ${colors.yellow}⚠${colors.reset} ${msg}`),
  info: (msg) => console.log(`  ${colors.cyan}→${colors.reset} ${msg}`),
  title: (msg) => console.log(`\n${colors.bright}${colors.cyan}[${msg}]${colors.reset}`),
  section: (msg) => console.log(`\n${colors.bright}${colors.yellow}━━━ ${msg} ━━━${colors.reset}`),
  value: (label, value, ok) => {
    const symbol = ok === true ? colors.green + '✓' : ok === false ? colors.red + '✗' : colors.dim + '·';
    console.log(`  ${symbol}${colors.reset} ${label}: ${colors.bright}${value}${colors.reset}`);
  },
};

// ====== 全局状态 ======
let passCount = 0;
let failCount = 0;
let warnCount = 0;

function record(ok) {
  if (ok === true) passCount++;
  else if (ok === false) failCount++;
  else warnCount++;
  return ok;
}

// ====== 工具函数 ======
function parseEnvFile(envPath) {
  const result = {};
  if (!fs.existsSync(envPath)) return result;
  const content = fs.readFileSync(envPath, 'utf-8');
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    // 去掉引号
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

function isPortInUse(port) {
  try {
    if (os.platform() === 'win32') {
      const netstat = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf-8', timeout: 5000 });
      return netstat.includes(`:${port}`) && netstat.includes('LISTENING');
    } else {
      const result = execSync(`ss -tlnp 2>/dev/null | grep :${port} || netstat -tlnp 2>/dev/null | grep :${port}`, { encoding: 'utf-8', timeout: 5000 });
      return result.trim().length > 0;
    }
  } catch {
    return false;
  }
}

// ====== 检测模块 ======

// 1. Node.js 运行环境
function checkNodeJS() {
  log.section('1. Node.js 运行环境');

  let allOk = true;

  // Node版本
  try {
    const nodeVersion = execSync('node --version', { encoding: 'utf-8', timeout: 5000 }).trim();
    const majorVersion = parseInt(nodeVersion.replace('v', '').split('.')[0], 10);
    if (majorVersion >= 18) {
      log.value('Node 版本', nodeVersion + ' (要求 >= v18.x)', true);
      record(true);
    } else {
      log.value('Node 版本', nodeVersion + ' (要求 >= v18.x，当前过低！)', false);
      log.info('请从 https://nodejs.org 下载安装 Node.js 18 LTS 或更高版本');
      record(false);
      allOk = false;
    }
  } catch {
    log.value('Node 版本', '未检测到 Node.js！', false);
    log.info('请从 https://nodejs.org 下载安装 Node.js 18 LTS');
    record(false);
    allOk = false;
  }

  // npm版本
  try {
    const npmVersion = execSync('npm --version', { encoding: 'utf-8', timeout: 5000 }).trim();
    log.value('npm 版本', npmVersion, true);
    record(true);
  } catch {
    log.value('npm 版本', '未检测到 npm！', false);
    record(false);
    allOk = false;
  }

  // 操作系统
  log.value('操作系统', `${os.platform()} ${os.arch()} (${os.release()})`, true);

  return allOk;
}

// 2. PostgreSQL 检测
function checkPostgreSQL() {
  log.section('2. PostgreSQL 数据库');

  let psqlFound = false;
  let versionStr = '';

  // 2.1 检测 psql 命令行
  try {
    versionStr = execSync('psql --version', { encoding: 'utf-8', timeout: 5000 }).trim();
    psqlFound = true;
    // psql (PostgreSQL) 14.10 或类似格式
    const match = versionStr.match(/(\d+)(?:\.(\d+))?/);
    if (match) {
      const major = parseInt(match[1], 10);
      if (major >= 14) {
        log.value('psql 命令行', versionStr + ' ✓', true);
        record(true);
      } else {
        log.value('psql 命令行', versionStr + ' (建议 >= 14.x)', false);
        log.info('PostgreSQL 版本过低，建议升级到 14+');
        record(false);
      }
    } else {
      log.value('psql 命令行', versionStr, true);
      record(true);
    }
  } catch {
    log.warn('psql 命令行未加入 PATH（不影响运行，但无法通过命令行检测）');
    record(null);
  }

  // 2.2 检测 PostgreSQL 服务是否运行
  log.info('正在检测 PostgreSQL 服务状态...');
  let pgRunning = false;

  if (os.platform() === 'win32') {
    // Windows: 通过 sc query 检测服务
    try {
      const scResult = execSync('sc query postgresql-x64-18', { encoding: 'utf-8', timeout: 5000 });
      if (scResult.includes('RUNNING')) {
        log.value('PostgreSQL 18 服务', '运行中', true);
        record(true);
        pgRunning = true;
      }
    } catch {}
    if (!pgRunning) {
      try {
        const scResult = execSync('sc query postgresql-x64-17', { encoding: 'utf-8', timeout: 5000 });
        if (scResult.includes('RUNNING')) {
          log.value('PostgreSQL 17 服务', '运行中', true);
          record(true);
          pgRunning = true;
        } else log.value('PostgreSQL 17 服务', '已安装但未运行', false);
      } catch {}
    }
    if (!pgRunning) {
      try {
        const scResult = execSync('sc query postgresql-x64-16', { encoding: 'utf-8', timeout: 5000 });
        if (scResult.includes('RUNNING')) {
          log.value('PostgreSQL 16 服务', '运行中', true);
          record(true);
          pgRunning = true;
        } else log.value('PostgreSQL 16 服务', '已安装但未运行', false);
      } catch {}
    }
    if (!pgRunning) {
      try {
        const scResult = execSync('sc query postgresql-x64-15', { encoding: 'utf-8', timeout: 5000 });
        if (scResult.includes('RUNNING')) {
          log.value('PostgreSQL 15 服务', '运行中', true);
          record(true);
          pgRunning = true;
        } else log.value('PostgreSQL 15 服务', '已安装但未运行', false);
      } catch {}
    }
    if (!pgRunning) {
      try {
        const scResult = execSync('sc query postgresql-x64-14', { encoding: 'utf-8', timeout: 5000 });
        if (scResult.includes('RUNNING')) {
          log.value('PostgreSQL 14 服务', '运行中', true);
          record(true);
          pgRunning = true;
        } else log.value('PostgreSQL 14 服务', '已安装但未运行', false);
      } catch {}
    }
    // 通用检测
    if (!pgRunning) {
      try {
        const scResult = execSync('sc query postgresql*', { encoding: 'utf-8', timeout: 5000 });
        if (scResult.includes('RUNNING')) {
          log.value('PostgreSQL 服务', '运行中', true);
          record(true);
          pgRunning = true;
        }
      } catch {}
    }
  } else {
    // Linux: systemctl
    try {
      execSync('systemctl is-active postgresql', { encoding: 'utf-8', timeout: 5000 });
      log.value('PostgreSQL 服务', '运行中 (systemctl)', true);
      record(true);
      pgRunning = true;
    } catch {
      try {
        execSync('systemctl is-active postgresql-18', { encoding: 'utf-8', timeout: 5000 });
        log.value('PostgreSQL 18 服务', '运行中 (systemctl)', true);
        record(true);
        pgRunning = true;
      } catch {
        try {
          execSync('systemctl is-active postgresql-17', { encoding: 'utf-8', timeout: 5000 });
          log.value('PostgreSQL 17 服务', '运行中 (systemctl)', true);
          record(true);
          pgRunning = true;
        } catch {
          try {
            execSync('systemctl is-active postgresql-16', { encoding: 'utf-8', timeout: 5000 });
            log.value('PostgreSQL 16 服务', '运行中 (systemctl)', true);
            record(true);
            pgRunning = true;
          } catch {
            try {
              execSync('systemctl is-active postgresql-15', { encoding: 'utf-8', timeout: 5000 });
              log.value('PostgreSQL 15 服务', '运行中 (systemctl)', true);
              record(true);
              pgRunning = true;
            } catch {
              try {
                execSync('systemctl is-active postgresql-14', { encoding: 'utf-8', timeout: 5000 });
                log.value('PostgreSQL 14 服务', '运行中 (systemctl)', true);
                record(true);
                pgRunning = true;
              } catch {}
            }
          }
        }
      }
    }
  }

  // 2.3 扫描常见安装路径
  if (!pgRunning || !psqlFound) {
    log.info('正在扫描 PostgreSQL 安装路径...');
    const installPaths = [];

    if (os.platform() === 'win32') {
      // 扫描 C:\Program Files\PostgreSQL\
      for (const ver of ['18', '17', '16', '15', '14']) {
        const pgPath = `C:\\Program Files\\PostgreSQL\\${ver}`;
        if (fs.existsSync(pgPath)) {
          installPaths.push(`PostgreSQL ${ver}: ${pgPath}`);
        }
      }
      // 扫描 C:\Program Files (x86)\
      for (const ver of ['18', '17', '16', '15', '14']) {
        const pgPath = `C:\\Program Files (x86)\\PostgreSQL\\${ver}`;
        if (fs.existsSync(pgPath)) {
          installPaths.push(`PostgreSQL ${ver} (x86): ${pgPath}`);
        }
      }
      // 扫描 data 目录
      for (const ver of ['18', '17', '16', '15', '14']) {
        const dataPath = `C:\\Program Files\\PostgreSQL\\${ver}\\data`;
        if (fs.existsSync(dataPath)) {
          installPaths.push(`PostgreSQL ${ver} data 目录: ${dataPath}`);
        }
      }
    } else {
      for (const ver of ['18', '17', '16', '15', '14']) {
        const pgPath = `/usr/lib/postgresql/${ver}`;
        if (fs.existsSync(pgPath)) {
          installPaths.push(`PostgreSQL ${ver}: ${pgPath}`);
        }
      }
      // 通用路径
      for (const p of ['/etc/postgresql', '/var/lib/postgresql', '/usr/share/postgresql']) {
        if (fs.existsSync(p)) {
          const entries = fs.readdirSync(p, { withFileTypes: true });
          for (const e of entries) {
            if (e.isDirectory() && /^\d+/.test(e.name)) {
              installPaths.push(`PostgreSQL ${e.name}: ${path.join(p, e.name)}`);
            }
          }
        }
      }
    }

    if (installPaths.length > 0) {
      for (const p of installPaths) {
        log.value('发现安装', p, true);
      }
      record(true);
    } else if (!pgRunning) {
      log.value('PostgreSQL 安装', '未检测到 PostgreSQL！', false);
      log.info('请从 https://www.postgresql.org/download/ 下载安装 PostgreSQL 14+');
      record(false);
    }
  }

  return pgRunning || psqlFound;
}

// 3. 数据库连接检测
async function checkDatabaseConnection() {
  log.section('3. 数据库连接检测');

  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) {
    log.value('.env 文件', '不存在！', false);
    log.info('请创建 .env 文件（可复制 .env.example）并填入数据库配置');
    record(false);
    return false;
  }

  const env = parseEnvFile(envPath);

  // 检查必要字段
  const dbFields = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'];
  let envOk = true;
  for (const f of dbFields) {
    if (env[f]) {
      log.value(f, f.includes('PASSWORD') ? '***已配置***' : env[f], true);
      record(true);
    } else {
      log.value(f, '未配置！', false);
      record(false);
      envOk = false;
    }
  }

  if (!envOk) {
    log.info('请在 .env 文件中配置以上数据库连接参数');
    return false;
  }

  // 尝试连接数据库
  log.info('正在尝试连接数据库...');
  try {
    const { Pool } = require('pg');
    const pool = new Pool({
      host: env.DB_HOST,
      port: parseInt(env.DB_PORT, 10) || 5432,
      database: env.DB_NAME,
      user: env.DB_USER,
      password: env.DB_PASSWORD,
      connectionTimeoutMillis: 5000,
    });

    const result = await pool.query('SELECT current_database(), current_user, version()');
    const { current_database, current_user, version } = result.rows[0];
    const pgVersionMatch = version.match(/PostgreSQL\s+([\d.]+)/);
    const pgVersion = pgVersionMatch ? pgVersionMatch[1] : version;

    log.value('数据库连接', '成功 ✓', true);
    log.value('数据库名', current_database, true);
    log.value('当前用户', current_user, true);
    log.value('PG 版本', pgVersion, true);
    record(true);

    // 检查表是否初始化
    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'users'
      )
    `);
    if (tableCheck.rows[0].exists) {
      const countResult = await pool.query('SELECT COUNT(*) FROM users');
      log.value('users 表', `已初始化 (${countResult.rows[0].count} 条记录)`, true);
      record(true);
    } else {
      log.value('数据库初始化', '未初始化（首次启动服务器时会自动执行 init.sql）', null);
      log.info('启动 npm start 后会自动创建表结构');
      record(null);
    }

    await pool.end();
    return true;
  } catch (err) {
    log.value('数据库连接', '失败！', false);
    log.fail(`错误详情: ${err.message}`);

    // 给出具体建议
    if (err.message.includes('ECONNREFUSED')) {
      log.info('👉 数据库服务未启动或端口不正确，请检查：');
      log.info('   1. PostgreSQL 服务是否已启动');
      log.info('   2. .env 中 DB_PORT 是否正确（默认 5432）');
      log.info('   3. 防火墙是否阻止了 5432 端口');
    } else if (err.message.includes('password authentication failed')) {
      log.info('👉 数据库密码不正确，请检查 .env 中 DB_PASSWORD');
    } else if (err.message.includes('does not exist')) {
      log.info(`👉 数据库 "${env.DB_NAME}" 不存在，请创建：`);
      log.info('   createdb virtual_world');
      log.info('   或通过 pgAdmin 创建名为 virtual_world 的数据库');
    } else if (err.message.includes('Cannot find module')) {
      log.info('👉 pg 模块未安装，请运行: npm install');
    }
    record(false);
    return false;
  }
}

// 4. 项目文件完整性
function checkProjectFiles() {
  log.section('4. 项目文件完整性');

  const requiredFiles = [
    { path: 'src/server.js', desc: '主入口文件' },
    { path: 'src/database/db.js', desc: '数据库模块' },
    { path: 'package.json', desc: '项目配置' },
    { path: '.env', desc: '环境变量' },
    { path: 'database/init.sql', desc: '数据库初始化脚本' },
    { path: 'public/index.html', desc: '前端首页' },
  ];

  let allOk = true;
  for (const file of requiredFiles) {
    const fullPath = path.join(__dirname, file.path);
    if (fs.existsSync(fullPath)) {
      const stat = fs.statSync(fullPath);
      const sizeKB = (stat.size / 1024).toFixed(1);
      log.value(file.desc, `${file.path} (${sizeKB} KB)`, true);
      record(true);
    } else {
      log.value(file.desc, `${file.path} - 缺失！`, false);
      record(false);
      allOk = false;
    }
  }

  // 额外检查目录
  const requiredDirs = [
    { path: 'public/js', desc: '前端 JS 目录' },
    { path: 'src/routes', desc: 'API 路由目录' },
    { path: 'src/services', desc: '业务服务目录' },
  ];
  for (const dir of requiredDirs) {
    const fullPath = path.join(__dirname, dir.path);
    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory()) {
      log.value(dir.desc, dir.path, true);
      record(true);
    } else {
      log.value(dir.desc, `${dir.path} - 缺失！`, false);
      record(false);
      allOk = false;
    }
  }

  return allOk;
}

// 5. npm 依赖检测
function checkNpmDependencies() {
  log.section('5. npm 依赖检测');

  const nodeModulesPath = path.join(__dirname, 'node_modules');
  if (!fs.existsSync(nodeModulesPath)) {
    log.value('node_modules', '不存在！', false);
    log.info('请运行: npm install');
    record(false);
    return false;
  }

  log.value('node_modules', '已安装', true);
  record(true);

  // 检查关键依赖
  const keyDeps = [
    { name: 'express', desc: 'Web 框架' },
    { name: 'pg', desc: 'PostgreSQL 驱动' },
    { name: 'cors', desc: 'CORS 中间件' },
    { name: 'dotenv', desc: '环境变量' },
    { name: 'jsonwebtoken', desc: 'JWT 认证' },
    { name: 'bcryptjs', desc: '密码加密' },
    { name: 'ws', desc: 'WebSocket' },
    { name: 'multer', desc: '文件上传' },
    { name: 'axios', desc: 'HTTP 客户端' },
    { name: 'uuid', desc: 'UUID 生成' },
  ];

  let allOk = true;
  for (const dep of keyDeps) {
    const depPath = path.join(nodeModulesPath, dep.name);
    if (fs.existsSync(depPath)) {
      log.value(dep.desc, dep.name + ' ✓', true);
      record(true);
    } else {
      log.value(dep.desc, dep.name + ' - 缺失！', false);
      record(false);
      allOk = false;
    }
  }

  if (!allOk) {
    log.info('部分依赖缺失，请运行: npm install');
  }

  return allOk;
}

// 6. 关键环境变量检测
function checkEnvironmentVariables() {
  log.section('6. 关键环境变量检测');

  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) {
    log.value('.env 文件', '不存在', false);
    record(false);
    return false;
  }

  const env = parseEnvFile(envPath);

  const essentialVars = [
    { key: 'PORT', desc: '应用端口', suggest: '3002' },
    { key: 'JWT_SECRET', desc: 'JWT 密钥', suggest: null },
    { key: 'ADMIN_JWT_SECRET', desc: '管理员 JWT 密钥', suggest: null },
    { key: 'NODE_ENV', desc: '运行环境', suggest: 'development/production' },
    { key: 'WORLD_NAME', desc: '世界名称', suggest: null },
    { key: 'WORLD_URL', desc: '世界地址', suggest: null },
  ];

  let allOk = true;
  for (const v of essentialVars) {
    const value = env[v.key];
    if (value) {
      // 对密钥只显示前缀
      const display = (v.key.includes('SECRET') || v.key.includes('KEY'))
        ? value.slice(0, 12) + '***' + value.slice(-4)
        : value;
      log.value(v.desc, `${v.key}=${display}`, true);
      record(true);

      // 密钥强度检查
      if (v.key.includes('SECRET') && value.length < 32) {
        log.warn(`${v.key} 长度不足（${value.length}字符），建议使用64字符以上的随机密钥`);
        record(null);
      }
    } else {
      log.value(v.desc, `${v.key} 未设置！`, false);
      if (v.key === 'JWT_SECRET' || v.key === 'ADMIN_JWT_SECRET') {
        log.info(`可用命令生成: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`);
      }
      record(false);
      allOk = false;
    }
  }

  // 可选变量
  log.info('AI/扩展功能变量（可选）:');
  const optionalVars = [
    { key: 'QWEN_API_KEY', desc: '通义千问', mask: true },
    { key: 'DOUBAO_API_KEY', desc: '豆包 AI', mask: true },
    { key: 'TENCENT_SECRET_ID', desc: '腾讯云 SecretId', mask: true },
    { key: 'TENCENT_SECRET_KEY', desc: '腾讯云 SecretKey', mask: true },
    { key: 'TRIPO_API_KEY', desc: 'Tripo 3D', mask: true },
  ];

  for (const v of optionalVars) {
    const value = env[v.key];
    if (value) {
      const display = v.mask ? value.slice(0, 8) + '***' + value.slice(-4) : value;
      log.value(v.desc, '已配置 (' + display + ')', true);
      record(true);
    } else {
      log.value(v.desc, '未配置（AI功能将不可用）', null);
      record(null);
    }
  }

  return allOk;
}

// 7. 端口占用检测
function checkPorts() {
  log.section('7. 端口占用检测');

  const port = 3002;
  const pgPort = 5432;

  // 应用端口
  if (isPortInUse(port)) {
    log.value(`端口 ${port} (应用)`, '已被占用', null);
    log.warn('如果这是之前的 virtual-world 进程，请先停止它');
    record(null);
  } else {
    log.value(`端口 ${port} (应用)`, '空闲可用', true);
    record(true);
  }

  // 尝试 HTTP 健康检查（如果已有服务在运行）
  try {
    const http = require('http');
    const checkPromise = new Promise((resolve) => {
      const req = http.get(`http://localhost:${port}/api/health`, { timeout: 3000 }, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json.status === 'ok') {
              log.info(`发现已运行的 virtual-world 服务 (端口 ${port})，状态正常`);
              resolve(true);
            } else resolve(false);
          } catch { resolve(true); }
        });
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
      req.end();
    });

    const isRunning = checkPromise;
    if (isRunning) {
      log.warn('如需重启请先停止旧进程');
    }
  } catch {}

  // 数据库端口
  if (isPortInUse(pgPort)) {
    log.value(`端口 ${pgPort} (PostgreSQL)`, '正在监听', true);
    record(true);
  } else {
    log.value(`端口 ${pgPort} (PostgreSQL)`, '未监听', false);
    log.info('PostgreSQL 服务可能未启动，或使用了非标准端口');
    record(false);
  }
}

// 8. 目录权限检测
function checkDirectoryPermissions() {
  log.section('8. 目录权限检测');

  const uploadDirs = [
    'public/uploads',
    'public/models',
    'public/models/uploaded',
    'public/generated',
  ];

  let allOk = true;
  for (const dir of uploadDirs) {
    const fullPath = path.join(__dirname, dir);

    // 确保目录存在
    if (!fs.existsSync(fullPath)) {
      try {
        fs.mkdirSync(fullPath, { recursive: true });
        log.value(dir, '自动创建成功', true);
        record(true);
      } catch {
        log.value(dir, '无法创建目录！', false);
        log.info('请手动创建并赋予写入权限');
        record(false);
        allOk = false;
      }
      continue;
    }

    // 检查读写权限
    try {
      const testFile = path.join(fullPath, '.write_test_' + Date.now());
      fs.writeFileSync(testFile, 'test', 'utf-8');
      fs.unlinkSync(testFile);
      log.value(dir, '读写正常', true);
      record(true);
    } catch {
      log.value(dir, '无写入权限！', false);
      log.info('请修复目录权限 (chmod 755 或 Windows 安全设置)');
      record(false);
      allOk = false;
    }
  }

  // 检查 uploads 根目录
  const rootUploads = path.join(__dirname, 'uploads');
  if (fs.existsSync(rootUploads)) {
    try {
      const testFile = path.join(rootUploads, '.write_test_' + Date.now());
      fs.writeFileSync(testFile, 'test', 'utf-8');
      fs.unlinkSync(testFile);
      log.value('uploads/', '读写正常', true);
      record(true);
    } catch {
      log.value('uploads/', '无写入权限！', false);
      record(false);
      allOk = false;
    }
  }

  return allOk;
}

// 9. 系统资源检测
function checkSystemResources() {
  log.section('9. 系统资源检测');

  // CPU
  const cpuCount = os.cpus().length;
  log.value('CPU 核心数', cpuCount + ' 核' + (cpuCount < 2 ? ' (偏低)' : ''), cpuCount >= 2);

  // 内存
  const totalMem = os.totalmem();
  const totalMemGB = (totalMem / (1024 ** 3)).toFixed(1);
  const freeMemGB = (os.freemem() / (1024 ** 3)).toFixed(1);
  log.value('总内存', totalMemGB + ' GB' + (totalMem < 2 * 1024 ** 3 ? ' (偏低)' : ''), totalMem >= 2 * 1024 ** 3);
  log.value('可用内存', freeMemGB + ' GB', parseFloat(freeMemGB) >= 0.5);

  // 磁盘
  try {
    let diskInfo;
    if (os.platform() === 'win32') {
      const drive = path.parse(__dirname).root;
      try {
        const result = execSync(`wmic logicaldisk where "DeviceID='${drive.replace('\\', '')}'" get Size,FreeSpace /format:csv`, { encoding: 'utf-8', timeout: 5000 });
        const lines = result.trim().split('\n');
        if (lines.length >= 2) {
          const parts = lines[1].split(',');
          const free = parseInt(parts[1], 10);
          const total = parseInt(parts[2], 10);
          diskInfo = { freeGB: (free / (1024 ** 3)).toFixed(1), totalGB: (total / (1024 ** 3)).toFixed(1) };
        }
      } catch {}
    }

    if (diskInfo) {
      log.value('磁盘总量', diskInfo.totalGB + ' GB', parseFloat(diskInfo.totalGB) >= 20);
      log.value('磁盘可用', diskInfo.freeGB + ' GB', parseFloat(diskInfo.freeGB) >= 5);
    } else {
      log.value('磁盘', '无法检测，请确保至少有 20GB 可用空间', null);
      record(null);
    }
  } catch {
    log.value('磁盘', '无法检测', null);
    record(null);
  }

  // 主机名
  log.value('主机名', os.hostname(), true);

  // 系统运行时间
  const uptimeDays = (os.uptime() / 86400).toFixed(1);
  log.value('系统运行时间', uptimeDays + ' 天', true);
}

// ====== 主函数 ======
async function main() {
  console.log(`
${colors.bright}${colors.cyan}╔══════════════════════════════════════════════════════╗
║       virtual-world 环境检测脚本 v1.0.0              ║
║       Copyright © 2026 济宁米多信息科技有限公司       ║
╚══════════════════════════════════════════════════════╝${colors.reset}
`);

  log.info(`项目目录: ${__dirname}`);
  log.info(`检测时间: ${new Date().toLocaleString('zh-CN')}`);
  log.info(`操作系统: ${os.platform()} ${os.arch()}`);

  // 执行所有检测
  checkNodeJS();
  checkPostgreSQL();
  await checkDatabaseConnection();
  checkProjectFiles();
  checkNpmDependencies();
  checkEnvironmentVariables();
  checkPorts();
  checkDirectoryPermissions();
  checkSystemResources();

  // ====== 总结 ======
  log.section('检测总结');

  const total = passCount + failCount + warnCount;
  console.log(`\n  通过: ${colors.green}${passCount}${colors.reset} 项`);
  console.log(`  警告: ${colors.yellow}${warnCount}${colors.reset} 项`);
  console.log(`  失败: ${colors.red}${failCount}${colors.reset} 项`);

  console.log('');

  if (failCount === 0) {
    console.log(`  ${colors.green}${colors.bright}🎉 所有检测通过！当前设备可以运行 virtual-world 项目。${colors.reset}`);
    console.log('');
    console.log(`  ${colors.bright}启动命令:${colors.reset}`);
    console.log(`    ${colors.cyan}npm start${colors.reset}`);
    console.log('');
    console.log(`  ${colors.bright}启动后访问:${colors.reset}`);
    console.log(`    用户端: http://localhost:3002/`);
    console.log(`    管理后台: http://localhost:3002/admin_login.html`);
    console.log('');
  } else if (failCount <= 3) {
    console.log(`  ${colors.yellow}${colors.bright}⚠ 有 ${failCount} 项未通过，修复后可运行。${colors.reset}`);
    console.log('');
    console.log(`  请根据上述 ╳ 标记项进行修复，然后重新运行检测。`);
  } else {
    console.log(`  ${colors.red}${colors.bright}✗ 有 ${failCount} 项未通过，当前设备不满足运行条件。${colors.reset}`);
    console.log('');
    console.log(`  请根据上述 ╳ 标记项逐一修复：`);
    console.log(`  1. 安装 Node.js 18+ (https://nodejs.org)`);
    console.log(`  2. 安装 PostgreSQL 14+ (https://www.postgresql.org/download/)`);
    console.log(`  3. 配置 .env 文件中的数据库连接信息`);
    console.log(`  4. 运行 npm install 安装项目依赖`);
    console.log(`  5. 重新运行 node check-env.js 验证`);
  }
}

main().catch((err) => {
  console.error(`${colors.red}检测脚本异常:${colors.reset}`, err.message);
  process.exit(1);
});
