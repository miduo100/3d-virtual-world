/**
 * 受信任世界 endpoint_key 回填 / 重复检测
 *
 * 用法：
 *   node scripts/backfill_trusted_world_endpoint_key.js          # 仅预览（默认）
 *   node scripts/backfill_trusted_world_endpoint_key.js --apply  # 真写库
 *
 * 说明：
 *   endpoint_key = host[:port][/path]，忽略 http/https，80/443 视为默认端口。
 *   本脚本只补 endpoint_key，**不删除任何记录**；重复项请在管理后台
 *   「联邦与传送 → 受信任世界」里人工保留一条、删除其余（或点「重新绑定」）。
 */

require('dotenv').config();
const { pool } = require('../src/database/db');
const { endpointKey } = require('../src/services/trustedWorldStore');

const APPLY = process.argv.includes('--apply');

async function main() {
  const { rows } = await pool.query(
    `SELECT world_id, world_name, world_url, endpoint_key, created_at
       FROM trusted_worlds
      ORDER BY created_at ASC NULLS FIRST`
  );

  if (rows.length === 0) {
    console.log('trusted_worlds 为空，无需处理');
    return;
  }

  const groups = new Map();
  for (const row of rows) {
    const key = endpointKey(row.world_url);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  console.log(`共 ${rows.length} 条记录 / ${groups.size} 个端点\n`);
  let needUpdate = 0;

  for (const [key, list] of groups.entries()) {
    const flag = list.length > 1 ? ' ⚠️ 重复' : '';
    console.log(`端点 ${key || '(无法解析)'}${flag}`);
    for (const row of list) {
      const mark = row.endpoint_key === key ? '✓' : '→';
      if (row.endpoint_key !== key) needUpdate += 1;
      console.log(`  ${mark} ${row.world_id}  ${row.world_name}  ${row.world_url}  [${row.endpoint_key || 'NULL'}]`);
    }
  }

  console.log(`\n需要回填 endpoint_key 的行：${needUpdate}`);

  if (!APPLY) {
    console.log('（预览模式，未写库；加 --apply 才会写入）');
    return;
  }

  let updated = 0;
  let failed = 0;
  for (const row of rows) {
    const key = endpointKey(row.world_url);
    if (!key) continue;
    try {
      await pool.query(
        'UPDATE trusted_worlds SET endpoint_key = $1, updated_at = NOW() WHERE world_id = $2',
        [key, row.world_id]
      );
      updated += 1;
    } catch (e) {
      failed += 1;
      console.warn(`  ✗ ${row.world_id} 写入失败: ${e.message}`);
    }
  }
  console.log(`\n完成：更新 ${updated} 行，失败 ${failed} 行`);
  if (failed > 0) {
    console.log('失败通常是唯一索引冲突（同端点存在多条记录）。请先在后台删除重复项，再重跑本脚本。');
  }
}

main()
  .catch((e) => {
    console.error('执行失败:', e.message);
    process.exitCode = 1;
  })
  .finally(() => {
    // Windows 下 pool 与异步句柄容易触发退出断言，直接结束进程
    setTimeout(() => process.exit(process.exitCode || 0), 300);
  });
