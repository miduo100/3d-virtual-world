/**
 * 单个地形瓦片的几何生成
 * - 位置/法线/顶点颜色全部 CPU 侧一次算好（世界其余部分零改动）
 * - 法线用高度网格中心差分，避免二次采样（64 段瓦片 ≈ 4~5ms）
 */
(function (global) {
  'use strict';

  /**
   * @param {object} sampler   TerrainHeight.createWorldSampler() 的返回值
   * @param {number} originX   瓦片西南角 X（米）
   * @param {number} originZ   瓦片西南角 Z（米）
   * @param {number} size      瓦片边长（米）
   * @param {number} segments  网格分段数（决定 LOD）
   */
  function buildGeometry(THREE, sampler, originX, originZ, size, segments) {
    const seg = Math.max(2, Math.min(128, segments | 0));
    const step = size / seg;
    const vN = seg + 1;              // 顶点边长
    const gN = seg + 3;              // 采样网格（外扩一圈算法线）

    const grid = new Float32Array(gN * gN);
    let minY = Infinity;
    let maxY = -Infinity;
    for (let j = 0; j < gN; j++) {
      const wz = originZ + (j - 1) * step;
      const row = j * gN;
      for (let i = 0; i < gN; i++) {
        const wx = originX + (i - 1) * step;
        const h = sampler.heightAt(wx, wz);   // 地形外会贴最近边缘，不会 NaN
        grid[row + i] = h;
        if (h < minY) minY = h;
        if (h > maxY) maxY = h;
      }
    }
    if (!Number.isFinite(minY)) { minY = 0; maxY = 0; }

    const vCount = vN * vN;
    const positions = new Float32Array(vCount * 3);
    const normals = new Float32Array(vCount * 3);
    const colors = new Float32Array(vCount * 3);

    const rgb = [0, 0, 0];
    const inv2Step = 1 / (2 * step);
    const RAD2DEG = 180 / Math.PI;

    let p = 0;
    for (let j = 0; j < vN; j++) {
      const wz = originZ + j * step;
      const gRow = (j + 1) * gN;
      for (let i = 0; i < vN; i++) {
        const wx = originX + i * step;
        const gi = gRow + (i + 1);
        const h = grid[gi];

        const hL = grid[gi - 1];
        const hR = grid[gi + 1];
        const hD = grid[gi - gN];
        const hU = grid[gi + gN];
        let nx = (hL - hR) * inv2Step;
        let nz = (hD - hU) * inv2Step;
        let ny = 1;
        const len = Math.hypot(nx, ny, nz) || 1;
        nx /= len; ny /= len; nz /= len;

        const grad = Math.hypot(hR - hL, hU - hD) * inv2Step;
        const slopeDeg = Math.atan(grad) * RAD2DEG;

        sampler.colorAt(wx, wz, h, slopeDeg, rgb);

        // 顶点坐标用**局部坐标**（x/z 从 0 起），y 用世界高度 → mesh.position 只承担平移，
        // 这样即使地形在 y=10000 也不会有太大精度损失
        const o3 = p * 3;
        positions[o3] = i * step;
        positions[o3 + 1] = h;
        positions[o3 + 2] = j * step;
        normals[o3] = nx;
        normals[o3 + 1] = ny;
        normals[o3 + 2] = nz;
        colors[o3] = rgb[0];
        colors[o3 + 1] = rgb[1];
        colors[o3 + 2] = rgb[2];
        p++;
      }
    }

    const quads = seg * seg;
    const IndexArray = vCount > 65535 ? Uint32Array : Uint16Array;
    const indices = new IndexArray(quads * 6);
    let k = 0;
    for (let j = 0; j < seg; j++) {
      for (let i = 0; i < seg; i++) {
        const a = j * vN + i;
        const b = a + 1;
        const c = a + vN;
        const d = c + 1;
        indices[k++] = a; indices[k++] = c; indices[k++] = b;
        indices[k++] = b; indices[k++] = c; indices[k++] = d;
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.computeBoundingSphere();
    geometry.computeBoundingBox();

    return { geometry, minY, maxY, verts: vCount, tris: quads * 2 };
  }

  global.TerrainChunk = { buildGeometry };
})(typeof window !== 'undefined' ? window : globalThis);
