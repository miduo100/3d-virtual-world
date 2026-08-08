# database/migrations/ 目录说明

**此目录已废弃，不再用于自动执行。**

所有数据库表结构定义和种子数据已统一合并到 `database/init.sql`。

Docker 部署时不再挂载此目录，避免增量迁移文件在全新初始化时引用不存在的表导致报错。

保留此目录中的文件仅供参考和手动迁移使用。如需手动执行增量迁移，请使用：

```bash
psql -U virtual_world -d virtual_world -f database/migrations/add_missing_fields.sql
```
