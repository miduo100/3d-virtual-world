#!/usr/bin/env node
/**
 * audit_agent_descriptions.js — AI 描述「漏点」审计（**只读**，不修改任何数据）
 *
 * 背景与设计取舍（2026-09-22 与用户确认）：
 *   模型上传时填的 `uploaded_models.description` 是 AI 描述的**权威来源**；
 *   放置到世界时由 uploadMetaDialog.js 按 model_path 自动注入
 *   `world_objects.agent_description`，对象复制时也继承。
 *   因此补描述的正确姿势是「填模型（95 个）」而不是「填对象（706 个）」。
 *
 *   ⚠️ 不做 AI 批量生成：AI 没见过模型，只能凭 type/name/周边物体臆测，
 *      写出来的"金碧辉煌的宫殿"是**错误信息**，比空着更糟（AI 会当真并据此行动）。
 *
 * 本脚本回答三个问题：
 *   ① 漏在哪？——把 1079 个对象按「修复路径」分类（模型级可救 / 必须逐条填 / 孤儿引用）
 *   ② 先补谁？——模型按「被放置次数」降序（填 1 个模型 = 救 N 个对象）
 *   ③ 怎么补？——输出回填 SQL（**只打印不执行**，由人确认后手动跑）
 *
 * 用法：
 *   node scripts/audit_agent_descriptions.js
 *   node scripts/audit_agent_descriptions.js --json        # 额外输出 JSON
 *   node scripts/audit_agent_descriptions.js --top=30      # 每个清单最多列 N 条（默认 20）
 *   node scripts/audit_agent_descriptions.js --base=http://localhost:3002
 *
 * 输出：
 *   scripts/_agent_desc_audit.md   人读报告（UTF-8）
 *   控制台只打印统计数字（英文，避免 PowerShell 中文乱码）
 */

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const getArg = (name, dflt) => {
  const hit = args.find(a => a.startsWith('--' + name + '='));
  return hit ? hit.split('=').slice(1).join('=') : dflt;
};
const BASE = getArg('base', process.env.AGENT_HOST || 'http://localhost:3002');
const TOP_RAW = parseInt(getArg('top', '20'), 10);
// --top=0 表示不截断（展开完整清单）；非法值回落默认 20
const TOP = (Number.isFinite(TOP_RAW) && TOP_RAW !== 0) ? Math.abs(TOP_RAW) : (TOP_RAW === 0 ? Infinity : 20);
const WANT_JSON = args.includes('--json');
const GRID = 100; // 网格边长（米）

// ==================== 工具 ====================

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + url);
  return res.json();
}

function pickArray(j, keys) {
  if (Array.isArray(j)) return j;
  for (const k of keys) if (Array.isArray(j[k])) return j[k];
  return [];
}

const mdCell = (v) => String(v == null ? '' : v).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

const gridKey = (x, z) => `${Math.floor(x / GRID)}_${Math.floor(z / GRID)}`;
const gridCenter = (k) => {
  const [gx, gz] = k.split('_').map(Number);
  return [gx * GRID + GRID / 2, gz * GRID + GRID / 2];
};

// ==================== 主流程 ====================

