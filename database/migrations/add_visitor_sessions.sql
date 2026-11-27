-- 访客访问统计（2026-11-13）
--
-- 口径（与产品确认）：
--   1) 只有真正进入世界（WS PLAYER_JOIN）才记一条会话；
--      仅打开首页、没进世界的人不进这张表（留待 P1 的 HTTP PV 层）。
--   2) 停留时长 = left_at - entered_at，在连接断开时由服务端回填，
--      不依赖前端上报（关页面、拔网线、杀进程都能覆盖）。
--
-- 两个必须注意的点：
--   * entered_at 用 TIMESTAMPTZ。日统计必须显式
--     (entered_at AT TIME ZONE 'Asia/Shanghai')::date，
--     否则「今日」会随数据库时区偏移 8 小时。
--   * end_reason = 'open' 表示会话还没结束；算平均停留时必须排除，
--     否则会把「正在玩的 30 秒」当成「逛完就走」。

CREATE TABLE IF NOT EXISTS visitor_sessions (
  id           BIGSERIAL PRIMARY KEY,
  visitor_type VARCHAR(10)  NOT NULL,              -- guest | user
  session_key  VARCHAR(128) NOT NULL,              -- 游客 guestId / 登录用户 user:<uuid>
  user_id      UUID REFERENCES users(id) ON DELETE SET NULL,
  ip           VARCHAR(64),
  ua           TEXT,
  world_id     TEXT,                               -- 预留多世界，先可空
  entered_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  left_at      TIMESTAMPTZ,
  duration_sec INTEGER,
  end_reason   VARCHAR(16)                         -- close | timeout | cap | open
);

CREATE INDEX IF NOT EXISTS idx_vs_entered
  ON visitor_sessions (entered_at DESC);

CREATE INDEX IF NOT EXISTS idx_vs_type_entered
  ON visitor_sessions (visitor_type, entered_at DESC);

-- 会话合并用：同 session_key 最近一条未结束会话
CREATE INDEX IF NOT EXISTS idx_vs_key_recent
  ON visitor_sessions (session_key, last_seen_at DESC);

-- 日聚合会扫 left_at IS NOT NULL 的子集
CREATE INDEX IF NOT EXISTS idx_vs_left
  ON visitor_sessions (left_at)
  WHERE left_at IS NOT NULL;
