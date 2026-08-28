/**
 * bake_skin_to_static.js — 将 GLB 中的蒙皮网格烘焙为静态网格（文件级修复）
 *
 * 背景：带骨骼动画的模型（如 LittlestTokyo 街道场景）作为世界对象放置时，
 *       骨骼矩阵与顶点不匹配会把顶点渲染到远离 pivot 的位置（幻影），
 *       且 setFromObject 包围盒会包含远处骨骼导致视锥剔除闪烁。
 *       世界对象不使用骨骼动画，将其烘焙为静态网格可彻底修复。
 *
 * 处理：
 *   1. 删除所有 mesh primitive 的 skin 引用
 *   2. 删除 skins 数组（骨骼蒙皮定义）
 *   3. 删除 animations 数组（骨骼动画已无意义）
 *
 * 安全：
 *   - 仅修改 JSON chunk，BIN chunk（几何/纹理数据）原样保留
 *   - 不删除任何 accessor/bufferView，避免索引重编号风险
 *   - 原文件自动备份到同目录 _backup_skin_before/
 *
 * 用法：node scripts/bake_skin_to_static.js <glb路径>
 */
const fs = require('fs');
const path = require('path');

const target = process.argv[2];
if (!target || !fs.existsSync(target)) {
  console.error('用法: node scripts/bake_skin_to_static.js <glb路径>');
  process.exit(1);
}

const buf = fs.readFileSync(target);
if (buf.readUInt32LE(0) !== 0x46546c67) {
  console.error('不是有效的 GLB 文件:', target);
  process.exit(1);
}

const jsonLen = buf.readUInt32LE(12);
const json = JSON.parse(buf.slice(20, 20 + jsonLen).toString('utf8'));

// ===== 统计与处理 =====
let skinRefs = 0;
const skinsCount = Array.isArray(json.skins) ? json.skins.length : 0;
const animCount = Array.isArray(json.animations) ? json.animations.length : 0;

(json.meshes || []).forEach((m) => {
  (m.primitives || []).forEach((p) => {
    if (p.skin !== undefined) {
      delete p.skin;
      skinRefs++;
    }
  });
});

if (skinsCount > 0) delete json.skins;
if (animCount > 0) delete json.animations;

// GLTFLoader._markDefs() 依据 nodeDef.skin 标记 SkinnedMesh，
// 必须同时删除 node 的 skin 引用，否则删除 skins 数组后会产生悬空引用，
// 且 GLTFLoader 仍会把这些网格创建为 SkinnedMesh（并因找不到 skin 定义而报错）
let nodeSkinRefs = 0;
(json.nodes || []).forEach((n) => {
  if (n.skin !== undefined) {
    delete n.skin;
    nodeSkinRefs++;
  }
});

if (skinRefs === 0 && nodeSkinRefs === 0 && skinsCount === 0 && animCount === 0) {
  console.log('无需处理（无 skin/animation）:', target);
  process.exit(0);
}

// ===== 备份原文件 =====
const backupDir = path.join(path.dirname(target), '_backup_skin_before');
fs.mkdirSync(backupDir, { recursive: true });
const backupPath = path.join(backupDir, path.basename(target));
if (!fs.existsSync(backupPath)) {
  fs.copyFileSync(target, backupPath);
  console.log('备份原文件:', backupPath);
}

// ===== 重新组装 GLB =====
// JSON chunk：重新序列化 + 空格填充到 4 字节对齐
const newJson = Buffer.from(JSON.stringify(json), 'utf8');
const jsonChunkLen = Math.ceil(newJson.length / 4) * 4;
const jsonChunk = Buffer.alloc(jsonChunkLen);
newJson.copy(jsonChunk);
for (let i = newJson.length; i < jsonChunkLen; i++) jsonChunk[i] = 0x20;

// 提取 BIN chunk（原文件合法 GLB，其 JSON 已对齐）
let binChunk = Buffer.alloc(0);
let binLen = 0;
const binOffset = 20 + Math.ceil(jsonLen / 4) * 4;
if (binOffset + 8 <= buf.length) {
  const cLen = buf.readUInt32LE(binOffset);
  const cType = buf.readUInt32LE(binOffset + 4);
  if (cType === 0x004E4942) {
    binChunk = Buffer.from(buf.subarray(binOffset + 8, binOffset + 8 + cLen));
    binLen = cLen;
  }
}

// 组装头部
const header = Buffer.alloc(20);
header.writeUInt32LE(0x46546c67, 0); // glTF magic
header.writeUInt32LE(2, 4);          // version 2
const totalLen = 20 + jsonChunkLen + (binLen > 0 ? 8 + binLen : 0);
header.writeUInt32LE(totalLen, 8);
header.writeUInt32LE(jsonChunkLen, 12);
header.writeUInt32LE(0x4E4F534A, 16); // JSON

let out;
if (binLen > 0) {
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(binLen, 0);
  binHeader.writeUInt32LE(0x004E4942, 4);
  out = Buffer.concat([header, jsonChunk, binHeader, binChunk]);
} else {
  out = Buffer.concat([header, jsonChunk]);
}

fs.writeFileSync(target, out);
console.log(`✅ 处理完成: ${target}`);
console.log(`   移除 primitive.skin 引用: ${skinRefs} 个`);
console.log(`   移除 node.skin 引用: ${nodeSkinRefs} 个`);
console.log(`   移除 skins 定义: ${skinsCount} 个`);
console.log(`   移除 animations: ${animCount} 个`);
console.log(`   文件大小: ${(buf.length / 1048576).toFixed(2)}MB → ${(out.length / 1048576).toFixed(2)}MB`);
