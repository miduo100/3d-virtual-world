/**
 * 路径规范化与目录安全校验（Phase 1 · 零件库）
 *
 * 两个入口共用：浏览器文件夹上传（relPaths）与服务器本地目录扫描（sourceDir）。
 *
 * 解决三个实测发现的问题：
 *   ① 路径空格 —— Kenney 的目录名是 "GLB format"，入库后 uploaded_models.path 不可逆，
 *      空格会导致 URL 拼接与相对 URI 解析风险 → 统一替换为下划线。
 *   ② 路径穿越 —— 浏览器上传的 relPaths 与扫描的 sourceDir 都可能带 ../ 或绝对路径。
 *   ③ 库名归一 —— 目录名可能是中文/乱码/带包装后缀，需要派生出合法的 pack_key。
 *
 * 纯 Node 模块，无外部依赖。
 */
const path = require('path');
const fs = require('fs');

/** 允许扫描的源根目录（白名单）。为空 = 不限制（仅本地开发用）。 */
const SCAN_ROOTS = (process.env.ASSET_SCAN_ROOTS || '')
  .split(';')
  .map(s => s.trim())
  .filter(Boolean)
  .map(s => path.resolve(s));

/** 源目录最大深度（防止把整块磁盘扫进来） */
const MAX_SOURCE_DEPTH = 8;

const ALLOWED_EXTS = new Set(['.gltf', '.obj', '.glb', '.bin', '.png', '.jpg', '.jpeg', '.webp', '.mtl']);
const PRIMARY_EXTS = new Set(['.gltf', '.obj', '.glb']);
const VARIANT_RE = /_(mid|lod)\.(gltf|glb|obj)$/i;

/**
 * 规范化单个路径段：去首尾空白、非法字符与空格转下划线、去连续下划线。
 */
function normalizeSegment(seg) {
  let s = String(seg || '').trim();
  if (!s) return '';
  s = s.replace(/[\s\u00a0]+/g, '_');
  s = s.replace(/[<>:"|?*\\]+/g, '_');
  s = s.replace(/[\x00-\x1f\x7f]/g, '');
  s = s.replace(/_{2,}/g, '_');
  s = s.replace(/^[._]+/, '').replace(/[._]+$/, '');
  if (!s) return '';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(s)) s = '_' + s;
  return s.slice(0, 120);
}

/**
 * 规范化整条相对路径，**保持目录结构**（GLB 的外置贴图依赖相对位置）。
 * 非法输入返回 null。隐藏文件/目录（.git、.DS_Store）直接丢弃。
 */
function normalizeRel(rel) {
  if (rel === undefined || rel === null) return null;
  let s = String(rel).replace(/\\/g, '/').trim();
  if (!s) return null;
  s = s.replace(/^\.?\//, '');
  if (/^[a-zA-Z]:/.test(s) || s.startsWith('//')) return null;   // 绝对路径 / UNC
  const rawSegs = s.split('/').filter(x => x !== '' && x !== '.');
  if (rawSegs.some(x => x === '..')) return null;               // 路径穿越
  // 隐藏文件/目录（.git / .DS_Store / Thumbs.db）→ 整条丢弃，而不是只跳那一段
  if (rawSegs.some(x => x.startsWith('.'))) return null;
  if (rawSegs.length === 0 || rawSegs.length > MAX_SOURCE_DEPTH + 2) return null;
  const segs = [];
  for (const seg of rawSegs) {
    const n = normalizeSegment(seg);
    if (n) segs.push(n);
  }
  return segs.length ? segs.join('/') : null;
}

/** 由目录名派生合法 pack_key。小写 + 非字母数字→下划线；纯中文则用短哈希兜底。 */
function derivePackKey(rawName, fallbackSeed) {
  let base = String(rawName || '').trim();
  base = base.replace(/\[[^\]]*\]/g, ' ').replace(/[（(][^）)]*[）)]/g, ' ');
  base = base.replace(/\.(gltf|glb|obj|fbx|zip|rar|7z)$/i, '');
  let key = base.toLowerCase().replace(/[^a-z0-9]+/g, '_')
    .replace(/_{2,}/g, '_').replace(/^[._]+/, '').replace(/[._]+$/, '').slice(0, 60);
  if (!key) {
    let h = 0;
    const s = String(fallbackSeed || rawName || 'lib');
    for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) >>> 0;
    key = 'library_' + (h >>> 0).toString(36).slice(0, 8);
  }
  return key;
}

