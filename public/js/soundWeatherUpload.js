/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
/**
 * soundWeatherUpload.js —— 天气声音「直接上传」这一步
 *
 * 只干一件事：把用户选的音频文件 POST 到后端既有的上传接口，把 url 交回去。
 * 不碰界面、不碰状态——要不要进候选池、要不要设为当前，由 soundWeather.js 决定。
 * 这样拆是因为 soundWeather.js 已经卡在 500 行红线上（项目规范），逻辑别再往里堆。
 *
 * 接口：POST /api/character-templates/upload-sound（multipart: sound_file）
 * 返回：{ success, url, filename, size, compressed }
 * ★ 后端会自动把 WAV 压成 32kbps 单声道 MP3（soundStore.js），
 *   所以传 30MB 的原始 wav 也不会把素材库撑大。
 *
 * ★ 鉴权：admin.html 里的 adminAuthFetch.js 已给 window.fetch 统一注入管理员令牌，
 *   这里直接用 fetch 即可，**不要再手动加 Authorization 头**（会和它重复）。
 */
(function () {
  'use strict';

  var ENDPOINT = '/api/character-templates/upload-sound';

  /**
   * @param {File} file  用户选的音频文件
   * @returns {Promise<{url:string, filename:string, size:number, compressed:boolean}>}
   */
  function upload(file) {
    return new Promise(function (resolve, reject) {
      if (!file) { reject(new Error('没有选到文件')); return; }

      var fd = new FormData();
      fd.append('sound_file', file);

      fetch(ENDPOINT, { method: 'POST', body: fd })
        .then(function (r) {
          return r.json().catch(function () { return {}; }).then(function (d) {
            if (!r.ok || !d.success || !d.url) {
              throw new Error(d.error || ('HTTP ' + r.status));
            }
            return d;
          });
        })
        .then(resolve)
        .catch(reject);
    });
  }

  window.SoundWeatherUpload = { upload: upload };
})();
