/**
 * dracoDecode.js — Draco 压缩 GLB 的解码前处理
 *
 * 背景（2026-11-23）：
 *   gltfpack 0.24（WASM 版）**没有 Draco 解码器**，遇到 extensionsRequired 含
 *   KHR_draco_mesh_compression 的 GLB 会直接抛
 *   「file requires Draco mesh compression support」，导致减面 / 几何压缩 / LOD
 *   三条链路对 Draco 源全部空转（LOD 那边早在 2026-10-14 就把它判成永久终态）。
 *
 * 做法：用 @gltf-transform + draco3d 把 Draco 几何解码成普通 GLB（临时文件），
 *   再交给 gltfpack 处理。原文件不动，临时文件用完即删。
 *
 * 注意：
 *   - 解码会展开几何数据，256 万面的模型解压后体积可能上百 MB（内存/磁盘需缓冲）；
 *   - 贴图保持原 mimeType 不动（webp 若 gltfpack 不认，由调用方决定是否跳过）；
 *   - 任何失败都返回 { decoded:false, reason }，不抛错阻断上传主流程。
 */
const path = require('path');
const fs = require('fs');
const os = require('os');

let ioPromise = null;
let ioFailed = false;

/** 懒加载 gltf-transform IO（draco3d 的 wasm 初始化较慢，全局复用一次） */
function _getIO() {
  if (ioFailed) return Promise.reject(new Error('gltf-transform 不可用'));
  if (!ioPromise) {
    ioPromise = (async () => {
      const { NodeIO } = require('@gltf-transform/core');
      // 注册全部扩展：Draco 之外，实测不少导出器要求 EXT_texture_webp / KHR_mesh_quantization
      // 等扩展也必须在册，否则 NodeIO.read 直接抛「Missing required extension」
      const { ALL_EXTENSIONS } = require('@gltf-transform/extensions');
      const draco3d = require('draco3d');
      const [decoder, encoder] = await Promise.all([
        draco3d.createDecoderModule({}),
        draco3d.createEncoderModule({}),
      ]);
      return new NodeIO()
        .registerExtensions(ALL_EXTENSIONS)
        .registerDependencies({
          'draco3d.decoder': decoder,
          'draco3d.encoder': encoder,
        });
    })().catch((e) => {
      ioFailed = true;
      ioPromise = null;
      throw e;
    });
  }
  return ioPromise;
}

/** 读 GLB 头部的 JSON 块（只读文件头，不把整个 GLB 读进内存） */
function readGlbJson(absPath) {
  let fd;
  try {
    fd = fs.openSync(absPath, 'r');
    const head = Buffer.alloc(20);
    if (fs.readSync(fd, head, 0, 20, 0) < 20) return null;
    if (head.readUInt32LE(0) !== 0x46546c67) return null; // 'glTF'
    const jsonLen = head.readUInt32LE(12);
    if (!jsonLen || jsonLen > 64 * 1024 * 1024) return null; // 防御异常长度
    const jsonBuf = Buffer.alloc(jsonLen);
    fs.readSync(fd, jsonBuf, 0, jsonLen, 20);
    return JSON.parse(jsonBuf.toString('utf8'));
  } catch (e) {
    return null;
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch (_) {} }
  }
}

/** 是否 Draco 压缩（看 extensionsRequired / extensionsUsed / primitive 扩展） */
function hasDracoCompression(absPath) {
  try {
    const json = readGlbJson(absPath);
    if (!json) return false;
    const req = json.extensionsRequired || [];
    const used = json.extensionsUsed || [];
    if (req.includes('KHR_draco_mesh_compression')) return true;
    if (used.includes('KHR_draco_mesh_compression')) return true;
    return (json.meshes || []).some((m) =>
      (m.primitives || []).some((p) => p.extensions && p.extensions.KHR_draco_mesh_compression)
    );
  } catch (e) {
    return false;
  }
}

/**
 * 把 Draco 压缩 GLB 解码为未压缩 GLB（写到系统临时目录）
 * @param {string} srcPath 源 .glb 绝对路径
 * @returns {Promise<object>}
 *   { decoded:true, decodedPath, sourceSize, decodedSize }   — 成功（decodedPath 需由调用方清理）
 *   { decoded:false, skipped:true, reason }                  — 跳过（not-draco / 失败）
 */
async function decodeDracoToTemp(srcPath) {
  if (!hasDracoCompression(srcPath)) {
    return { decoded: false, skipped: true, reason: 'not-draco' };
  }
  const tmpPath = path.join(
    os.tmpdir(),
    'draco-dec-' + Date.now() + '-' + Math.round(Math.random() * 1e6) + '.glb'
  );
  try {
    const io = await _getIO();
    const doc = await io.read(srcPath);
    // 丢掉 Draco 扩展 → 写出即未压缩几何
    // v4 没有 doc.dispose()，移除扩展统一走 document.disposeExtension(name)
    const usedExts = doc.getRoot().listExtensionsUsed().map((e) => e.extensionName);
    if (usedExts.includes('KHR_draco_mesh_compression')) {
      doc.disposeExtension('KHR_draco_mesh_compression');
    }
    await io.write(tmpPath, doc);

    const json = readGlbJson(tmpPath);
    if (json && (json.extensionsRequired || []).includes('KHR_draco_mesh_compression')) {
      // dispose 没清干净 → 视为失败，避免把同样读不进去的文件喂给 gltfpack
      await fs.promises.unlink(tmpPath).catch(() => {});
      return { decoded: false, skipped: true, reason: 'ext-required-residual' };
    }
    if (!fs.existsSync(tmpPath)) {
      return { decoded: false, skipped: true, reason: 'no-output' };
    }
    return {
      decoded: true,
      decodedPath: tmpPath,
      sourceSize: fs.statSync(srcPath).size,
      decodedSize: fs.statSync(tmpPath).size,
    };
  } catch (e) {
    await fs.promises.unlink(tmpPath).catch(() => {});
    console.warn('[dracoDecode] 解码失败，保留原文件:', path.basename(srcPath), e.message);
    return { decoded: false, skipped: true, reason: 'error', error: e.message };
  }
}

module.exports = { decodeDracoToTemp, hasDracoCompression, readGlbJson };
