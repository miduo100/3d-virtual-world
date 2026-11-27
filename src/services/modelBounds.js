/**
 * modelBounds.js — 模型「单位尺度半径」采集
 * -----------------------------------------------------------------------------
 * 背景（2026-11-26）：
 *   编辑器按「相机 → 对象原点」的直线距离决定是否加载真实模型（120m/240m）。
 *   对「原点不在中心 / 体量几十上百米」的模型（如整张赛道场景），这个距离严重失真：
 *   站在模型这一端，到对象原点可能已经 >240m → 判定「太远」→ 真实模型被换回占位盒，
 *   表现就是「远处看得到、走近反而没了」。
 *
 *   model_bounds 表（path / unit_radius）本来就是为这件事设计的，但服务端从未写入。
 *   这里补上写入侧：解析 GLB/OBJ 的包围盒，得到 scale=1 时「从对象原点到最远水平角的距离」，
 *   前端据此把「原点距离」换算成「边缘距离」。
 *
 * 约定：
 *   unit_radius = scale=1 时的水平半径（米），已包含模型自身根节点的所有变换（Blender 的 0.001 等）。
 *   实际半径 = unit_radius × 对象 scale（取 X/Z 较大者）。
 *   取「到最远水平角」而不是「包围盒半宽」，是因为对象原点常在包围盒角上，
 *   用半宽会低估，导致该加载时被判成「太远」。
 * -----------------------------------------------------------------------------
 */
const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const { query } = require('../database/db');

const PUBLIC_ROOT = path.join(__dirname, '../../public');

// ── 4x4 矩阵（column-major，与 glTF 一致）───────────────────────────────
function identity() {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

function multiply(a, b) {
  const o = new Array(16);
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      o[j * 4 + i] =
        a[i] * b[j * 4] +
        a[4 + i] * b[j * 4 + 1] +
        a[8 + i] * b[j * 4 + 2] +
        a[12 + i] * b[j * 4 + 3];
    }
  }
  return o;
}

function composeTRS(t, r, s) {
  const x = r[0], y = r[1], z = r[2], w = r[3];
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  const sx = s[0], sy = s[1], sz = s[2];
  return [
    sx * (1 - (yy + zz)), sy * (xy + wz), sz * (xz - wy), 0,
    sx * (xy - wz), sy * (1 - (xx + zz)), sz * (yz + wx), 0,
    sx * (xz + wy), sy * (yz - wx), sz * (1 - (xx + yy)), 0,
    t[0], t[1], t[2], 1,
  ];
}

function nodeMatrix(n) {
  if (Array.isArray(n.matrix) && n.matrix.length === 16) return n.matrix.slice();
  return composeTRS(
    n.translation || [0, 0, 0],
    n.rotation || [0, 0, 0, 1],
    n.scale || [1, 1, 1]
  );
}

function transformPoint(m, p) {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ];
}

function emptyBox() {
  return { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity], any: false };
}

function expand(box, p) {
  for (let i = 0; i < 3; i++) {
    if (p[i] < box.min[i]) box.min[i] = p[i];
    if (p[i] > box.max[i]) box.max[i] = p[i];
  }
  box.any = true;
}

/**
 * 由包围盒算「到最远水平角的距离」。原点在 (0,0,0)。
 */
function radiusFromBox(box) {
  if (!box.any) return 0;
  const xs = [box.min[0], box.max[0]];
  const zs = [box.min[2], box.max[2]];
  let r2 = 0;
  for (const x of xs) {
    for (const z of zs) {
      const d = x * x + z * z;
      if (d > r2) r2 = d;
    }
  }
  return Math.sqrt(r2);
}

/**
 * 由 glTF 的 JSON 结构算包围盒（GLB 与 .gltf 共用）。
 * 只依赖 accessor.min/max + 节点变换，不需要顶点缓冲（Draco/meshopt 压缩也适用）。
 * @returns {{min:number[],max:number[],radius:number}|null}
 */
