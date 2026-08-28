/**
 * 修复 zhu 模板待机动画"趴地"问题（临时修复脚本）
 *
 * 根因：
 *   模型 GLB:   Armature(+90°X) → Hips(-90°X)   → 世界旋转 = 0°（立着）
 *   动画 GLB:   mofx_rig(-90°X) → Hips(0°)      → Hips 通道值≈0°
 *   播放时动画 Hips.quaternion（≈0°）覆盖模型 Hips rest（-90°），
 *   模型 Armature(+90°) 保留 → 骨骼链 = +90° → 角色趴地
 *
 * 修复：
 *   将动画 GLB 中 Hips.quaternion 通道的每一帧左乘补偿四元数
 *   C = (-0.70710678, 0, 0, 0.70710678)（绕 X 轴 -90°），
 *   使动画 Hips 值与模型 Hips rest(-90°) 对齐，角色恢复站立。
 *
 * 只修改 Hips 的 rotation 通道，position/scale 通道不动，
 * 其余骨骼通道不动（其余骨骼 rest 两边一致，无需补偿）。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ANIM_FILE = path.join(ROOT, 'public', 'uploads', 'character-templates', 'char-1787821421996-4328298.glb');
const MODEL_FILE = path.join(ROOT, 'public', 'uploads', 'character-templates', 'char-1787820600981-349079065.glb');

// 补偿四元数（绕 X 轴 -90°）：从模型 Hips rest 与动画 Hips rest 计算
const COMP = { x: -0.7071067811865476, y: 0, z: 0, w: 0.7071067811865476 };

function loadGLB(filePath) {
  const buf = fs.readFileSync(filePath);
  const jsonLen = buf.readUInt32LE(12);
  const binLen = buf.readUInt32LE(16);
  const json = JSON.parse(buf.slice(20, 20 + jsonLen).toString('utf-8'));
  const binStart = 20 + jsonLen + 8;
  return { json, buf, binStart, binLen };
}

// 计算 accessor 数据在 buffer0(BIN) 中的绝对偏移（仅支持单 buffer GLB）
function accessorOffset(json, accIdx, binStart) {
  const acc = json.accessors[accIdx];
  const bv = json.bufferViews[acc.bufferView];
  if (bv.buffer !== 0) throw new Error('不支持多 buffer GLB: bufferIndex=' + bv.buffer);
  return binStart + (bv.byteOffset || 0) + (acc.byteOffset || 0);
}

function quatMult(a, b) {
  // a * b（左乘）
  return {
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  };
}

function main() {
  if (!fs.existsSync(ANIM_FILE)) { console.error('动画文件不存在:', ANIM_FILE); process.exit(1); }
  if (!fs.existsSync(MODEL_FILE)) { console.error('模型文件不存在:', MODEL_FILE); process.exit(1); }

  const anim = loadGLB(ANIM_FILE);
  const model = loadGLB(MODEL_FILE);
  const { json, buf, binStart } = anim;

  // 1. 从模型取 Hips rest rotation（目标）
  let targetHipsQuat = null;
  model.json.nodes.forEach((n) => {
    if (n.name === 'Hips' && n.rotation) targetHipsQuat = { x: n.rotation[0], y: n.rotation[1], z: n.rotation[2], w: n.rotation[3] };
  });
  // 2. 从动画取 Hips rest rotation（源）
  let sourceHipsQuat = null;
  json.nodes.forEach((n) => {
    if (n.name === 'Hips') sourceHipsQuat = { x: (n.rotation || [0,0,0,1])[0], y: (n.rotation || [0,0,0,1])[1], z: (n.rotation || [0,0,0,1])[2], w: (n.rotation || [0,0,0,1])[3] };
  });
  if (!targetHipsQuat || !sourceHipsQuat) {
    console.error('未找到 Hips rest rotation');
    process.exit(1);
  }
  // 补偿 = target * source^-1（source 需归一化）
  const len = Math.hypot(sourceHipsQuat.x, sourceHipsQuat.y, sourceHipsQuat.z, sourceHipsQuat.w);
  const inv = { x: -sourceHipsQuat.x / len, y: -sourceHipsQuat.y / len, z: -sourceHipsQuat.z / len, w: sourceHipsQuat.w / len };
  const comp = quatMult(targetHipsQuat, inv);
  console.log('目标 Hips rest:', targetHipsQuat);
  console.log('源   Hips rest:', sourceHipsQuat);
  console.log('补偿四元数    :', comp);

  // 3. 找到所有 Hips.rotation 动画通道，修改数据
  let modifiedChannels = 0;
  let modifiedFrames = 0;
  (json.animations || []).forEach((a, ai) => {
    a.channels.forEach((ch) => {
      const node = json.nodes[ch.target.node];
      if (!node || node.name !== 'Hips') return;
      if (ch.target.path !== 'rotation') return;

      const samp = a.samplers[ch.sampler];
      const acc = json.accessors[samp.output];
      if (acc.componentType !== 5126 || acc.type !== 'VEC4') {
        console.warn(`anim[${ai}] Hips.rotation accessor 类型不预期 componentType=${acc.componentType} type=${acc.type}，跳过`);
        return;
      }
      const bv = json.bufferViews[acc.bufferView];
      const stride = bv.byteStride || 16;
      const base = accessorOffset(json, samp.output, binStart);
      const n = acc.count;
      let modified = 0;
      for (let i = 0; i < n; i++) {
        const off = base + i * stride;
        const q = {
          x: buf.readFloatLE(off),
          y: buf.readFloatLE(off + 4),
          z: buf.readFloatLE(off + 8),
          w: buf.readFloatLE(off + 12),
        };
        const r = quatMult(comp, q);
        buf.writeFloatLE(r.x, off);
        buf.writeFloatLE(r.y, off + 4);
        buf.writeFloatLE(r.z, off + 8);
        buf.writeFloatLE(r.w, off + 12);
        modified++;
      }
      modifiedChannels++;
      modifiedFrames += modified;
      console.log(`anim[${ai}] Hips.rotation 通道已修正 ${modified} 帧 (accessor[${samp.output}])`);
    });
  });

  if (modifiedChannels === 0) {
    console.error('未找到 Hips.rotation 动画通道，无需修复');
    process.exit(1);
  }

  // 4. 备份 + 写回
  const backup = ANIM_FILE + '.bak_upfix';
  if (!fs.existsSync(backup)) {
    fs.copyFileSync(ANIM_FILE, backup);
    console.log('已备份原文件:', backup);
  }
  fs.writeFileSync(ANIM_FILE, buf);
  console.log(`✅ 修复完成：共修正 ${modifiedChannels} 个 Hips.rotation 通道 / ${modifiedFrames} 帧`);
  console.log('文件已写回:', ANIM_FILE);
}

main();
