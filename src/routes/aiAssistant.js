/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
const express = require('express');
const router = express.Router();
const pool = require('../database/db');
// hunyuan3d 服务已移除，使用空桩替代
let hunyuan3dService;
try {
  hunyuan3dService = require('../services/hunyuan3d');
} catch (e) {
  hunyuan3dService = {
    textToModel: async () => ({ success: false, error: '3D生成服务暂不可用' })
  };
}


// AI助手对话接口
router.post('/chat', async (req, res) => {
  try {
    const { message, context, textGenerationEnabled } = req.body;
    
    console.log('🤖 AI助手收到消息:', message);
    console.log('📝 文字生成功能:', textGenerationEnabled ? '已启用' : '已关闭');
    
    // 解析用户意图
    const intent = parseIntent(message);
    
    console.log('🎯 识别意图:', intent);
    
    // 根据意图执行不同操作
    let response;
    
    switch (intent.type) {
      case 'generate_building':
      case 'batch_generate':
      case 'create_scene':
        // 检查是否启用文字生成
        if (!textGenerationEnabled) {
          response = {
            success: false,
            message: '⚠️ AI文字生成功能未启用\n\n' +
                     '文字生成建筑需要调用腾讯混元3D API，会消耗额度。\n\n' +
                     '💡 建议使用方式：\n' +
                     '• <strong>图片转3D</strong>：在"3D建筑管理"标签，上传建筑照片生成模型\n' +
                     '• <strong>文字生成</strong>：如需使用，请在"系统配置"中启用AI文字生成功能\n\n' +
                     'AI助手仍可帮你：\n' +
                     '• 查询建筑状态\n' +
                     '• 管理现有建筑\n' +
                     '• 提供建造建议',
            actions: []
          };
        } else {
          // 根据具体意图处理
          if (intent.type === 'generate_building') {
            response = await handleGenerateBuilding(intent, message);
          } else if (intent.type === 'batch_generate') {
            response = await handleBatchGenerate(intent, message);
          } else if (intent.type === 'create_scene') {
            response = await handleCreateScene(intent, message);
          }
        }
        break;
        
      case 'place_building':
        response = await handlePlaceBuilding(intent);
        break;
        
      case 'query_status':
        response = await handleQueryStatus(intent);
        break;
        
      default:
        response = {
          success: true,
          message: '我理解了你的需求。请告诉我你想要：\n\n' +
                   '1. 查询状态（例如："当前有多少建筑"）\n' +
                   '2. 管理建筑（例如："放置建筑"）\n' +
                   (textGenerationEnabled ? 
                     '3. 生成建筑（例如："生成一个茅草屋"）\n' +
                     '4. 批量生成（例如："生成5栋房子"）\n' +
                     '5. 创建场景（例如："创建一个村庄"）' :
                     '\n💡 提示：如需文字生成建筑功能，请在系统配置中启用。\n' +
                     '推荐使用"图片转3D"功能上传照片生成建筑。'),
          actions: []
        };
    }
    
    res.json(response);
    
  } catch (error) {
    console.error('AI助手错误:', error);
    res.status(500).json({
      success: false,
      message: '抱歉，处理你的请求时遇到了问题：' + error.message
    });
  }
});

// 解析用户意图
function parseIntent(message) {
  const msg = message.toLowerCase();
  
  // 批量生成建筑
  const batchMatch = msg.match(/生成\s*(\d+)\s*(个|栋|座)?\s*(.+)/);
  if (batchMatch) {
    return {
      type: 'batch_generate',
      count: parseInt(batchMatch[1]),
      description: batchMatch[3] || '建筑'
    };
  }
  
  // 单个建筑生成
  if (msg.includes('生成') || msg.includes('创建建筑') || msg.includes('添加建筑')) {
    const description = message.replace(/生成|创建建筑|添加建筑/g, '').trim();
    return {
      type: 'generate_building',
      description: description || '建筑'
    };
  }
  
  // 创建场景
  if (msg.includes('村庄') || msg.includes('城市') || msg.includes('街区') || msg.includes('场景')) {
    return {
      type: 'create_scene',
      sceneType: extractSceneType(msg)
    };
  }
  
  // 放置建筑
  if (msg.includes('放置') || msg.includes('摆放')) {
    return {
      type: 'place_building'
    };
  }
  
  // 查询状态
  if (msg.includes('多少') || msg.includes('状态') || msg.includes('查询') || msg.includes('列表') ||
      msg.includes('图片') || msg.includes('照片') || msg.includes('上传') ||
      msg.includes('管理') || msg.includes('建议')) {
    return {
      type: 'query_status',
      originalMessage: message
    };
  }
  
  return { type: 'unknown' };
}

// 提取场景类型
function extractSceneType(message) {
  if (message.includes('村庄')) return 'village';
  if (message.includes('城市') || message.includes('街区')) return 'city';
  if (message.includes('中世纪')) return 'medieval';
  if (message.includes('现代')) return 'modern';
  return 'custom';
}

