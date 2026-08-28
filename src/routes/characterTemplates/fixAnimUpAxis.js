/**
 * 修复自定义上传动作"趴地"问题（服务端子模块）
 *
 * 根因：
 *   模型 GLB:   Armature(+90°X) → Hips(-90°X)   → 世界旋转 = 0°（立着）
 *   动画 GLB:   mofx_rig(-90°X) → Hips(0°)      → Hips 通道值≈0°
 *   播放时动画 Hips.quaternion（≈0°）覆盖模型 Hips rest（-90°），
 *   模型 Armature(+90°) 保留 → 骨骼链 = +90° → 角色趴地
 *
 * 修复：
 *   将动画 GLB 中 Hips.quaternion 通道的每一帧左乘补偿四元数
 *   C = 模型 Hips rest × 动画 Hips rest⁻¹
 *   使动画 Hips 值与模型 Hips rest 对齐，角色恢复站立。
 *
 * 仅修改 Hips 的 rotation 通道，position/scale 通道不动，其余骨骼不动。
 * 支持多 buffer GLB（含 EXT_meshopt_compression 压缩流），自动平移 byteOffset。
 * 幂等：若动画 Hips rest 已与模型对齐，返回 detected=false，不写文件。
 */

const fs = require('fs');
const path = require('path');

// 四元数乘法（左乘 a*b）
function quatMult(a, b) {
  return {
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  };
}

// 四元数共轭（单位四元数时等于逆）
function quatConj(q) {
  return { x: -q.x, y: -q.y, z: -q.z, w: q.w };
}

function quatNorm(q) {
  const l = Math.hypot(q.x, q.y, q.z, q.w) || 1;
  return { x: q.x / l, y: q.y / l, z: q.z / l, w: q.w / l };
}

// 四元数接近判定
function quatClose(a, b, eps = 1e-3) {
  return Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps &&
         Math.abs(a.z - b.z) < eps && Math.abs(a.w - b.w) < eps;
}

// 解析 GLB JSON chunk：容忍非标准 padding（规范要求 0x20 空格，
// 但部分工具/旧版写入 NUL 0x00 甚至其它字节），截取到顶层 JSON 对象结束
function parseJsonChunk(text) {
  let depth = 0, start = -1, end = -1;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '{') {
      if (start < 0) start = i;
      depth++;
    } else if (c === '}') {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  if (end < 0) throw new Error('GLB JSON chunk 中未找到完整 JSON 对象');
  return JSON.parse(text.slice(start, end + 1));
}

function loadGLB(filePath) {
  const buf = fs.readFileSync(filePath);
  const jsonLen = buf.readUInt32LE(12);
  const json = parseJsonChunk(buf.slice(20, 20 + jsonLen).toString('utf-8'));
  const binStart = 20 + jsonLen + 8; // chunk1(BIN) 数据起点
  const binLen = buf.readUInt32LE(20 + jsonLen); // chunk1 声明长度（含 padding）
  return { json, buf, binStart, binLen };
}

// Hips 骨骼名匹配：兼容裸名与 Mixamo 命名空间前缀（mixamorig:Hips / mixamorig1:Hips 等）
function isHipsName(name) {
  if (!name || typeof name !== 'string') return false;
  return name === 'Hips' || name === 'hips' || /(^|[:/|])Hips$/i.test(name);
}

// 读取四元数：5126=FLOAT（直接浮点），5122=SHORT（KHR_mesh_quantization，分量=int16/32767）
function readQuatAt(buf, off, ct) {
  if (ct === 5126) {
    return { x: buf.readFloatLE(off), y: buf.readFloatLE(off + 4), z: buf.readFloatLE(off + 8), w: buf.readFloatLE(off + 12) };
  }
  return { x: buf.readInt16LE(off) / 32767, y: buf.readInt16LE(off + 2) / 32767, z: buf.readInt16LE(off + 4) / 32767, w: buf.readInt16LE(off + 6) / 32767 };
}

// 写回四元数：5126 直接浮点，5122 量化回 int16（clamp 到 [-32767,32767]）
function writeQuatAt(buf, off, ct, q) {
  if (ct === 5126) {
    buf.writeFloatLE(q.x, off);
    buf.writeFloatLE(q.y, off + 4);
    buf.writeFloatLE(q.z, off + 8);
    buf.writeFloatLE(q.w, off + 12);
  } else {
    buf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(q.x * 32767))), off);
    buf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(q.y * 32767))), off + 2);
    buf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(q.z * 32767))), off + 4);
    buf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(q.w * 32767))), off + 6);
  }
}

