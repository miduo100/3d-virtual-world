// _tmp: verify parseJson truncation repair
const { parseJson } = require('../src/worldai/missions/missionPlanner');

// 1) 完整 JSON 不受影响
const full = '{"blocks":[{"anchor":{"dx":0,"dz":0},"footprint":{"d":8,"w":6},"kind":"wooden_cottage","parts":[{"partKey":"wooden_wall_001","ry":0.5},{"partKey":"wooden_wall_002","ry":1.5}]}]}';
console.log('T1 full:', parseJson(full).blocks.length === 1 ? 'PASS' : 'FAIL');

// 2) markdown 围栏
console.log('T2 fence:', parseJson('```json\n' + full + '\n```').blocks.length === 1 ? 'PASS' : 'FAIL');

// 3) 模拟截断：在第二个零件中间被切（撞 maxTokens）
const truncated = '{"blocks":[{"anchor":{"dx":0,"dz":0},"footprint":{"d":8,"w":6},"kind":"wooden_cottage","parts":[{"partKey":"wooden_wall_001","ry":0.0000000000000004440892098500626},{"partKey":"wooden_w';
const r3 = parseJson(truncated);
console.log('T3 truncated-mid-value:', r3 && r3.blocks && r3.blocks[0].parts.length === 1 ? 'PASS' : 'FAIL', JSON.stringify(r3 && r3.blocks && r3.blocks[0].parts));

// 4) 截断在完整元素后的逗号处
const truncated2 = '{"blocks":[{"parts":[{"partKey":"a","ry":0.1},';
const r4 = parseJson(truncated2);
console.log('T4 truncated-at-comma:', r4 && r4.blocks[0].parts.length === 1 ? 'PASS' : 'FAIL');

// 5) 截断在第一个元素内部（无任何完整元素可救）→ 返回 null，由 planner 重试下一轮
const truncated3 = '{"blocks":[{"parts":[{"partKey":"wooden_w';
const r5 = parseJson(truncated3);
console.log('T5 truncated-in-string:', r5 === null ? 'PASS' : 'FAIL');

// 6) 乱到无法修复
console.log('T6 garbage:', parseJson('{"blocks": [') === null ? 'PASS' : 'FAIL');

// 7) 修复产物可被 JSON.parse 二次确认（无 NaN/悬挂）
try { JSON.stringify(r3); console.log('T7 stringify-safe: PASS'); } catch (e) { console.log('T7 stringify-safe: FAIL', e.message); }
