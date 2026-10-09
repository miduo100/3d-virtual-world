-- add_world_reward_grants.sql —— Phase 3.5-2 · 极简玩法：Agent 领取记录（§C.3 ⑨ grants 的落地）
-- 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
--
-- ★ 为什么需要这张表（3.5-2 实施中发现的缺口，必须记进文档）：
--   player_inventory.user_id 有 FK → users(id)，而 **Agent 没有 users 行**
--   （红线：World AI/Agent 一律不建本地用户，见 P3/P5 铁律）。
--   所以"Agent 采集点发物品码 → player_inventory +1"在字面上做不到。
--   本阶段的选择：**只登记不发放**（grant 记录），物品码真正进背包留给 Phase 6
--   （届时与 player_inventory 打通，或改为"真人代领"）。
--   判据 P35-15 因此按"领取记录 +1、重复 interact 不重复发"验收。
--
-- 幂等：可重复执行
CREATE TABLE IF NOT EXISTS world_reward_grants (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id       VARCHAR(100) NOT NULL,
  actor_type     VARCHAR(10) NOT NULL,          -- human | agent（本期只有 agent 会真的进来）
  actor_id       VARCHAR(100) NOT NULL,
  interaction_id UUID REFERENCES world_interactions(id) ON DELETE SET NULL,
  interaction_key VARCHAR(60),
  region_key     VARCHAR(60),
  code_id        UUID,                          -- → reward_codes.id（可空：池子按 key 解析时可能没落具体码）
  code           VARCHAR(120),
  count          INT NOT NULL DEFAULT 1,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- ★ 幂等键：同一 Actor 对同一交互点只能领一次（判据 P35-15「重复 interact 不重复发」）
  CONSTRAINT uq_world_reward_grants UNIQUE (actor_type, actor_id, interaction_key)
);
CREATE INDEX IF NOT EXISTS idx_world_reward_grants_actor ON world_reward_grants(actor_type, actor_id);
CREATE INDEX IF NOT EXISTS idx_world_reward_grants_region ON world_reward_grants(region_key);