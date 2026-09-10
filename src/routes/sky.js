/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 *
 * 天空库（自定义天空背景）API：/api/sky
 *  - GET    /api/sky/list          公开读（世界页与管理后台共用，含内置"默认天空"）
 *  - POST   /api/sky/upload        管理员：上传全景图（jpg/png）或 HDR（exr）
 *  - PUT    /api/sky/:id           管理员：改名 / 开关环境光照
 *  - DELETE /api/sky/:id           管理员：删除（正被选中时自动回退默认天空）
 *
 * 选中状态存在 game_config.world_weather 的 sky_id 字段里，
 * 由 resolveSky() 在天气配置下发时内联成完整对象，随 WEATHER_CHANGE / WORLD_STATE 同步。
 */
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const { query } = require('../database/db');
const { authenticateAdminToken } = require('../middleware/adminAuth');

const UPLOAD_DIR = path.join(__dirname, '../../public/uploads/sky');
const URL_PREFIX = '/uploads/sky/';
const MAX_SIZE = 30 * 1024 * 1024; // 30MB（1K~4K 全景图 / EXR 足够）
const ALLOWED_EXT = ['.jpg', '.jpeg', '.png', '.exr'];

// 内置"默认天空"：不入库、不可删，等价于系统原有纯色背景行为
const DEFAULT_SKY = {
  id: 'default', name: '默认天空', kind: 'default',
  url: null, width: null, height: null, use_env: false, builtin: true
};

