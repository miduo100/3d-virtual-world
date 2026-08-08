/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
const { query } = require('./database/db');

async function initAIScenesDB() {
  try {
    console.log('');
    console.log('========================================');
    console.log('🎨 AI场景保存功能 - 数据库初始化');
    console.log('========================================');
    console.log('');

    // 直接使用代码创建表，而不是解析SQL文件
    console.log('📝 开始创建数据表...');
    console.log('');

    // 1. 创建 ai_generated_scenes 表
    console.log('✅ [1/6] 创建表: ai_generated_scenes');
    await query(`
      CREATE TABLE IF NOT EXISTS ai_generated_scenes (
        id SERIAL PRIMARY KEY,
        scene_name VARCHAR(255) NOT NULL,
        description TEXT NOT NULL,
        scene_type VARCHAR(50),
        scene_config JSONB NOT NULL,
        layout_data JSONB NOT NULL,
        object_count INTEGER DEFAULT 0,
        ai_provider VARCHAR(50),
        user_id INTEGER,
        is_public BOOLEAN DEFAULT false,
        view_count INTEGER DEFAULT 0,
        thumbnail_url VARCHAR(500),
        tags TEXT[],
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 2. 创建 ai_scene_favorites 表
    console.log('✅ [2/6] 创建表: ai_scene_favorites');
    await query(`
      CREATE TABLE IF NOT EXISTS ai_scene_favorites (
        id SERIAL PRIMARY KEY,
        scene_id INTEGER REFERENCES ai_generated_scenes(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(scene_id, user_id)
      )
    `);

    // 3. 创建索引
    console.log('✅ [3/6] 创建索引');
    await query('CREATE INDEX IF NOT EXISTS idx_ai_scenes_user_id ON ai_generated_scenes(user_id)');
    await query('CREATE INDEX IF NOT EXISTS idx_ai_scenes_scene_type ON ai_generated_scenes(scene_type)');
    await query('CREATE INDEX IF NOT EXISTS idx_ai_scenes_is_public ON ai_generated_scenes(is_public)');
    await query('CREATE INDEX IF NOT EXISTS idx_ai_scenes_created_at ON ai_generated_scenes(created_at)');
    await query('CREATE INDEX IF NOT EXISTS idx_ai_scenes_tags ON ai_generated_scenes USING GIN(tags)');
    await query('CREATE INDEX IF NOT EXISTS idx_ai_scene_favorites_user_id ON ai_scene_favorites(user_id)');
    await query('CREATE INDEX IF NOT EXISTS idx_ai_scene_favorites_scene_id ON ai_scene_favorites(scene_id)');

    // 4. 创建更新时间触发器函数
    console.log('✅ [4/6] 创建触发器函数');
    await query(`
      CREATE OR REPLACE FUNCTION update_ai_scenes_updated_at()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = CURRENT_TIMESTAMP;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);

    // 5. 创建触发器
    console.log('✅ [5/6] 创建触发器');
    await query(`
      DROP TRIGGER IF EXISTS trigger_update_ai_scenes_updated_at ON ai_generated_scenes
    `);
    await query(`
      CREATE TRIGGER trigger_update_ai_scenes_updated_at
      BEFORE UPDATE ON ai_generated_scenes
      FOR EACH ROW
      EXECUTE FUNCTION update_ai_scenes_updated_at()
    `);

    // 6. 插入示例数据
    console.log('✅ [6/6] 插入示例数据');
    try {
      await query(`
        INSERT INTO ai_generated_scenes (scene_name, description, scene_type, scene_config, layout_data, object_count, ai_provider, is_public, tags)
        VALUES 
        (
          '温馨小村庄',
          '一个漂亮的村子，有几座山、茅草屋、树木和小动物',
          'village',
          '{"scene_type":"village","environment":{"terrain":"hills","time":"day","weather":"clear"},"objects":[{"type":"mountain","count":3,"properties":{"size":"medium"}},{"type":"cottage","count":5,"properties":{"size":"small"}},{"type":"tree","count":10,"properties":{"size":"varied"}},{"type":"hen","count":2,"properties":{"size":"small"}},{"type":"cat","count":1,"properties":{"size":"small"}}]}'::jsonb,
          '[]'::jsonb,
          21,
          'default',
          true,
          ARRAY['村庄', '温馨', '示例']
        ),
        (
          '现代化都市',
          '繁华的城市场景，高楼大厦林立，街道上车水马龙',
          'city',
          '{"scene_type":"city","environment":{"terrain":"flat","time":"night","weather":"clear"},"objects":[{"type":"skyscraper","count":12,"properties":{"size":"varied"}},{"type":"lamp","count":20,"properties":{"size":"small"}},{"type":"car","count":8,"properties":{"size":"small"}}]}'::jsonb,
          '[]'::jsonb,
          40,
          'default',
          true,
          ARRAY['城市', '现代', '示例']
        ),
        (
          '魔法森林',
          '神秘的魔法森林，有发光的水晶和传送门',
          'forest',
          '{"scene_type":"forest","environment":{"terrain":"hills","time":"day","weather":"fog"},"objects":[{"type":"tree","count":30,"properties":{"size":"varied"}},{"type":"crystal","count":10,"properties":{"size":"varied"}},{"type":"portal","count":1,"properties":{"size":"large"}}]}'::jsonb,
          '[]'::jsonb,
          41,
          'default',
          true,
          ARRAY['森林', '魔法', '示例']
        )
        ON CONFLICT DO NOTHING
      `);
    } catch (error) {
      if (error.message.includes('duplicate key')) {
        console.log('   ⚠️  示例数据已存在，跳过');
      } else {
        throw error;
      }
    }

    console.log('');
    console.log('🔍 验证数据表...');
    
    // 验证表是否创建成功
    const tableCheck = await query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
        AND table_name IN ('ai_generated_scenes', 'ai_scene_favorites')
      ORDER BY table_name
    `);

    if (tableCheck.rows.length === 2) {
      console.log('✅ 数据表验证成功:');
      tableCheck.rows.forEach(row => {
        console.log(`   - ${row.table_name}`);
      });
    } else {
      console.warn('⚠️  部分数据表可能未创建成功');
    }

    console.log('');
    console.log('📊 检查示例场景...');
    
    const sceneCount = await query(`
      SELECT COUNT(*) as count FROM ai_generated_scenes
    `);
    
    console.log(`✅ 当前场景数量: ${sceneCount.rows[0].count}`);

    console.log('');
    console.log('========================================');
    console.log('✅ AI场景数据库初始化完成！');
    console.log('========================================');
    console.log('');
    console.log('🎨 现在你可以：');
    console.log('   1. 启动服务器: npm start');
    console.log('   2. 访问测试页面: http://localhost:3002/test_ai_scene.html');
    console.log('   3. 生成场景后点击"保存场景"按钮');
    console.log('   4. 在"我的场景"列表中查看和加载已保存的场景');
    console.log('');
    console.log('💾 可用功能：');
    console.log('   - 保存场景到数据库');
    console.log('   - 导出场景为JSON文件');
    console.log('   - 查看和加载历史场景');
    console.log('   - 场景统计和管理');
    console.log('');

    process.exit(0);

  } catch (error) {
    console.error('');
    console.error('========================================');
    console.error('❌ 初始化失败');
    console.error('========================================');
    console.error('错误信息:', error.message);
    console.error('');
    
    if (error.message.includes('password authentication failed')) {
      console.error('💡 解决方法：');
      console.error('   检查 .env 文件中的数据库密码是否正确');
      console.error('   DB_PASSWORD=你的数据库密码');
    } else if (error.message.includes('connection')) {
      console.error('💡 解决方法：');
      console.error('   1. 确认 PostgreSQL 服务是否运行');
      console.error('   2. 检查 .env 文件中的数据库配置');
      console.error('   3. 确认数据库 virtual_world 已创建');
    } else if (error.code === 'ENOENT') {
      console.error('💡 解决方法：');
      console.error('   SQL文件不存在，请确认文件路径:');
      console.error('   src/database/init_ai_scenes.sql');
    }
    
    console.error('');
    process.exit(1);
  }
}

// 执行初始化
initAIScenesDB();