async function main() {
  console.log('[audit] BASE = ' + BASE);

  const [objRaw, modelRaw] = await Promise.all([
    getJson(BASE + '/api/world/objects'),
    getJson(BASE + '/api/uploaded-models')
  ]);

  const objects = pickArray(objRaw, ['objects', 'data']);
  const models = pickArray(modelRaw, ['models', 'data', 'uploadedModels']);

  // 模型库按 path 建索引（与 uploadMetaDialog.js 的匹配口径一致：m.path === wo.model_path）
  const modelByPath = new Map();
  models.forEach(m => { if (m && m.path) modelByPath.set(m.path, m); });

  // ---------- 对象分类 ----------
  const byType = {};                       // type -> {total, withDesc, modelLinked, orphan, bare}
  const orphans = [];                      // C 类：引用了模型库里不存在的模型
  const bareList = [];                     // D 类：非上传模型（无模型库概念）
  const linkedByModel = new Map();         // model_path -> {count, grids:Set, withoutDesc}

  objects.forEach(o => {
    const t = o.type || 'unknown';
    byType[t] = byType[t] || { total: 0, withDesc: 0, modelLinked: 0, orphan: 0, bare: 0 };
    byType[t].total++;
    if (o.agent_description) byType[t].withDesc++;

    const p = o.model_path;
    if (t === 'uploaded_model' && p && modelByPath.has(p)) {
      byType[t].modelLinked++;
      const rec = linkedByModel.get(p) || { count: 0, grids: new Set(), withoutDesc: 0 };
      rec.count++;
      rec.grids.add(gridKey(o.position_x || 0, o.position_z || 0));
      if (!o.agent_description) rec.withoutDesc++;
      linkedByModel.set(p, rec);
    } else if (t === 'uploaded_model' && p) {
      byType[t].orphan++;
      orphans.push(o);
    } else {
      byType[t].bare++;
      bareList.push(o);
    }
  });

  // ---------- A 类：模型库里没有描述的模型（按被放置次数降序）----------
  const aList = [];
  linkedByModel.forEach((rec, p) => {
    const m = modelByPath.get(p);
    if (m && !m.description) {
      aList.push({
        path: p,
        label: m.display_name || m.file_name || p.split('/').pop(),
        placements: rec.count,
        gridCount: rec.grids.size,
        grids: Array.from(rec.grids).sort()
      });
    }
  });
  aList.sort((a, b) => b.placements - a.placements);

  // ---------- B 类：模型有描述但对象没继承 ----------
  const bList = [];
  linkedByModel.forEach((rec, p) => {
    const m = modelByPath.get(p);
    if (m && m.description && rec.withoutDesc > 0) {
      bList.push({
        path: p,
        label: m.display_name || m.file_name || p.split('/').pop(),
        desc: String(m.description).slice(0, 60),
        placements: rec.count,
        missing: rec.withoutDesc
      });
    }
  });
  bList.sort((a, b) => b.missing - a.missing);

  // ---------- 汇总 ----------
  const total = objects.length;
  const withDesc = objects.filter(o => o.agent_description).length;
  const modelsWithDesc = models.filter(m => m && m.description).length;
  const savedByModelPath = Array.from(linkedByModel.values()).reduce((s, r) => s + r.count, 0);
  const mustHandFill = total - savedByModelPath;
  const bareMissing = bareList.filter(o => !o.agent_description).length;   // 非上传模型里"仍未填"的（几何体已可自动映射）

  // ---------- 网格分布（object 视角，用于判断"先补哪片区域"）----------
  const gridAgg = new Map();
  objects.forEach(o => {
    const k = gridKey(o.position_x || 0, o.position_z || 0);
    const rec = gridAgg.get(k) || { total: 0, withDesc: 0 };
    rec.total++;
    if (o.agent_description) rec.withDesc++;
    gridAgg.set(k, rec);
  });
  const gridTop = Array.from(gridAgg.entries())
    .map(([k, v]) => ({ key: k, center: gridCenter(k), ...v }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 15);

  // ==================== 报告 ====================
  const L = [];
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

  L.push('# AI 描述漏点审计报告');
  L.push('');
  L.push(`- 生成时间：${now}`);
  L.push(`- 数据来源：${BASE}/api/world/objects + /api/uploaded-models`);
  L.push(`- 性质：**只读审计**，未修改任何数据`);
  L.push('');

  L.push('## 一、总览');
  L.push('');
  L.push('| 指标 | 数值 |');
  L.push('|---|---|');
  L.push(`| 世界对象总数 | ${total} |`);
  L.push(`| 已有 agent_description | ${withDesc}（${total ? (withDesc * 100 / total).toFixed(1) : 0}%） |`);
  L.push(`| 模型库总数 | ${models.length} |`);
  L.push(`| 模型库已有 description | ${modelsWithDesc}（${models.length ? (modelsWithDesc * 100 / models.length).toFixed(1) : 0}%） |`);
  L.push(`| **可走「模型级」修复路径的对象** | **${savedByModelPath}** ← 只需填 ${aList.length} 个模型（有描述缺失的） |`);
  L.push(`| **非上传模型的对象**（几何体可自动映射 / 媒体·代码块需手填） | **${mustHandFill}** |`);
  L.push(`| └ 其中**仍未填**的 | **${bareMissing}**（几何体已由类型词映射覆盖） |`);
  L.push('');
  L.push('> 修复原理：填 `uploaded_models.description` → 回填到 `world_objects.agent_description`（按 model_path 匹配）。');
  L.push('> 填 1 个被放置 10 次的模型 = 一次解决 10 个对象的描述。');
  L.push('');

  L.push('## 二、按对象类型的分布');
  L.push('');
  L.push('| type | 对象数 | 已有描述 | 走模型级可救 | 孤儿引用 | 必须手填 |');
  L.push('|---|---|---|---|---|---|');
  Object.entries(byType).sort((a, b) => b[1].total - a[1].total).forEach(([t, v]) => {
    L.push(`| \`${mdCell(t)}\` | ${v.total} | ${v.withDesc} | ${v.modelLinked} | ${v.orphan} | ${v.bare} |`);
  });
  L.push('');

  L.push(`## 三、A 类｜模型库里缺 description 的模型（按被放置次数降序，共 ${aList.length} 个）`);
  L.push('');
  L.push('**这是主战场**：填完这些 → 一键回填 → 上表「走模型级可救」的对象全部有描述。');
  L.push('');
  L.push('| # | 模型 | 被放置 | 涉及网格数 |');
  L.push('|---|---|---|---|');
  aList.slice(0, TOP).forEach((m, i) => {
    L.push(`| ${i + 1} | \`${mdCell(m.label)}\` | ${m.placements} | ${m.gridCount} |`);
  });
  if (aList.length > TOP) L.push(`| … | 其余 ${aList.length - TOP} 个（用 --top=N 展开） | | |`);
  L.push('');
  const aPlacements = aList.reduce((s, m) => s + m.placements, 0);
  L.push(`> 这 ${aList.length} 个模型合计覆盖 **${aPlacements}** 个世界对象。`);
  L.push('');

  L.push(`## 四、B 类｜模型**有**描述、但已放置对象没继承（共 ${bList.length} 个模型需要回填）`);
  L.push('');
  if (bList.length === 0) {
    L.push('当前无此项（模型库描述全为空，或对象已全部继承）。');
  } else {
    L.push('| # | 模型 | 已有描述 | 待回填对象数 |');
    L.push('|---|---|---|---|');
    bList.slice(0, TOP).forEach((m, i) => {
      L.push(`| ${i + 1} | \`${mdCell(m.label)}\` | ${mdCell(m.desc)}… | ${m.missing} |`);
    });
  }
  L.push('');

  L.push(`## 五、C 类｜对象引用了模型库中不存在的模型（孤儿引用，共 ${orphans.length} 个）`);
  L.push('');
  if (orphans.length === 0) {
    L.push('无。');
  } else {
    L.push('这些对象的 `model_path` 在 `uploaded_models` 里找不到对应行（模型被删过？路径改过？），**无法走模型级路径**，只能逐条填对象描述，或先修数据。');
    L.push('');
    L.push('| # | 对象 id | 名称 | model_path | 位置 |');
    L.push('|---|---|---|---|---|');
    orphans.slice(0, TOP).forEach((o, i) => {
      L.push(`| ${i + 1} | ${mdCell(o.id)} | ${mdCell(o.name)} | \`${mdCell(o.model_path)}\` | (${Math.round(o.position_x || 0)}, ${Math.round(o.position_z || 0)}) |`);
    });
  }
  L.push('');

  L.push(`## 六、D 类｜非上传模型的对象（共 ${bareList.length} 个，其中仍未填 ${bareMissing} 个）`);
  L.push('');
  L.push('程序生成的几何体、图片、视频、代码块、广告位等，没有模型库对应行。');
  L.push('**几何体已由类型词映射自动覆盖**（见下方说明）；真正建议手填的只有媒体/代码块/广告位等少数对象。');
  L.push('');
  const bareByType = {};
  bareList.forEach(o => {
    const t = o.type || 'unknown';
    bareByType[t] = bareByType[t] || { total: 0, withDesc: 0 };
    bareByType[t].total++;
    if (o.agent_description) bareByType[t].withDesc++;
  });
  L.push('| type | 数量 | 已有描述 | 定级建议 |');
  L.push('|---|---|---|---|');
  const advice = {
    geometry_building: '优先级中（地标建筑，AI 会靠近）',
    geometry_nature: '优先级低（植被装饰，同类可写一句话）',
    geometry_decoration: '优先级低',
    geometry_vehicle: '优先级中',
    geometry_animal: '优先级中（AI 可能互动）',
    geometry_terrain: '优先级低',
    media_image: '优先级高（有内容价值）',
    media_video: '优先级高',
    threejs_code: '优先级高（功能对象）',
    ad_slot: '优先级高（传送门等）',
    unknown: '需人工确认类型'
  };
  Object.entries(bareByType).sort((a, b) => b[1].total - a[1].total).forEach(([t, v]) => {
    L.push(`| \`${mdCell(t)}\` | ${v.total} | ${v.withDesc} | ${advice[t] || '—'} |`);
  });
  const geoMissing = bareList.filter(o => (o.type || '').startsWith('geometry_') && !o.agent_description).length;
  const stillMissing = bareList.filter(o => !o.agent_description).length;
  L.push('');
  L.push('> **几何体（`geometry_*`）已由「名称类型词 → 映射表」自动覆盖**：`src/data/geometryDescMap.json` +');
  L.push('> `src/services/geometryAgentDesc.js`（observe 输出时对空描述推导默认值，人工填写的优先），');
  L.push('> 存量值由 `node scripts/sync_agent_descriptions.js --apply` 落库。');
  L.push(`> 因此本表里 **只剩 ${stillMissing} 个对象真正需要逐条手填**` +
         `（其中几何体未覆盖 ${geoMissing} 个，其余为媒体/代码块/广告位等）。`);
  L.push('');

  L.push('## 七、热点网格（按对象密度降序，供"先补哪片"决策）');
  L.push('');
  L.push('| # | 网格中心 (x, z) | 对象数 | 已有描述 |');
  L.push('|---|---|---|---|');
  gridTop.forEach((g, i) => {
    L.push(`| ${i + 1} | (${Math.round(g.center[0])}, ${Math.round(g.center[1])}) | ${g.total} | ${g.withDesc} |`);
  });
  L.push('');

  L.push('## 八、回填 SQL（**dry-run 预览，脚本未执行**）');
  L.push('');
  L.push('等 A 类模型描述填好后，执行下面这条把描述同步到已有对象：');
  L.push('');
  L.push('```sql');
  L.push('-- 只回填「对象描述为空」的行，不覆盖已手写的对象级描述');
  L.push('UPDATE world_objects wo');
  L.push('SET agent_description = um.description, updated_at = NOW()');
  L.push('FROM uploaded_models um');
  L.push('WHERE wo.model_path = um.path');
  L.push('  AND um.description IS NOT NULL');
  L.push('  AND um.description <> \'\'');
  L.push('  AND wo.agent_description IS NULL;');
  L.push('```');
  L.push('');
  L.push('> 执行前建议先 `SELECT COUNT(*)` 同条件预览影响行数；执行后重跑本审计脚本复核。');
  L.push('');

  L.push('## 九、下一步（人做的事）');
  L.push('');
  L.push('1. 到管理后台「3D资产 → 上传模型库」逐条补 A 类模型的 🤖AI 描述（每行「✏️ 标签」按钮；');
  L.push('   `--top=0` 可展开完整清单，或直接看仓库根的 `AI描述待填清单.md`）');
  L.push('2. 跑 `node scripts/sync_agent_descriptions.js --apply` 把模型描述传导到世界里已有对象（只填空，不覆盖人工值）');
  L.push('3. 几何体（`geometry_*`）**不用手填**：已由类型词映射自动覆盖；');
  L.push('   媒体/视频/代码块/广告位等少数对象在「世界编辑器」右侧面板逐条补');
  L.push('4. 传送门描述在「管理后台 → 联邦与传送 → 传送门 → 编辑」里填（`observe` 已能读到）');
  L.push('5. C 类孤儿引用按需处理');
  L.push('');

  const reportPath = path.join(__dirname, '_agent_desc_audit.md');
  fs.writeFileSync(reportPath, L.join('\n'), 'utf8');

  if (WANT_JSON) {
    fs.writeFileSync(path.join(__dirname, '_agent_desc_audit.json'), JSON.stringify({
      generatedAt: now, base: BASE,
      summary: { total, withDesc, models: models.length, modelsWithDesc, savedByModelPath, mustHandFill },
      byType, aList, bList, orphansCount: orphans.length, bareByType, gridTop
    }, null, 2), 'utf8');
  }

  // 控制台：纯英文数字，避免 PowerShell 中文乱码
  console.log('---- AUDIT SUMMARY ----');
  console.log('objects=' + total + ' withDesc=' + withDesc + ' coverage=' + (total ? (withDesc * 100 / total).toFixed(1) : 0) + '%');
  console.log('models=' + models.length + ' modelsWithDesc=' + modelsWithDesc);
  console.log('A_CLASS_models_missing_desc=' + aList.length + ' -> covers ' + aPlacements + ' objects');
  console.log('B_CLASS_models_need_backfill=' + bList.length);
  console.log('C_CLASS_orphan_refs=' + orphans.length);
  console.log('D_CLASS_hand_fill=' + bareList.length + ' (still missing=' + bareList.filter(o => !o.agent_description).length + ')');
  console.log('headline_top5(placements)=' + aList.slice(0, 5).map(m => m.placements).join(','));
  console.log('report=' + reportPath);
}

main().catch(e => {
  console.error('[audit] FATAL ' + e.message);
  process.exitCode = 1;
});
