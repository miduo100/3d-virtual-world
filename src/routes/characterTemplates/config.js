/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
/**
 * 角色模板管理 - 配置文件
 * 
 * 本文件包含角色模板模块的常量配置、上传配置和基础设置
 * 
 * @module characterTemplates/config
 */

const multer = require('multer');
const path = require('path');
const fs = require('fs');

// 确保上传目录存在
const uploadDir = path.join(__dirname, '../../../uploads/templates');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Multer 配置
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'template-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB 限制
    },
    fileFilter: function (req, file, cb) {
        const allowedTypes = ['.json', '.png', '.jpg', '.jpeg'];
        const ext = path.extname(file.originalname).toLowerCase();
        if (allowedTypes.includes(ext)) {
            cb(null, true);
        } else {
            cb(new Error('不支持的文件类型'));
        }
    }
});

// 验证函数
function validateCharacterTemplate(data) {
    const errors = [];
    
    if (!data.name || typeof data.name !== 'string' || data.name.trim().length === 0) {
        errors.push('角色名称是必填项');
    } else if (data.name.length > 100) {
        errors.push('角色名称不能超过100个字符');
    }
    
    if (data.description && data.description.length > 2000) {
        errors.push('角色描述不能超过2000个字符');
    }
    
    // 验证属性范围
    if (data.attributes) {
        const numericFields = ['strength', 'agility', 'intelligence', 'vitality', 'luck'];
        numericFields.forEach(field => {
            if (data.attributes[field] !== undefined) {
                const val = parseFloat(data.attributes[field]);
                if (isNaN(val) || val < 0 || val > 9999) {
                    errors.push(`属性 ${field} 必须是0-9999之间的数字`);
                }
            }
        });
    }
    
    // 验证装备配置
    if (data.equipment) {
        if (typeof data.equipment !== 'object') {
            errors.push('装备配置必须是对象类型');
        }
    }
    
    // 验证技能列表
    if (data.skills) {
        if (!Array.isArray(data.skills)) {
            errors.push('技能列表必须是数组类型');
        } else {
            data.skills.forEach((skill, index) => {
                if (!skill.id || typeof skill.id !== 'string') {
                    errors.push(`技能列表第 ${index + 1} 项缺少有效的技能ID`);
                }
            });
        }
    }
    
    return errors;
}

// 角色类型枚举
const CHARACTER_TYPES = {
    PLAYER: 'player',
    NPC: 'npc',
    MONSTER: 'monster',
    BOSS: 'boss',
    ELITE: 'elite'
};

// 默认分页配置
const DEFAULT_PAGINATION = {
    page: 1,
    limit: 20,
    maxLimit: 100
};

// 导出配置
module.exports = {
    upload,
    uploadDir,
    validateCharacterTemplate,
    CHARACTER_TYPES,
    DEFAULT_PAGINATION
};