// ---------- 自动建表（幂等） ----------
(async () => {
  try {
    await query(`CREATE TABLE IF NOT EXISTS world_sky_presets (
      id SERIAL PRIMARY KEY,
      name VARCHAR(60) NOT NULL,
      kind VARCHAR(16) NOT NULL DEFAULT 'image',
      url VARCHAR(255) NOT NULL,
      width INT,
      height INT,
      use_env BOOLEAN NOT NULL DEFAULT false,
      sort_order INT NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);
  } catch (e) {
    console.warn('world_sky_presets 建表跳过:', e.message);
  }
})();

// ---------- 上传存储 ----------
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    try {
      await fsp.mkdir(UPLOAD_DIR, { recursive: true });
      cb(null, UPLOAD_DIR);
    } catch (e) { cb(e); }
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, 'sky-' + Date.now() + '-' + Math.round(Math.random() * 1e9) + ext);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_SIZE, files: 1 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    // exr 的 mimetype 浏览器常给 application/octet-stream，故只校验扩展名白名单
    if (!ALLOWED_EXT.includes(ext)) {
      return cb(new Error('只支持全景图片（JPG/PNG）或 HDR 文件（EXR）'));
    }
    cb(null, true);
  }
});

function rowToSky(r) {
  return {
    id: r.id, name: r.name, kind: r.kind,
    url: r.url, width: r.width, height: r.height,
    use_env: !!r.use_env, builtin: false
  };
}

// ---------- 列表（公开读） ----------
router.get('/list', async (req, res) => {
  try {
    const r = await query('SELECT * FROM world_sky_presets ORDER BY sort_order, id');
    res.json({ success: true, skies: [DEFAULT_SKY].concat(r.rows.map(rowToSky)) });
  } catch (e) {
    console.error('获取天空库失败:', e);
    res.status(500).json({ success: false, error: '获取天空库失败' });
  }
});

// ---------- 上传（管理员） ----------
router.post('/upload', authenticateAdminToken, upload.single('file'), async (req, res) => {
  let savedPath = null;
  try {
    if (!req.file) return res.status(400).json({ success: false, error: '请选择天空文件' });
    savedPath = req.file.path;

    const ext = path.extname(req.file.originalname).toLowerCase();
    const kind = ext === '.exr' ? 'hdr' : 'image';
    const url = URL_PREFIX + req.file.filename;
    const baseName = path.basename(req.file.originalname, ext).slice(0, 40) || '自定义天空';

    // 读取尺寸并校验是否为 2:1 等距柱状投影（EXR 读不到就跳过，不阻断）
    let width = null, height = null, ratioWarning = null;
    if (kind === 'image') {
      try {
        const sharp = require('sharp');
        const meta = await sharp(savedPath).metadata();
        width = meta.width; height = meta.height;
        if (width && height) {
          const ratio = width / height;
          if (Math.abs(ratio - 2) > 0.1) {
            ratioWarning = `该图宽高比 ${ratio.toFixed(2)}:1，不是标准 2:1 全景图，天空可能拉伸变形`;
          }
        }
      } catch (e) {
        ratioWarning = '无法读取图片尺寸，已上传但无法校验全景比例';
      }
    }

    // HDR 默认开启环境光照，全景图默认关闭（卡片上可随时切换）
    const useEnv = kind === 'hdr';
    const r = await query(
      `INSERT INTO world_sky_presets (name, kind, url, width, height, use_env, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6, COALESCE((SELECT MAX(sort_order)+1 FROM world_sky_presets), 1))
       RETURNING *`,
      [baseName, kind, url, width, height, useEnv]
    );

    console.log(`🌌 天空上传成功: ${baseName} (${kind}) ${width || '?'}x${height || '?'}`);
    res.json({ success: true, sky: rowToSky(r.rows[0]), warning: ratioWarning });
  } catch (e) {
    if (savedPath && fs.existsSync(savedPath)) {
      try { await fsp.unlink(savedPath); } catch (_) {}
    }
    console.error('天空上传失败:', e);
    res.status(500).json({ success: false, error: e.message || '上传失败' });
  }
});

// ---------- 修改（管理员） ----------
router.put('/:id', authenticateAdminToken, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ success: false, error: '无效的天空ID' });
    const { name, use_env } = req.body;
    const r = await query(
      `UPDATE world_sky_presets SET
         name = COALESCE($1, name),
         use_env = COALESCE($2, use_env)
       WHERE id = $3 RETURNING *`,
      [name ? String(name).slice(0, 60) : null, typeof use_env === 'boolean' ? use_env : null, id]
    );
    if (!r.rows.length) return res.status(404).json({ success: false, error: '天空不存在' });
    res.json({ success: true, sky: rowToSky(r.rows[0]) });
  } catch (e) {
    console.error('更新天空失败:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ---------- 删除（管理员） ----------
router.delete('/:id', authenticateAdminToken, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ success: false, error: '无效的天空ID' });
    const r = await query('SELECT * FROM world_sky_presets WHERE id = $1', [id]);
    if (!r.rows.length) return res.status(404).json({ success: false, error: '天空不存在' });

    // 删除文件（只允许删除本目录下的文件，防路径穿越）
    const fileName = path.basename(r.rows[0].url || '');
    if (fileName) {
      const p = path.join(UPLOAD_DIR, fileName);
      if (p.startsWith(UPLOAD_DIR) && fs.existsSync(p)) {
        try { await fsp.unlink(p); } catch (e) { console.warn('删除天空文件失败:', e.message); }
      }
    }
    await query('DELETE FROM world_sky_presets WHERE id = $1', [id]);

    // 若正被选中，回退到默认天空
    try {
      await query(
        `UPDATE game_config
            SET config_value = jsonb_set(config_value::jsonb, '{sky_id}', '"default"')::text,
                updated_at = NOW()
          WHERE config_key = 'world_weather'
            AND config_value::jsonb->>'sky_id' = $1`,
        [String(id)]
      );
    } catch (e) { console.warn('回退天空选中状态失败:', e.message); }

    res.json({ success: true, message: '天空已删除' });
  } catch (e) {
    console.error('删除天空失败:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// multer / 业务错误统一出口
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const msg = err.code === 'LIMIT_FILE_SIZE' ? '天空文件超过 30MB 限制' : err.message;
    return res.status(400).json({ success: false, error: msg });
  }
  if (err) return res.status(400).json({ success: false, error: err.message });
  next();
});

/**
 * 把天气配置里的 sky_id 解析为完整天空对象（供天气 GET/PUT 与 WS 下发内联）
 * @param {{sky_id?: string|number}} weatherCfg
 * @returns {Promise<object|null>} null 表示使用默认天空（前端按天气纯色处理）
 */
async function resolveSky(weatherCfg) {
  try {
    const id = weatherCfg && weatherCfg.sky_id;
    if (id === undefined || id === null || id === 'default' || id === '') return null;
    const numId = parseInt(id, 10);
    if (!Number.isInteger(numId)) return null;
    const r = await query(
      'SELECT id, name, kind, url, width, height, use_env FROM world_sky_presets WHERE id = $1',
      [numId]
    );
    if (!r.rows.length) return null;
    return {
      id: r.rows[0].id, name: r.rows[0].name, kind: r.rows[0].kind,
      url: r.rows[0].url, width: r.rows[0].width, height: r.rows[0].height,
      use_env: !!r.rows[0].use_env, builtin: false
    };
  } catch (e) {
    console.warn('解析天空配置失败，回退默认天空:', e.message);
    return null;
  }
}

module.exports = { router, resolveSky, DEFAULT_SKY };
