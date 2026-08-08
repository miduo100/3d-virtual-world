/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
/**
 * AI动作工厂 - 后端API路由
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');

// 配置文件上传
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = path.join(__dirname, '../../uploads/ai-factory-models');
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        const charId = req.body.characterId || 'unknown';
        const ext = path.extname(file.originalname).toLowerCase();
        const name = path.basename(file.originalname, ext);
        cb(null, `${charId}_${name}_${Date.now()}${ext}`);
    }
});

const upload = multer({ 
    storage,
    limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
    fileFilter: (req, file, cb) => {
        const allowed = ['.glb', '.gltf', '.fbx'];
        const ext = path.extname(file.originalname).toLowerCase();
        if (allowed.includes(ext)) {
            cb(null, true);
        } else {
            cb(new Error('不支持的文件格式'));
        }
    }
});

// ===== 角色管理 =====

/**
 * 获取角色列表
 */
router.get('/characters', async (req, res) => {
    try {
        const db = req.db || global.db;
        
        let characters = [];
        
        // 从数据库读取（如果有的话）
        if (db && db.query) {
            try {
                const rows = await db.query(
                    'SELECT * FROM ai_factory_characters ORDER BY created_at DESC'
                );
                characters = rows;
            } catch (err) {
                console.log('数据库查询失败，使用内存数据');
            }
        }
        
        // 如果没有数据，返回演示数据
        if (characters.length === 0) {
            characters = getDemoCharacters();
        }
        
        res.json({ success: true, characters });
    } catch (err) {
        console.error('获取角色列表失败:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * 创建角色
 */
router.post('/characters', async (req, res) => {
    try {
        const { id, name, emoji } = req.body;
        
        const newChar = {
            id: id || 'char-' + Date.now(),
            name,
            emoji: emoji || '👤',
            glbUrl: null,
            fbxUrl: null,
            motionCount: { total: 18, done: 0 },
            created_at: new Date().toISOString()
        };
        
        const db = req.db || global.db;
        
        if (db && db.query) {
            try {
                await db.query(
                    `INSERT INTO ai_factory_characters 
                     (id, name, emoji, glb_url, fbx_url, motion_count, created_at) 
                     VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [newChar.id, newChar.name, newChar.emoji, null, null, 
                     JSON.stringify(newChar.motionCount), newChar.created_at]
                );
            } catch (err) {
                console.log('数据库插入失败:', err);
            }
        }
        
        res.json({ success: true, character: newChar });
    } catch (err) {
        console.error('创建角色失败:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * 获取单个角色
 */
router.get('/characters/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const db = req.db || global.db;
        
        if (db && db.query) {
            const rows = await db.query(
                'SELECT * FROM ai_factory_characters WHERE id = ?',
                [id]
            );
            
            if (rows.length > 0) {
                return res.json({ success: true, character: rows[0] });
            }
        }
        
        // 尝试从演示数据中找
        const demoChars = getDemoCharacters();
        const char = demoChars.find(c => c.id === id);
        
        if (char) {
            return res.json({ success: true, character: char });
        }
        
        res.status(404).json({ success: false, error: '角色不存在' });
    } catch (err) {
        console.error('获取角色失败:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * 上传模型文件
 */
router.post('/upload-model', upload.fields([
    { name: 'glbFile', maxCount: 1 },
    { name: 'fbxFile', maxCount: 1 }
]), async (req, res) => {
    try {
        const { characterId } = req.body;
        
        let glbUrl = null;
        let fbxUrl = null;
        
        if (req.files['glbFile']) {
            glbUrl = '/uploads/ai-factory-models/' + req.files['glbFile'][0].filename;
        }
        
        if (req.files['fbxFile']) {
            fbxUrl = '/uploads/ai-factory-models/' + req.files['fbxFile'][0].filename;
        }
        
        const db = req.db || global.db;
        
        if (db && db.query && characterId) {
            try {
                await db.query(
                    `UPDATE ai_factory_characters 
                     SET glb_url = COALESCE(?, glb_url),
                         fbx_url = COALESCE(?, fbx_url),
                         updated_at = NOW()
                     WHERE id = ?`,
                    [glbUrl, fbxUrl, characterId]
                );
            } catch (err) {
                console.log('数据库更新失败:', err);
            }
        }
        
        res.json({ success: true, glbUrl, fbxUrl });
    } catch (err) {
        console.error('上传模型失败:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * 获取角色的动作配置
 */
router.get('/characters/:id/configs', async (req, res) => {
    try {
        const { id } = req.params;
        const db = req.db || global.db;
        
        let configs = {};
        
        if (db && db.query) {
            try {
                const rows = await db.query(
                    'SELECT * FROM ai_factory_motion_configs WHERE character_id = ?',
                    [id]
                );
                
                rows.forEach(row => {
                    configs[row.motion_key] = JSON.parse(row.config_data);
                });
            } catch (err) {
                console.log('获取动作配置失败:', err);
            }
        }
        
        res.json({ success: true, configs });
    } catch (err) {
        console.error('获取动作配置失败:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * 保存角色的动作数据
 */
router.post('/characters/:id/motions', async (req, res) => {
    try {
        const { id } = req.params;
        const { motionKey, config } = req.body;
        
        const db = req.db || global.db;
        
        if (db && db.query) {
            try {
                // 检查是否存在
                const existing = await db.query(
                    'SELECT id FROM ai_factory_motion_configs WHERE character_id = ? AND motion_key = ?',
                    [id, motionKey]
                );
                
                if (existing.length > 0) {
                    await db.query(
                        `UPDATE ai_factory_motion_configs 
                         SET config_data = ?, updated_at = NOW()
                         WHERE character_id = ? AND motion_key = ?`,
                        [JSON.stringify(config), id, motionKey]
                    );
                } else {
                    await db.query(
                        `INSERT INTO ai_factory_motion_configs 
                         (character_id, motion_key, config_data, created_at) 
                         VALUES (?, ?, ?, NOW())`,
                        [id, motionKey, JSON.stringify(config)]
                    );
                }
                
                // 更新角色完成数
                await updateCharacterMotionCount(db, id);
            } catch (err) {
                console.log('保存动作失败:', err);
            }
        }
        
        res.json({ success: true });
    } catch (err) {
        console.error('保存动作失败:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * 更新角色的动作完成数
 */
async function updateCharacterMotionCount(db, characterId) {
    try {
        const count = await db.query(
            `SELECT COUNT(*) as done FROM ai_factory_motion_configs 
             WHERE character_id = ? AND JSON_EXTRACT(config_data, '$.status') = 'done'`,
            [characterId]
        );
        
        await db.query(
            `UPDATE ai_factory_characters 
             SET motion_count = JSON_OBJECT('total', 18, 'done', ?),
                 updated_at = NOW()
             WHERE id = ?`,
            [count[0].done, characterId]
        );
    } catch (err) {
        console.log('更新动作计数失败:', err);
    }
}

// ===== 动作生成 =====

/**
 * 生成动作动画
 */
router.post('/generate', async (req, res) => {
    try {
        const { tposeFile, characterId, motionKey, textPrompt, duration } = req.body;
        
        if (!tposeFile || !characterId || !motionKey) {
            return res.status(400).json({ success: false, message: '缺少必要参数' });
        }
        
        // 检查T-Pose文件是否存在
        const modelPath = path.join(__dirname, '../../public' + tposeFile);
        if (!fs.existsSync(modelPath)) {
            return res.status(400).json({ success: false, message: '模型文件不存在: ' + tposeFile });
        }
        
        // 动作生成目录 (放在public下，这样服务器可以直接提供静态文件)
        const animDir = path.join(__dirname, '../../public/uploads/character-templates');
        if (!fs.existsSync(animDir)) {
            fs.mkdirSync(animDir, { recursive: true });
        }
        
        // 生成文件名
        const animFileName = `${characterId}_${motionKey}_${Date.now()}.glb`;
        const animUrl = `/uploads/character-templates/${animFileName}`;
        const animPath = path.join(animDir, animFileName);
        
        // 复制模型文件作为动画文件（实际项目中这里应该调用AI服务生成动画）
        // 目前先复制T-Pose模型作为占位
        fs.copyFileSync(modelPath, animPath);
        
        console.log(`[AI Factory] 动作生成完成: ${motionKey} -> ${animUrl}`);
        
        res.json({ 
            success: true, 
            animUrl: animUrl,
            message: '动作生成成功（演示模式）'
        });
        
    } catch (err) {
        console.error('[AI Factory] 动作生成失败:', err);
        res.status(500).json({ success: false, message: err.message || '生成失败' });
    }
});

// ===== 演示数据 =====

function getDemoCharacters() {
    return [
        {
            id: 'demo-1',
            name: '战士',
            emoji: '⚔️',
            glbUrl: '/models/blockman_tpose.glb',
            fbxUrl: null,
            motionCount: { total: 18, done: 6 }
        },
        {
            id: 'demo-2',
            name: '法师',
            emoji: '🧙',
            glbUrl: null,
            fbxUrl: null,
            motionCount: { total: 18, done: 0 }
        },
        {
            id: 'demo-3',
            name: '弓箭手',
            emoji: '🏹',
            glbUrl: '/models/archer.glb',
            fbxUrl: null,
            motionCount: { total: 18, done: 12 }
        }
    ];
}

module.exports = router;
