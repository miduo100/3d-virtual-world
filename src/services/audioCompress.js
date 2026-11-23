/**
 * audioCompress.js —— 音效压缩管线（WAV → MP3 单声道低码率）
 *
 * 为什么要做（2026-11-03 实测数据，项目内样本 env-wind.wav，3.0s / 44.1kHz / mono）：
 *   原始 WAV                        258.4 KB   （86.1 KB/s）
 *   MP3 44.1k mono 64k              23.7 KB   10.9x
 *   MP3 44.1k mono 48k              17.9 KB   14.4x
 *   MP3 44.1k mono 32k              11.9 KB   21.6x   ← 默认
 *   MP3 22.05k mono 32k             11.9 KB   21.6x
 *   Opus 48k mono 32kbps            11.5 KB   22.4x
 *
 * 为什么默认 MP3 而不是 Opus：
 *   同体积下 Opus 音质确实更好，但项目里已经有 .ogg 在上传白名单里、
 *   而 Safari 不支持 Ogg Vorbis → decodeAudioData 静默失败（用户见「点了没声音」）。
 *   Opus 塞 WebM/Ogg 是同一个坑。默认走 MP3（全平台通吃），Opus 留作可选。
 *
 * 采样率策略（不一刀切）：
 *   动作/撞击类音效保留 44.1kHz —— 金属、玻璃、瓷器的高频细节在 22.05kHz 会明显发闷。
 *   环境铺底/氛围类降到 22.05kHz —— 内容以低频为主，听感几乎无损。
 *
 * 安全：转码失败 / 无体积收益 → 保留原文件，不阻断入库（仿 textureCompress.js 范式）。
 */
const fs = require('fs');
const path = require('path');

const DEFAULT_BITRATE = 32;       // kbps，单声道
const DEFAULT_SAMPLE_RATE = 44100;
const LOW_SAMPLE_RATE = 22050;
const BLOCK_SIZE = 1152;          // MP3 帧样本数

/**
 * 峰值归一化目标：-3 dBFS（不是 -1）
 *
 * 为什么留 2dB 余量（实测踩出来的）：
 *   MP3 是位压缩，编码时会把信号压得更"稠密"，解码后振幅会**反冲**超过原始值。
 *   实测：env-fire 原始峰值 0.5 → 归一化到 -1dBFS(0.891) → 解码后 1.0997，
 *   超过满刻度 → 播放时削顶失真（爆裂声会变成"咔咔"的方波感）。
 *   归一化到 -3dBFS(0.707) 后，同样的过冲比例落在 0.87，安全。
 *   损失的 2dB 响度无所谓——播放音量本来就是靠 slot.volume 增益控制的。
 */
const DEFAULT_TARGET_DBFS = -3;

// lamejs 是 ESM only（package.json type=module），CommonJS 里 require 拿到的是空对象。
// 用动态 import() 加载，不 hack 它的产物。
let lamePromise = null;
function loadLame() {
  if (!lamePromise) {
    lamePromise = import('@breezystack/lamejs').then(m => m.Mp3Encoder);
  }
  return lamePromise;
}

// ───────────────────────────── WAV 解析 ─────────────────────────────

/**
 * 读 WAV → { channels: Float32Array[], sampleRate, bitsPerSample }
 * 只支持 PCM（整数采样）；浮点 WAV 直接抛错，交给调用方保留原文件。
 */
function decodeWav(buf) {
  if (buf.length < 12 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('不是有效的 WAV 文件');
  }
  let pos = 12;
  let fmt = null;
  let dataOffset = -1;
  let dataLen = 0;
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    if (id === 'fmt ') {
      fmt = {
        audioFormat: buf.readUInt16LE(pos + 8),
        channels: buf.readUInt16LE(pos + 10),
        sampleRate: buf.readUInt32LE(pos + 12),
        bitsPerSample: buf.readUInt16LE(pos + 22),
      };
    } else if (id === 'data') {
      dataOffset = pos + 8;
      dataLen = Math.min(size, buf.length - dataOffset);
      break;
    }
    pos += 8 + size + (size % 2);
  }
  if (!fmt) throw new Error('WAV 缺少 fmt 块');
  if (dataOffset < 0) throw new Error('WAV 缺少 data 块');
  if (fmt.audioFormat !== 1) throw new Error('只支持 PCM 整数 WAV（audioFormat=' + fmt.audioFormat + '）');
  if (fmt.bitsPerSample !== 16 && fmt.bitsPerSample !== 8 && fmt.bitsPerSample !== 24) {
    throw new Error('不支持 ' + fmt.bitsPerSample + ' 位深的 WAV');
  }

  const nch = fmt.channels;
  const bytesPerSample = fmt.bitsPerSample / 8;
  const frames = Math.floor(dataLen / (nch * bytesPerSample));
  const channels = [];
  for (let c = 0; c < nch; c++) channels.push(new Float32Array(frames));

  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < nch; c++) {
      const off = dataOffset + (i * nch + c) * bytesPerSample;
      let v;
      if (fmt.bitsPerSample === 16) {
        v = buf.readInt16LE(off) / 32768;
      } else if (fmt.bitsPerSample === 8) {
        v = (buf.readUInt8(off) - 128) / 128;
      } else {
        // 24bit：取低 2 字节当有符号 16 位用，高位精度对音效无意义
        const b0 = buf.readUInt8(off);
        const b1 = buf.readUInt8(off + 1);
        const b2 = buf.readInt8(off + 2);
        v = ((b2 << 16) | (b1 << 8) | b0) / 8388608;
      }
      channels[c][i] = v;
    }
  }
  return { channels, sampleRate: fmt.sampleRate, channelsCount: nch, frames };
}

