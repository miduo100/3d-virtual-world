/**
 * r185 升级阶段 5 ③ —— 合成 3DGS 测试样本 PLY
 * ------------------------------------------------------------------
 * 背景：全项目无 .ply 样本（public/scenes/3dgs/ 为空目录），无法实测
 * gaussianSplatRenderer 的 GLSL1 shader 在 r185 WebGL2/GLSL3 下的表现。
 * 本脚本按 INRIA 3DGS 标准导出格式（62 属性二进制小端 PLY）生成确定性
 * 样本，文件名固定为 test_gaussian.html 引用的 scene-1786835882322-897112501.ply。
 *
 * 内容设计（便于程序化像素断言）：
 *  - 彩虹球：18000 点，半径 1.5，颜色 = 位置归一化（+X 红 / +Y 绿 / +Z 蓝），
 *    任意视角都能看到三色区域；法线 = 球面法线 + f_rest_0..8 非零小值
 *    → 覆盖 loader 的一阶 SH 颜色展开分支。
 *  - 地面圆盘：6000 点，半径 3.5，y=-1.55，灰蓝色，验证遮挡/贴地 minY。
 *  - 全部点：opacity logit(0.99)、scale log(0.025)、随机小旋转四元数（w 主导）。
 *
 * 用法：node scripts/gen_3dgs_test_ply.js
 * 输出：public/scenes/3dgs/scene-1786835882322-897112501.ply（约 5.95MB）
 */
'use strict';
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'public', 'scenes', '3dgs', 'scene-1786835882322-897112501.ply');

// SH DC 基函数（与 gaussianSplatLoader.js 一致）
const C0 = 0.28209479177387814;

