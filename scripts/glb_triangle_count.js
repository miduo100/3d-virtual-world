/* Count triangles in a GLB (sum of POSITION accessor counts / 3) */
const fs = require('fs');

function countTriangles(path) {
  const buf = fs.readFileSync(path);
  const magic = buf.readUInt32LE(0);
  if (magic !== 0x46546c67) { console.error('Not a GLB:', path); return null; }
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.slice(20, 20 + jsonLen).toString('utf8'));
  let total = 0;
  const byMesh = [];
  if (json.meshes) {
    json.meshes.forEach((m, mi) => {
      let meshTri = 0;
      m.primitives.forEach((p) => {
        if (p.mode !== undefined && p.mode !== 4) return; // only triangles
        const posIdx = p.attributes.POSITION;
        if (posIdx === undefined) return;
        const acc = json.accessors[posIdx];
        meshTri += Math.floor(acc.count / 3);
      });
      total += meshTri;
      byMesh.push({ mesh: mi, tris: meshTri });
    });
  }
  return { total, byMesh, nodes: json.nodes ? json.nodes.length : 0, meshes: json.meshes ? json.meshes.length : 0, hasQuantized: JSON.stringify(json).includes('quantized') };
}

const files = process.argv.slice(2);
files.forEach((f) => {
  const r = countTriangles(f);
  if (r) console.log(`${f}: ${r.total} tris, meshes=${r.meshes}, nodes=${r.nodes}, quantized=${r.hasQuantized}`);
});
