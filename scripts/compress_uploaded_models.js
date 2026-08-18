#!/usr/bin/env node
/**
 * compress_uploaded_models.js — 存量上传模型批量压缩脚本
 *
 * 用法：
 *   node scripts/compress_uploaded_models.js                # 扫描并压缩全部 >10MB 的 GLB/GLTF
 *   node scripts/compress_uploaded_models.js --file xxx.glb  # 只压缩指定文件
 *   node scripts/compress_uploaded_models.js --dry-run       # 仅预览将处理的文件
 *
 * 安全：
 *   - 处理前备份到 public/models/uploaded/_backup_原始/（备份已存在则跳过，幂等可重跑）
 *   - 压缩失败/输出未变小 → 保留原文件
 *   - DB 同步失败 → 只压缩文件不更新库，不阻断
 */
const path = require('path');
const fs = require('fs');
const { compressIfNeeded } = require('../src/services/modelAutoCompress');

const UPLOAD_DIR = path.join(__dirname, '../public/models/uploaded');
const BACKUP_DIR = path.join(UPLOAD_DIR, '_backup_原始');
const THRESHOLD = 10 * 1024 * 1024; // 10MB

// ---- 参数解析 ----
const argv = process.argv.slice(2);
let onlyFile = null;
let dryRun = false;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--dry-run') dryRun = true;
  else if (a === '--file') onlyFile = argv[++i];
  else if (a.startsWith('--file=')) onlyFile = a.slice(7);
}

function fmt(bytes) {
  if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + 'MB';
  if (bytes >= 1024) return (bytes / 1024).toFixed(1) + 'KB';
  return bytes + 'B';
}

async function main() {
  await fs.promises.mkdir(BACKUP_DIR, { recursive: true });

  // 收集目标文件
  let files = (await fs.promises.readdir(UPLOAD_DIR))
    .filter(f => /\.(glb|gltf)$/i.test(f))
    .map(f => {
      const absPath = path.join(UPLOAD_DIR, f);
      const size = fs.statSync(absPath).size;
      return { name: f, absPath, size };
    })
    .filter(f => f.size > THRESHOLD);

  if (onlyFile) {
    const target = files.find(f => f.name === onlyFile);
    const fullPath = path.join(UPLOAD_DIR, onlyFile);
    if (target) {
      files = [target];
    } else if (fs.existsSync(fullPath)) {
      const size = fs.statSync(fullPath).size;
      files = [{ name: onlyFile, absPath: fullPath, size }];
    } else {
      console.error('❌ 文件不存在:', onlyFile);
      process.exit(1);
    }
  }

  if (files.length === 0) {
    console.log('没有需要压缩的 GLB/GLTF 文件（>10MB）。');
    return;
  }

  console.log('════════ 上传模型批量压缩 ════════');
  console.log(`待处理 ${files.length} 个文件:`);
  for (const f of files) console.log(`  - ${f.name} (${fmt(f.size)})`);

  if (dryRun) {
    console.log('── dry-run 模式，不执行压缩 ──');
    return;
  }

  // 数据库连接（可降级）
  let pool = null;
  try { pool = require('../src/database/db').pool; } catch (e) { pool = null; }

  const results = [];
  let totalBefore = 0;
  let totalAfter = 0;
  let compressedCount = 0;

  for (const f of files) {
    totalBefore += f.size;

    // 备份（幂等：备份已存在则跳过）
    const backupPath = path.join(BACKUP_DIR, f.name);
    if (!fs.existsSync(backupPath)) {
      await fs.promises.copyFile(f.absPath, backupPath);
      console.log(`📦 已备份 → ${backupPath}`);
    } else {
      console.log(`📦 备份已存在，跳过备份: ${f.name}`);
    }

    console.log(`⚙️ 压缩中: ${f.name} ...`);
    const comp = await compressIfNeeded(f.absPath, f.size);

    let status;
    if (comp.compressed) {
      compressedCount++;
      totalAfter += comp.compressedSize;
      status = 'COMPRESSED';
      // 同步 DB file_size
      if (pool) {
        try {
          const up = await pool.query(
            'UPDATE uploaded_models SET file_size = $1 WHERE saved_file_name = $2',
            [comp.compressedSize, f.name]
          );
          if (up.rowCount > 0) {
            console.log(`  ✔ DB file_size 已更新为 ${fmt(comp.compressedSize)}`);
          } else {
            console.log('  ℹ DB 中未找到对应记录，跳过 DB 更新');
          }
        } catch (dbErr) {
          console.warn('  ⚠ DB 更新失败（不影响文件压缩）:', dbErr.message);
        }
      }
    } else {
      totalAfter += f.size;
      status = 'SKIPPED(' + comp.reason + ')';
      if (comp.error) status += ' | ' + comp.error;
    }
    results.push({
      name: f.name,
      before: f.size,
      after: comp.compressed ? comp.compressedSize : f.size,
      status,
    });
  }

  // 输出对比表
  console.log('\n════════ 压缩结果 ════════');
  console.log('文件名 | 原始大小 | 压缩后 | 压缩率 | 状态');
  for (const r of results) {
    const ratio = r.after < r.before ? ((1 - r.after / r.before) * 100).toFixed(1) + '%↓' : '-';
    console.log(`  ${r.name} | ${fmt(r.before)} | ${fmt(r.after)} | ${ratio} | ${r.status}`);
  }
  console.log(`\n总计: ${fmt(totalBefore)} → ${fmt(totalAfter)} (压缩 ${compressedCount}/${files.length} 个)`);
}

main().catch(e => { console.error('❌ 脚本执行失败:', e); process.exit(1); });