// ───────────────────────────── 音频处理 ─────────────────────────────

/** 多声道 → 单声道（等权平均） */
function toMono(channels) {
  if (channels.length === 1) return channels[0];
  const out = new Float32Array(channels[0].length);
  for (let c = 0; c < channels.length; c++) {
    const src = channels[c];
    for (let i = 0; i < out.length; i++) out[i] += src[i];
  }
  const inv = 1 / channels.length;
  for (let i = 0; i < out.length; i++) out[i] *= inv;
  return out;
}

/** 降采样（线性插值，够用：音效是宽带信号，但低码率下高频本来就要丢） */
function resample(src, srcRate, dstRate) {
  if (srcRate === dstRate) return src;
  const ratio = srcRate / dstRate;
  const outLen = Math.max(1, Math.floor(src.length / ratio));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const idx = Math.floor(pos);
    const frac = pos - idx;
    const a = src[idx] || 0;
    const b = idx + 1 < src.length ? src[idx + 1] : a;
    out[i] = a + (b - a) * frac;
  }
  return out;
}

/** 峰值归一化到 targetDbFS（避免压缩后音量忽大忽小） */
function normalizePeak(ch, targetDbFS) {
  let peak = 0;
  for (let i = 0; i < ch.length; i++) {
    const v = ch[i] < 0 ? -ch[i] : ch[i];
    if (v > peak) peak = v;
  }
  if (peak < 1e-6) return ch;
  const target = Math.pow(10, targetDbFS / 20);
  const gain = target / peak;
  const out = new Float32Array(ch.length);
  for (let i = 0; i < ch.length; i++) out[i] = ch[i] * gain;
  return out;
}

/**
 * MP3 编码。
 *
 * ★ 关键：lamejs 的 encodeBuffer 收 **Int16Array**（-32768..32767），
 *   不是 Float32。传 Float32 不会报错，只会安静地编码出一段**静音**——
 *   文件能解码、体积正常、但波形全零。（这个坑踩过一次，别再踩。）
 */
async function encodeMp3(channelsFloat, sampleRate, kbps, channelCount, Mp3Encoder) {
  const enc = new Mp3Encoder(channelCount, sampleRate, kbps);
  const n = channelsFloat[0].length;
  const chunks = [];

  // Float32(-1..1) → Int16
  const toInt16 = (src, from, len) => {
    const out = new Int16Array(len);
    for (let i = 0; i < len; i++) {
      let v = src[from + i];
      if (v > 1) v = 1; else if (v < -1) v = -1;
      out[i] = v < 0 ? Math.round(v * 32768) : Math.round(v * 32767);
    }
    return out;
  };

  for (let i = 0; i < n; i += BLOCK_SIZE) {
    const len = Math.min(BLOCK_SIZE, n - i);
    const a = toInt16(channelsFloat[0], i, len);
    let buf;
    if (channelCount === 2) {
      const b = toInt16(channelsFloat[1], i, len);
      buf = enc.encodeBuffer(a, b);
    } else {
      buf = enc.encodeBuffer(a);
    }
    if (buf && buf.length) chunks.push(Buffer.from(buf));
  }
  const tail = enc.flush();
  if (tail && tail.length) chunks.push(Buffer.from(tail));
  return Buffer.concat(chunks);
}

// ───────────────────────────── 对外接口 ─────────────────────────────

/**
 * 压缩音频 buffer。
 * @param {Buffer} inputBuf      原始音频（WAV/PCM）
 * @param {object} [opts]
 * @param {number} [opts.bitrate=32]        目标码率 kbps
 * @param {number} [opts.sampleRate=44100]  目标采样率（22050 或 44100）
 * @param {number} [opts.targetDbFS=-3]     峰值归一化目标（留 2dB 给 MP3 解码反冲）
 * @param {boolean} [opts.mono=true]        是否转单声道
 * @returns {Promise<{ok:boolean, buffer?:Buffer, sizeIn:number, sizeOut:number, ratio?:number, sampleRate?:number, bitrate?:number, reason?:string}>}
 *          ok=false 表示「不建议压缩」，调用方应保留原文件
 */
