/* 批量减面 26 个红军模型：gltfpack -si 0.15，输出 _dec.glb 新文件，原文件备份 */
const fs = require('fs');
const path = require('path');
const gltfpack = require('../node_modules/gltfpack/library.js');

const UPLOAD_DIR = path.join(__dirname, '..', 'public', 'models', 'uploaded');
const BACKUP_DIR = path.join(UPLOAD_DIR, '_backup_decimate_before');
const SIMPLIFY_RATIO = '0.15'; // 保留 15% 三角面

async function main() {
  // 收集红军 26 个模型文件（1787128xxx/1787129xxx 前缀，排除已减面 _dec）
  const all = fs.readdirSync(UPLOAD_DIR).filter(f => /^model-178712[89]\d{6}-/.test(f) && f.endsWith('.glb') && !f.includes('_dec'));
  if (!all.length) { console.log('NO red army models found'); return; }

  // 备份
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const files = [];
  for (const f of all) {
    const src = path.join(UPLOAD_DIR, f);
    const dst = path.join(UPLOAD_DIR, f.replace(/\.glb$/, '_dec.glb'));
    if (fs.existsSync(dst)) {
      console.log(`SKIP (already decimated): ${f}`);
      continue;
    }
    fs.copyFileSync(src, path.join(BACKUP_DIR, f));
    files.push({ f, src, dst });
  }
  console.log(`Backed up ${files.length} files to ${BACKUP_DIR}`);

  // 逐个减面
  let totalBefore = 0, totalAfter = 0;
  for (let i = 0; i < files.length; i++) {
    const { f, src, dst } = files[i];
    const before = countTris(src);
    totalBefore += before;
    try {
      const log = await pack(src, dst, SIMPLIFY_RATIO);
      const after = countTris(dst);
      totalAfter += after;
      console.log(`[${i + 1}/${files.length}] ${f}: ${before} -> ${after} tris (${((after / before) * 100).toFixed(1)}%) size ${(fs.statSync(src).size / 1048576).toFixed(1)}MB -> ${(fs.statSync(dst).size / 1048576).toFixed(1)}MB`);
      if (after > before * 0.3) console.log(`  WARN: reduction less than 70%, log: ${log}`);
    } catch (e) {
      console.error(`FAIL ${f}: ${e.message}`);
    }
  }
  console.log(`\nDONE. Total tris: ${totalBefore} -> ${totalAfter} (-${(100 - totalAfter / totalBefore * 100).toFixed(1)}%)`);
}

function countTris(p) {
  const buf = fs.readFileSync(p);
  if (buf.readUInt32LE(0) !== 0x46546c67) return 0;
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.slice(20, 20 + jsonLen).toString('utf8'));
  let total = 0;
  (json.meshes || []).forEach((m) => {
    m.primitives.forEach((p2) => {
      const pi = p2.attributes.POSITION;
      if (pi !== undefined) total += Math.floor(json.accessors[pi].count / 3);
    });
  });
  return total;
}

function pack(src, dst, ratio) {
  const interface = {
    read: (p) => fs.readFileSync(p),
    write: (p, d) => fs.writeFileSync(p, d),
  };
  return gltfpack.pack(['-i', src, '-o', dst, '-si', ratio, '-kn', '-km'], interface);
}

main().catch(e => { console.error(e); process.exit(1); });
