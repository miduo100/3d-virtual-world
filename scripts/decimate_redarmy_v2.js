/**
 * 红军模型二次减面 v2（2026-09-09）：集群区 612 实例 × 7.5 万面 = 45.9M tris/帧 GPU 瓶颈。
 * 对集群引用的 _dec.glb 再跑 gltfpack -si 0.3（→ ~2.2 万面/个，总 tris ~13.8M）。
 * 同路径替换（无 SQL 改动），原文件备份到 _backup_decimate_v2/，回退 = 复制回去。
 *
 * 注意：gltfpack 量化后 POSITION accessor count/3 会低估面数，必须用 indices count/3 统计。
 *
 * 用法：node scripts/decimate_redarmy_v2.js [--ratio 0.3]
 * 回退：node -e "..." 把 _backup_decimate_v2/ 下的文件复制回 public/models/uploaded/
 */
const fs = require('fs');
const path = require('path');
const gltfpack = require('../node_modules/gltfpack/library.js');

const UPLOAD_DIR = path.join(__dirname, '..', 'public', 'models', 'uploaded');
const BACKUP_DIR = path.join(UPLOAD_DIR, '_backup_decimate_v2');
const CLUSTER = { x: -273.7, z: -1056.9, r: 300 };
const RATIO = (process.argv.includes('--ratio') ? process.argv[process.argv.indexOf('--ratio') + 1] : '0.3');

async function main() {
  const res = await fetch('http://localhost:3002/api/world/objects').then(r => r.json());
  const l = res.objects || res.data || res;
  const arr = Array.isArray(l) ? l : [];
  const rows = arr.filter(o => {
    const dx = (o.position_x || 0) - CLUSTER.x, dz = (o.position_z || 0) - CLUSTER.z;
    return dx * dx + dz * dz < CLUSTER.r * CLUSTER.r && /_dec\.glb$/i.test(String(o.model_path || ''));
  });
  const files = [...new Set(rows.map(o => o.model_path.replace(/^.*\//, '')))];
  console.log(`cluster rows=${rows.length}  distinct files=${files.length}  ratio=${RATIO}`);
  if (!files.length) { console.log('NOTHING TO DO'); return; }

  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

  let tb = 0, ta = 0, ok = 0, fail = 0;
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const src = path.join(UPLOAD_DIR, f);
    if (!fs.existsSync(src)) { console.log(`[${i + 1}] SKIP missing: ${f}`); fail++; continue; }
    const before = countTris(src);
    const sizeBefore = fs.statSync(src).size;
    const bak = path.join(BACKUP_DIR, f);
    if (!fs.existsSync(bak)) fs.copyFileSync(src, bak);
    const tmp = src + '.tmp.glb';
    try {
      await pack(src, tmp, RATIO);
      const after = countTris(tmp);
      fs.renameSync(tmp, src);
      const sizeAfter = fs.statSync(src).size;
      tb += before; ta += after; ok++;
      console.log(`[${i + 1}/${files.length}] ${f}: ${before} -> ${after} tris (${(after / before * 100).toFixed(1)}%)  ${(sizeBefore / 1048576).toFixed(1)}MB -> ${(sizeAfter / 1048576).toFixed(1)}MB`);
      if (after > before * 0.5) console.log(`  WARN: reduction <50%`);
    } catch (e) {
      console.error(`[${i + 1}] FAIL ${f}: ${e.message}`);
      try { fs.existsSync(tmp) && fs.unlinkSync(tmp); } catch (e2) {}
      fail++;
    }
  }
  console.log(`\nDONE ok=${ok} fail=${fail}  total tris: ${tb} -> ${ta} (${(ta / Math.max(1, tb) * 100).toFixed(1)}%)`);
  console.log(`集群总量估算: 612 实例 x 平均 -> ${(ta / Math.max(1, ok) * 612 / 1e6).toFixed(1)}M tris/frame`);
  console.log(`回退: 把 ${BACKUP_DIR} 下的文件复制回 ${UPLOAD_DIR} 即可`);
}

function countTris(p) {
  const buf = fs.readFileSync(p);
  if (buf.readUInt32LE(0) !== 0x46546c67) return 0;
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.slice(20, 20 + jsonLen).toString('utf8'));
  let total = 0;
  (json.meshes || []).forEach((m) => {
    m.primitives.forEach((p2) => {
      if (p2.indices !== undefined) {
        total += Math.floor(json.accessors[p2.indices].count / 3);
      } else if (p2.attributes.POSITION !== undefined) {
        total += Math.floor(json.accessors[p2.attributes.POSITION].count / 3);
      }
    });
  });
  return total;
}

function pack(src, dst, ratio) {
  const intf = {
    read: (p) => fs.readFileSync(p),
    write: (p, d) => fs.writeFileSync(p, d),
  };
  return gltfpack.pack(['-i', src, '-o', dst, '-si', ratio, '-kn', '-km'], intf);
}

main().catch(e => { console.error(e); process.exit(1); });
