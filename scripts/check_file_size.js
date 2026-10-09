#!/usr/bin/env node
/**
 * check_file_size.js —— §K 文件边界自检工具（AI World Brain · Phase 2a · 队列项 2a-2）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 用途（主文档 §K.1 / §K.7）：
 *   ① 目标文件是不是"大文件"（决定改动上限：>500 行只允许 ≤3 行接线）；
 *   ② 本次改动里大文件的**净增行数**（git diff --numstat）；
 *   ③ 越界即退出码 1（可挂进验收脚本）。
 *
 * 用法：
 *   node scripts/check_file_size.js                    # 列出 ≥500 行的文件
 *   node scripts/check_file_size.js --min 400          # 换阈值
 *   node scripts/check_file_size.js --diff             # 只看 git 已改文件的净增行
 *   node scripts/check_file_size.js --diff --fail      # 越界退出码 1（可挂验收）
 *   node scripts/check_file_size.js --diff --allow 5   # 放宽"接线行"上限（默认 3）
 *   node scripts/check_file_size.js --json             # 机器可读
 *   node scripts/check_file_size.js --write-doc        # 重写主文档 §K.2 表格
 *
 * 规则（§K.1）：
 *   - 新建文件 ≤ min 行（理想 ≤300）；超了必须拆模块。
 *   - 已存在且 ≥ min 行的文件：净增 > allow 行 = 越界（--fail 时报错）。
 *   - 同名文件必须带路径（src/routes/admin.js 与 public/js/admin.js 是两个文件）。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SCAN_ROOTS = ['src', 'public/js'];   // 递归扫 .js
const HTML_ROOT = 'public';               // 只看顶层 .html（admin.html /各编辑器页，体积最大的那批）
const TRACKED_EXT = /\.(js|html)$/;
const SKIP_DIR = /^(node_modules|\.git|_backup[^\\/]*|dist|build|coverage)$/;
const DOC = path.join(ROOT, 'AI-World-Brain-架构审查与改造方案.md');
const MARK_START = '<!-- FILE_SIZE_TABLE_START -->';
const MARK_END = '<!-- FILE_SIZE_TABLE_END -->';
const DEFAULT_MIN = 500;
const DEFAULT_ALLOW = 3;
const DOC_ROW_LIMIT = 30;

// ─────────────────────────── 参数解析 ───────────────────────────
function parseArgs(argv) {
  const out = { min: DEFAULT_MIN, allow: DEFAULT_ALLOW, json: false, diff: false, fail: false, writeDoc: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--min') out.min = Number(argv[++i]) || DEFAULT_MIN;
    else if (a === '--allow') out.allow = Number(argv[++i]);
    else if (a === '--json') out.json = true;
    else if (a === '--diff') out.diff = true;
    else if (a === '--fail') out.fail = true;
    else if (a === '--write-doc') out.writeDoc = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else if (a.startsWith('--min=')) out.min = Number(a.slice(6)) || DEFAULT_MIN;
    else if (a.startsWith('--allow=')) out.allow = Number(a.slice(8));
  }
  return out;
}

// ─────────────────────────── 扫描 ───────────────────────────
function walk(dir, acc) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return acc; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIR.test(e.name)) continue;
      // public/js/lib 是第三方 vendor（three.min.js / postprocessing 等），不是我们的业务代码
      if (e.name === 'lib' && full.replace(/\\/g, '/').includes('/public/js/')) continue;
      walk(full, acc);
    } else if (e.isFile() && e.name.endsWith('.js')) {
      acc.push(full);
    }
  }
  return acc;
}

/** 行数口径：末尾换行不额外计一行 */
function countLines(file) {
  const s = fs.readFileSync(file, 'utf8');
  if (!s) return 0;
  const n = s.split(/\r?\n/).length;
  return s.endsWith('\n') ? n - 1 : n;
}

