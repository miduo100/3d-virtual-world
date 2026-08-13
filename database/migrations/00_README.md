# database/migrations/ 目录说明

## 自动执行机制

`src/database/db.js` 启动时会依次执行本目录（以及 `database/` 根目录）下列迁移文件：

1. `gallery_init.sql`（database/ 根目录）
2. `migrations/add_ad_slot_portal_fields.sql`
3. `add_security_questions.sql`（database/ 根目录）
4. `add_login_attempts.sql`（database/ 根目录）
5. `migrations/add_system_config.sql`
6. `migrations/add_user_subscriptions.sql`
7. `migrations/add_payment_reference.sql`
8. `migrations/add_world_id_to_subscriptions.sql`
9. `migrations/fix_subscription_user_id.sql`
10. `migrations/add_has_collision.sql`
11. `add_threejs_code_blocks.sql`（database/ 根目录）
12. `migrations/add_federation_trust_approval.sql`
13. `migrations/add_custom_config.sql`

## 迁移编写规范

- **所有迁移必须幂等**：使用 `CREATE TABLE IF NOT EXISTS`、`ALTER TABLE ... ADD COLUMN IF NOT EXISTS`、`DROP CONSTRAINT IF EXISTS`，保证可重复执行不报错。
- 先执行 `database/init.sql`（全量建表 + 种子数据，同样幂等），再执行以上增量迁移，用于补齐旧库缺失的结构。
- 迁移文件执行失败不影响服务器启动（`db.js` 会捕获并打印跳过日志）。

## 手动执行

如需手动执行某个迁移（例如部署后手动补结构）：

```bash
psql -U virtual_world -d virtual_world -f database/migrations/add_has_collision.sql
```

## 其他参考脚本

本目录保留的 `cleanup_duplicate_hunyuan.sql`、`migrate_old_config_to_ai_providers.sql`、`update_hunyuan_provider.sql`、`update_qwen_models.sql` 为一次性数据修复脚本，**不在自动执行列表内**，按需手动执行。
