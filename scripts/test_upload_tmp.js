const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '../public/models/uploaded/_backup_原始/model-1787019326584-436020307.glb');

(async () => {
  const buf = fs.readFileSync(SRC);
  console.log('source size:', buf.length);
  const fd = new FormData();
  fd.append('model', new Blob([buf]), 'desk-original-test.glb');
  fd.append('display_name', 'texture-pipeline-test');
  const t0 = Date.now();
  const r = await fetch('http://localhost:3002/api/upload-model', { method: 'POST', body: fd });
  const data = await r.json();
  console.log('http:', r.status, '| elapsed:', ((Date.now() - t0) / 1000).toFixed(1) + 's');
  console.log('success:', data.success);
  if (data.model) {
    console.log('model id:', data.model.id, '| saved:', data.model.saved_file_name, '| db file_size:', data.model.file_size);
    console.log('geometry:', JSON.stringify(data.model.compression));
    console.log('texture :', JSON.stringify(data.model.textureCompression));
    const diskPath = path.join(__dirname, '../public/models/uploaded', data.model.saved_file_name);
    if (fs.existsSync(diskPath)) {
      console.log('disk size:', fs.statSync(diskPath).size, '(db==disk:', fs.statSync(diskPath).size === data.model.file_size, ')');
    }
  } else {
    console.log('error:', JSON.stringify(data).slice(0, 300));
  }
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
