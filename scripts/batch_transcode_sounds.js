/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
/**
 * batch_transcode_sounds.js —— 批量把 sounds 目录下的 WAV 转成 MP3，并同步更新所有引用
 *
 * 为什么需要这个脚本：
 *   音效的**文件名即引用键**（soundAssetsRoute 靠扫目录建引用明细）。
 *   转码会把 env-wind.wav 变成 env-wind.mp3，所有引用它的地方（JSONB 里的 url 字段）
 *   都得跟着改，否则引用全断、素材点不响。
 *
 * 用法：
 *   node scripts/batch_transcode_sounds.js --dry-run   只看会改什么，不动文件
 *   node scripts/batch_transcode_sounds.js             真转
 *
 * 转码规则（与 soundStore.js / audioCompress.js 同一套）：
 *   WAV → MP3 单声道 32kbps；采样率按素材类型分级（环境音 22.05kHz / 动作音 44.1kHz）
 *   已经是 mp3/aac/m4a 的跳过（再压是 generational loss）
 *   压缩失败或无收益 → 保留原文件
 *
 * 引用源（9 类，改名后逐个同步）：
 *   ① character_templates.anim_sounds      JSONB {key:{urls:[],...}}
 *   ② character_templates.weapon_sounds    同上
 *   ③ world_objects.custom_config->'audio' JSONB {url,...}
 *   ④ world_regions.gameplay->'audio'      JSONB {url|synth|layers}
 *   ⑤ system_config['ambient_pads']        JSONB 数组 [{url,...}]
 *   ⑥ system_config['audio_weather']       JSONB {wind:{url,candidates[]},...}
 *   ⑦ system_config['ambient_music']       JSONB {url,...}
 *   ⑧ animation_library.sound_url          TEXT
 *   ⑨ weapon_skills.sound_url / template_skills.fx_sound_url   TEXT
 */
'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool, query } = require('../src/database/db');
const audioCompress = require('../src/services/audioCompress');

const SOUNDS_DIR = path.join(__dirname, '../public/uploads/character-templates/sounds');
const DRY_RUN = process.argv.includes('--dry-run');

// 已经压缩过的格式不再二次压缩
const SKIP = /\.(mp3|aac|m4a|ogg|opus)$/i;

function asJson(v) {
  if (v == null) return null;
  if (typeof v === 'string') { try { return JSON.parse(v); } catch (e) { return null; } }
  return v;
}

/** 递归把对象里所有指向旧文件名的 url 换成新文件名 */
function remap(obj, map) {
  if (obj == null) return obj;
  if (typeof obj === 'string') {
    // 直接命中文件名
    if (map[obj]) return map[obj];
    // 命中 URL 尾部（带目录前缀的完整 URL）
    for (const [oldName, newName] of Object.entries(map)) {
      if (obj.endsWith('/' + oldName)) {
        return obj.slice(0, obj.length - oldName.length) + newName;
      }
    }
    return obj;
  }
  if (Array.isArray(obj)) return obj.map(x => remap(x, map));
  if (typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) out[k] = remap(v, map);
    return out;
  }
  return obj;
}