// 处理生成建筑
async function handleGenerateBuilding(intent, originalMessage) {
  try {
    const description = intent.description;
    
    // 调用混元3D API
    const result = await hunyuan3dService.textToModel(description, 1);
    
    if (!result.success) {
      throw new Error(result.error || '生成失败');
    }
    
    // 保存到数据库
    const insertQuery = `
      INSERT INTO generated_buildings 
      (user_id, name, prompt, task_id, status, created_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
      RETURNING *
    `;
    
    const dbResult = await pool.query(insertQuery, [
      1, // 管理员ID
      description,
      description,
      result.data.TaskId,
      'processing'
    ]);
    
    return {
      success: true,
      message: `✅ 已开始生成"${description}"！\n\n` +
               `📝 任务ID: ${result.data.TaskId}\n` +
               '⏱️ 预计需要 3-5 分钟\n\n' +
               '你可以在"建筑管理"标签中查看进度。',
      actions: [{
        type: 'building_generating',
        buildingId: dbResult.rows[0].id,
        taskId: result.data.TaskId
      }]
    };
    
  } catch (error) {
    return {
      success: false,
      message: `❌ 生成失败: ${error.message}`
    };
  }
}

// 处理批量生成
async function handleBatchGenerate(intent, originalMessage) {
  try {
    const { count, description } = intent;
    
    if (count > 10) {
      return {
        success: false,
        message: '⚠️ 为了保证质量，单次最多生成10个建筑。\n建议分批生成或使用场景模板功能。'
      };
    }
    
    const tasks = [];
    const buildingIds = [];
    
    // 并行提交所有生成任务
    for (let i = 0; i < count; i++) {
      const buildingName = `${description} ${i + 1}`;
      const result = await hunyuan3dService.textToModel(description, 1);
      
      if (result.success) {
        // 保存到数据库
        const insertQuery = `
          INSERT INTO generated_buildings 
          (user_id, name, prompt, task_id, status, created_at)
          VALUES ($1, $2, $3, $4, $5, NOW())
          RETURNING *
        `;
        
        const dbResult = await pool.query(insertQuery, [
          1,
          buildingName,
          description,
          result.data.TaskId,
          'processing'
        ]);
        
        tasks.push(result.data.TaskId);
        buildingIds.push(dbResult.rows[0].id);
      }
    }
    
    return {
      success: true,
      message: `✅ 已开始批量生成 ${count} 个"${description}"！\n\n` +
               `📦 提交任务: ${tasks.length}/${count}\n` +
               '⏱️ 预计需要 3-5 分钟\n\n' +
               '所有建筑将并行生成，完成后会自动显示在建筑列表中。',
      actions: [{
        type: 'batch_generating',
        count: tasks.length,
        taskIds: tasks,
        buildingIds: buildingIds
      }]
    };
    
  } catch (error) {
    return {
      success: false,
      message: `❌ 批量生成失败: ${error.message}`
    };
  }
}

// 处理放置建筑
async function handlePlaceBuilding(intent) {
  try {
    // 查询已完成的建筑
    const result = await pool.query(
      'SELECT * FROM generated_buildings WHERE status = $1 ORDER BY created_at DESC LIMIT 10',
      ['completed']
    );
    
    if (result.rows.length === 0) {
      return {
        success: false,
        message: '❌ 当前没有可用的已完成建筑。\n请先生成一些建筑。'
      };
    }
    
    const buildingList = result.rows.map((b, i) => 
      `${i + 1}. ${b.name} (ID: ${b.id})`
    ).join('\n');
    
    return {
      success: true,
      message: `📋 可放置的建筑列表：\n\n${buildingList}\n\n` +
               '请在"建筑管理"标签中选择建筑并点击"放置到世界"按钮。',
      actions: [{
        type: 'show_buildings',
        buildings: result.rows
      }]
    };
    
  } catch (error) {
    return {
      success: false,
      message: `❌ 查询失败: ${error.message}`
    };
  }
}

