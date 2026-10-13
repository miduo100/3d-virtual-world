'use strict';
/**
 * scan_part_geometry.js v2 —— 扫描全库零件真实 GLB 几何，与数据库 grid/bbox 对比
 *   v2 修正：只聚合 mesh.primitives 的 POSITION accessor（不再混入 UV 等），
 *            并计入 node.scale；带 rotation/非均匀 scale/matrix 的标注 needsPrecise。
 * 用法：node scripts/scan_part_geometry.js [--apply]
 */
const fs = require('fs');
const path = require('path');
const { query } = require('../src/database/db');
const PUB = path.join(__dirname, '..', 'public');
const APPLY = process.argv.indexOf('--apply') >= 0;

function quatToMat3(q) {
  const [x, y, z, w] = q;
  const m = [
    [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
    [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
    [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
  ];
  return m;
}
function mat4FromTRS(t, r, s) {
  const R = quatToMat3(r || [0, 0, 0, 1]);
  const out = [];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) out.push(R[i][j] * s[j]);
  }
  out.push(t[0], t[1], t[2], 1);
  return out;
}
function applyMat(m, v) {
  return [
    m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12],
    m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13],
    m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14],
  ];
}

function glbBBox(p) {
  let buf;
  try { buf = fs.readFileSync(p); } catch (e) { return { err: 'read:' + (e.code || 'e') }; }
  if (buf.length < 20 || buf.slice(0, 4).toString() !== 'glTF') return { err: 'not-glb' };
  let j;
  try { j = JSON.parse(buf.slice(20, 20 + buf.readUInt32LE(12)).toString('utf8')); } catch (e) { return { err: 'json' }; }
  const meshes = j.meshes || [], accs = j.accessors || [], nodes = j.nodes || [];
  if (!meshes.length || !accs.length) return { err: 'no-mesh' };

  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  let used = 0, needsPrecise = false, maxScale = 0;

  for (let ni = 0; ni < nodes.length; ni++) {
    const nd = nodes[ni];
    if (nd.mesh === undefined) continue;
    const mesh = meshes[nd.mesh];
    if (!mesh || !mesh.primitives) continue;
    const sc = nd.scale || [1, 1, 1];
    maxScale = Math.max(maxScale, sc[0], sc[1], sc[2]);
    const trs = nd.matrix ? { matrix: nd.matrix }
      : (nd.rotation && nd.rotation.some(function (v) { return !!v; })
        ? { m: mat4FromTRS(nd.translation || [0, 0, 0], nd.rotation, sc) }
        : { s: sc, t: nd.translation || [0, 0, 0] });
    for (const prim of mesh.primitives) {
      const ai = prim.attributes && prim.attributes.POSITION;
      if (ai === undefined) continue;
      const a = accs[ai];
      if (!a || !a.min || !a.max || a.min.length !== 3 || a.max.length !== 3) continue;
      const fin = [a.min[0], a.min[1], a.min[2], a.max[0], a.max[1], a.max[2]]
        .every(function (x) { return typeof x === 'number' && isFinite(x); });
      if (!fin) continue;
      // 取包围盒 8 角点，做同样的缩放/平移/旋转
      for (let c = 0; c < 8; c++) {
        const v = [
          (c & 1) ? a.max[0] : a.min[0],
          (c & 2) ? a.max[1] : a.min[1],
          (c & 4) ? a.max[2] : a.min[2],
        ];
        let w;
        if (trs.matrix) { w = applyMat(trs.matrix, v); needsPrecise = true; }
        else if (trs.m) { w = applyMat(trs.m, v); }
        else { w = [v[0] * trs.s[0] + trs.t[0], v[1] * trs.s[1] + trs.t[1], v[2] * trs.s[2] + trs.t[2]]; }
        for (let k = 0; k < 3; k++) { if (w[k] < mn[k]) mn[k] = w[k]; if (w[k] > mx[k]) mx[k] = w[k]; }
      }
      used++;
    }
  }
  if (!used) return { err: 'no-pos' };
  for (let k = 0; k < 3; k++) if (!isFinite(mn[k]) || !isFinite(mx[k])) return { err: 'bad-minmax' };
  if (mx[0] - mn[0] <= 0 || mx[1] - mn[1] <= 0 || mx[2] - mn[2] <= 0) return { err: 'degenerate' };
  // 非均匀缩放会破坏"轴对齐盒=真实尺寸"，标出来供人工复核
  if (nodes.some(function (nd) {
    const s = nd.scale || [1, 1, 1];
    return Math.abs(s[0] - s[1]) > 1e-6 || Math.abs(s[0] - s[2]) > 1e-6;
  })) needsPrecise = true;

  return {
    w: +(mx[0] - mn[0]).toFixed(4), h: +(mx[1] - mn[1]).toFixed(4), d: +(mx[2] - mn[2]).toFixed(4),
    minX: +mn[0].toFixed(4), minY: +mn[1].toFixed(4), minZ: +mn[2].toFixed(4),
    maxScale: +maxScale.toFixed(4), needsPrecise: needsPrecise,
  };
}

