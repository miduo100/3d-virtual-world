/**
 * 天空库 API 端到端验收
 *
 * 用法: node scripts/accept_sky_api.js [adminUser] [adminPass]
 * 默认账号: baseline_shot / Baseline#185（截图专用管理员）
 *
 * 覆盖：列表 / 上传全景图 / 上传 HDR / 选中并内联 / 环境光照开关 / 回退默认 / 删除
 * 结束后自动清理测试产生的数据（不残留）。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const BASE = process.env.API_BASE || 'http://localhost:3002';
const USER = process.argv[2] || 'baseline_shot';
const PASS = process.argv[3] || 'Baseline#185';

const IMG = path.join(__dirname, '..', 'public', 'uploads', 'sky', 'DaySkyHDRI054B_1K_TONEMAPPED.jpg');
const HDR = path.join(__dirname, '..', 'public', 'uploads', 'sky', 'DaySkyHDRI054B_1K_HDR.exr');

const results = [];
function check(name, cond, extra) {
  results.push({ name, ok: !!cond, extra: extra || '' });
  console.log(`${cond ? 'PASS' : 'FAIL'} | ${name}${extra ? ' | ' + extra : ''}`);
}

let TOKEN = '';
function auth(extra) {
  const h = { Authorization: 'Bearer ' + TOKEN };
  return Object.assign(h, extra || {});
}

async function uploadFile(file) {
  const buf = fs.readFileSync(file);
  const fd = new FormData();
  fd.append('file', new Blob([buf]), path.basename(file));
  const r = await fetch(BASE + '/api/sky/upload', { method: 'POST', headers: auth(), body: fd });
  return r.json();
}

async function setWeather(body) {
  const r = await fetch(BASE + '/api/config/weather', {
    method: 'PUT',
    headers: auth({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body)
  });
  return r.json();
}

(async () => {
  // 0. 登录
  const lr = await fetch(BASE + '/api/admin-auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USER, password: PASS })
  });
  const ld = await lr.json();
  TOKEN = ld.token || ld.accessToken || '';
  check('A0 admin login', !!TOKEN, TOKEN ? 'token ok' : JSON.stringify(ld));
  if (!TOKEN) return finish();

  // 1. 列表含内置默认天空
  const list0 = await (await fetch(BASE + '/api/sky/list', { headers: auth() })).json();
  check('A1 list has default sky', list0.success && list0.skies[0] && list0.skies[0].id === 'default',
    'count=' + (list0.skies ? list0.skies.length : 'n/a'));

  // 2. 上传全景图
  let imgSky = null;
  if (fs.existsSync(IMG)) {
    const up = await uploadFile(IMG);
    imgSky = up.sky || null;
    check('A2 upload panorama jpg', up.success && imgSky && imgSky.kind === 'image',
      imgSky ? `${imgSky.width}x${imgSky.height} url=${imgSky.url}` : JSON.stringify(up));
    if (imgSky) {
      check('A2b panorama is 2:1', imgSky.width && imgSky.height && Math.abs(imgSky.width / imgSky.height - 2) < 0.1,
        `${imgSky.width}x${imgSky.height}`);
    }
  } else {
    check('A2 upload panorama jpg', false, 'missing sample: ' + IMG);
  }

  // 3. 上传 HDR
  let hdrSky = null;
  if (fs.existsSync(HDR)) {
    const up = await uploadFile(HDR);
    hdrSky = up.sky || null;
    check('A3 upload hdr exr', up.success && hdrSky && hdrSky.kind === 'hdr',
      hdrSky ? `${hdrSky.kind} use_env=${hdrSky.use_env}` : JSON.stringify(up));
    if (hdrSky) check('A3b hdr defaults use_env=true', hdrSky.use_env === true, 'use_env=' + hdrSky.use_env);
  } else {
    check('A3 upload hdr exr', false, 'missing sample: ' + HDR);
  }

  // 4. 选中全景图并内联到天气配置
  if (imgSky) {
    const put = await setWeather({ type: 'clear', intensity: 50, wind: 20, auto_cycle: false, cycle_interval: 30, sky_id: imgSky.id });
    check('A4 select sky via weather PUT', put.success && put.weather && put.weather.sky && put.weather.sky.id === imgSky.id,
      put.weather && put.weather.sky ? 'sky_id=' + put.weather.sky.id : JSON.stringify(put));

    const get = await (await fetch(BASE + '/api/config/weather', { headers: auth() })).json();
    check('A5 weather GET inlines sky', get.sky && get.sky.id === imgSky.id && get.sky.url === imgSky.url,
      get.sky ? get.sky.url : 'null');
  }

  // 5. 切到 HDR + 环境光照开关
  if (hdrSky) {
    const put = await setWeather({ type: 'clear', intensity: 50, wind: 20, sky_id: hdrSky.id });
    check('A6 switch to hdr sky', put.success && put.weather.sky && put.weather.sky.kind === 'hdr',
      put.weather && put.weather.sky ? put.weather.sky.kind : 'null');

    const off = await fetch(BASE + '/api/sky/' + hdrSky.id, {
      method: 'PUT', headers: auth({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ use_env: false })
    }).then(r => r.json());
    check('A7 toggle use_env off', off.success && off.sky && off.sky.use_env === false, 'use_env=' + (off.sky ? off.sky.use_env : 'n/a'));

    // 重新广播后应带最新的 use_env=false
    const put2 = await setWeather({ type: 'rain', intensity: 60, wind: 30, sky_id: hdrSky.id });
    check('A8 rebroadcast carries use_env', put2.success && put2.weather.sky.use_env === false,
      'use_env=' + (put2.weather ? put2.weather.sky.use_env : 'n/a'));
  }

  // 6. 非法 sky_id 应被拒
  const bad = await setWeather({ type: 'clear', sky_id: 999999 });
  check('A9 invalid sky_id rejected', !bad.success, 'status expected non-success');

  // 7. 回退默认天空
  const dflt = await setWeather({ type: 'clear', intensity: 50, wind: 20, sky_id: 'default' });
  check('A10 fallback to default sky', dflt.success && dflt.weather.sky === null, 'sky=' + JSON.stringify(dflt.weather && dflt.weather.sky));

  // 8. 删除（清理测试数据）
  for (const s of [imgSky, hdrSky]) {
    if (!s) continue;
    const del = await fetch(BASE + '/api/sky/' + s.id, { method: 'DELETE', headers: auth() }).then(r => r.json());
    check('A11 delete sky ' + s.id, del.success, JSON.stringify(del).slice(0, 60));
  }

  // 9. 文件是否真的被删（上传的文件名带随机后缀，校验目录不再包含该 url 文件）
  if (imgSky) {
    const fileGone = !fs.existsSync(path.join(__dirname, '..', 'public', imgSky.url.replace(/^\//, '')));
    check('A12 uploaded file removed', fileGone, imgSky.url);
  }

  // 10. 收尾列表只剩默认天空
  const list1 = await (await fetch(BASE + '/api/sky/list', { headers: auth() })).json();
  check('A13 library cleaned', list1.skies.length === 1 && list1.skies[0].id === 'default',
    'remaining=' + list1.skies.length);

  finish();
})().catch(e => {
  console.error('FATAL', e);
  process.exit(1);
});

function finish() {
  const passed = results.filter(r => r.ok).length;
  console.log(`\n=== SKY API ACCEPTANCE: ${passed}/${results.length} ===`);
  process.exit(passed === results.length ? 0 : 1);
}
