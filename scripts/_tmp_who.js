/**
 * _tmp_who.js — 临时诊断：从推流事件日志里列出最近的实体（人类/Agent）id 与最新位置
 */
const fs = require('fs');
const path = require('path');
const EV = path.join(__dirname, '..', 'examples', 'agent-client', 'live', 'events.jsonl');

const lines = fs.readFileSync(EV, 'utf8').split('\n').filter(Boolean);
const map = new Map();
for (const l of lines) {
  let o; try { o = JSON.parse(l); } catch (e) { continue; }
  if (o.dir !== 'in' || !o.msg) continue;
  const t = o.msg.type, p = o.msg.payload;
  if (t === 'ENTITY_UPDATED' && p && p.id) {
    map.set(p.id, { name: p.name, type: p.type, pos: p.position, at: o.ts.slice(11, 19), anim: p.animMode });
  } else if (t === 'ENTITY_ADDED' && p && p.id) {
    map.set(p.id, { name: p.name, type: p.type, pos: p.position, at: o.ts.slice(11, 19) + '(added)', anim: null });
  } else if (t === 'ENTITY_REMOVED' && p && p.id) {
    const prev = map.get(p.id) || {};
    map.set(p.id, { ...prev, removedAt: o.ts.slice(11, 19) });
  } else if (t === 'PLAYER_JOINED' && p) {
    console.log('PLAYER_JOINED', o.ts.slice(11, 19), p.characterId, p.characterName, JSON.stringify(p.position), 'isGuest=' + p.isGuest, 'entityType=' + (p.entityType || 'human'));
  } else if (t === 'PLAYER_LEFT' && p) {
    console.log('PLAYER_LEFT  ', o.ts.slice(11, 19), p.characterId, p.characterName, JSON.stringify(p.lastPosition));
  } else if (t === 'WORLD_SNAPSHOT' && p && Array.isArray(p.entities)) {
    console.log('WORLD_SNAPSHOT', o.ts.slice(11, 19), JSON.stringify(p.entities));
  }
}
console.log('--- latest known entity state ---');
for (const [id, v] of map.entries()) {
  console.log([id, v.type, v.name, JSON.stringify(v.pos), v.at, 'anim=' + v.anim, v.removedAt ? 'removed@' + v.removedAt : ''].join(' | '));
}
