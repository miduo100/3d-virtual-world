/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
/**
 * soundScenes.js —— 场景声源接口（音效库 ② 模型声源 / ③ 环境声景）
 *
 * 为什么新建而不是改 world.js：
 *   world.js 已 876 行，超项目 500 行红线，只能引用不能加代码。
 *   另外 world.js 的 GET /objects 一次拉全部 4329 条（无分页无筛选），
 *   PUT /objects/:id 的 custom_config 是整块覆盖，会吃掉 doors 等其他子配置。
 *   这里提供轻量、只碰 custom_config.audio 的专用接口。
 *
 * 挂载：server.js  `app.use('/api/sound-scenes', require('./routes/soundScenes'))`
 * 鉴权：全部要求管理员 token（音效库是后台功能）
 */
const express = require('express');
const router = express.Router();
const { query } = require('../database/db');
const { authenticateAdminToken } = require('../middleware/adminAuth');
const soundPads = require('./soundPads');

/** JSONB 可能以字符串形式回来，统一转对象 */
function asJson(v) {
  if (v == null) return null;
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch (e) { return null; }
}

/** 天气参数是 0~100 的整数，统一成 0~100 便于前端映射 */
function clamp01_100(v) {
  const n = parseFloat(v);
  if (!isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

// ─── 公开：环境声景 + 天气联动的运行时配置 ────────────────────
// 玩家页面用：区域铺底声 + 声音点位 + 天气音频配置 + 当前天气参数（只读）
router.get('/ambience', async (req, res) => {
  try {
    const regions = await query(`
      SELECT id, region_key, name, bounds, tags, gameplay->'audio' AS audio
      FROM world_regions
      ORDER BY name
    `);

    const wcfg = await query("SELECT config_value FROM system_config WHERE config_key = 'audio_weather'");
    const weatherAudio = wcfg.rows.length ? asJson(wcfg.rows[0].config_value) : null;

    const pads = await soundPads.readPads();

    const gcfg = await query("SELECT config_value FROM game_config WHERE config_key = 'world_weather'");
    const weatherRaw = gcfg.rows.length ? asJson(gcfg.rows[0].config_value) : {};
    const weather = {
      type: weatherRaw.type || 'clear',
      intensity: clamp01_100(weatherRaw.intensity),
      wind: clamp01_100(weatherRaw.wind)
    };

    res.set('Cache-Control', 'public, max-age=15');
    res.json({
      success: true,
      regions: regions.rows,
      weatherAudio,
      weather,
      pads: Array.isArray(pads) ? pads.filter((p) => p && p.url && p.enabled !== false) : []
    });
  } catch (e) {
    console.error('[soundScenes] 环境声景配置失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ─── 公开：运行时读取场景声源 ─────────────────────────────────
// 关键：soundRuntime.js 跑在玩家页面，没有管理员 token。
// 这里只返回 id + audio（不暴露物件其他字段），音频 URL 本身是公开静态文件。
// 写入接口仍要求管理员，见下方 router.use。
router.get('/audio-sources', async (req, res) => {
  try {
    const r = await query(`
      SELECT id, custom_config->'audio' AS audio
      FROM world_objects
      WHERE (custom_config->'audio') IS NOT NULL
      LIMIT 500
    `);
    const sources = r.rows.filter(function (x) { return x.audio && x.audio.url; });
    res.set('Cache-Control', 'public, max-age=15');   // 后台改完 15 秒内生效
    res.json({ success: true, sources: sources });
  } catch (e) {
    console.error('[soundScenes] 公开声源失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ─── 公开：背景音乐配置（玩家页面要读，所以放在鉴权之前）────────
// 单条结构：{ enabled, url, mode:'loop'|'once', volume, fadeIn }
router.get('/music', async (req, res) => {
  try {
    const r = await query("SELECT config_value FROM system_config WHERE config_key = 'ambient_music'");
    const cfg = r.rows.length ? asJson(r.rows[0].config_value) : null;
    res.set('Cache-Control', 'public, max-age=15');
    res.json({ success: true, music: cfg || { enabled: false, url: '', mode: 'loop', volume: 0.5, fadeIn: 2 } });
  } catch (e) {
    console.error('[soundScenes] 背景音乐读取失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ─── 以下接口要求管理员（音效库后台配置用）────────────────────
router.use(authenticateAdminToken);

// ─── 区域列表（② 的筛选下拉 / ③ 的挂载对象）─────────────────
router.get('/regions', async (req, res) => {
  try {
    const r = await query(`
      SELECT id, region_key, name, purpose, tags,
             bounds,
             bounds->>'x' AS bx, bounds->>'z' AS bz,
             -- ★ 键名是 width / depth，不是 w / d（原来写错，宽深恒为 null，
             --   导致 ③ 环境声景看不到任何区域范围，只能看到一串建筑名）
             bounds->>'width' AS bw, bounds->>'depth' AS bd,
             (gameplay->'audio') IS NOT NULL AS has_audio
      FROM world_regions
      ORDER BY name
    `);
    res.json({ success: true, regions: r.rows });
  } catch (e) {
    console.error('[soundScenes] 区域列表失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ─── 物件列表（轻量 + 筛选 + 分页）────────────────────────────
// ?region_id= &type= &hasAudio=1|0 &q=关键词 &limit=50 &offset=0
router.get('/objects', async (req, res) => {
  try {
    const where = [];
    const vals = [];
    let i = 1;

    if (req.query.region_id) { where.push(`region_id = $${i++}`); vals.push(req.query.region_id); }
    if (req.query.type)      { where.push(`type = $${i++}`);      vals.push(req.query.type); }
    if (req.query.q)         { where.push(`name ILIKE $${i++}`);  vals.push('%' + req.query.q + '%'); }
    if (req.query.hasAudio === '1') where.push(`(custom_config->'audio') IS NOT NULL`);
    if (req.query.hasAudio === '0') where.push(`(custom_config->'audio') IS NULL`);

    const whereSql = where.length ? ('WHERE ' + where.join(' AND ')) : '';
    const limit  = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    const total = await query(`SELECT count(*)::int AS n FROM world_objects ${whereSql}`, vals);

    // 只取 audio 子对象，不传整个 custom_config（里面有 doors、材质等大字段）
    const list = await query(`
      SELECT id, name, type, region_id, model_path,
             position_x, position_z,
             custom_config->'audio' AS audio
      FROM world_objects
      ${whereSql}
      ORDER BY (custom_config->'audio') IS NOT NULL DESC, id
      LIMIT ${limit} OFFSET ${offset}
    `, vals);

    res.json({
      success: true,
      total: total.rows[0].n,
      limit, offset,
      items: list.rows
    });
  } catch (e) {
    console.error('[soundScenes] 物件列表失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ─── 单个物件的音频配置 ─────────────────────────────────────
router.get('/objects/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, error: '物件 ID 非法' });

    const r = await query(`
      SELECT id, name, type, region_id, model_path,
             position_x, position_y, position_z,
             custom_config->'audio' AS audio
      FROM world_objects WHERE id = $1
    `, [id]);

    if (!r.rows.length) return res.status(404).json({ success: false, error: '物件不存在' });
    res.json({ success: true, object: r.rows[0] });
  } catch (e) {
    console.error('[soundScenes] 读取物件失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ─── 写入/清除某个物件的声音（只合并 audio，不碰其他子配置）────
// body: { audio: {...} }   传 null 或 {} 表示移除该物件的声音
router.put('/objects/:id/audio', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, error: '物件 ID 非法' });

    let audio = req.body ? req.body.audio : undefined;
    if (typeof audio === 'string') {
      try { audio = JSON.parse(audio); } catch (e) { return res.status(400).json({ success: false, error: 'audio 不是合法 JSON' }); }
    }
    if (audio !== null && audio !== undefined && typeof audio !== 'object') {
      return res.status(400).json({ success: false, error: 'audio 必须是对象或 null' });
    }

    // 基本校验：挂了声音就必须有 assetId 或 url 或 synth
    if (audio && Object.keys(audio).length) {
      if (!audio.assetId && !audio.url && !audio.synth && !Array.isArray(audio.layers)) {
        return res.status(400).json({ success: false, error: 'audio 至少要有 assetId / url / synth / layers 之一' });
      }
    }

    const isEmpty = (audio === null || audio === undefined || (typeof audio === 'object' && Object.keys(audio).length === 0));

    // 关键：jsonb_set 只替换 audio 键，custom_config 里的 doors / 材质等原样保留
    const r = isEmpty
      ? await query(`
          UPDATE world_objects
          SET custom_config = (COALESCE(custom_config, '{}'::jsonb) - 'audio'),
              updated_at = NOW()
          WHERE id = $1
          RETURNING id, name, custom_config->'audio' AS audio
        `, [id])
      : await query(`
          UPDATE world_objects
          SET custom_config = jsonb_set(COALESCE(custom_config, '{}'::jsonb), '{audio}', $2::jsonb, true),
              updated_at = NOW()
          WHERE id = $1
          RETURNING id, name, custom_config->'audio' AS audio
        `, [id, JSON.stringify(audio)]);

    if (!r.rows.length) return res.status(404).json({ success: false, error: '物件不存在' });
    res.json({ success: true, object: r.rows[0] });
  } catch (e) {
    console.error('[soundScenes] 写入物件声音失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ─── 可用的音频文件（扫 uploads 目录，给 ② 选声音用）──────────
router.get('/sounds', async (req, res) => {
  try {
    const fs = require('fs');
    const path = require('path');
    const dir = path.join(__dirname, '../../public/uploads/character-templates/sounds');
    let files = [];
    if (fs.existsSync(dir)) {
      files = fs.readdirSync(dir)
        .filter(f => /\.(mp3|ogg|wav|m4a|aac)$/i.test(f))
        .map(f => {
          const st = fs.statSync(path.join(dir, f));
          return {
            name: f,
            url: '/uploads/character-templates/sounds/' + f,
            size: st.size,
            mtime: st.mtimeMs
          };
        })
        .sort((a, b) => b.mtime - a.mtime);
    }
    res.json({ success: true, dir: '/uploads/character-templates/sounds/', sounds: files });
  } catch (e) {
    console.error('[soundScenes] 音频文件列表失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ─── 已挂声音的物件统计（给 ② 的顶部计数用）──────────────────
router.get('/stats', async (req, res) => {
  try {
    const r = await query(`
      SELECT
        count(*)::int AS total_objects,
        count(*) FILTER (WHERE (custom_config->'audio') IS NOT NULL)::int AS with_audio
      FROM world_objects
    `);
    const regions = await query(`
      SELECT count(*)::int AS n FROM world_regions WHERE (gameplay->'audio') IS NOT NULL
    `);
    res.json({
      success: true,
      objects: r.rows[0],
      regionsWithAudio: regions.rows[0].n
    });
  } catch (e) {
    console.error('[soundScenes] 统计失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ─── ③ 区域音频：读 ─────────────────────────────────────────
router.get('/regions/:id/audio', async (req, res) => {
  try {
    const r = await query(
      `SELECT id, region_key, name,
              bounds, bounds->>'x' AS bx, bounds->>'z' AS bz,
              bounds->>'width' AS bw, bounds->>'depth' AS bd,
              gameplay->'audio' AS audio
       FROM world_regions WHERE id = $1`,
      [req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ success: false, error: '区域不存在' });
    res.json({ success: true, region: r.rows[0] });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ─── ③ 区域音频：写（只替换 gameplay.audio，不动 gameplay 其他键）──
router.put('/regions/:id/audio', async (req, res) => {
  try {
    let audio = req.body ? req.body.audio : undefined;
    if (typeof audio === 'string') audio = asJson(audio);
    if (audio !== null && audio !== undefined && typeof audio !== 'object') {
      return res.status(400).json({ success: false, error: 'audio 必须是对象或 null' });
    }
    if (audio && Object.keys(audio).length && !audio.url && !audio.synth && !Array.isArray(audio.layers)) {
      return res.status(400).json({ success: false, error: 'audio 至少要有 url / synth / layers 之一' });
    }
    const isEmpty = (audio == null || Object.keys(audio).length === 0);

    const r = isEmpty
      ? await query(`
          UPDATE world_regions
          SET gameplay = (COALESCE(gameplay, '{}'::jsonb) - 'audio'), updated_at = NOW()
          WHERE id = $1 RETURNING id, region_key, name, gameplay->'audio' AS audio
        `, [req.params.id])
      : await query(`
          UPDATE world_regions
          SET gameplay = jsonb_set(COALESCE(gameplay, '{}'::jsonb), '{audio}', $2::jsonb, true),
              updated_at = NOW()
          WHERE id = $1 RETURNING id, region_key, name, gameplay->'audio' AS audio
        `, [req.params.id, JSON.stringify(audio)]);

    if (!r.rows.length) return res.status(404).json({ success: false, error: '区域不存在' });
    res.json({ success: true, region: r.rows[0] });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ─── 声音资产清单（扫目录 + 7 类引用明细）────────────────────
router.use('/assets', require('./soundAssetsRoute'));

// ─── 环境声点位：在某个坐标放一段环境声 ─────────────────────
// 实现拆到 soundPads.js（本文件加完点位会超 500 行红线）：
//   主键是点位而不是区域，因为「声音 → 坐标 + 可听半径」才是环境声的真实模型，
//   而 world_regions 里那 17 条全是 AI 建楼的占地框，挂上去等于给建筑挂声。
// 这里是 admin 路由（已过 authenticateAdminToken），点位属后台功能。
router.use('/pads', soundPads.router);

// ─── ④ 背景音乐：写（整份替换，零建表）──────────────────────
router.put('/music', async (req, res) => {
  try {
    let cfg = req.body ? req.body.music : null;
    if (typeof cfg === 'string') cfg = asJson(cfg);
    if (!cfg || typeof cfg !== 'object') {
      return res.status(400).json({ success: false, error: 'music 必须是对象' });
    }
    const num = (v, d) => { const n = parseFloat(v); return isFinite(n) ? n : d; };
    const norm = {
      enabled: cfg.enabled !== false && !!cfg.url,
      url: String(cfg.url || '').slice(0, 500),
      mode: cfg.mode === 'once' ? 'once' : 'loop',
      volume: Math.max(0, Math.min(1, num(cfg.volume, 0.5))),
      fadeIn: Math.max(0, Math.min(10, num(cfg.fadeIn, 2)))
    };
    await query(`
      INSERT INTO system_config (config_key, config_value, description, updated_at)
      VALUES ('ambient_music', $1, '场景背景音乐（进世界播放）', NOW())
      ON CONFLICT (config_key) DO UPDATE SET config_value = $1, updated_at = NOW()
    `, [JSON.stringify(norm)]);
    res.json({ success: true, music: norm });
  } catch (e) {
    console.error('[soundScenes] 背景音乐保存失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ─── 天气声音配置：读（现由「世界与场景 → 天气控制」使用） ─────────────────────────────────────
router.get('/weather-audio', async (req, res) => {
  try {
    const r = await query("SELECT config_value FROM system_config WHERE config_key = 'audio_weather'");
    const cfg = r.rows.length ? asJson(r.rows[0].config_value) : null;
    const g = await query("SELECT config_value FROM game_config WHERE config_key = 'world_weather'");
    const raw = g.rows.length ? asJson(g.rows[0].config_value) : {};
    res.json({
      success: true,
      config: cfg,
      current: { type: raw.type || 'clear', intensity: clamp01_100(raw.intensity), wind: clamp01_100(raw.wind) }
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ─── 天气声音配置：写（现由「世界与场景 → 天气控制」使用） ─────────────────────────────────────
router.put('/weather-audio', async (req, res) => {
  try {
    let cfg = req.body ? req.body.config : null;
    if (typeof cfg === 'string') cfg = asJson(cfg);
    if (!cfg || typeof cfg !== 'object') {
      return res.status(400).json({ success: false, error: 'config 必须是对象' });
    }
    await query(`
      INSERT INTO system_config (config_key, config_value, description, updated_at)
      VALUES ('audio_weather', $1, '天气联动音频配置（风/雨/雪/雾/雷）', NOW())
      ON CONFLICT (config_key) DO UPDATE SET config_value = $1, updated_at = NOW()
    `, [JSON.stringify(cfg)]);
    res.json({ success: true, config: cfg });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ─── ④ AI 生成声音：文生音效 + 入库 ──────────────────────────
// 子路由自带 authenticateAdminToken，这里挂载在上面的 router.use(authenticateAdminToken) 之后，
// 双重保险无副作用（中间件会重复跑一次校验，token 有效时开销可忽略）。
router.use('/sfx', require('./sfxGenerateRoute'));

// ─── ⑤ 声音资产：文件清单 + 被引用次数 ──────────────────────
module.exports = router;