function scanAll() {
  const files = [];
  for (const r of SCAN_ROOTS) walk(path.join(ROOT, r), files);
  // public 顶层 HTML（admin.html 等）：只取一层，编辑器页/世界页才是 §K.1 的重点对象
  try {
    for (const e of fs.readdirSync(path.join(ROOT, HTML_ROOT), { withFileTypes: true })) {
      if (e.isFile() && e.name.endsWith('.html')) files.push(path.join(ROOT, HTML_ROOT, e.name));
    }
  } catch (err) { /* public 不存在 */ }
  return files
    .map((f) => ({ rel: path.relative(ROOT, f).replace(/\\/g, '/'), lines: countLines(f) }))
    .sort((a, b) => b.lines - a.lines);
}

// ─────────────────────────── git 净增 ───────────────────────────
function gitNumstat() {
  let txt = '';
  try {
    txt = execFileSync('git', ['diff', '--numstat', 'HEAD'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  } catch (e) {
    try { txt = execFileSync('git', ['diff', '--numstat'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }); }
    catch (e2) { txt = ''; }
  }
  const out = [];
  const seen = new Set();
  for (const line of String(txt).split(/\r?\n/)) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    const added = parts[0] === '-' ? 0 : Number(parts[0]) || 0;
    const deleted = parts[1] === '-' ? 0 : Number(parts[1]) || 0;
    const rel = parts.slice(2).join('\t').replace(/\\/g, '/');
    if (seen.has(rel)) continue;
    seen.add(rel);
    out.push({ rel, added, deleted, net: added - deleted });
  }
  // ★ 未跟踪的新文件 git diff 看不到，必须单独并进来（否则新建大文件会漏检）
  let untracked = '';
  try {
    untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  } catch (e) { untracked = ''; }
  for (const line of String(untracked).split(/\r?\n/)) {
    const rel = line.trim().replace(/\\/g, '/');
    if (!rel || seen.has(rel)) continue;
    seen.add(rel);
    out.push({ rel, added: 0, deleted: 0, net: 0, untracked: true });
  }
  return out;
}

function existedBefore(rel) {
  try {
    execFileSync('git', ['cat-file', '-e', 'HEAD:' + rel], { cwd: ROOT, stdio: 'ignore' });
    return true;
  } catch (e) { return false; }
}

// ─────────────────────────── 报告 ───────────────────────────
function evaluateDiff(opts, all) {
  const byRel = new Map(all.map(x => [x.rel, x.lines]));
  const changes = gitNumstat();
  const rowsOut = [];
  const violations = [];
  for (const c of changes) {
    if (!TRACKED_EXT.test(c.rel)) continue;
    if (!c.rel.startsWith('src/') && !c.rel.startsWith('public/')) continue;
    const current = byRel.has(c.rel) ? byRel.get(c.rel) : null;
    const isNew = !existedBefore(c.rel);
    const added = c.untracked && current != null ? current : c.added;
    const net = c.untracked && current != null ? current : c.net;
    let verdict = 'ok';
    if (isNew) {
      if (current != null && current > opts.min) verdict = 'violation';
    } else if (current != null && current >= opts.min) {
      if (net > opts.allow) verdict = 'violation';
    } else if (net > 300) {
      verdict = 'warn'; // 既有但 <min 的文件净增很大：提醒拆分
    }
    const row = { file: c.rel, added, deleted: c.deleted, net, currentLines: current, isNew, verdict };
    rowsOut.push(row);
    if (verdict === 'violation') violations.push(row);
  }
  rowsOut.sort((a, b) => b.net - a.net);
  return { rows: rowsOut, violations };
}

function printHuman(opts, all, diffResult) {
  if (opts.diff) {
    if (!diffResult.rows.length) { console.log('（git 没有已跟踪的 JS 改动）'); return; }
    console.log(`净增行数检查（新文件 ≤ ${opts.min} 行；已存在且 ≥${opts.min} 行的文件净增 ≤ ${opts.allow} 行）\n`);
    for (const r of diffResult.rows) {
      const tag = r.verdict === 'violation' ? 'X 越界' : (r.verdict === 'warn' ? '! 偏大  ' : (r.isNew ? '+ 新文件' : 'ok      '));
      console.log(`  ${tag}  ${r.file}  净增 ${r.net >= 0 ? '+' : ''}${r.net}（+${r.added}/-${r.deleted}）  当前 ${r.currentLines == null ? '?' : r.currentLines} 行`);
    }
    if (diffResult.violations.length) {
      console.log(`\nX ${diffResult.violations.length} 个文件越界（§K.1：>=${opts.min} 行的既有文件只允许 <=${opts.allow} 行接线；新功能另建模块）`);
    } else {
      console.log('\n✓ 无越界');
    }
    return;
  }
  const big = all.filter(x => x.lines >= opts.min);
  console.log(`≥ ${opts.min} 行的文件：${big.length} 个 / 共扫描 ${all.length} 个文件（src 与 public/js 的 .js + public 顶层 .html）\n`);
  for (const x of big) console.log(`  ${String(x.lines).padStart(6)}  ${x.rel}`);
  console.log(`\n（改动前自检：node scripts/check_file_size.js --min ${opts.min} --diff）`);
}

// ─────────────────────────── §K.2 文档表格 ───────────────────────────
function readDocAllowances() {
  const map = new Map();
  if (!fs.existsSync(DOC)) return map;
  const s = fs.readFileSync(DOC, 'utf8');
  for (const line of s.split(/\r?\n/)) {
    const m = line.match(/^\|\s*\**\d+\**\s*\|\s*`([^`]+)`\s*\|\s*(.+?)\s*\|$/);
    if (m) map.set(m[1], m[2]);
  }
  return map;
}

function writeDocTable(opts, all) {
  if (!fs.existsSync(DOC)) { console.error('X 找不到主文档：' + DOC + '（--write-doc 跳过）'); return false; }
  const src = fs.readFileSync(DOC, 'utf8');
  const i = src.indexOf(MARK_START), j = src.indexOf(MARK_END);
  if (i < 0 || j < 0 || j < i) { console.error('X 主文档里找不到 §K.2 的标记对（--write-doc 跳过，不手工猜位置）'); return false; }
  const allow = readDocAllowances();
  const big = all.filter(x => x.lines >= opts.min).slice(0, DOC_ROW_LIMIT);
  const lines = ['', '| 行数 | 文件 | 本期允许的改动 |', '|---:|---|---|'];
  for (const x of big) {
    const a = allow.get(x.rel);
    lines.push(`| ${x.lines} | \`${x.rel}\` | ${a || '（按 §K.1：≤3 行接线；新功能另建模块）'} |`);
  }
  lines.push('');
  const next = src.slice(0, i + MARK_START.length) + '\n' + lines.join('\n') + '\n' + src.slice(j);
  fs.writeFileSync(DOC, next, 'utf8');
  console.log(`✓ 已重写 §K.2 表格（${big.length} 行，按行数降序取前 ${DOC_ROW_LIMIT}；全量用 --json）`);
  return true;
}

// ─────────────────────────── main ───────────────────────────
function main() {
  const opts = parseArgs(process.argv.slice(2));
  const all = scanAll();
  const diffResult = opts.diff ? evaluateDiff(opts, all) : null;

  if (opts.writeDoc) writeDocTable(opts, all);

  if (opts.json) {
    console.log(JSON.stringify({
      min: opts.min, allow: opts.allow,
      scanned: all.length,
      big: all.filter(x => x.lines >= opts.min),
      diff: diffResult,
    }, null, 2));
  } else {
    printHuman(opts, all, diffResult);
  }

  if (opts.fail && diffResult && diffResult.violations.length) return 1;
  return 0;
}

process.exit(main());