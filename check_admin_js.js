// 临时校验脚本：提取 admin.html 内联 <script> 并做语法检查（跳过 importmap 与外部 src）
const fs = require('fs');
const html = fs.readFileSync('public/admin.html', 'utf8');
const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
let m, idx = 0, errors = 0;
while ((m = re.exec(html)) !== null) {
  idx++;
  const attrs = m[1] || '';
  const code = m[2] || '';
  if (/\bsrc\s*=/.test(attrs)) continue;            // 外部文件跳过
  if (/type\s*=\s*["']importmap["']/i.test(attrs)) continue; // importmap 跳过
  if (!code.trim()) continue;
  try {
    new Function(code);
  } catch (e) {
    errors++;
    console.log(`[SCRIPT #${idx}] SYNTAX ERROR: ${e.message}`);
    const lines = code.split('\n');
    console.log('  line count:', lines.length);
  }
}
console.log(errors === 0 ? `OK: all ${idx} inline scripts pass syntax check` : `FAILED: ${errors} script(s) with errors`);
process.exit(errors === 0 ? 0 : 1);