// 取节点 Hips 的 rest rotation（缺省单位四元数）
function getHipsRest(json) {
  for (const n of json.nodes || []) {
    if (isHipsName(n.name)) {
      const r = n.rotation || [0, 0, 0, 1];
      return { x: r[0], y: r[1], z: r[2], w: r[3] };
    }
  }
  return null;
}

// 计算 accessor 数据在所属 buffer 中的绝对偏移（支持多 buffer + meshopt 扩展）
function accessorBase(json, accIdx, buf) {
  const acc = json.accessors[accIdx];
  const bv = json.bufferViews[acc.bufferView];
  const binStartOf = (bIdx) => {
    // GLB BIN chunk 是所有 buffer 数据按序拼接；buffer[0] 从 binStart 起，
    // buffer[i] 起点 = 前一个 buffer 的 byteLength 之和
    let off = json.buffers[0].byteLength; // 这是 BIN 总长（已含 4 字节对齐 padding）
    // 重新计算各 buffer 在 BIN chunk 内的起点
    let start = buf.binStart;
    for (let i = 0; i < bIdx; i++) {
      const blen = json.buffers[i].byteLength;
      start += blen + ((4 - (blen % 4)) % 4); // 4 字节对齐
    }
    return start;
  };
  const base = binStartOf(bv.buffer) + (bv.byteOffset || 0) + (acc.byteOffset || 0);
  return { base, stride: bv.byteStride || 16, count: acc.count };
}

/**
 * 修复单个动画文件
 * @param {string} modelPath 模型 GLB 绝对路径
 * @param {string} animPath  动画 GLB 绝对路径
 * @returns {{success, detected, fixedChannels, fixedFrames, backupPath}|{success:false, error}}
 */