function rel(a, b) { return Math.max(a, b) < 1e-9 ? 0 : Math.abs(a - b) / Math.max(a, b); }
async function main() {
  const rows = (await query(
    'SELECT i.id, i.part_key, i.part_role, i.grid_w, i.grid_h, i.grid_d, u.path, u.file_type, l.pack_key '
    + 'FROM part_library_items i '
    + 'JOIN part_libraries l ON l.id = i.library_id '
    + 'JOIN uploaded_models u ON u.id = i.model_id '
    + "WHERE l.status = 'active' AND l.deleted_at IS NULL"
  )).rows;
  console.log('扫描 ' + rows.length + ' 件（active 库）');

  const out = [];
  const errs = {};
  const byType = {};
  let needs = 0;
  let idx = 0;
  async function worker() {
    while (idx < rows.length) {
      const r = rows[idx++];
      const p = path.join(PUB, String(r.path).replace(/^\//, ''));
      const b = glbBBox(p);
      if (b.err) {
        errs[b.err] = (errs[b.err] || 0) + 1;
        const t = String(r.file_type || path.extname(String(r.path)).slice(1));
        byType[t] = (byType[t] || 0) + 1;
        out.push({ id: r.id, key: r.part_key, role: r.part_role, err: b.err, ftype: t });
        continue;
      }
      if (b.needsPrecise) needs++;
      out.push({
        id: r.id, key: r.part_key, role: r.part_role, pack: r.pack_key,
        db: [+r.grid_w || 0, +r.grid_h || 0, +r.grid_d || 0],
        real: [b.w, b.h, b.d], min: [b.minX, b.minY, b.minZ],
        scale: b.maxScale, precise: b.needsPrecise,
      });
    }
  }
  await Promise.all(new Array(24).fill(0).map(worker));

  const ok = out.filter(function (o) { return !o.err; });
  console.log('成功 ' + ok.length + ' / 失败 ' + (out.length - ok.length) + ' ' + JSON.stringify(errs));
  console.log('失败件的文件类型分布：' + JSON.stringify(byType));
  console.log('需人工复核（node matrix / 非均匀 scale）：' + needs + ' 件');

  const diffs = [];
  for (const o of ok) {
    const worst = Math.max(rel(o.db[0], o.real[0]), rel(o.db[1], o.real[1]), rel(o.db[2], o.real[2]));
    if (worst > 0.05) diffs.push({ o: o, worst: worst });
  }
  console.log('');
  console.log('=== grid vs 真实几何差异 >5%：' + diffs.length + ' / ' + ok.length
    + '（' + (100 * diffs.length / ok.length).toFixed(1) + '%）===');

  const byRole = {};
  for (const d of diffs) { const k = d.o.role || '?'; (byRole[k] = byRole[k] || []).push(d); }
  Object.keys(byRole).sort(function (a, b) { return byRole[b].length - byRole[a].length; }).slice(0, 10)
    .forEach(function (k) { console.log('   ' + k.padEnd(10) + String(byRole[k].length).padStart(5) + ' 件'); });

  console.log('');
  console.log('差异最大 10 件：');
  diffs.slice().sort(function (a, b) { return b.worst - a.worst; }).slice(0, 10).forEach(function (d) {
    console.log('   ' + d.o.key.slice(0, 30).padEnd(32)
      + ' db ' + d.o.db.map(function (v) { return v.toFixed(2); }).join('x').padEnd(17)
      + ' real ' + d.o.real.map(function (v) { return v.toFixed(2); }).join('x')
      + ' scale=' + d.o.scale);
  });

  console.log('');
  console.log('建筑类各 role 一例：');
  const seen = {};
  for (const d of diffs.slice().sort(function (a, b) { return b.worst - a.worst; })) {
    const r = d.o.role;
    if (['wall', 'window', 'door', 'roof', 'column', 'cornice'].indexOf(r) < 0) continue;
    if (seen[r]) continue;
    seen[r] = 1;
    console.log('   ' + String(r).padEnd(8) + d.o.key.padEnd(30)
      + ' db ' + d.o.db.map(function (v) { return v.toFixed(2); }).join('x').padEnd(17)
      + ' real ' + d.o.real.map(function (v) { return v.toFixed(2); }).join('x'));
  }

  const cache = path.join(__dirname, '..', '.cache_part_geometry.json');
  fs.writeFileSync(cache, JSON.stringify({ scannedAt: new Date().toISOString(), items: out }));
  console.log('');
  console.log('缓存：' + cache);
  if (!APPLY) { console.log('（只读，未写库）'); return 0; }
  return applyFix(ok);
}

async function applyFix(ok) {
  console.log('');
  console.log('=== 写库：修正 grid + metadata.bbox（只改差异>5% 且非 needsPrecise）===');
  const stamp = new Date().toISOString();
  const targets = ok.filter(function (o) {
    return (rel(o.db[0], o.real[0]) > 0.05 || rel(o.db[1], o.real[1]) > 0.05 || rel(o.db[2], o.real[2]) > 0.05)
      && !o.precise;
  });
  const skipped = ok.filter(function (o) {
    return (rel(o.db[0], o.real[0]) > 0.05 || rel(o.db[1], o.real[1]) > 0.05 || rel(o.db[2], o.real[2]) > 0.05)
      && o.precise;
  });
  console.log('可自动修正 ' + targets.length + ' 件 / 需人工 ' + skipped.length + ' 件');
  let n = 0;
  for (const o of targets) {
    const bbox = { w: o.real[0], h: o.real[1], d: o.real[2], geomVerifiedAt: stamp, geomSource: 'glb_position_accessor_v2' };
    await query(
      'UPDATE part_library_items SET grid_w = $1, grid_h = $2, grid_d = $3, '
      + 'metadata = jsonb_set(coalesce(metadata, \'{}\'::jsonb), \'{bbox}\', $4::jsonb) WHERE id = $5',
      [o.real[0], o.real[1], o.real[2], JSON.stringify(bbox), o.id]
    );
    n++;
    if (n % 300 === 0) process.stdout.write('  ' + n + '/' + targets.length + '\n');
  }
  console.log('完成，修正 ' + n + ' 件');
  return 0;
}

main().then(function (c) { process.exit(c || 0); }).catch(function (e) {
  console.error('ERR', (e && e.stack) || e);
  process.exit(1);
});