// 确定性伪随机（mulberry32）
function rng(seed) {
    let a = seed >>> 0;
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
const rand = rng(20260904);

// ---- 参数 ----
const SPHERE_N = 18000;
const SPHERE_R = 1.5;
const DISC_N = 6000;
const DISC_R = 3.5;
const DISC_Y = -1.55;
const TOTAL = SPHERE_N + DISC_N;

// INRIA 标准属性布局（62 属性，全 float，248 字节/点）
const PROPS = [
    'x', 'y', 'z',
    'nx', 'ny', 'nz',
    'f_dc_0', 'f_dc_1', 'f_dc_2',
    ...Array.from({ length: 45 }, (_, i) => 'f_rest_' + i),
    'opacity',
    'scale_0', 'scale_1', 'scale_2',
    'rot_0', 'rot_1', 'rot_2', 'rot_3',
];
const STRIDE = PROPS.length * 4; // 248
const OFF = {};
PROPS.forEach((p, i) => { OFF[p] = i * 4; });

function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
function logit(p) { return Math.log(p / (1 - p)); }

// 头部
let header = 'ply\n';
header += 'format binary_little_endian 1.0\n';
header += 'comment r185 stage5 synthetic 3DGS test asset (gen_3dgs_test_ply.js)\n';
header += 'element vertex ' + TOTAL + '\n';
for (const p of PROPS) header += 'property float ' + p + '\n';
header += 'end_header\n';

const headBuf = Buffer.from(header, 'latin1');
const buf = Buffer.alloc(headBuf.length + TOTAL * STRIDE);
buf.set(headBuf, 0);

let row = 0;
function writePoint(x, y, z, nx, ny, nz, r, g, b, scaleLog, opacityLog, quat) {
    const base = headBuf.length + row * STRIDE;
    buf.writeFloatLE(x, base + OFF.x);
    buf.writeFloatLE(y, base + OFF.y);
    buf.writeFloatLE(z, base + OFF.z);
    buf.writeFloatLE(nx, base + OFF.nx);
    buf.writeFloatLE(ny, base + OFF.ny);
    buf.writeFloatLE(nz, base + OFF.nz);
    // 颜色 → SH DC（loader: c = f_dc*C0 + 0.5）
    buf.writeFloatLE((r - 0.5) / C0, base + OFF.f_dc_0);
    buf.writeFloatLE((g - 0.5) / C0, base + OFF.f_dc_1);
    buf.writeFloatLE((b - 0.5) / C0, base + OFF.f_dc_2);
    // 一阶 SH 非零小值（覆盖 loader SH 分支），其余 f_rest_9..44 = 0（Buffer 默认）
    buf.writeFloatLE(0.25, base + OFF.f_rest_0);
    buf.writeFloatLE(-0.25, base + OFF.f_rest_1);
    buf.writeFloatLE(0.25, base + OFF.f_rest_2);
    buf.writeFloatLE(-0.25, base + OFF.f_rest_3);
    buf.writeFloatLE(0.25, base + OFF.f_rest_4);
    buf.writeFloatLE(-0.25, base + OFF.f_rest_5);
    buf.writeFloatLE(0.25, base + OFF.f_rest_6);
    buf.writeFloatLE(-0.25, base + OFF.f_rest_7);
    buf.writeFloatLE(0.25, base + OFF.f_rest_8);
    buf.writeFloatLE(opacityLog, base + OFF.opacity);
    buf.writeFloatLE(scaleLog, base + OFF.scale_0);
    buf.writeFloatLE(scaleLog, base + OFF.scale_1);
    buf.writeFloatLE(scaleLog, base + OFF.scale_2);
    // PLY 四元数 (w,x,y,z)
    buf.writeFloatLE(quat[0], base + OFF.rot_0);
    buf.writeFloatLE(quat[1], base + OFF.rot_1);
    buf.writeFloatLE(quat[2], base + OFF.rot_2);
    buf.writeFloatLE(quat[3], base + OFF.rot_3);
    row++;
}

// 小随机旋转（w 主导，接近单位）
function smallQuat() {
    const x = (rand() - 0.5) * 0.3, y = (rand() - 0.5) * 0.3, z = (rand() - 0.5) * 0.3;
    const n = Math.sqrt(Math.max(1e-9, x * x + y * y + z * z));
    const w = Math.sqrt(Math.max(0, 1 - n * n));
    return [w, x, y, z];
}

// ---- 1) 彩虹球（Fibonacci 分布） ----
const GA = Math.PI * (3 - Math.sqrt(5)); // 黄金角
for (let i = 0; i < SPHERE_N; i++) {
    const t = (i + 0.5) / SPHERE_N;
    const yy = 1 - 2 * t;                       // [-1, 1]
    const rr = Math.sqrt(Math.max(0, 1 - yy * yy));
    const th = GA * i;
    const x = Math.cos(th) * rr, z = Math.sin(th) * rr, y = yy;
    // 颜色 = 主导轴扇区（+X/-X 红、+Y/-Y 绿、+Z/-Z 蓝，高饱和大色块，
    // 任意视角均可见多色区域，便于程序化像素断言）
    const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
    let r, g, b;
    if (ax >= ay && ax >= az) { r = 0.95; g = 0.15; b = 0.15; }
    else if (ay >= az) { r = 0.15; g = 0.95; b = 0.15; }
    else { r = 0.15; g = 0.15; b = 0.95; }
    writePoint(x * SPHERE_R, y * SPHERE_R, z * SPHERE_R,
        x, y, z, r, g, b,
        Math.log(0.025), logit(0.99), smallQuat());
}

// ---- 2) 地面圆盘（等面积分布） ----
for (let i = 0; i < DISC_N; i++) {
    const rr = Math.sqrt(rand()) * DISC_R;
    const th = rand() * Math.PI * 2;
    const x = Math.cos(th) * rr, z = Math.sin(th) * rr;
    writePoint(x, DISC_Y, z,
        0, 1, 0,
        0.75, 0.75, 0.8,
        Math.log(0.02), logit(0.95), smallQuat());
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, buf.subarray(0, headBuf.length + row * STRIDE));

const mb = (fs.statSync(OUT).size / 1024 / 1024).toFixed(2);
console.log('[gen] wrote ' + OUT);
console.log('[gen] points=' + row + ' (sphere=' + SPHERE_N + ' disc=' + DISC_N + '), stride=' + STRIDE + 'B, size=' + mb + 'MB');
