/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
/**
 * soundWeatherCard.js —— 天气声音的「候选池」和「卡片」两块 HTML
 *
 * 为什么单独拆出来：
 *   soundWeather.js 已经卡在 500 行红线上，给「雾」补上候选池（它原先只有低通参数、
 *   没有声音入口）又得加几十行。按项目规范拆文件，不在主文件里堆。
 *
 * 这里只画 HTML，不碰状态、不发请求；事件由 soundWeather.js 的 bind() 统一挂。
 *
 * 对外：window.SoundWeatherCard.pool(key, cfg, sounds) / .card(key, title, note, body, enabled)
 */
(function () {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function baseName(u) { return String(u || '').split('/').pop() || ''; }

  /**
   * 候选池：当前在用的（绿点）+ 其它候选 + 底部「加进来 / 上传」
   * 池子为空时下拉里仍列出素材库所有声音——先试听再决定要不要固定下来。
   *
   * 【2026-11-15】池底加了「⬆ 上传」：不用再跳到音效库去传。
   * 上传落盘后会自动进本类型的候选池并设为当前（逻辑在 soundWeather.js 的 onPickFile），
   * 这里只负责画按钮 + 藏一个 file input，id 约定 sw-<key>-file。
   */
  function pool(key, cfg, sounds) {
    cfg = cfg || {};
    var list = cfg.candidates || [];
    var rows = list.length
      ? list.map(function (u) {
        var on = (u === cfg.url);
        return '<div class="sw-pool-row' + (on ? ' on' : '') + '" data-cur="' + key + '" data-url="' + esc(u) + '">' +
          '<span class="sw-radio"></span>' +
          '<span class="sw-pool-nm" title="' + esc(u) + '">' + esc(baseName(u)) + '</span>' +
          '<button class="sw-mini" data-try="' + key + '" data-url="' + esc(u) + '">听</button>' +
          '<button class="sw-mini" data-drop="' + key + '" data-url="' + esc(u) + '">移除</button>' +
          '</div>';
      }).join('')
      : '<div class="sw-pool-empty">这个类型还没有固定声音。下拉里选一个 →「试听」先听 → 满意了点「＋ 加进来」</div>';

    var using = list.filter(function (u) { return u; });
    var opts = (sounds || []).filter(function (s) { return using.indexOf(s.url) < 0; }).map(function (s) {
      return '<option value="' + esc(s.url) + '">' + esc(s.name) + '</option>';
    }).join('');

    return '<div class="sw-pool">' +
      '<div class="sw-pool-hd">候选声音 · ' + list.length + ' 个' +
        (cfg.url ? '' : '　<span style="color:var(--orange)">（当前没用）</span>') + '</div>' +
      rows +
      '<div class="sw-pool-acts">' +
        '<select id="sw-' + key + '-add">' + (opts || '<option value="">素材库没有别的了</option>') + '</select>' +
        '<button class="sw-mini" data-trysel="' + key + '" title="试听下拉里选中的这个（还没加进候选池也能先听）">▶</button>' +
        '<button class="sw-mini" data-add="' + key + '">＋ 加进来</button>' +
        '<button class="sw-mini" data-upload="' + key + '" title="直接上传一段音频，落在素材库，传完自动设为当前">⬆ 上传</button>' +
        '<input type="file" id="sw-' + key + '-file" accept=".mp3,.ogg,.wav,.aac,.m4a" style="display:none">' +
      '</div>' +
      '</div>';
  }

  function card(key, title, note, body, enabled) {
    return '<div class="sw-card">' +
      '<div class="sw-hd"><span class="sw-tt">' + title + '</span>' +
      '<label class="sw-sw"><input type="checkbox" id="sw-' + key + '-on"' + (enabled ? ' checked' : '') + '> 启用</label></div>' +
      body +
      '<div class="sw-note">' + note + '</div>' +
      '</div>';
  }

  window.SoundWeatherCard = { pool: pool, card: card };
})();