/** 目录名 → 可读展示名（去掉 [Standard] / (副本) 之类包装） */
function deriveDisplayName(rawName) {
  let s = String(rawName || '').trim();
  s = s.replace(/\[[^\]]*\]/g, '').replace(/[（(][^）)]*[）)]/g, '');
  s = s.replace(/[_-]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  return (s || String(rawName || '未命名库')).slice(0, 120);
}

/**
 * 校验服务器本地扫描目录：存在 / 是目录 / 绝对路径 / 不在上传目录内 / 在白名单内。
 * @returns {{ok:true, abs:string}|{ok:false, error:string}}
 */
function assertSafeSourceDir(inputPath) {
  if (!inputPath || typeof inputPath !== 'string') return { ok: false, error: '未提供目录路径' };
  const trimmed = inputPath.trim();
  if (!trimmed) return { ok: false, error: '目录路径为空' };
  if (trimmed.includes('\0')) return { ok: false, error: '路径含非法字符' };
  if (!path.isAbsolute(trimmed)) return { ok: false, error: '请填写绝对路径（例如 H:\\素材\\kenney）' };

  const abs = path.resolve(trimmed);
  let st;
  try { st = fs.statSync(abs); } catch (e) { return { ok: false, error: '目录不存在或不可访问' }; }
  if (!st.isDirectory()) return { ok: false, error: '路径不是目录' };

  const uploadRoot = path.resolve(__dirname, '../../public/models/uploaded');
  if (abs === uploadRoot || abs.startsWith(uploadRoot + path.sep)) {
    return { ok: false, error: '不能扫描上传目录本身（会造成自我复制）' };
  }
  if (SCAN_ROOTS.length) {
    const okRoot = SCAN_ROOTS.some(r => abs === r || abs.startsWith(r + path.sep));
    if (!okRoot) return { ok: false, error: '该目录不在允许扫描的根目录内（由 ASSET_SCAN_ROOTS 配置）' };
  }
  return { ok: true, abs };
}

/** 递归列文件。@returns {{files:string[], skipped:string[]}} */
function listSourceFiles(absDir) {
  const files = [];
  const skipped = [];
  const walk = (dir, rel, depth) => {
    if (depth > MAX_SOURCE_DEPTH) return;
    let ents;
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const e of ents) {
      if (e.name.startsWith('.')) continue;
      const abs = path.join(dir, e.name);
      const relRaw = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) { walk(abs, relRaw, depth + 1); continue; }
      if (!e.isFile()) continue;
      if (ALLOWED_EXTS.has(path.extname(e.name).toLowerCase())) files.push(relRaw);
      else skipped.push(relRaw);
    }
  };
  walk(absDir, '', 0);
  return { files, skipped };
}

/** 挑出主文件（.gltf/.obj/.glb，排除 _mid/_lod 变体名） */
function pickPrimaries(files) {
  return files.filter(rel => {
    const ext = path.extname(rel).toLowerCase();
    return PRIMARY_EXTS.has(ext) && !VARIANT_RE.test(rel);
  });
}

/** 递归复制目录，返回落盘后的文件相对路径列表。调用方负责确保 dst 在上传根内。 */
function copyTree(srcAbs, dstAbs, opts) {
  const o = opts || {};
  const keep = o.keep || null;              // Set<string>：**规范化后**的相对路径；null=全复制
  const copied = [];
  const walk = (s, d, rel) => {
    let ents;
    try { ents = fs.readdirSync(s, { withFileTypes: true }); } catch (e) { return; }
    for (const e of ents) {
      if (e.name.startsWith('.')) continue;
      const s2 = path.join(s, e.name);
      const relRaw = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) {
        const n = normalizeRel(relRaw);
        if (!n) continue;
        // ⚠ 只拼「本级段名」。此前误拼整条相对路径 →
        //   Models/ → Models/Models/ → Models/Models/OBJ_format/Models/OBJ_format/…（每层重复前缀）
        // 目录不预先 mkdir：文件分支会按需建链，避免留下空的 Textures/ 目录
        walk(s2, path.join(d, path.basename(n)), n);
      } else if (e.isFile()) {
        const n = normalizeRel(relRaw);
        if (!n) continue;
        if (keep && !keep.has(n)) continue;   // 只复制被选中的文件
        const ext = path.extname(e.name).toLowerCase();
        if (!ALLOWED_EXTS.has(ext)) continue;
        const d2 = path.join(d, path.basename(n));   // 同理：只拼本级文件名
        fs.mkdirSync(path.dirname(d2), { recursive: true });
        fs.copyFileSync(s2, d2);
        copied.push({ from: relRaw, to: n, bytes: fs.statSync(d2).size });
      }
    }
  };
  fs.mkdirSync(dstAbs, { recursive: true });
  walk(srcAbs, dstAbs, '');
  return copied;
}

