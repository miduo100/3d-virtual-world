/**
 * portals 表列懒迁移（幂等，进程内只执行一次）
 * show_in_list：是否在玩家端"现有传送门列表"中显示（世界内模型渲染与传送不受影响）
 */
const { query } = require('./db');

let ensured = false;

async function ensureShowInListColumn() {
  if (ensured) return;
  try {
    await query(
      'ALTER TABLE portals ADD COLUMN IF NOT EXISTS show_in_list BOOLEAN DEFAULT TRUE'
    );
    ensured = true;
  } catch (error) {
    console.error('[portals] show_in_list 列迁移失败:', error.message);
  }
}

module.exports = { ensureShowInListColumn };
