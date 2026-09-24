/**
 * audit_threejs_issues.js — Three.js 代码批量体检（问题知识库命令行入口）
 *
 * 用途：网上收集的代码入库前先跑一遍，自动识别"已知问题类型"并给出处置建议。
 *   问题库越大，命中率越高；未命中的新问题按 threejsIssueRegistry.js 的模板登记后永久生效。
 *
 * 用法：
 *   node scripts/audit_threejs_issues.js [目录或文件] [--json] [--quiet]
 *   默认目录：L:\shegnjir185\网上找的代码
 *
 * 退出码：0 = 无致命问题；1 = 存在 fatal 级问题（必须人工处理）
 */
const fs = require('fs');
const path = require('path');
const Normalizer = require('../public/js/threejsCodeNormalizer.js');
const Registry = require('../public/js/threejsIssueRegistry.js');

const DEFAULT_DIR = 'L:/shegnjir185/网上找的代码';
const args = process.argv.slice(2);
const jsonMode = args.indexOf('--json') >= 0;
const quiet = args.indexOf('--quiet') >= 0;
const configIdx = args.indexOf('--config');
const configPath = configIdx >= 0 ? args[configIdx + 1] : null;
const apiIdx = args.indexOf('--api');
const apiBase = apiIdx >= 0 ? args[apiIdx + 1] : (process.env.AUDIT_BASE || 'http://localhost:3002');
const skipConfig = args.indexOf('--no-config') >= 0;
const target = args.filter((a, i) => a.indexOf('--') !== 0 && args[i - 1] !== '--config' && args[i - 1] !== '--api')[0] || DEFAULT_DIR;

const ICON = { 'auto-fix': '🔧', warn: '⚠️', fatal: '🚫', delegated: 'ℹ️' };

function extractCode(file, text) {
  if (!/\.html?$/i.test(file)) return text;
  // 优先取 type="module" 的内联脚本；否则拼接所有无 src 的内联脚本
  const mods = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    const attrs = m[1] || '';
    if (/\bsrc\s*=/i.test(attrs)) continue;
    if (/type\s*=\s*["']module["']/i.test(attrs) || !/type\s*=/i.test(attrs)) mods.push(m[2]);
  }
  return mods.join('\n;\n') || text;
}

function collectFiles(p) {
  const st = fs.statSync(p);
  if (st.isFile()) return [p];
  return fs.readdirSync(p)
    .filter((f) => /\.(html?|js|mjs)$/i.test(f))
    .map((f) => path.join(p, f));
}

// 词条配置：--config 文件 > 后台 API（与浏览器端同源）> 内置默认
async function loadConfigForCli() {
  if (skipConfig) return { source: 'default(跳过)' };
  if (configPath) {
    try {
      const c = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      Registry.applyConfig(c);
      return { source: 'file:' + configPath };
    } catch (e) {
      console.warn('配置读取失败，改用默认值:', e.message);
      return { source: 'default(配置读取失败)' };
    }
  }
  try {
    const r = await fetch(apiBase + '/api/threejs-issues/config', { signal: AbortSignal.timeout(3000) });
    const d = await r.json();
    if (d && d.success && d.config) {
      Registry.applyConfig(d.config);
      return { source: 'api:' + apiBase, updatedAt: d.updatedAt };
    }
    return { source: 'default(后台未配置)' };
  } catch (e) {
    return { source: 'default(后台不可达)' };
  }
}

async function main() {
const cfgInfo = await loadConfigForCli();
if (!jsonMode && !quiet) console.log('词条配置: ' + cfgInfo.source + (cfgInfo.updatedAt ? '（更新于 ' + String(cfgInfo.updatedAt).slice(0, 19) + '）' : ''));

const files = collectFiles(target);
const rows = [];
let fatalCount = 0;

for (const f of files) {
  const raw = fs.readFileSync(f, 'utf8');
  const code = extractCode(f, raw);
  let normalized = code;
  try {
    normalized = Normalizer.normalize(code, { aggressive: true, stripExports: true, stripImports: true, stripTypeScript: true }).code;
  } catch (e) { /* 规范化失败则按原码体检 */ }
  const result = Registry.auditCode(normalized);
  const fatal = result.findings.filter((x) => x.action === 'fatal');
  fatalCount += fatal.length;
  rows.push({ file: path.basename(f), findings: result.findings });
  if (jsonMode || quiet) continue;
  console.log('\n=== ' + path.basename(f) + (result.findings.length ? '' : '  ✅ 未命中已知问题'));
  result.findings.forEach((x) => {
    console.log('  ' + (ICON[x.action] || '·') + ' [' + x.id + '] ' + x.title +
      (x.action === 'delegated' ? '（运行时已自动处理）' : '') +
      (x.hint ? '\n      建议: ' + x.hint : ''));
  });
}

if (jsonMode) {
  console.log(JSON.stringify({ target, registryVersion: Registry.version, stats: Registry.stats(), files: rows }, null, 2));
  process.exit(fatalCount ? 1 : 0);
}

// 汇总
const byId = {};
rows.forEach((r) => r.findings.forEach((x) => { byId[x.id] = (byId[x.id] || 0) + 1; }));
console.log('\n================ 汇总 ================');
console.log('文件: ' + files.length + ' 个 | 知识库: ' + Registry.version + '（' + Registry.stats().total + ' 条规则）');
const hit = Object.keys(byId).sort();
if (!hit.length) console.log('未命中任何已知问题。');
hit.forEach((id) => {
  const entry = Registry.get(id);
  console.log('  ' + id + ' × ' + byId[id] + '  ' + entry.title + '  [' + entry.action + ']');
});
console.log('致命项: ' + fatalCount + (fatalCount ? '（必须人工处理）' : ''));
process.exit(fatalCount ? 1 : 0);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