function parseGltfJson(json) {
  if (!json || typeof json !== 'object') return null;
  const nodes = json.nodes || [];
  const meshes = json.meshes || [];
  const accessors = json.accessors || [];
  const scenes = json.scenes || [];
  const sceneIdx = Number.isInteger(json.scene) ? json.scene : 0;
  const scene = scenes[sceneIdx] || scenes[0];
  if (!scene || !Array.isArray(scene.nodes)) return null;

  const box = emptyBox();
  const stack = scene.nodes.map((i) => ({ i, m: identity() }));
  const seen = new Set();
  let guard = 0;

  while (stack.length && guard++ < 200000) {
    const { i, m } = stack.pop();
    const key = i + ':' + m.join(',');
    if (seen.has(key)) continue; // 防止异常数据造成重复遍历
    seen.add(key);
    const n = nodes[i];
    if (!n) continue;
    const world = multiply(m, nodeMatrix(n));

    if (n.mesh != null && meshes[n.mesh]) {
      const prims = meshes[n.mesh].primitives || [];
      for (const p of prims) {
        const acc = accessors[p && p.attributes ? p.attributes.POSITION : -1];
        if (!acc || !Array.isArray(acc.min) || !Array.isArray(acc.max)) continue;
        for (let cx = 0; cx < 2; cx++) {
          for (let cy = 0; cy < 2; cy++) {
            for (let cz = 0; cz < 2; cz++) {
              const local = [
                cx ? acc.max[0] : acc.min[0],
                cy ? acc.max[1] : acc.min[1],
                cz ? acc.max[2] : acc.min[2],
              ];
              expand(box, transformPoint(world, local));
            }
          }
        }
      }
    }

    const children = n.children || [];
    for (const c of children) stack.push({ i: c, m: world });
  }

  if (!box.any) return null;
  return { min: box.min, max: box.max, radius: radiusFromBox(box) };
}

/**
 * 解析 GLB 包围盒。只读 JSON chunk + accessor 的 min/max，不解码顶点缓冲 → 毫秒级。
 * @returns {{min:number[],max:number[],radius:number}|null}
 */
function parseGlbBounds(buf) {
  if (!buf || buf.length < 20) return null;
  // magic 'glTF' = 0x46546C67
  if (buf.readUInt32LE(0) !== 0x46546C67) return null;
  const jsonLen = buf.readUInt32LE(12);
  if (jsonLen <= 0 || 20 + jsonLen > buf.length) return null;
  if (buf.readUInt32LE(16) !== 0x4E4F534A) return null; // 'JSON'

  let json;
  try {
    json = JSON.parse(buf.slice(20, 20 + jsonLen).toString('utf8'));
  } catch (e) {
    return null;
  }
  return parseGltfJson(json);
}

/**
 * 解析 OBJ 包围盒（只扫 `v ` 行）。大文件按块读，避免一次性把几百 MB 读进内存。
 */
async function parseObjBounds(absPath) {
  const stat = await fsp.stat(absPath);
  const CHUNK = 4 * 1024 * 1024;
  const box = emptyBox();
  let carry = '';
  const fh = await fsp.open(absPath, 'r');
  try {
    for (let pos = 0; pos < stat.size; pos += CHUNK) {
      const len = Math.min(CHUNK, stat.size - pos);
      const buf = Buffer.allocUnsafe(len);
      await fh.read(buf, 0, len, pos);
      const text = carry + buf.toString('utf8');
      const lines = text.split('\n');
      carry = lines.pop() || '';
      for (const line of lines) {
        if (line.charCodeAt(0) !== 118) continue; // 'v'
        if (line.charCodeAt(1) !== 32 && line.charCodeAt(1) !== 9) continue;
        const parts = line.trim().split(/\s+/);
        const x = parseFloat(parts[1]);
        const y = parseFloat(parts[2]);
        const z = parseFloat(parts[3]);
        if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) expand(box, [x, y, z]);
      }
    }
  } finally {
    await fh.close();
  }
  if (!box.any) return null;
  return { min: box.min, max: box.max, radius: radiusFromBox(box) };
}

/**
 * 只读 GLB 头部 + JSON chunk（不解码顶点缓冲）。几百 MB 的模型也只读几 MB。
 */
async function readGlbHead(absPath) {
  const fh = await fsp.open(absPath, 'r');
  try {
    const head = Buffer.alloc(20);
    const n = await fh.read(head, 0, 20, 0);
    if (n.bytesRead < 20) return null;
    if (head.readUInt32LE(0) !== 0x46546C67) return null;
    const jsonLen = head.readUInt32LE(12);
    if (!(jsonLen > 0) || jsonLen > 512 * 1024 * 1024) return null;
    const need = 20 + jsonLen;
    const buf = Buffer.allocUnsafe(need);
    const n2 = await fh.read(buf, 0, need, 0);
    if (n2.bytesRead < need) return null;
    return buf;
  } finally {
    await fh.close();
  }
}

/**
 * 计算某个模型文件（/models/... 形式的路由路径）的包围盒。
 * @param {string} routePath 例如 /models/uploaded/xxx.glb
 * @returns {Promise<{min:number[],max:number[],radius:number}|null>}
 */
