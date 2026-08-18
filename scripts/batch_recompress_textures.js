#!/usr/bin/env node
/**
 * batch_recompress_textures.js — 批量纹理重压缩 + DB 同步
 * 逐个调用已验证的单文件脚本 recompress_textures.js（继承其安全机制：备份/无收益保护/布局断言）
 *
 * 用法:
 *   node scripts/batch_recompress_textures.js --dry   # 预览（输出 *.tex.glb，不写盘不动库）
 *   node scripts/batch_recompress_textures.js         # 正式执行（备份→压缩→同步DB）
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const UPLOAD_DIR = path.join(__dirname, '../public/models/uploaded');
const SINGLE = path.join(__dirname, 'recompress_textures.js');
const SKIP = new Set(['model-1787019326584-436020307.glb']); // 课桌已完成

function fmt(b) {
  if (b >= 1048576) return (b / 1048576).toFixed(2) + 'MB';
  if (b >= 1024) return (b / 1024).toFixed(1) + 'KB';
  return b + 'B';
}

async function syncDB() {
  const { pool } = require('../src/database/db');
  const files = fs.readdirSync(UPLOAD_DIR).filter(f => /\.glb$/i.test(f));
  let updated = 0;
  for (const f of files) {
    const size = fs.statSync(path.join(UPLOAD_DIR, f)).size;
    const r = await pool.query(
      'UPDATE uploaded_models SET file_size = $1 WHERE saved_file_name = $2 AND file_size <> $1',
      [size, f]
    );
    updated += r.rowCount;
  }
  await pool.end();
  return updated;
}

(async () => {
  const dry = process.argv.includes('--dry');
  const files = fs.readdirSync(UPLOAD_DIR).filter(f => /\.glb$/i.test(f) && !SKIP.has(f));
  let totalBefore = 0, totalAfter = 0, ok = 0, skipNoGain = 0, fail = 0;

  console.log(`待处理 ${files.length} 个 GLB，模式: ${dry ? 'DRY-RUN' : 'APPLY'}`);

  for (const f of files) {
    const fp = path.join(UPLOAD_DIR, f);
    const before = fs.statSync(fp).size;
    const args = [SINGLE, fp];
    if (!dry) args.push('--apply');
    const r = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 600000 });
    // dry-run 时成果在 .tex.glb 预览文件；apply 时原地替换
    const outPath = dry ? path.join(UPLOAD_DIR, f.replace(/\.glb$/i, '') + '.tex.glb') : fp;
    const after = fs.existsSync(outPath) ? fs.statSync(outPath).size : before;
    // dry-run 结束即清理预览文件（统计完再删）
    if (r.status !== 0) {
      fail++;
      const msg = (r.stderr || r.stdout || 'unknown').split('\n').filter(Boolean).pop();
      console.log(`[FAIL] ${f}: ${msg}`);
      if (dry && fs.existsSync(outPath)) fs.unlinkSync(outPath);
      continue;
    }
    if (after < before) {
      ok++;
      console.log(`[ OK ] ${f}: ${fmt(before)} -> ${fmt(after)} (-${(100 - after / before * 100).toFixed(1)}%)`);
    } else {
      skipNoGain++;
      console.log(`[SKIP] ${f}: ${fmt(before)} 无收益保留`);
    }
    totalBefore += before;
    totalAfter += after;
    if (dry && fs.existsSync(outPath)) fs.unlinkSync(outPath);
  }

  console.log('════════ 汇总 ════════');
  console.log(`压缩成功: ${ok} | 无收益: ${skipNoGain} | 失败: ${fail}`);
  if (totalBefore > 0) {
    console.log(`总体积: ${fmt(totalBefore)} -> ${fmt(totalAfter)} (节省 ${fmt(totalBefore - totalAfter)}, -${(100 - totalAfter / totalBefore * 100).toFixed(1)}%)`);
  }

  if (!dry) {
    const n = await syncDB();
    console.log(`DB uploaded_models.file_size 已同步 ${n} 条`);
  }
})().catch(e => { console.error('BATCH FAIL:', e.message); process.exit(1); });
