const fs = require('fs');
const zh = require('./public/i18n/zh-CN.json');
const en = require('./public/i18n/en-US.json');
const html = fs.readFileSync('./public/admin.html', 'utf8');

const keys = new Set();
const re = /adminCharacters\.([A-Za-z0-9_]+)/g;
let m;
while ((m = re.exec(html))) keys.add(m[1]);

const missingZh = [...keys].filter(k => !(k in zh.adminCharacters));
const missingEn = [...keys].filter(k => !(k in en.adminCharacters));

console.log('admin.html references adminCharacters keys:', keys.size);
console.log('Missing in zh-CN:', missingZh.length ? missingZh : 'none');
console.log('Missing in en-US:', missingEn.length ? missingEn : 'none');

const kz = Object.keys(zh.adminCharacters);
const ke = Object.keys(en.adminCharacters);
console.log('zh-CN adminCharacters keys:', kz.length, '| en-US:', ke.length, '| identical order:', JSON.stringify(kz) === JSON.stringify(ke));