function fixAnimUpAxis(modelPath, animPath) {
  if (!fs.existsSync(modelPath)) return { success: false, error: '模型文件不存在: ' + modelPath };
  if (!fs.existsSync(animPath)) return { success: false, error: '动画文件不存在: ' + animPath };

  const model = loadGLB(modelPath);
  const anim = loadGLB(animPath);
  const { json, buf } = anim;

  const targetHips = getHipsRest(model.json); // 模型侧 Hips rest（目标）
  const sourceHips = getHipsRest(json);         // 动画侧 Hips rest（源）

  if (!targetHips) return { success: false, error: '模型未找到 Hips 骨骼' };
  if (!sourceHips) return { success: false, error: '动画未找到 Hips 骨骼' };

  const tH = quatNorm(targetHips);
  const sH = quatNorm(sourceHips);

  // 幂等：若动画已带本工具修复标记，说明已对齐，无需重复修复
  if (json.extensions && json.extensions.VW_FIXED_UP_AXIS) {
    return { success: true, detected: false, fixedChannels: 0, fixedFrames: 0, backupPath: null,
             note: '该动画已修复过（含 VW_FIXED_UP_AXIS 标记）' };
  }

  // 取动画第一个 Hips.rotation 通道首帧值，作为"当前朝向"判定依据。
  // 注意：动画 Hips 节点 rest 通常为固定单位四元数，不能用于判定，
  // 必须以 clip 实际首帧为准（趴地时首帧≈单位四元数，站立时首帧≈模型 rest）。
  let firstFrame = null;
  for (const a of (json.animations || [])) {
    for (const ch of a.channels) {
      const node = json.nodes[ch.target.node];
      if (!node || !isHipsName(node.name) || ch.target.path !== 'rotation') continue;
      const samp = a.samplers[ch.sampler];
      const acc = json.accessors[samp.output];
      if ((acc.componentType !== 5126 && acc.componentType !== 5122) || acc.type !== 'VEC4') continue;
      const { base } = accessorBase(json, samp.output, anim);
      firstFrame = readQuatAt(buf, base, acc.componentType);
      break;
    }
    if (firstFrame) break;
  }

  // 判定逻辑（关键，避免误伤已站立动画）：
  //   趴地的本质 = 动画 Hips 通道首帧≈单位四元数（模型 Armature(+90°) 未被抵消 → 趴下）
  //   已站立（含姿势偏移）的动画首帧会明显偏离单位四元数 → 不应再补偿
  //   已用本工具修复的文件带 VW_FIXED_UP_AXIS 标记 → 幂等跳过（上方已处理）
  const UNIT = { x: 0, y: 0, z: 0, w: 1 };
  if (!firstFrame || quatClose(quatNorm(firstFrame), UNIT, 0.15)) {
    // 首帧≈单位四元数（趴地）→ 需要修复
  } else {
    // 首帧已明显旋转（已站立/带姿势）→ 无需修复，避免双重补偿趴回去
    return { success: true, detected: false, fixedChannels: 0, fixedFrames: 0, backupPath: null,
             note: '动画首帧已明显偏离单位四元数，判定为已站立，无需修复' };
  }

  // 补偿 = 目标 × 源⁻¹（源为单位四元数时逆=共轭）
  const comp = quatMult(tH, quatConj(sH));

  let fixedChannels = 0;
  let fixedFrames = 0;

  (json.animations || []).forEach((a, ai) => {
    a.channels.forEach((ch) => {
      const node = json.nodes[ch.target.node];
      if (!node || !isHipsName(node.name)) return;
      if (ch.target.path !== 'rotation') return;

      const samp = a.samplers[ch.sampler];
      const acc = json.accessors[samp.output];
      if ((acc.componentType !== 5126 && acc.componentType !== 5122) || acc.type !== 'VEC4') return; // 非 float/量化四元数跳过

      const { base, stride, count } = accessorBase(json, samp.output, anim);
      for (let i = 0; i < count; i++) {
        const off = base + i * stride;
        const q = readQuatAt(buf, off, acc.componentType);
        const r = quatMult(comp, quatNorm(q));
        writeQuatAt(buf, off, acc.componentType, r);
        fixedFrames++;
      }
      fixedChannels++;
    });
  });

  if (fixedChannels === 0) {
    return { success: true, detected: false, fixedChannels: 0, fixedFrames: 0, backupPath: null,
             note: '未找到 Hips.rotation 动画通道' };
  }

  // 写入修复标记（幂等依据），渲染器会忽略未知 extension
  json.extensions = json.extensions || {};
  json.extensions.VW_FIXED_UP_AXIS = {
    fixedAt: new Date().toISOString(),
    targetHips: tH,
    sourceHips: sH,
  };

  // 重新组装 GLB：header(12) + JSON chunk + BIN chunk（bin 数据不变）
  const jsonStr = JSON.stringify(json);
  const jsonBin = Buffer.from(jsonStr, 'utf-8');
  const jsonChunkLen = jsonBin.length;
  const jsonPad = (4 - (jsonChunkLen % 4)) % 4;
  const binData = buf.slice(anim.binStart, anim.binStart + anim.binLen);
  const binPad = (4 - (binData.length % 4)) % 4;

  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546C67, 0); // glTF magic
  header.writeUInt32LE(2, 4);          // version
  const totalLen = 12 + 8 + jsonChunkLen + jsonPad + 8 + binData.length + binPad;
  header.writeUInt32LE(totalLen, 8);

  const jsonChunkHeader = Buffer.alloc(8);
  jsonChunkHeader.writeUInt32LE(jsonChunkLen + jsonPad, 0);
  jsonChunkHeader.writeUInt32LE(0x4E4F534A, 4); // JSON

  const binChunkHeader = Buffer.alloc(8);
  binChunkHeader.writeUInt32LE(binData.length + binPad, 0);
  binChunkHeader.writeUInt32LE(0x004E4942, 4); // BIN

  const out = Buffer.concat([
    header,
    jsonChunkHeader,
    jsonBin,
    Buffer.alloc(jsonPad, 0x20), // JSON chunk padding 规范为 0x20 空格
    binChunkHeader,
    binData,
    Buffer.alloc(binPad),        // BIN chunk padding 规范为 0x00
  ]);

  // 备份原文件（仅首次）
  const backupPath = animPath + '.bak_upfix';
  if (!fs.existsSync(backupPath)) {
    fs.copyFileSync(animPath, backupPath);
  }

  fs.writeFileSync(animPath, out);

  return { success: true, detected: true, fixedChannels, fixedFrames, backupPath };
}

module.exports = { fixAnimUpAxis };
