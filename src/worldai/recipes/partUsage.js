'use strict';
/**
 * partUsage.js —— 零件用途对照表（AI 自由拼装 · 新标准）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 产品标准已降到「能搭出来就行，不要精致、不要审美」，故此前设计的 7 类索引体系
 * （assembly_role / 长度轴 / 变体规则 / 装饰层…）全部砍掉。本模块只回答三个问题：
 *   ① 这个 role 是干什么的  ② 拿它摆在哪  ③ 摆的时候注意什么
 * 官方效果图（918×515，已导入 public/models/uploaded/_packpreviews/）供 AI 看图判断。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROLE_USAGE = {
  wall:   { label: '墙',     how: '沿轮廓一圈竖着排，一层一圈，层间对齐', tip: '排不下就缩一圈，别硬塞' },
  window: { label: '窗',     how: '插在墙中间，位置随意，不用对称',        tip: '别贴地，从墙高中段往上' },
  door:   { label: '门',     how: '只放最底层，朝向随意',                  tip: '一层最多一扇' },
  roof:   { label: '屋顶',   how: '最上一层之上平铺，铺满轮廓',            tip: '铺不满留缝没关系' },
  column: { label: '柱',     how: '四角各放几根，可选',                    tip: '没有也能立' },
  road:   { label: '路面',   how: '沿折线一段段铺，弯道换转角件',            tip: '宁可重叠也不要断开' },
  ground: { label: '地面',   how: '铺在路两边、建筑周边',                  tip: '纯装饰' },
  nature: { label: '绿化',   how: '路边、屋旁随机撒',                      tip: '同种别扎堆' },
  prop:   { label: '杂物',   how: '路边、屋旁随机撒',                      tip: '点缀用' },
  floor:  { label: '地板',   how: '铺在每层地面，可选',                    tip: '不做楼板也能看' },
  railing:{ label: '栏杆',   how: '阳台或屋顶边缘，可选',                  tip: '纯装饰' },
  stairs: { label: '楼梯',   how: '放一到两处，可选',                      tip: '不做也能看' },
};

function loadPackPreviewManifest() {
  try {
    const p = path.join(__dirname, '..', '..', '..', 'public', 'models', 'uploaded', '_packpreviews', 'manifest.json');
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) { return {}; }
}

function usagePromptText() {
  const lines = Object.keys(ROLE_USAGE).map(function (k) {
    const u = ROLE_USAGE[k];
    return '  ' + k + ' = ' + u.label + '：' + u.how + (u.tip ? '（注意：' + u.tip + '）' : '');
  });
  return ['【零件用途对照表 part_role → 怎么摆】', lines.join('\n'),
    '总原则：能搭出来、能用即可，不要求精致与美观；有缝、有轻微错位都可接受。'].join('\n');
}

function usageOf(role) { return ROLE_USAGE[String(role || '').toLowerCase()] || null; }
function packPreviewOf(packKey) {
  const man = loadPackPreviewManifest();
  const k = String(packKey || '');
  return man[k] || man[k.replace(/_/g, '-')] || null;
}

module.exports = { ROLE_USAGE, usagePromptText, usageOf, packPreviewOf, loadPackPreviewManifest };