/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
/**
 * soundWeatherGen.js —— 天气音的「派生变体」生成器
 *
 * 干什么：拿一段现成的天气音（风/雨/雪/雷那种长循环噪声），渲染出几个不同味道的版本，
 *        存成新文件放进同一个素材目录，返回新文件的 url 给你加进候选池。
 *
 * 为什么不改时长：天气音是**无限循环**的底噪，裁短或拉长会改变循环点，容易听出接缝。
 *   所以只动频响——同一段噪声换个滤波，听感就是「更闷的风」「更薄更尖的雨」，
 *   长度、循环特性完全不变，游戏里那套交叉淡化逻辑不受影响。
 *
 * 为什么在浏览器里算：和 ⑤ 的编辑器同一个理由——本机和服务端都没装 ffmpeg，
 *   OfflineAudioContext 渲染几十毫秒的噪声比装一套 ffmpeg 划算得多。
 *
 * 对外：window.SoundWeatherGen.make(srcUrl, onProgress) -> Promise<[{url, name, label}]>
 */
(function () {
  'use strict';

  // 三个变体的频响配方：闷 / 薄 / 沉。数值是按环境噪声的听感调的，不是随便取的。
  var RECIPES = [
    { label: '更闷',  filter: { type: 'lowpass',  freq: 1100, q: 0.7 }, gain: 1.0 },
    { label: '更薄',  filter: { type: 'highpass', freq: 900,  q: 0.6 }, gain: 0.9 },
    { label: '更低沉', filter: { type: 'lowpass',  freq: 520,  q: 0.9 }, gain: 1.15 }
  ];

  function ac() {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    return new AC();
  }

  function toWav(chs, sr) {
    var nch = chs.length;
    var len = chs[0].length;
    var dataLen = len * nch * 2;
    var buf = new ArrayBuffer(44 + dataLen);
    var v = new DataView(buf);
    function str(off, s) { for (var i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); }
    str(0, 'RIFF'); v.setUint32(4, 36 + dataLen, true); str(8, 'WAVE');
    str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
    v.setUint16(22, nch, true); v.setUint32(24, sr, true);
    v.setUint32(28, sr * nch * 2, true); v.setUint16(32, nch * 2, true); v.setUint16(34, 16, true);
    str(36, 'data'); v.setUint32(40, dataLen, true);
    var off = 44;
    for (var i = 0; i < len; i++) {
      for (var c = 0; c < nch; c++) {
        var s = chs[c][i];
        s = s > 1 ? 1 : (s < -1 ? -1 : s);
        v.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
        off += 2;
      }
    }
    return new Blob([buf], { type: 'audio/wav' });
  }

  /** 用滤波把一段 buffer 重新渲染一遍（长度严格一致） */
  function renderVariant(ctx, srcBuf, recipe) {
    return new Promise(function (resolve) {
      var OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      if (!OAC) { resolve(null); return; }
      var ch = Math.min(1, srcBuf.numberOfChannels);
      var off;
      try {
        off = new OAC(ch, srcBuf.length, srcBuf.sampleRate);
      } catch (e) { resolve(null); return; }

      var src = off.createBufferSource();
      src.buffer = srcBuf;

      var flt = off.createBiquadFilter();
      flt.type = recipe.filter.type;
      flt.frequency.value = recipe.filter.freq;
      flt.Q.value = recipe.filter.q;

      var g = off.createGain();
      g.gain.value = recipe.gain;

      src.connect(flt);
      flt.connect(g);
      g.connect(off.destination);
      src.start(0);

      off.startRendering().then(function (out) {
        var chs = [];
        for (var c = 0; c < out.numberOfChannels; c++) chs.push(out.getChannelData(c));
        resolve(chs);
      })['catch'](function () { resolve(null); });
    });
  }

  async function make(srcUrl, onProgress) {
    var ctx = ac();
    if (!ctx) throw new Error('浏览器不支持 WebAudio');

    var res = await fetch(srcUrl);
    if (!res.ok) throw new Error('读不到源文件 HTTP ' + res.status);
    var srcBuf = await ctx.decodeAudioData(await res.arrayBuffer());

    var out = [];
    var base = String(srcUrl).split('/').pop().replace(/\.[^.]+$/, '') || 'weather';

    for (var i = 0; i < RECIPES.length; i++) {
      var r = RECIPES[i];
      if (typeof onProgress === 'function') onProgress(i + 1, RECIPES.length, r.label);
      var chs = await renderVariant(ctx, srcBuf, r);
      if (!chs) continue;

      var blob = toWav(chs, srcBuf.sampleRate);
      var fd = new FormData();
      fd.append('sound_file', blob, base + '-' + (i + 1) + '.wav');
      try {
        var up = await fetch('/api/character-templates/upload-sound', { method: 'POST', body: fd });
        var d = await up.json().catch(function () { return {}; });
        if (!up.ok || !d.success) throw new Error(d.error || ('HTTP ' + up.status));
        out.push({ url: d.url, name: d.filename, label: r.label });
      } catch (e) {
        console.warn('[WeatherGen] 第 ' + (i + 1) + ' 个变体上传失败:', e.message);
      }
    }
    try { ctx.close(); } catch (e) {}
    if (!out.length) throw new Error('三个变体都没生成成功');
    return out;
  }

  window.SoundWeatherGen = { make: make };
})();
