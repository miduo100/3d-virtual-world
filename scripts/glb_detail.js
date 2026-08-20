/* Print GLB JSON structure: accessors, mesh primitives, modes */
const fs = require('fs');

const f = process.argv[2];
const buf = fs.readFileSync(f);
const jsonLen = buf.readUInt32LE(12);
const json = JSON.parse(buf.slice(20, 20 + jsonLen).toString('utf8'));

console.log('=== Accessors ===');
json.accessors.forEach((a, i) => {
  console.log(`[${i}] type=${a.type} count=${a.count} componentType=${a.componentType} bufView=${a.bufferView} byteOffset=${a.byteOffset} min=${a.min && a.min[0]} max=${a.max && a.max[0]}`);
});
console.log('\n=== BufferViews ===');
json.bufferViews.forEach((b, i) => {
  console.log(`[${i}] buffer=${b.buffer} byteOffset=${b.byteOffset} byteLength=${b.byteLength} target=${b.target} ${JSON.stringify(b.extensions || {})}`);
});
console.log('\n=== Buffers ===');
json.buffers.forEach((b, i) => console.log(`[${i}] byteLength=${b.byteLength}`));
console.log('\n=== Meshes ===');
(json.meshes || []).forEach((m, mi) => {
  m.primitives.forEach((p, pi) => {
    console.log(`mesh[${mi}].prim[${pi}]: mode=${p.mode} indices=${p.indices} attrs=${JSON.stringify(p.attributes)} material=${p.material} ${JSON.stringify(p.extensions || {})}`);
  });
});
console.log('\n=== Nodes ===');
(json.nodes || []).forEach((n, i) => {
  console.log(`[${i}] mesh=${n.mesh} children=${JSON.stringify(n.children)} name=${n.name} matrix=${JSON.stringify(n.matrix)}`);
});
console.log('\n=== ExtensionsUsed ===', JSON.stringify(json.extensionsUsed));
