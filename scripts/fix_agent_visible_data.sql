-- ============================================================================
-- AI 访客体检 #9 / #10 数据修复（2026-09-22）
--
-- 用途：修掉「AI 通过 observe 读到的、对外可见且是错的」两处数据。
--   ① #10  world_objects.name 的乱码显示名（mojibake：UTF-8 字节被按 Latin-1 解读）
--   ② #9   portals 的残留测试项与空描述（**需要你填内容**，本文件只给模板与现状）
--
-- ⚠️ 为什么用 `WHERE id = N AND name IS DISTINCT FROM '<新名>'` 而不是拿旧值做守卫：
--   乱码串里含**不可见字符**（U+00AD 软连字符、U+00A0 等），用文本编辑器/手写几乎不可能
--   逐字节复现，实测按旧值守卫匹配不上（0 行受影响）。改成只比对**新值**：
--   第一次执行会改到，重复执行返回 0 行（幂等），且不受编码差异影响。
--
-- 编码要求：本文件是 UTF-8。执行前确认客户端编码，否则会把中文再次写坏：
--   psql "…" -c "SHOW client_encoding;"                      -- 期望 UTF8
--   psql "…" -v ON_ERROR_STOP=1 -f scripts/fix_agent_visible_data.sql
--
-- 幂等性：全部只改 name / description，**不动模型路径、不动位置、不动 is_active**。
-- 备份建议（执行前）：
--   CREATE TABLE world_objects_bak_20260922 AS SELECT id, name FROM world_objects;
--   CREATE TABLE portals_bak_20260922      AS SELECT id, name, description FROM portals;
-- ============================================================================

-- ---------------------------------------------------------------------------
-- ① #10 乱码显示名（12 条，已逐条解码核对，可直接执行）
--    mojibake 还原规则：latin1 编码回字节 → 再按 UTF-8 解码。
--    ⚠️ id=515~523 的 "(副本)" 后缀是正常中文，还原时**不要**一起转（会变成 "(o,)"）。
-- ---------------------------------------------------------------------------
BEGIN;

-- 493  media_image     旧：æ¬¢è¿æ¥å°ä½ çä¸ç_å¼ å¾·å¿.jpg
UPDATE world_objects SET name = '欢迎来到你的世界_张德志.jpg', updated_at = NOW()
 WHERE id = 493 AND name IS DISTINCT FROM '欢迎来到你的世界_张德志.jpg';

-- 514~523  uploaded_model  旧：æ¡å­.glb 及其 "(副本)" 系列
UPDATE world_objects SET name = '桌子.glb', updated_at = NOW()
 WHERE id = 514 AND name IS DISTINCT FROM '桌子.glb';
UPDATE world_objects SET name = '桌子.glb (副本)', updated_at = NOW()
 WHERE id = 515 AND name IS DISTINCT FROM '桌子.glb (副本)';
UPDATE world_objects SET name = '桌子.glb (副本) (副本)', updated_at = NOW()
 WHERE id = 516 AND name IS DISTINCT FROM '桌子.glb (副本) (副本)';
UPDATE world_objects SET name = '桌子.glb (副本) (副本) (副本)', updated_at = NOW()
 WHERE id = 517 AND name IS DISTINCT FROM '桌子.glb (副本) (副本) (副本)';
UPDATE world_objects SET name = '桌子.glb (副本) (副本) (副本) (副本)', updated_at = NOW()
 WHERE id = 518 AND name IS DISTINCT FROM '桌子.glb (副本) (副本) (副本) (副本)';
UPDATE world_objects SET name = '桌子.glb (副本) (副本) (副本) (副本) (副本)', updated_at = NOW()
 WHERE id = 519 AND name IS DISTINCT FROM '桌子.glb (副本) (副本) (副本) (副本) (副本)';
UPDATE world_objects SET name = '桌子.glb (副本) (副本) (副本) (副本) (副本) (副本)', updated_at = NOW()
 WHERE id = 520 AND name IS DISTINCT FROM '桌子.glb (副本) (副本) (副本) (副本) (副本) (副本)';
UPDATE world_objects SET name = '桌子.glb (副本) (副本) (副本) (副本) (副本)', updated_at = NOW()
 WHERE id = 521 AND name IS DISTINCT FROM '桌子.glb (副本) (副本) (副本) (副本) (副本)';
UPDATE world_objects SET name = '桌子.glb (副本) (副本) (副本) (副本) (副本) (副本)', updated_at = NOW()
 WHERE id = 522 AND name IS DISTINCT FROM '桌子.glb (副本) (副本) (副本) (副本) (副本) (副本)';
UPDATE world_objects SET name = '桌子.glb (副本) (副本) (副本) (副本) (副本) (副本)', updated_at = NOW()
 WHERE id = 523 AND name IS DISTINCT FROM '桌子.glb (副本) (副本) (副本) (副本) (副本) (副本)';

-- 8392  uploaded_model  旧：åå¸æ¨¡å.glb
UPDATE world_objects SET name = '城市模型.glb', updated_at = NOW()
 WHERE id = 8392 AND name IS DISTINCT FROM '城市模型.glb';

COMMIT;

-- 自检（应返回 0 行 = 已无乱码显示名）：
-- SELECT id, name FROM world_objects WHERE name ~ '[ÃÂåæçèéêëìíîïðñòóôõö]';


-- ---------------------------------------------------------------------------
-- ② #9 portals：2 个残留测试项 + 3 个空描述
--    ⚠️ 本段**故意不预设内容**：传送门的名字/描述属于世界内容，
--       编造比留空更糟（AI 会照着编造的内容向用户转述）。
--       请按下面模板改成你想要的文案后再执行；若不改，保留注释即可（其余不受影响）。
--
--    当前现状（2026-09-22 实测，7 个全部 is_active=true）：
--      id_prefix   name           description
--      125bc2ee    城市            这是个大型城市场景
--      cbbdbfc5    多模型          （空）
--      82f3459c    大学开学        （空）
--      6291eb02    测试            测试          ← 残留
--      f660be5a    测试 (返回)     测试          ← 残留
--      905793ad    记忆空间        勿忘国耻
--      752f58f7    返回中心        （空）
-- ---------------------------------------------------------------------------
-- BEGIN;
--
-- -- 例：把「测试」改名并补描述（名字与描述请自行填写，不要照抄这里的示例文字）
-- -- UPDATE portals SET name = '（你要的名字）', description = '（一句话说明它通向哪里/是什么）'
-- --  WHERE id LIKE '6291eb02%';
-- --
-- -- UPDATE portals SET name = '（你要的名字）', description = '（同上）'
-- --  WHERE id LIKE 'f660be5a%';
-- --
-- -- -- 例：补空描述
-- -- UPDATE portals SET description = '（描述）' WHERE id LIKE 'cbbdbfc5%';
-- -- UPDATE portals SET description = '（描述）' WHERE id LIKE '82f3459c%';
-- -- UPDATE portals SET description = '（描述）' WHERE id LIKE '752f58f7%';
-- COMMIT;

-- 自检（当前应返回 5 行 = 还有 5 个待填/待清理）：
-- SELECT id, name, description FROM portals WHERE description = '测试' OR description = '' OR description IS NULL;