async function compressAudio(inputBuf, opts = {}) {
  const bitrate = opts.bitrate || DEFAULT_BITRATE;
  const targetRate = opts.sampleRate || DEFAULT_SAMPLE_RATE;
  const targetDbFS = opts.targetDbFS != null ? opts.targetDbFS : DEFAULT_TARGET_DBFS;
  const wantMono = opts.mono !== false;
  const sizeIn = inputBuf.length;

  let decoded;
  try {
    decoded = decodeWav(inputBuf);
  } catch (e) {
    return { ok: false, sizeIn, sizeOut: sizeIn, reason: e.message };
  }
  if (!decoded.frames) {
    return { ok: false, sizeIn, sizeOut: sizeIn, reason: 'WAV 没有采样数据' };
  }

  try {
    const Mp3Encoder = await loadLame();

    let channels = decoded.channels.map(ch => resample(ch, decoded.sampleRate, targetRate));
    if (wantMono) {
      channels = [toMono(channels)];
    } else {
      // 立体声但限幅到 2 声道
      while (channels.length < 2) channels.push(new Float32Array(channels[0].length));
      channels = channels.slice(0, 2);
    }
    // 每个声道各自归一化
    channels = channels.map(ch => normalizePeak(ch, targetDbFS));

    const out = await encodeMp3(channels, targetRate, bitrate, channels.length, Mp3Encoder);
    if (!out || !out.length) {
      return { ok: false, sizeIn, sizeOut: sizeIn, reason: 'MP3 编码产出为空' };
    }
    // 无收益就不给压缩版（让调用方保留原文件）
    if (out.length >= sizeIn) {
      return { ok: false, sizeIn, sizeOut: sizeIn, reason: '压缩后体积未变小' };
    }
    return {
      ok: true,
      buffer: out,
      sizeIn,
      sizeOut: out.length,
      ratio: sizeIn / out.length,
      sampleRate: targetRate,
      bitrate,
      channels: channels.length,
      durationSec: decoded.frames / decoded.sampleRate,
    };
  } catch (e) {
    return { ok: false, sizeIn, sizeOut: sizeIn, reason: '编码失败：' + e.message };
  }
}

/**
 * 就地压缩一个文件，产出同目录的 .mp3。
 * 无收益 / 失败 → 不写盘，返回 null（调用方保留原文件）。
 * @returns {Promise<null|{mp3Path:string, sizeIn:number, sizeOut:number, ratio:number}>}
 */
async function compressFile(filePath, opts = {}) {
  let buf;
  try {
    buf = fs.readFileSync(filePath);
  } catch (e) {
    return null;
  }
  const r = await compressAudio(buf, opts);
  if (!r.ok) return null;
  const mp3Path = filePath.replace(/\.[^.]+$/, '') + '.mp3';
  try {
    fs.writeFileSync(mp3Path, r.buffer);
  } catch (e) {
    console.warn('[audioCompress] 写入失败:', e.message);
    return null;
  }
  return { mp3Path, sizeIn: r.sizeIn, sizeOut: r.sizeOut, ratio: r.ratio };
}

/**
 * 判断一个素材该用哪档采样率。
 * 规则按文件名/场景关键词粗判，只影响「是否降到 22.05kHz」这一档，
 * 判错的后果只是文件稍大或稍闷，不会破坏文件。
 */
function suggestSampleRate(name, hint) {
  const text = String(name || '') + ' ' + String(hint || '');
  // 高频细节敏感 → 保 44.1kHz
  if (/metal|glass|ceramic|impact|hit|weapon|sword|bell|metal|金属|玻璃|瓷|撞击|武器|剑|铃/i.test(text)) {
    return DEFAULT_SAMPLE_RATE;
  }
  // 环境铺底 → 22.05kHz 足够
  if (/env|amb|wind|rain|water|fire|birds|city|leaves|weather|pad|loop|环境|风|雨|水|火|鸟|城市|叶|天气|铺底|循环/i.test(text)) {
    return LOW_SAMPLE_RATE;
  }
  return DEFAULT_SAMPLE_RATE;
}

module.exports = {
  compressAudio,
  compressFile,
  decodeWav,
  toMono,
  resample,
  normalizePeak,
  suggestSampleRate,
  DEFAULT_BITRATE,
  DEFAULT_SAMPLE_RATE,
  LOW_SAMPLE_RATE,
};
