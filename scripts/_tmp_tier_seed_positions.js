/**
 * _tmp_tier_seed_positions.js — 长会话（longsession）验收的**环境前置**：给三个测试 Agent 播种落库位置
 *
 * 为什么需要：`accept_agent_longsession.js` 的 C6 判据是
 *   `victimPosBefore !== null && delta < 40 && dist(spawn, 原点) > 1`
 * 即"重连出生点继承了断开前的位置，**且该位置不是原点**"——位置是原点时无法区分
 * "继承成功"与"回落到默认 (0,0,0)"，判据必然 FAIL（实测踩到）。
 * 而 `_tmp_tier_reset.js` 恰恰把位置清空 → spawn 变回 (0,0,0)，两者用途相反：
 *   - tier 六轮：先 reset（脚本假设 Agent 在原点附近，D/E 组的 30m CHAT 与到达窗口）
 *   - longsession：先 seed（C6 需要非原点；C5 需要 witness 能看到 victim → 三者相距 <200m）
 *
 * 用法：node scripts/_tmp_tier_seed_positions.js
 */
const fs = require('fs');
const path = require('path');
const db = require('../src/database/db');

// 三者互相距离 < 10m（witness 的 observe radius=200 一定看得到），且都非原点
const POS = {
  eco: { x: 30, y: 0, z: 3 },
  standard: { x: 34, y: 0, z: 6 },
  realtime: { x: 38, y: 0, z: 3 }
};

(async () => {
  const store = JSON.parse(fs.readFileSync(path.join(__dirname, '_tmp_tier_agents.json'), 'utf8'));
  for (const c of store.created) {
    const p = POS[c.key];
    if (!p) continue;
    const r = await db.query(
      'UPDATE agent_sessions SET current_position = $1::text::jsonb WHERE agent_id = $2',
      [JSON.stringify(p), c.id]
    );
    console.log(`${c.key.padEnd(9)} ${c.id.slice(0, 8)} rows=${r.rowCount} -> ${JSON.stringify(p)}`);
  }
  console.log('done：三个 Agent 下次连接将出生在 (30,3)/(34,6)/(38,3) 附近（非原点、互相 <10m）');
  process.exitCode = 0;
})();