/**
 * 同一零件的多格式副本去重（Kenney 每个 kit 同时给 GLB + FBX + OBJ + STL）。
 *
 * 背景（真实故障）：`Modular Buildings` 的 108 个零件各有 .glb 与 .obj 两份，
 * 两者 `derivePartKey` 得到**同一个 part_key**（扩展名不同、基名相同）
 * → part_library_items 的 UNIQUE(library_id, part_key) 触发 ON CONFLICT DO UPDATE
 * → **后扫到的 .obj 覆盖了 .glb 行**（OBJ 在本项目是 phase2 占位、根本渲不出来），
 * 零件表 108 行被改成指向 .obj，metadata.tris 全变 0，库统计 totalTris=0。
 *
 * 规则：同基名只保留一个格式，优先级 GLB > glTF > OBJ；
 *      附属文件按「引用」而非「同目录」收集 —— Kenney 的贴图在**子目录**
 *      （`Models/GLB format/Textures/colormap.png`，GLB 内 uri = `Textures/colormap.png`），
 *      只按同目录判断会把贴图全丢掉（AL-3 直接失败）。
 *      因此：① 读 glTF JSON 收集 images/buffers 的外�� uri（需调用方传 readRefs，
 *      保持本模块零依赖）；② 退化兜底 = 同目录附属（覆盖 OBJ 的 .mtl）；
 *      ③ `Previews/` 下缩略图一律保留（AL-10 需要）。
 *
 * @param {string[]} files        listSourceFiles 的输出
 * @param {{rootDir?:string, readRefs?:(absFile:string)=>string[]}} [opts]
 * @returns {{keep:Set<string>, dropped:Array<{file:string, reason:string}>}}
 *   keep 里的路径是**规范化后**的相对路径（空格→下划线），可直接给 copyTree({keep})。
 */
