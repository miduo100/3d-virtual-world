/**
 * _tmp_tier_reset.js — 三档验收的**环境前置**：把三个测试 Agent 的落库位置清空
 *
 * 为什么需要：Agent 的出生点由 agentSessionManager.getLatestPosition 继承"上次落库位置"（缺陷 J 修复），
 * 而 tier 各轮脚本结束时 Agent 会停在远处（如 r5 走 +35m）。下一轮脚本若直接从第二轮开始跑
 * （D 组 CHAT 距离判定 30m、E 组 walk_to 到达等待窗口都假设 Agent 在原点附近），就会出现
 * "D 30m 内 CHAT 不可达 / E 未在窗口内到达"这类**假失败**。
 *
 * 用法：node scripts/_tmp_tier_reset.js   → 清空后三档脚本从出生点 (0,0,0) 开始。
 * （联测收尾清理时删除本文件）
 */
const fs = require('fs');
const path = require('path');
const db = require('../src/database/db');

(async () => {
  const store = JSON.parse(fs.readFileSync(path.join(__dirname, '_tmp_tier_agents.json'), 'utf8'));
  const ids = store.created.map(a => a.id);
  const before = await db.query(
    'SELECT agent_id, current_position FROM agent_sessions WHERE agent_id = ANY($1)', [ids]
  );
  console.log('before:', before.rows.map(r => `${r.agent_id.slice(0, 8)}=${JSON.stringify(r.current_position)}`).join(' | ') || '(无会话行)');
  const res = await db.query(
    'UPDATE agent_sessions SET current_position = NULL WHERE agent_id = ANY($1)', [ids]
  );
  console.log(`reset ${res.rowCount} session rows -> current_position = NULL（三个 Agent 下次连接从 (0,0,0) 出生）`);
  process.exitCode = 0;
})();