async function computeBoundsByRoutePath(routePath) {
  if (!routePath || typeof routePath !== 'string') return null;
  const clean = routePath.split('?')[0];
  const abs = path.join(PUBLIC_ROOT, clean.replace(/^\/+/, ''));
  if (!abs.startsWith(PUBLIC_ROOT)) return null; // 防目录穿越
  const ext = path.extname(clean).toLowerCase();
  try {
    if (ext === '.glb') {
      const head = await readGlbHead(abs);
      return head ? parseGlbBounds(head) : null;
    }
    if (ext === '.gltf') {
      // .gltf 是纯 JSON；accessor.min/max 已经够算包围盒，不需要读外链 .bin
      const text = await fsp.readFile(abs, 'utf8');
      return parseGltfJson(JSON.parse(text));
    }
    if (ext === '.obj') {
      return await parseObjBounds(abs);
    }
  } catch (e) {
    return null;
  }
  // 其他格式（.fbx/.zip/目录）暂不支持
  return null;
}

/**
 * 计算并写入 model_bounds（幂等 upsert）。
 * 失败只打日志，绝不抛出 —— 不能因为算半径把上传流程搞挂。
 * @returns {Promise<number|null>} 写入的 unit_radius，失败返回 null
 */
async function recordModelBounds(routePath, source = 'upload') {
  try {
    const b = await computeBoundsByRoutePath(routePath);
    if (!b || !Number.isFinite(b.radius) || b.radius <= 0) return null;
    // 保留 3 位小数即可；米级精度足够做距离判定
    const r = Math.round(b.radius * 1000) / 1000;
    await query(
      `INSERT INTO model_bounds (path, unit_radius, source, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (path) DO UPDATE SET unit_radius = EXCLUDED.unit_radius,
                                       source = EXCLUDED.source,
                                       updated_at = NOW()`,
      [routePath, r, source]
    );
    return r;
  } catch (e) {
    console.warn('[modelBounds] 记录半径失败:', routePath, e && e.message);
    return null;
  }
}

/**
 * 标记「算不出半径」的模型（写 0 占位），避免回填时每轮重复捞取同一个文件。
 * 前端把 0 视为「未知」，范围加载退化为原逻辑，不受影响。
 */
async function markUnresolved(routePath) {
  try {
    await query(
      `INSERT INTO model_bounds (path, unit_radius, source, updated_at)
       VALUES ($1, 0, 'unresolved', NOW())
       ON CONFLICT (path) DO NOTHING`,
      [routePath]
    );
  } catch (e) { /* 忽略 */ }
}

/**
 * 批量读取半径表 → Map<path, unit_radius>
 */
async function getBoundsMap(paths) {
  const map = new Map();
  try {
    if (Array.isArray(paths) && paths.length === 0) return map;
    const r = Array.isArray(paths)
      ? await query(`SELECT path, unit_radius FROM model_bounds WHERE path = ANY($1)`, [paths])
      : await query(`SELECT path, unit_radius FROM model_bounds`);
    for (const row of r.rows) map.set(String(row.path), Number(row.unit_radius));
  } catch (e) {
    console.warn('[modelBounds] 读取半径表失败:', e && e.message);
  }
  return map;
}

/**
 * 回填历史模型（分批）。只处理还没有记录、且文件存在的。
 * @param {{limit?:number}} opts
 */
async function backfillMissing(opts = {}) {
  const limit = Math.min(200, Math.max(1, parseInt(opts.limit, 10) || 20));
  const r = await query(
    `SELECT u.path
       FROM uploaded_models u
       LEFT JOIN model_bounds b ON b.path = u.path
      WHERE b.path IS NULL
        AND u.path IS NOT NULL
      ORDER BY u.created_at DESC
      LIMIT $1`,
    [limit]
  );
  const rows = r.rows || [];
  let ok = 0;
  let skipped = 0;
  for (const row of rows) {
    const p = String(row.path || '');
    const v = await recordModelBounds(p, 'backfill');
    if (v != null) { ok++; continue; }
    // 算不出来（文件缺失 / 非 glb|gltf|obj / 无 POSITION）→ 写 0 占位，
    // 否则每轮都会把同一批失败项重新捞出来，回填永远跑不完。
    await markUnresolved(p);
    skipped++;
  }
  const left = await query(
    `SELECT COUNT(*)::int AS n
       FROM uploaded_models u
       LEFT JOIN model_bounds b ON b.path = u.path
      WHERE b.path IS NULL AND u.path IS NOT NULL`
  );
  return {
    processed: rows.length,
    succeeded: ok,
    skipped,
    remaining: left.rows[0] ? left.rows[0].n : 0,
    limit,
  };
}

module.exports = {
  computeBoundsByRoutePath,
  recordModelBounds,
  getBoundsMap,
  backfillMissing,
  // 导出内部函数便于单测/排查
  _parseGlbBounds: parseGlbBounds,
  _parseObjBounds: parseObjBounds,
};