// 处理查询状态
async function handleQueryStatus(intent) {
  try {
    const message = intent.originalMessage || '';
    
    // 检查是否询问图片转3D
    if (message.includes('图片') || message.includes('照片') || message.includes('上传')) {
      return {
        success: true,
        message: '📸 图片转3D使用指南\n\n' +
                 '✅ 这是混元3D的推荐使用方式！\n\n' +
                 '📝 操作步骤：\n' +
                 '1. 点击顶部的"🏗️ 3D建筑管理"标签\n' +
                 '2. 找到"上传图片生成3D建筑"区域\n' +
                 '3. 点击"选择图片"上传建筑照片\n' +
                 '4. 输入建筑名称和描述\n' +
                 '5. 点击"开始生成"，等待3-5分钟\n' +
                 '6. 生成完成后可直接放置到世界中\n\n' +
                 '💡 提示：\n' +
                 '• 上传清晰的建筑正面照效果最佳\n' +
                 '• 支持JPG、PNG格式\n' +
                 '• 建议照片中建筑占比较大'
      };
    }
    
    // 检查是否询问管理建议
    if (message.includes('管理') || message.includes('建议')) {
      return {
        success: true,
        message: '🎯 虚拟世界管理建议\n\n' +
                 '📊 建筑管理：\n' +
                 '• 定期查看建筑生成状态\n' +
                 '• 及时放置完成的建筑到世界中\n' +
                 '• 删除失败或不需要的建筑\n\n' +
                 '🏗️ 建造建议：\n' +
                 '• 优先使用图片转3D功能（效果好、成本低）\n' +
                 '• 合理规划建筑布局，避免拥挤\n' +
                 '• 根据场景需求选择合适的建筑风格\n\n' +
                 '⚙️ 系统优化：\n' +
                 '• 根据实际需求开启/关闭文字生成功能\n' +
                 '• 定期检查混元3D API额度\n' +
                 '• 备份重要的建筑模型文件'
      };
    }
    
    // 统计各种状态的建筑
    const stats = await pool.query(`
      SELECT 
        status,
        COUNT(*) as count
      FROM generated_buildings
      GROUP BY status
    `);
    
    // 查询世界中的建筑
    const worldObjects = await pool.query(
      'SELECT COUNT(*) as count FROM world_objects WHERE type = $1',
      ['generated_building']
    );
    
    let statusText = '📊 当前建筑状态：\n\n';
    
    stats.rows.forEach(row => {
      const statusName = {
        'completed': '✅ 已完成',
        'processing': '⏳ 生成中',
        'failed': '❌ 失败'
      }[row.status] || row.status;
      
      statusText += `${statusName}: ${row.count} 个\n`;
    });
    
    statusText += `\n🌍 已放置到世界: ${worldObjects.rows[0].count} 个`;
    
    return {
      success: true,
      message: statusText
    };
    
  } catch (error) {
    return {
      success: false,
      message: `❌ 查询失败: ${error.message}`
    };
  }
}

// 处理创建场景
async function handleCreateScene(intent, originalMessage) {
  const sceneTemplates = {
    village: {
      name: '村庄',
      buildings: [
        { description: '茅草屋', count: 5 },
        { description: '小型谷仓', count: 2 },
        { description: '水井', count: 1 }
      ]
    },
    city: {
      name: '城市街区',
      buildings: [
        { description: '现代居民楼', count: 3 },
        { description: '商店', count: 2 },
        { description: '办公楼', count: 1 }
      ]
    },
    medieval: {
      name: '中世纪场景',
      buildings: [
        { description: '中世纪石屋', count: 4 },
        { description: '铁匠铺', count: 1 },
        { description: '小教堂', count: 1 }
      ]
    }
  };
  
  const template = sceneTemplates[intent.sceneType];
  
  if (!template) {
    return {
      success: false,
      message: '抱歉，暂时还不支持这种场景类型。\n\n' +
               '目前支持：\n' +
               '- 村庄\n' +
               '- 城市街区\n' +
               '- 中世纪场景'
    };
  }
  
  const totalBuildings = template.buildings.reduce((sum, b) => sum + b.count, 0);
  
  return {
    success: true,
    message: `🎬 准备创建"${template.name}"场景！\n\n` +
             '包含建筑：\n' +
             template.buildings.map(b => `  • ${b.description} x${b.count}`).join('\n') +
             `\n\n共 ${totalBuildings} 个建筑\n` +
             '⏱️ 预计需要 5-8 分钟\n\n' +
             '是否开始生成？',
    actions: [{
      type: 'confirm_scene',
      template: template
    }],
    needsConfirmation: true
  };
}

// 确认并执行场景创建
router.post('/confirm-scene', async (req, res) => {
  try {
    const { template } = req.body;
    
    const allTasks = [];
    
    for (const building of template.buildings) {
      for (let i = 0; i < building.count; i++) {
        const buildingName = `${building.description} ${i + 1}`;
        const result = await hunyuan3dService.textToModel(building.description, 1);
        
        if (result.success) {
          const insertQuery = `
            INSERT INTO generated_buildings 
            (user_id, name, prompt, task_id, status, created_at)
            VALUES ($1, $2, $3, $4, $5, NOW())
            RETURNING *
          `;
          
          await pool.query(insertQuery, [
            1,
            buildingName,
            building.description,
            result.data.TaskId,
            'processing'
          ]);
          
          allTasks.push(result.data.TaskId);
        }
      }
    }
    
    res.json({
      success: true,
      message: `✅ 场景"${template.name}"已开始生成！\n\n` +
               `📦 提交了 ${allTasks.length} 个建筑任务\n` +
               '⏱️ 预计 5-8 分钟完成',
      taskIds: allTasks
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      message: `❌ 场景创建失败: ${error.message}`
    });
  }
});

module.exports = router;
