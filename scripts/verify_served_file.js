/* 验证服务器 HTTP 返回的 _dec 文件与磁盘一致（面数/大小） */
const http = require('http');

const URL = 'http://localhost:3002/models/uploaded/' + process.argv[2];

http.get(URL, (res) => {
  const chunks = [];
  res.on('data', (c) => chunks.push(c));
  res.on('end', () => {
    const buf = Buffer.concat(chunks);
    console.log('HTTP status: ' + res.statusCode);
    console.log('HTTP size: ' + buf.length + ' bytes (' + (buf.length / 1048576).toFixed(2) + 'MB)');
    if (buf.readUInt32LE(0) === 0x46546c67) {
      const jsonLen = buf.readUInt32LE(12);
      const json = JSON.parse(buf.slice(20, 20 + jsonLen).toString('utf8'));
      let tris = 0;
      (json.meshes || []).forEach((m) => {
        m.primitives.forEach((p) => {
          const pi = p.attributes.POSITION;
          if (pi !== undefined) tris += Math.floor(json.accessors[pi].count / 3);
        });
      });
      console.log('Served file tris: ' + tris);
    }
  });
}).on('error', (e) => console.error('ERR: ' + e.message));
