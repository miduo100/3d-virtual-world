-- =============================================
-- AI动作工厂 - 数据库表结构
-- =============================================

-- 角色模板表
CREATE TABLE IF NOT EXISTS ai_factory_characters (
    id VARCHAR(100) PRIMARY KEY COMMENT '角色ID',
    name VARCHAR(100) NOT NULL COMMENT '角色名称',
    emoji VARCHAR(50) DEFAULT '👤' COMMENT '角色图标',
    glb_url VARCHAR(500) DEFAULT NULL COMMENT 'GLB模型路径',
    fbx_url VARCHAR(500) DEFAULT NULL COMMENT 'FBX T-Pose路径',
    thumb_url VARCHAR(500) DEFAULT NULL COMMENT '缩略图路径',
    category VARCHAR(50) DEFAULT 'general' COMMENT '角色分类',
    tags VARCHAR(200) DEFAULT NULL COMMENT '标签',
    description TEXT DEFAULT NULL COMMENT '描述',
    motion_count JSON DEFAULT ('{"total":18,"done":0}') COMMENT '动作完成统计',
    status ENUM('draft', 'in_progress', 'complete') DEFAULT 'draft' COMMENT '状态',
    total_cost DECIMAL(10,2) DEFAULT 0 COMMENT '累计AI费用',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_name (name),
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='AI动作工厂角色表';

-- 动作配置表（存储每个角色的每个动作配置）
CREATE TABLE IF NOT EXISTS ai_factory_motion_configs (
    id INT PRIMARY KEY AUTO_INCREMENT,
    character_id VARCHAR(100) NOT NULL COMMENT '角色ID',
    motion_key VARCHAR(50) NOT NULL COMMENT '动作标识',
    config_data JSON NOT NULL COMMENT '动作配置JSON',
    status ENUM('pending', 'generating', 'done', 'error') DEFAULT 'pending' COMMENT '生成状态',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_char_motion (character_id, motion_key),
    FOREIGN KEY (character_id) REFERENCES ai_factory_characters(id) ON DELETE CASCADE,
    INDEX idx_character (character_id),
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='角色动作配置表';

-- 动作关键帧数据表（存储生成的动作数据）
CREATE TABLE IF NOT EXISTS ai_factory_motion_data (
    id INT PRIMARY KEY AUTO_INCREMENT,
    character_id VARCHAR(100) NOT NULL COMMENT '角色ID',
    motion_key VARCHAR(50) NOT NULL COMMENT '动作标识',
    display_name VARCHAR(100) NOT NULL COMMENT '显示名称',
    
    -- 时间参数
    duration DECIMAL(6,2) COMMENT '时长(秒)',
    frame_count INT COMMENT '总帧数',
    fps INT DEFAULT 30 COMMENT '帧率',
    
    -- 骨骼关键帧数据
    keyframe_data LONGTEXT COMMENT 'JSON格式的骨骼关键帧数据',
    
    -- AI任务信息
    job_id VARCHAR(100) DEFAULT NULL COMMENT '腾讯云任务ID',
    source_prompt TEXT COMMENT '原始AI描述',
    cost_yuan DECIMAL(8,2) DEFAULT 0 COMMENT '生成费用',
    
    -- 元数据
    category VARCHAR(50) DEFAULT 'general' COMMENT '分类',
    tags VARCHAR(200) DEFAULT NULL COMMENT '标签',
    use_count INT DEFAULT 0 COMMENT '使用次数',
    is_favorite BOOLEAN DEFAULT FALSE COMMENT '是否收藏',
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    UNIQUE KEY uk_char_motion_data (character_id, motion_key),
    FOREIGN KEY (character_id) REFERENCES ai_factory_characters(id) ON DELETE CASCADE,
    INDEX idx_character (character_id),
    INDEX idx_category (category),
    INDEX idx_favorite (is_favorite)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='动作关键帧数据表';

-- 动作预设表（可选，用于管理标准动作集）
CREATE TABLE IF NOT EXISTS ai_factory_motion_presets (
    id INT PRIMARY KEY AUTO_INCREMENT,
    motion_key VARCHAR(50) UNIQUE NOT NULL COMMENT '动作标识',
    category VARCHAR(50) NOT NULL COMMENT '所属分类',
    display_name VARCHAR(100) NOT NULL COMMENT '显示名称',
    emoji VARCHAR(10) DEFAULT '🎬' COMMENT '图标',
    is_essential BOOLEAN DEFAULT FALSE COMMENT '是否核心必选',
    sort_order INT DEFAULT 0 COMMENT '排序',
    default_duration DECIMAL(4,2) DEFAULT 3.0 COMMENT '默认时长',
    default_prompt TEXT COMMENT '默认提示词',
    description TEXT COMMENT '描述',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_category (category),
    INDEX idx_sort (sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='动作预设表';

-- =============================================
-- 插入18个动作预设
-- =============================================

INSERT INTO ai_factory_motion_presets 
(motion_key, category, display_name, emoji, is_essential, sort_order, default_duration, default_prompt, description)
VALUES
-- 基础移动 (4)
('idle', 'locomotion', '待机', '💤', TRUE, 1, 3.0, '角色站立原地待机，轻微自然呼吸起伏...', '站立呼吸待机'),
('walk', 'locomotion', '走路', '🚶', TRUE, 2, 2.0, '角色以正常步行速度向前行走...', '标准行走'),
('run', 'locomotion', '奔跑', '🏃', TRUE, 3, 1.5, '角色全速奔跑，身体明显前倾...', '快速奔跑'),
('jump', 'locomotion', '跳跃', '🦘', TRUE, 4, 0.8, '角色完成一个标准的垂直起跳过程...', '垂直跳跃'),

-- 转向 (2)
('turn_left', 'turning', '左转', '↩️', FALSE, 5, 1.2, '角色从面向正前方平滑转向左侧90度...', '左转向'),
('turn_right', 'turning', '右转', '↪️', FALSE, 6, 1.2, '角色从面向正前方平滑转向右侧90度...', '右转向'),

-- 单体攻击 (5)
('attack_normal', 'combat_single', '普通攻击', '⚔️', TRUE, 7, 2.0, '角色进行一次标准的正面普通攻击...', '普通攻击'),
('attack_stab', 'combat_single', '刺', '🗡️', TRUE, 8, 1.2, '角色执行一次快速直刺攻击...', '刺击'),
('attack_chop', 'combat_single', '砍', '🪓', TRUE, 9, 2.0, '角色执行一次强力下砍攻击...', '砍击'),
('attack_swing', 'combat_single', '挥', '💫', TRUE, 10, 1.8, '角色执行一次水平或斜向的大范围挥击...', '挥击'),
('attack_uppercut', 'combat_single', '挑', '⬆️', TRUE, 11, 1.6, '角色执行一次从下向上的挑击...', '挑击'),

-- 连击 (3)
('combo_2', 'combo', '连击二', '🔨', TRUE, 12, 2.5, '角色执行两段连续攻击组合...', '二连击'),
('combo_3', 'combo', '连击三', '🔨', TRUE, 13, 3.2, '角色执行三段递进式连击组合...', '三连击'),
('combo_4', 'combo', '连击四', '🔨', FALSE, 14, 4.0, '角色执行四段豪华连击组合...', '四连击'),

-- 武器 & 状态 (4)
('draw_weapon', 'weapon_state', '拔剑', '🗡️', TRUE, 15, 1.5, '角色执行拔出武器的动作...', '拔剑'),
('sheath_weapon', 'weapon_state', '收剑', '🗡️', TRUE, 16, 1.5, '角色执行将武器收回鞘中的动作...', '收剑'),
('hurt', 'weapon_state', '受击', '😵', TRUE, 17, 0.8, '角色受到攻击时的受击反馈动画...', '受击反馈'),
('death', 'weapon_state', '死亡', '💀', TRUE, 18, 3.0, '角色的死亡倒地动画...', '死亡动画');

-- =============================================
-- 创建演示角色（可选）
-- =============================================

INSERT INTO ai_factory_characters (id, name, emoji, motion_count, status)
VALUES
('demo-warrior', '战士', '⚔️', '{"total":18,"done":0}', 'draft'),
('demo-mage', '法师', '🧙', '{"total":18,"done":0}', 'draft'),
('demo-archer', '弓箭手', '🏹', '{"total":18,"done":0}', 'draft');

-- =============================================
-- keyframe_data JSON 结构示例
-- =============================================
/*
{
  "bones": {
    "headTop": [
      { "time": 0.0, "rot": [0, 0, 0], "euler": { "x": 0, "y": 0, "z": 0 } },
      { "time": 1.0, "rot": [0.087, 0, 0], "euler": { "x": 10, "y": 0, "z": 0 } }
    ],
    "leftShoulder": [...],
    "leftElbow": [...],
    "leftWrist": [...],
    "rightShoulder": [...],
    "rightElbow": [...],
    "rightWrist": [...],
    "torso": [...],
    "pelvis": [...],
    "leftHip": [...],
    "leftKnee": [...],
    "leftAnkle": [...],
    "rightHip": [...],
    "rightKnee": [...],
    "rightAnkle": [...]
  },
  "duration": 3.0,
  "fps": 30,
  "totalFrames": 90,
  "metadata": {
    "generatedAt": "2026-05-12T17:30:00Z",
    "jobId": "job-12345",
    "prompt": "角色站立待机...",
    "cost": 1.20,
    "model": "hunyuan3d-v1"
  }
}
*/

-- =============================================
-- config_data JSON 结构示例
-- =============================================
/*
{
  "enabled": true,
  "prompt": "角色站立原地待机，轻微自然呼吸起伏...",
  "duration": 3.0,
  "intensity": "weak",
  "templateIndex": null,
  "status": "done",
  "keyframes": { ... },  // 引用 ai_factory_motion_data 的 keyframe_data
  "cost": 1.20,
  "error": null
}
*/
