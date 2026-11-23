/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
/**
 * soundWaveDraw.js —— 波形画布绘制（给 soundEditor.js 用）
 *
 * 为什么单独一个文件：soundEditor.js 加完鼠标拖动交互已经 550 行，超项目 500 行红线，
 * 按规范把「画」这部分抽出来。这里只管像素，不碰状态，改样式不会牵连交互逻辑。
 *
 * 对外：window.SoundWave.draw(canvas, { buf, start, end, fadeIn, fadeOut, height })
 *   buf 是 AudioBuffer；start/end/fadeIn/fadeOut 单位秒；height 默认 118。
 */
(function () {
  'use strict';

  function draw(cv, opt) {
    if (!cv || !opt || !opt.buf) return;
    var buf = opt.buf;
    var start = opt.start || 0;
    var end = opt.end == null ? buf.duration : opt.end;
    var fadeIn = opt.fadeIn || 0;
    var fadeOut = opt.fadeOut || 0;
    var dur = buf.duration || 1;
    var h = opt.height || 118;

    var dpr = window.devicePixelRatio || 1;
    var w = cv.clientWidth || 640;
    cv.width = Math.floor(w * dpr);
    cv.height = Math.floor(h * dpr);
    var g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#0a0e13';
    g.fillRect(0, 0, w, h);

    // ── 波形本体：每列取 min/max ──
    var data = buf.getChannelData(0);
    var step = Math.max(1, Math.floor(data.length / w));
    var mid = (h - 14) / 2;
    var amp = mid - 5;
    g.fillStyle = 'rgba(0,255,0,0.55)';
    for (var x = 0; x < w; x++) {
      var s0 = x * step;
      var min = 1, max = -1;
      for (var i = 0; i < step; i += 4) {
        var v = data[s0 + i];
        if (v === undefined) break;
        if (v < min) min = v;
        if (v > max) max = v;
      }
      if (min > max) continue;
      var y1 = mid - max * amp;
      var y2 = mid - min * amp;
      g.fillRect(x, y1, 1, Math.max(1, y2 - y1));
    }

    // ── 选区外压暗 ──
    var x0 = (start / dur) * w;
    var x1 = (end / dur) * w;
    g.fillStyle = 'rgba(0,0,0,0.62)';
    g.fillRect(0, 0, Math.max(0, x0), h);
    g.fillRect(Math.min(w, x1), 0, Math.max(0, w - x1), h);

    // ── 边界线 + 顶部抓手 ──
    g.strokeStyle = 'rgba(0,255,0,0.9)';
    g.lineWidth = 1;
    [x0, x1].forEach(function (px) {
      if (px < 0 || px > w) return;
      g.beginPath(); g.moveTo(px, 0); g.lineTo(px, h - 14); g.stroke();
      g.fillStyle = 'rgba(0,255,0,0.9)';
      g.fillRect(px - 2, 0, 4, 12);
    });

    // ── 淡入淡出斜线 ──
    if (fadeIn > 0 || fadeOut > 0) {
      g.strokeStyle = 'rgba(0,200,255,0.75)';
      g.beginPath();
      if (fadeIn > 0) { g.moveTo(x0, 14); g.lineTo(x0 + (fadeIn / dur) * w, amp * 2 - 4); }
      if (fadeOut > 0) { g.moveTo(x1 - (fadeOut / dur) * w, amp * 2 - 4); g.lineTo(x1, 14); }
      g.stroke();
    }

    // ── 时间刻度 ──
    g.fillStyle = 'rgba(255,255,255,0.32)';
    g.font = '9px Consolas, monospace';
    var tick = dur > 6 ? 2 : (dur > 3 ? 1 : 0.5);
    for (var t = 0; t <= dur + 0.001; t += tick) {
      var tx = (t / dur) * w;
      g.fillRect(tx, h - 12, 1, 4);
      g.fillText(t.toFixed(tick < 1 ? 1 : 0) + 's', Math.min(w - 18, tx + 2), h - 2);
    }
  }

  window.SoundWave = { draw: draw };
})();