const FORMAT_PRIORITY = { '.glb': 0, '.gltf': 1, '.obj': 2 };
function selectCanonicalFiles(files, opts) {
  const o = opts || {};
  const rootDir = o.rootDir || null;
  const readRefs = typeof o.readRefs === 'function' ? o.readRefs : null;
  const keep = new Set();                                   // 规范化路径
  const dropped = [];

  // ① 主文件：同基名去重（GLB > glTF > OBJ；同优先级取路径更浅的）
  const primaries = pickPrimaries(files);
  const best = new Map();
  for (const rel of primaries) {
    const ext = path.extname(rel).toLowerCase();
    const base = path.basename(rel, path.extname(rel)).toLowerCase();
    const rank = FORMAT_PRIORITY[ext];
    if (rank === undefined) { dropped.push({ file: rel, reason: '未知主文件格式 ' + ext }); continue; }
    const depth = rel.split('/').length;
    const cur = best.get(base);
    if (!cur || rank < cur.rank || (rank === cur.rank && depth < cur.depth)) {
      if (cur) dropped.push({ file: cur.rel, reason: `同零件低优先级格式（保留 ${path.basename(rel)}）` });
      best.set(base, { rel, rank, depth });
    } else {
      dropped.push({ file: rel, reason: `同零件低优先级格式（保留 ${path.basename(cur.rel)}）` });
    }
  }
  const chosen = [...best.values()].map(x => x.rel);
  const rawOf = new Map();                        // 规范化路径 → 源目录真实相对路径
  const addNorm = raw => { const n = normalizeRel(raw); if (n) { keep.add(n); rawOf.set(n, raw); } return n; };
  for (const rel of chosen) addNorm(rel);

  // ② 引用跟随：读 glTF 里的外置 images/buffers（Kenney 贴图在子目录里）
  if (readRefs && rootDir) {
    for (const rel of chosen) {
      if (!/\.(glb|gltf)$/i.test(rel)) continue;
      let refs = [];
      try { refs = readRefs(path.join(rootDir, rel)) || []; } catch (e) { refs = []; }
      const dir = path.dirname(rel);
      for (const u of refs) {
        // ⚠ dir 是相对路径，必须连 rootDir 一起 resolve。
        //   只写 path.resolve(dir, u) 会解析到进程 cwd → 触发下面的越界闸门 → 贴图全丢。
        const abs = path.resolve(rootDir, dir, String(u));
        if (abs !== rootDir && !abs.startsWith(rootDir + path.sep)) {
          dropped.push({ file: `${rel} → ${u}`, reason: '引用越界（拒绝复制）' });
          continue;
        }
        addNorm(path.relative(rootDir, abs).split(path.sep).join('/'));
      }
    }
  }

  // ③ 同目录附属（OBJ 的 .mtl / 贴图恰好与模型同级的情况）
  const keepDirs = new Set();
  for (const n of keep) keepDirs.add(path.dirname(n).toLowerCase());
  // ④ Previews 缩略图；⑤ 其余一律丢弃并说明原因
  for (const rel of files) {
    const n = normalizeRel(rel);
    if (!n || keep.has(n)) continue;
    const ext = path.extname(rel).toLowerCase();
    if (PRIMARY_EXTS.has(ext) && !VARIANT_RE.test(rel)) continue;   // ① 已处理
    if (keepDirs.has(path.dirname(n).toLowerCase())) { keep.add(n); rawOf.set(n, rel); keepDirs.add(path.dirname(n).toLowerCase()); continue; }
    if (/(^|\/)Previews?\//i.test(n)) { keep.add(n); rawOf.set(n, rel); continue; }
    dropped.push({
      file: rel,
      reason: PRIMARY_EXTS.has(ext) || ext === '.mtl' ? '未被引用的模型副本'
        : ext === '.bin' || /\.(png|jpe?g|webp)$/i.test(ext) ? '无模型引用此贴图（他格式附属）'
        : '不在任何保留模型旁边',
    });
  }
  return { keep, rawOf, dropped };
}

/** 读 License.txt 摘要（若存在），解析出授权类型/作者 */
function readLicenseInfo(absDir) {
  const candidates = ['License.txt', 'license.txt', 'LICENSE.txt', 'License-LowRes.txt', 'README.txt', 'readme.txt'];
  for (const name of candidates) {
    const p = path.join(absDir, name);
    if (!fs.existsSync(p)) continue;
    let txt = '';
    try { txt = fs.readFileSync(p, 'utf8').slice(0, 4000); } catch (e) { continue; }
    const info = { raw: txt.replace(/\s+/g, ' ').trim().slice(0, 500) };
    const cc0 = /Creative\s*Commons\s*Zero|\bCC0\b/i.test(txt);
    const ccBy = /Creative\s*Commons\s*Attribution|\bCC\s*BY\b/i.test(txt);
    info.type = cc0 ? 'CC0' : ccBy ? 'CC-BY' : 'unknown';
    const au = txt.match(/by\s+([A-Z][\w.'-]+(?:\s+[A-Z][\w.'-]+){0,3})/);
    if (au) info.author = au[1].trim();
    else {
      const nm = txt.match(/^([A-Z][\w.'-]+(?:\s+[A-Z][\w.'-]+){0,3})/);
      if (nm && !/^(License|Creative|The|This|You)/i.test(nm[1])) info.author = nm[1].trim();
    }
    const url = txt.match(/https?:\/\/[^\s)]+/);
    if (url) info.url = url[0];
    return info;
  }
  return null;
}

module.exports = {
  ALLOWED_EXTS,
  PRIMARY_EXTS,
  MAX_SOURCE_DEPTH,
  SCAN_ROOTS,
  normalizeSegment,
  normalizeRel,
  derivePackKey,
  deriveDisplayName,
  assertSafeSourceDir,
  listSourceFiles,
  pickPrimaries,
  copyTree,
  selectCanonicalFiles,
  FORMAT_PRIORITY,
  readLicenseInfo,
};
