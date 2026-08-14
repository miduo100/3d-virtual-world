// 临时脚本：扫描 3DGS JS 代码区残留中文（仅 JS 字符串区域，含中文的行）
const fs = require('fs');
const lines = fs.readFileSync('public/admin.html', 'utf8').split('\n');
const re = /[\u4e00-\u9fff]/;
for (let i = 8689; i < Math.min(9120, lines.length); i++) {
  const line = lines[i];
  if (re.test(line)) {
    console.log((i + 1) + ': ' + line.trim());
  }
}
