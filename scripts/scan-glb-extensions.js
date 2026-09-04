#!/usr/bin/env node
/**
 * scan-glb-extensions.js — GLB 扩展兼容性扫描器（r185 升级阶段 0 工具）
 *
 * 目的：GLTFLoader 自 r146 起移除 KHR_materials_pbrSpecularGlossiness 支持，
 *       r185 的 GLTFLoader 加载含该扩展的 GLB 会直接报错。升级前必须摸清存量。
 *
 * 原理：GLB = 12 字节头 + chunks；首个 chunk 为 JSON。只读取 JSON chunk
 *       （按 chunk.length 精确读取，几十 MB 的模型只多读几十 KB），解析
 *       extensionsUsed / extensionsRequired。
 *
 * 用法：node scripts/scan-glb-extensions.js
 * 输出：控制台英文报告（避免 PowerShell GBK 乱码）
 *   exit 0 = 无 spec/gloss 风险；exit 1 = 存在风险文件；exit 2 = 扫描器错误
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SCAN_DIRS = ['public/uploads', 'public/models', 'public/scenes', 'uploads'];

// r185 GLTFLoader 仍支持（无需关注）之外的常见扩展，全部列出便于了解全貌
const RISK_EXT = 'KHR_materials_pbrSpecularGlossiness';

function readGlbJsonChunk(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const header = Buffer.alloc(12);
    const bytesRead = fs.readSync(fd, header, 0, 12, 0);
    if (bytesRead < 12) throw new Error('file too small, not a GLB');
    const magic = header.readUInt32LE(0);
    if (magic !== 0x46546c67) throw new Error('bad GLB magic (not glTF binary)');
    // version = header.readUInt32LE(4); // 2 expected
    const totalLen = header.readUInt32LE(8);
    if (totalLen < 12) throw new Error('bad GLB total length');

    const chunkHead = Buffer.alloc(8);
    const n2 = fs.readSync(fd, chunkHead, 0, 8, 12);
    if (n2 < 8) throw new Error('truncated chunk header');
    const chunkLen = chunkHead.readUInt32LE(0);
    // chunkType = chunkHead.readUInt32LE(4); // 0x4e4f534a = 'JSON'
    if (chunkLen <= 0 || chunkLen > 64 * 1024 * 1024) throw new Error('bad JSON chunk length: ' + chunkLen);

    const jsonBuf = Buffer.alloc(chunkLen);
    let off = 0;
    while (off < chunkLen) {
      const n = fs.readSync(fd, jsonBuf, off, chunkLen - off, 20 + off);
      if (n <= 0) throw new Error('truncated JSON chunk');
      off += n;
    }
    // 部分工具导出的 GLB 在 JSON chunk 内有尾部 padding（\0），JSON.parse 会报
    // "non-whitespace character after JSON"，先剥掉尾部的 NUL/空白再解析。
    const text = jsonBuf.toString('utf8').replace(/\x00+$/g, '');
    return JSON.parse(text);
  } finally {
    fs.closeSync(fd);
  }
}

function main() {
  const extStats = {};          // ext -> count
  const riskFiles = [];         // 含风险扩展的文件
  const parseErrors = [];       // 解析失败（可能不是 GLB / 损坏）
  let total = 0;

  for (const dir of SCAN_DIRS) {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) continue;
    const files = [];
    (function walk(d) {
      for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
        if (ent.name.startsWith('.') || ent.name.startsWith('_backup')) continue;
        const full = path.join(d, ent.name);
        if (ent.isDirectory()) walk(full);
        else if (/\.glb$/i.test(ent.name)) files.push(full);
      }
    })(abs);

    for (const f of files) {
      total++;
      const rel = path.relative(ROOT, f).replace(/\\/g, '/');
      try {
        const json = readGlbJsonChunk(f);
        const used = json.extensionsUsed || [];
        const required = json.extensionsRequired || [];
        for (const e of used) extStats[e] = (extStats[e] || 0) + 1;
        if (used.includes(RISK_EXT) || required.includes(RISK_EXT)) {
          riskFiles.push({ file: rel, required: required.includes(RISK_EXT) });
        }
      } catch (e) {
        parseErrors.push({ file: rel, err: e.message });
      }
    }
  }

  console.log('=== GLB extension scan (r185 compatibility) ===');
  console.log('dirs: ' + SCAN_DIRS.join(', '));
  console.log('total GLB scanned: ' + total);
  console.log('');

  console.log('--- extensions used (all files) ---');
  const ids = Object.keys(extStats).sort();
  if (ids.length === 0) console.log('  (none)');
  for (const id of ids) {
    console.log('  ' + id + ' x' + extStats[id]);
  }
  console.log('');

  console.log('--- RISK: files with ' + RISK_EXT + ' (rejected by GLTFLoader since r146) ---');
  if (riskFiles.length === 0) {
    console.log('  NONE - no spec/gloss risk found');
  } else {
    for (const r of riskFiles) {
      console.log('  ' + r.file + (r.required ? '  [REQUIRED - will fail hard]' : '  [optional - may still load]'));
    }
  }
  console.log('');

  if (parseErrors.length > 0) {
    console.log('--- parse errors (not GLB v2 binary or corrupted, first 20) ---');
    for (const p of parseErrors.slice(0, 20)) {
      console.log('  ' + p.file + '  (' + p.err + ')');
    }
    if (parseErrors.length > 20) console.log('  ... and ' + (parseErrors.length - 20) + ' more');
  }

  console.log('');
  console.log('=== SUMMARY ===');
  console.log('risk files: ' + riskFiles.length + ' / ' + total);
  console.log('parse errors: ' + parseErrors.length);

  process.exit(riskFiles.length > 0 ? 1 : 0);
}

try {
  main();
} catch (e) {
  console.error('[FATAL] ' + (e && e.stack ? e.stack : e));
  process.exit(2);
}
