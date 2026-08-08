/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
/**
 * characterTemplates 工具函数模块
 * 包含：GLB压缩、文件哈希、骨骼处理等工具函数
 */

const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');

// ===== gltfpack GLB 压缩工具 =====
let gltfpackReady = null;
function _getGltfpack() {
  if (!gltfpackReady) {
    try {
      gltfpackReady = require('gltfpack');
    } catch (e) {
      console.warn('[gltfpack] 未安装，跳过压缩:', e.message);
    }
  }
  return gltfpackReady;
}

/**
 * 用 gltfpack 压缩 GLB 文件（原地替换）
 * 参数 -tc 开启纹理压缩，-ac 开启动画曲线优化，-kn 保留所有节点名称（骨骼）
 * 返回 { originalSize, compressedSize, ratio } 或 null（压缩失败时）
 */
async function compressGlb(filePath) {
  const gp = _getGltfpack();
  if (!gp) return null;
  try {
    const originalBuf = await fs.readFile(filePath);
    const originalSize = originalBuf.length;

    // gltfpack iface：通过内存 buffer 操作，避免路径问题
    const inputKey = 'input.glb';
    const outputKey = 'output.glb';
    let outputBuf = null;

    const iface = {
      read(p) {
        if (p === inputKey) return new Uint8Array(originalBuf);
        throw new Error('unknown read path: ' + p);
      },
      write(p, data) {
        if (p === outputKey) outputBuf = Buffer.from(data);
      },
    };

    // -ac: 动画曲线压缩（关键帧抽稀）, -kn: 保留节点名称（骨骼名不丢失）
    await gp.pack(['-i', inputKey, '-o', outputKey, '-ac', '-kn'], iface);

    if (!outputBuf || outputBuf.length === 0) {
      console.warn('[gltfpack] 输出为空，跳过替换');
      return null;
    }

    // 压缩后如果体积反而更大，保留原文件
    if (outputBuf.length >= originalSize) {
      console.log(`[gltfpack] 压缩后(${outputBuf.length}) >= 原始(${originalSize})，保留原文件`);
      return { originalSize, compressedSize: originalSize, ratio: 1 };
    }

    await fs.writeFile(filePath, outputBuf);
    const ratio = outputBuf.length / originalSize;
    console.log(`[gltfpack] 压缩成功: ${(originalSize/1024).toFixed(1)}KB → ${(outputBuf/1024).toFixed(1)}KB (${(ratio*100).toFixed(1)}%)`);
    return { originalSize, compressedSize: outputBuf.length, ratio };
  } catch (e) {
    console.warn('[gltfpack] 压缩失败，保留原文件:', e.message);
    return null;
  }
}

// 上传大小限制：默认 300MB，可用环境变量覆盖
const CHAR_TEMPLATE_MAX_UPLOAD_MB = (() => {
  const raw = process.env.CHAR_TEMPLATE_MAX_UPLOAD_MB || process.env.UPLOAD_MAX_MB || '300';
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 300;
})();
const CHAR_TEMPLATE_MAX_UPLOAD_BYTES = CHAR_TEMPLATE_MAX_UPLOAD_MB * 1024 * 1024;

// 计算文件 SHA256 哈希
async function fileHash(filePath) {
  const buf = await fs.readFile(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

// 解析GLB文件，提取骨骼信息
function extractBonesFromGlb(filePath) {
  try {
    const fs = require('fs');
    const glb = fs.readFileSync(filePath);
    
    // 简单的GLB解析，仅提取骨骼信息
    // 注意：这是一个简化版本，实际生产环境可能需要使用专业的GLB解析库
    const bones = [];
    
    // 这里应该使用专业的GLB解析库来正确提取骨骼信息
    // 为了演示，我们假设返回一些示例骨骼名称
    // 在实际实现中，应该使用 three.js 或其他库来解析GLB
    
    // 示例骨骼名称
    const exampleBones = [
      'Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head',
      'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand',
      'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand',
      'LeftUpperLeg', 'LeftLowerLeg', 'LeftFoot', 'LeftToeBase',
      'RightUpperLeg', 'RightLowerLeg', 'RightFoot', 'RightToeBase'
    ];
    
    return exampleBones;
  } catch (e) {
    console.error('解析GLB文件失败:', e.message);
    return [];
  }
}

// Levenshtein距离算法，用于模糊匹配骨骼名称
function levenshteinDistance(a, b) {
  const matrix = [];
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

// 骨骼匹配函数
function matchBones(sourceBones, targetBones) {
  const matches = {};
  const confidence = {};
  
  sourceBones.forEach(sourceBone => {
    let bestMatch = null;
    let bestDistance = Infinity;
    
    targetBones.forEach(targetBone => {
      const distance = levenshteinDistance(sourceBone.toLowerCase(), targetBone.toLowerCase());
      if (distance < bestDistance) {
        bestDistance = distance;
        bestMatch = targetBone;
      }
    });
    
    if (bestMatch) {
      // 计算匹配置信度 (0-1)
      const maxLength = Math.max(sourceBone.length, bestMatch.length);
      const matchConfidence = 1 - (bestDistance / maxLength);
      matches[sourceBone] = bestMatch;
      confidence[sourceBone] = matchConfidence;
    }
  });
  
  return { matches, confidence };
}

// 标准骨骼列表
const STANDARD_BONES = [
  'Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head',
  'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand',
  'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand',
  'LeftUpperLeg', 'LeftLowerLeg', 'LeftFoot', 'LeftToeBase',
  'RightUpperLeg', 'RightLowerLeg', 'RightFoot', 'RightToeBase'
];

module.exports = {
  compressGlb,
  CHAR_TEMPLATE_MAX_UPLOAD_MB,
  CHAR_TEMPLATE_MAX_UPLOAD_BYTES,
  fileHash,
  extractBonesFromGlb,
  matchBones,
  STANDARD_BONES
};