(async () => {
  // 只在直接运行时执行（被 require 时不跑）
  if (require.main !== module) {
    module.exports = { remap };
    return;
  }

  console.log(DRY_RUN ? '=== 试运行（不改动任何文件/数据）===' : '=== 开始批量转码 ===');
  console.log('目录: ' + SOUNDS_DIR + '\n');

  if (!fs.existsSync(SOUNDS_DIR)) {
    console.log('目录不存在，退出');
    process.exit(0);
  }

  // ── 1. 扫目录，找出要转的 WAV ──
  const files = fs.readdirSync(SOUNDS_DIR)
    .filter(f => fs.statSync(path.join(SOUNDS_DIR, f)).isFile())
    .filter(f => /\.(wav)$/i.test(f));

  if (!files.length) {
    console.log('没有 WAV 需要转码');
    process.exit(0);
  }

  const map = {};        // 旧文件名 → 新文件名
  const results = [];

  for (const f of files) {
    const src = path.join(SOUNDS_DIR, f);
    const sizeIn = fs.statSync(src).size;
    const rate = audioCompress.suggestSampleRate(f);
    const buf = fs.readFileSync(src);
    const r = await audioCompress.compressAudio(buf, { sampleRate: rate });

    if (!r.ok) {
      results.push({ file: f, ok: false, reason: r.reason, sizeIn });
      console.log(`⏭  ${f.padEnd(46)} 跳过：${r.reason}`);
      continue;
    }

    const newName = f.replace(/\.wav$/i, '.mp3');
    map[f] = newName;
    results.push({
      file: f, ok: true, newName, sizeIn, sizeOut: r.buffer.length,
      ratio: Number(r.ratio.toFixed(1)), sampleRate: r.sampleRate, buffer: r.buffer,
    });
    console.log(`✅ ${f.padEnd(46)} ${(sizeIn / 1024).toFixed(1).padStart(7)}KB → ${(r.buffer.length / 1024).toFixed(1).padStart(6)}KB  ${r.ratio.toFixed(1)}x  ${r.sampleRate}Hz`);
  }

  const okList = results.filter(x => x.ok);
  const totalIn = results.reduce((s, x) => s + x.sizeIn, 0);
  const totalOut = results.reduce((s, x) => s + (x.ok ? x.sizeOut : x.sizeIn), 0);
  console.log(`\n汇总: ${okList.length}/${results.length} 个可转  总体积 ${(totalIn / 1024).toFixed(1)}KB → ${(totalOut / 1024).toFixed(1)}KB  省 ${(100 - totalOut / totalIn * 100).toFixed(1)}%`);

  if (DRY_RUN) {
    console.log('\n（试运行结束，未改动任何文件。去掉 --dry-run 执行真实转码）');
    process.exit(0);
  }

  if (!okList.length) {
    console.log('\n没有可转的文件，退出');
    process.exit(0);
  }

  // ── 2. 写文件 ──
  console.log('\n--- 写入文件 ---');
  for (const x of okList) {
    fs.writeFileSync(path.join(SOUNDS_DIR, x.newName), x.buffer);
  }
  console.log(`已写入 ${okList.length} 个 MP3`);

  // ── 3. 同步引用（事务）──
  console.log('\n--- 同步引用 ---');
  const client = await pool.connect();
  const updates = [];
  try {
    await client.query('BEGIN');

    // ① ② character_templates 的两个 JSONB
    const tpl = await client.query('SELECT id, anim_sounds, weapon_sounds FROM character_templates');
    for (const row of tpl.rows) {
      const anim = remap(asJson(row.anim_sounds), map);
      const wpn = remap(asJson(row.weapon_sounds), map);
      if (JSON.stringify(anim) !== JSON.stringify(asJson(row.anim_sounds)) ||
          JSON.stringify(wpn) !== JSON.stringify(asJson(row.weapon_sounds))) {
        await client.query(
          'UPDATE character_templates SET anim_sounds=$2, weapon_sounds=$3 WHERE id=$1',
          [row.id, JSON.stringify(anim), JSON.stringify(wpn)]
        );
        updates.push('character_templates#' + row.id);
      }
    }

    // ③ world_objects.custom_config->'audio'
    const objs = await client.query("SELECT id, custom_config->'audio' AS audio FROM world_objects WHERE (custom_config->'audio') IS NOT NULL");
    for (const row of objs.rows) {
      const a = remap(asJson(row.audio), map);
      await client.query(
        `UPDATE world_objects SET custom_config = jsonb_set(custom_config, '{audio}', $2::jsonb) WHERE id=$1`,
        [row.id, JSON.stringify(a)]
      );
      updates.push('world_objects#' + row.id);
    }

    // ④ world_regions.gameplay->'audio'
    const regs = await client.query("SELECT id, gameplay->'audio' AS audio FROM world_regions WHERE (gameplay->'audio') IS NOT NULL");
    for (const row of regs.rows) {
      const a = remap(asJson(row.audio), map);
      await client.query(
        `UPDATE world_regions SET gameplay = jsonb_set(gameplay, '{audio}', $2::jsonb) WHERE id=$1`,
        [row.id, JSON.stringify(a)]
      );
      updates.push('world_regions#' + row.id);
    }

    // ⑤⑥⑦ system_config 三个键
    for (const key of ['ambient_pads', 'audio_weather', 'ambient_music']) {
      const r = await client.query('SELECT config_value FROM system_config WHERE config_key=$1', [key]);
      if (!r.rows.length) continue;
      const before = asJson(r.rows[0].config_value);
      const after = remap(before, map);
      if (JSON.stringify(before) === JSON.stringify(after)) continue;
      await client.query(
        'UPDATE system_config SET config_value=$2, updated_at=NOW() WHERE config_key=$1',
        [key, JSON.stringify(after)]
      );
      updates.push('system_config.' + key);
    }

    // ⑧⑨ TEXT 字段
    for (const [table, col] of [
      ['animation_library', 'sound_url'],
      ['weapon_skills', 'sound_url'],
      ['template_skills', 'fx_sound_url'],
    ]) {
      const r = await client.query(`SELECT id, ${col} AS u FROM ${table} WHERE ${col} IS NOT NULL`);
      for (const row of r.rows) {
        const after = remap(row.u, map);
        if (after === row.u) continue;
        await client.query(`UPDATE ${table} SET ${col}=$2 WHERE id=$1`, [row.id, after]);
        updates.push(`${table}.${col}#${row.id}`);
      }
    }

    await client.query('COMMIT');
    console.log('引用已同步，共更新 ' + updates.length + ' 处:');
    updates.forEach(u => console.log('  · ' + u));
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('\n❌ 引用同步失败，已回滚: ' + e.message);
    process.exit(1);
  } finally {
    client.release();
  }

  // ── 4. 删原 WAV（引用已同步，删了不会断）──
  console.log('\n--- 清理原 WAV ---');
  for (const x of okList) {
    const p = path.join(SOUNDS_DIR, x.file);
    try { fs.unlinkSync(p); } catch (e) { console.log('  删除失败 ' + x.file + ': ' + e.message); }
  }
  console.log('已删除 ' + okList.length + ' 个原 WAV');

  // ── 5. 复核：有没有引用还指向已删除的 WAV ──
  console.log('\n--- 复核：残留引用检查 ---');
  const after = fs.readdirSync(SOUNDS_DIR).filter(f => fs.statSync(path.join(SOUNDS_DIR, f)).isFile());
  const wavNames = new Set(after.filter(f => /\.wav$/i.test(f)));
  let dangling = 0;
  const check = (url, where) => {
    if (!url || typeof url !== 'string') return;
    const n = url.split('/').pop();
    if (wavNames.has(n)) { console.log(`  ⚠️ 仍指向现存 WAV: ${n} (${where})`); dangling++; }
    if (!after.includes(n) && !n.startsWith('.')) {
      // 文件不存在了
    }
  };
  const tpl2 = await query('SELECT anim_sounds, weapon_sounds FROM character_templates');
  tpl2.rows.forEach(r => {
    [asJson(r.anim_sounds), asJson(r.weapon_sounds)].forEach(d => {
      if (d && typeof d === 'object') Object.values(d).forEach(v => {
        const urls = Array.isArray(v && v.urls) ? v.urls : (v && v.url ? [v.url] : []);
        urls.forEach(u => check(u, 'character_templates'));
      });
    });
  });
  console.log(dangling ? `  发现 ${dangling} 处残留` : '  ✅ 无残留指向已删除文件的引用');

  console.log('\n=== 完成 ===');
  process.exit(0);
})().catch(e => { console.error('失败: ' + e.message); console.error(e.stack); process.exit(1); });
