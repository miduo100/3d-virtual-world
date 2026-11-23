/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 *
 * weatherCycleService.js — 自动天气循环调度
 *
 * 背景（2026-11-05）：后台「世界与场景 → 天气控制 → 自动天气循环」这个开关，
 * 此前只有 UI + 存储（PUT /api/config/weather 把 auto_cycle 写进
 * game_config.world_weather 的 JSON），**全项目没有任何代码读取它**——
 * 所以勾上之后天气永远不变，看起来就是"开关失效"。
 *
 * 这里补上唯一缺的那环：服务端轮询配置，到点随机换一个不同的天气，
 * 写回 DB 并广播 WEATHER_CHANGE（与管理员手动点"立即应用并广播"
 * 走完全相同的客户端链路 public/js/websocket.js#handleWeatherChange）。
 *
 * 为什么不放在浏览器里轮转：
 *   1) 每个玩家各转各的，同一世界里有人晴天有人下雪；
 *   2) 必须有人一直开着页面才会转。
 *
 * 计时口径：配置里保存 last_switch_at。
 *   - 管理员从"关→开"时由 PUT /weather 重置为当时时间，所以第一次切换在
 *     一个完整间隔之后，不会一开启就立刻变天；
 *   - 老配置没有该字段时，本次只把它补成现在（建锚点），不立即切换；
 *   - 服务重启后锚点仍在，不会因为重启就把周期重算。
 */

const { query } = require('../database/db');
const { resolveSky } = require('../routes/sky');

const TICK_MS = 60 * 1000;                       // 轮询粒度：60s（最坏延迟 1 分钟，换来抗重启 + 零状态）
const WEATHER_TYPES = ['clear', 'rain', 'snow', 'fog', 'storm'];

let _timer = null;
let _ticking = false;

/** 随机取一个与当前不同的天气类型（避免"循环"里切到自己） */
function pickNextType(current) {
  const pool = WEATHER_TYPES.filter(t => t !== current);
  return pool[Math.floor(Math.random() * pool.length)];
}

function clampInterval(v) {
  return Math.min(120, Math.max(5, parseInt(v, 10) || 30));
}

async function loadConfigRow() {
  const r = await query(
    'SELECT config_value FROM game_config WHERE config_key = \'world_weather\''
  );
  if (!r.rows.length) return null;
  try {
    return JSON.parse(r.rows[0].config_value);
  } catch (e) {
    console.warn('[WeatherCycle] 天气配置 JSON 解析失败，本轮跳过:', e.message);
    return null;
  }
}

async function saveConfig(cfg) {
  await query(
    `INSERT INTO game_config (config_key, config_value, updated_at)
     VALUES ('world_weather', $1, NOW())
     ON CONFLICT (config_key)
     DO UPDATE SET config_value = $1, updated_at = NOW()`,
    [JSON.stringify(cfg)]
  );
}

async function tick() {
  if (_ticking) return;       // 防重入：上一轮 DB 操作还没回来
  _ticking = true;
  try {
    const cfg = await loadConfigRow();
    if (!cfg || cfg.auto_cycle !== true) return;

    const intervalMs = clampInterval(cfg.cycle_interval) * 60 * 1000;
    const now = Date.now();
    const anchor = Date.parse(cfg.last_switch_at || '') || 0;

    // 老配置没有计时锚点：只建锚点，不立刻变天（避免"一开就变"的意外）
    if (!anchor) {
      cfg.last_switch_at = new Date(now).toISOString();
      cfg.cycle_interval = clampInterval(cfg.cycle_interval);
      await saveConfig(cfg);
      console.log(`[WeatherCycle] 已建立计时锚点，下次切换约在 ${new Date(now + intervalMs).toLocaleString()}`);
      return;
    }

    if (now - anchor < intervalMs) return;   // 还没到点

    const prevType = cfg.type || 'clear';
    const nextType = pickNextType(prevType);
    const weatherConfig = {
      ...cfg,
      type: nextType,
      auto_cycle: true,
      cycle_interval: clampInterval(cfg.cycle_interval),
      last_switch_at: new Date(now).toISOString(),
      updated_at: new Date(now).toISOString()
    };
    // 天空按当前 sky_id 重新解析（库里可能存的是旧快照）
    weatherConfig.sky = await resolveSky(weatherConfig);

    await saveConfig(weatherConfig);

    try {
      const { broadcastToAll } = require('../websocket/wsServer');
      broadcastToAll({ type: 'WEATHER_CHANGE', payload: weatherConfig });
    } catch (e) {
      console.warn('[WeatherCycle] 广播失败（WS 可能未初始化）:', e.message);
    }

    console.log(
      `[WeatherCycle] 自动切换天气: ${prevType} → ${nextType} ` +
      `（间隔 ${weatherConfig.cycle_interval} 分钟，下次约 ${new Date(now + intervalMs).toLocaleTimeString()}）`
    );
  } finally {
    _ticking = false;
  }
}

/** 启动轮询（server.js 在 listen 之后调用；重复调用安全） */
function startWeatherCycleLoop() {
  if (_timer) return;
  _timer = setInterval(() => {
    tick().catch(e => console.warn('[WeatherCycle] 轮询异常（不影响主服务）:', e.message));
  }, TICK_MS);
  if (typeof _timer.unref === 'function') _timer.unref();

  // 启动后延迟 20s 首次检查：等数据库连接与 WS 就绪，别在启动瞬间抢资源
  const first = setTimeout(() => {
    tick().catch(e => console.warn('[WeatherCycle] 首次检查异常:', e.message));
  }, 20000);
  if (typeof first.unref === 'function') first.unref();

  console.log(`[WeatherCycle] 自动天气循环调度已启动（每 ${TICK_MS / 1000}s 检查一次）`);
}

module.exports = { startWeatherCycleLoop, tick };
