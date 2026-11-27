/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
/**
 * 动作库种子数据自检（服务器启动时自动调用）
 *
 * 背景：角色动作不在角色模型里，而是「动作库」里的独立 glb，运行时重定向到角色骨骼。
 *       animation_library 表为空时，动作库页面没有任何动作可选，角色只能停在 T-pose。
 *       早期打包的 database/00_init_all.sql 只带了表结构、没带种子数据，线上首次部署会踩到。
 *
 * 策略：
 *   1. 只在表「完全为空」时插入种子数据 —— 管理员后续的增删启停不会被启动流程覆盖。
 *   2. 插入后核对文件是否落盘，缺文件只告警不阻断（不影响建库和其他功能）。
 *   3. 任何异常都吞掉，绝不影响服务器启动。
 */
const fs = require('fs');
const path = require('path');
const { query } = require('./db');

const SEED_FILE = path.join(__dirname, '..', '..', 'database', 'seed_animation_library.sql');
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'public', 'uploads', 'anim-library');

/**
 * @returns {Promise<{status:'inserted'|'skipped'|'failed', count?:number, missing?:string[], error?:string}>}
 */
async function ensureAnimationLibrary() {
  try {
    // 表可能还没建（安装未完成）—— 直接跳过
    const reg = await query(`SELECT to_regclass('public.animation_library') AS t`);
    if (!reg.rows[0] || !reg.rows[0].t) {
      return { status: 'skipped', reason: 'table-missing' };
    }

    const cnt = await query('SELECT COUNT(*)::int AS n FROM public.animation_library');
    const existing = cnt.rows[0].n;
    if (existing > 0) {
      return { status: 'skipped', count: existing };
    }

    if (!fs.existsSync(SEED_FILE)) {
      return { status: 'skipped', reason: 'seed-file-missing' };
    }

    const sql = fs.readFileSync(SEED_FILE, 'utf-8');
    // 单条 INSERT ... VALUES (...),(...) ON CONFLICT DO NOTHING，pg 可直接执行
    await query(sql);

    const after = await query('SELECT COUNT(*)::int AS n FROM public.animation_library');
    const total = after.rows[0].n;

    // 核对启用的动作文件是否都在磁盘上
    const rows = await query(
      `SELECT anim_key, glb_url FROM public.animation_library WHERE is_active = TRUE ORDER BY sort_order`
    );
    const missing = [];
    for (const row of rows.rows) {
      const url = String(row.glb_url || '');
      const name = url.split('/').pop();
      if (!name) continue;
      if (!fs.existsSync(path.join(UPLOAD_DIR, name))) {
        missing.push(`${row.anim_key} → ${url}`);
      }
    }

    return { status: 'inserted', count: total, missing };
  } catch (e) {
    return { status: 'failed', error: e.message };
  }
}

module.exports = { ensureAnimationLibrary };
