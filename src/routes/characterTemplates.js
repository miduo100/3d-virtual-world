/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
/**
 * characterTemplates.js 已重构为模块化结构
 * 本文件作为兼容入口，实际代码已迁移到 ./characterTemplates/ 目录
 *
 * 文件结构：
 * ├── characterTemplates/
 * │   ├── index.js          # 主入口模块
 * │   ├── utils.js          # 工具函数
 * │   ├── uploads.js        # 文件上传配置
 * │   ├── database.js       # 数据库初始化
 * │   ├── templates.js      # 角色模板 API
 * │   ├── weapons.js      # 武器库 API
 * │   └── extras.js       # 其他功能 API
 */

module.exports = require('./characterTemplates/index');
