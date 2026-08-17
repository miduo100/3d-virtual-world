/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 *
 * 3D 高斯泼溅 (3D Gaussian Splatting) - Three.js r128 渲染器
 *
 * - BufferGeometry + ShaderMaterial + Points, 一次上传全量 GPU
 * - geometry.setDrawRange(0, n) 渐进上屏(数据已按重要度排序)
 * - 顶点着色器: 3D 协方差 Σ=R·S·Sᵀ·Rᵀ → 相机空间 → 雅可比投影 → 屏幕椭圆 → gl_PointSize
 * - 片元着色器: gl_PointCoord 高斯衰减 exp(-r²·8), alpha 混合, depthWrite:false
 * - 包围球视锥剔除(loader 提供 boundingSphere)
 * - 帧间半透明不做排序(静态场景伪影可接受)
 *
 * 挂载: window.GaussianSplatRenderer (浏览器) / module.exports (Node)
 * 输入 data 来自 GaussianSplatLoader.loadPLY 返回值。
 */
(function () {
    'use strict';

    var VERT = [
        // position / modelViewMatrix / projectionMatrix 由 Three.js 自动注入,
        // 手动声明会在 WebGL2(GLSL3) 下与自动注入重复导致 redefinition 编译错误。
        'attribute vec3 aColor;',
        'attribute vec3 aScale;',
        'attribute vec4 aRotation;',
        'attribute float aOpacity;',
        'uniform float uPointSize;',
        'uniform float uFocalX;',
        'uniform float uFocalY;',
        'varying vec3 vColor;',
        'varying float vOpacity;',
        'mat3 quatToMat3(vec4 q) {',
        '    float s = 2.0 / (q.x*q.x + q.y*q.y + q.z*q.z + q.w*q.w);',
        '    float x = q.x, y = q.y, z = q.z, w = q.w;',
        '    float b00 = 1.0 - s*(y*y + z*z);',
        '    float b01 = s*(x*y - z*w);',
        '    float b02 = s*(x*z + y*w);',
        '    float b10 = s*(x*y + z*w);',
        '    float b11 = 1.0 - s*(x*x + z*z);',
        '    float b12 = s*(y*z - x*w);',
        '    float b20 = s*(x*z - y*w);',
        '    float b21 = s*(y*z + x*w);',
        '    float b22 = 1.0 - s*(x*x + y*y);',
        '    return mat3(b00, b10, b20, b01, b11, b21, b02, b12, b22);',
        '}',
        'void main() {',
        '    vColor = aColor;',
        '    vOpacity = aOpacity;',
        '    vec4 camPos = modelViewMatrix * vec4(position, 1.0);',
        '    // 3D 协方差 Σ = R·S·Sᵀ·Rᵀ',
        '    mat3 R = quatToMat3(aRotation);',
        '    mat3 S = mat3(aScale.x, 0.0, 0.0, 0.0, aScale.y, 0.0, 0.0, 0.0, aScale.z);',
        '    mat3 M = R * S;',
        '    mat3 cov3d = M * transpose(M);',
        '    // 世界 → 相机旋转',
        '    mat3 W = mat3(modelViewMatrix);',
        '    mat3 covCam = W * cov3d * transpose(W);',
        '    // 透视投影雅可比(含 x/z², y/z² 项)',
        '    float z = max(camPos.z, 0.001);',
        '    mat3 J = mat3(',
        '        uFocalX / z, 0.0, -(uFocalX * camPos.x) / (z * z),',
        '        0.0, uFocalY / z, -(uFocalY * camPos.y) / (z * z),',
        '        0.0, 0.0, 0.0',
        '    );',
        '    mat3 cov2d = J * covCam * transpose(J);',
        '    // 屏幕椭圆 → 点尺寸(取较大特征值保证覆盖)',
        '    float mid = 0.5 * (cov2d[0][0] + cov2d[1][1]);',
        '    float radius = length(vec2((cov2d[0][0] - cov2d[1][1]) / 2.0, cov2d[0][1]));',
        '    float lambda1 = max(mid + radius, 0.0);',
        '    gl_PointSize = clamp(2.5 * sqrt(lambda1), 1.0, uPointSize);',
        '    gl_Position = projectionMatrix * camPos;',
        '}'
    ].join('\n');

    var FRAG = [
        'varying vec3 vColor;',
        'varying float vOpacity;',
        'void main() {',
        '    vec2 d = gl_PointCoord - vec2(0.5);',
        '    float r2 = dot(d, d);',             // [0, 0.5]
        '    float alpha = exp(-r2 * 8.0);',     // 高斯衰减(σ≈0.25), 边缘淡出
        '    alpha *= vOpacity;',
        '    if (alpha < 0.003) discard;',
        '    // 线性 → sRGB 近似编码(r128 ShaderMaterial 不自动编码, 此处统一处理)',
        '    gl_FragColor = vec4(pow(max(vColor, vec3(0.0)), vec3(1.0 / 2.2)), alpha);',
        '}'
    ].join('\n');

    function createSplatNode(data, options) {
        var opts = options || {};
        var maxPointSize = opts.maxPointSize || 32;
        var totalCount = data.count;
        var initialCount = Math.max(1, Math.min(opts.initialCount || 50000, totalCount));
        // 渐进节奏: 默认约 1.5s 全量(60fps≈90帧), 用户可覆盖
        var incrementPerFrame = opts.incrementPerFrame ||
            Math.max(2000, Math.ceil((totalCount - initialCount) / 90));

        var geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
        geometry.setAttribute('aColor', new THREE.BufferAttribute(data.colors, 3));
        geometry.setAttribute('aScale', new THREE.BufferAttribute(data.scales, 3));
        geometry.setAttribute('aRotation', new THREE.BufferAttribute(data.rotations, 4));
        geometry.setAttribute('aOpacity', new THREE.BufferAttribute(data.opacities, 1));
        if (data.boundingSphere) {
            var bs = data.boundingSphere;
            // 中心固定为 (0,0,0): loader 已把点云中心化到本地原点, 所有调用方统一。
            // 若引用旧格式非零 center, r128 剔除球会被 matrixWorld 变换到
            // "group位置+center" 的错误位置 → 相机一转整对象被误剔除消失。
            geometry.boundingSphere = new THREE.Sphere(
                new THREE.Vector3(0, 0, 0), bs.radius);
        }

        var material = new THREE.ShaderMaterial({
            vertexShader: VERT,
            fragmentShader: FRAG,
            transparent: true,
            depthWrite: false,
            uniforms: {
                uPointSize: { value: maxPointSize },
                uFocalX: { value: 1.0 },
                uFocalY: { value: 1.0 }
            }
        });

        var points = new THREE.Points(geometry, material);
        // 视锥剔除: loader 已把点云中心化到本地原点且包围球中心归零(见 loader 注释),
        // 剔除球经 matrixWorld 变换后位置正确, 可安全开启。大场景(如 12 万点)每帧
        // 全量绘制是卡顿主因之一, 开启后可跳过屏幕外场景的全部顶点开销。
        points.frustumCulled = true;

        var drawCount = Math.min(initialCount, totalCount);
        geometry.setDrawRange(0, drawCount);

        var progressCb = null;
        var lastPct = -1;
        var size = new THREE.Vector2();
        var worldPos = new THREE.Vector3();

        // 距离 LOD: 相机到 splat 的距离决定每帧实际绘制的点预算。
        // 近处满配, 60~120 限 1.5 万, 120~250 限 5 千, >250 完全隐藏。
        // 与"渐进上屏"共用 drawRange: 上屏进度只由 drawCount 驱动, 此处仅封顶。
        var LOD_NEAR = 60, LOD_MID = 120, LOD_FAR = 250;
        var LOD_MID_CAP = 15000, LOD_FAR_CAP = 5000;

        function setProgressCallback(fn) {
            progressCb = fn;
            if (progressCb) progressCb(drawCount / totalCount);
        }

        function update(camera, renderer) {
            // 1) 渐进上屏: 后台持续增长到 totalCount, 不受 LOD 影响
            if (drawCount < totalCount) {
                drawCount = Math.min(totalCount, drawCount + incrementPerFrame);
                if (progressCb) {
                    var pct = drawCount / totalCount;
                    if (pct - lastPct >= 0.01 || pct >= 1) {
                        lastPct = pct;
                        progressCb(pct);
                    }
                }
            }
            // 2) 距离 LOD: 决定可见性与点预算
            var lodLimit = totalCount;
            if (camera && camera.position && points.parent) {
                try { points.updateWorldMatrix(true, false); } catch (e) {}
                worldPos.setFromMatrixPosition(points.matrixWorld);
                var dist = worldPos.distanceTo(camera.position);
                if (dist > LOD_FAR) {
                    lodLimit = 0;
                } else if (dist > LOD_MID) {
                    lodLimit = Math.min(LOD_FAR_CAP, totalCount);
                } else if (dist > LOD_NEAR) {
                    lodLimit = Math.min(LOD_MID_CAP, totalCount);
                }
            }
            var eff = Math.min(drawCount, lodLimit);
            if (eff <= 0) {
                if (points.visible) points.visible = false;
            } else {
                if (!points.visible) points.visible = true;
                geometry.setDrawRange(0, eff);
            }
            // 3) 由相机视场角与渲染器尺寸推导焦距(像素), 保证屏幕椭圆尺寸正确
            if (renderer && renderer.getSize && camera) {
                renderer.getSize(size);
                if (size.height > 0 && camera.fov) {
                    var focal = (0.5 * size.height) / Math.tan((camera.fov * Math.PI) / 360.0);
                    material.uniforms.uFocalX.value = focal * (size.width / size.height);
                    material.uniforms.uFocalY.value = focal;
                }
            }
        }

        function dispose() {
            geometry.dispose();
            material.dispose();
        }

        return {
            object3D: points,
            update: update,
            dispose: dispose,
            setProgressCallback: setProgressCallback
        };
    }

    var api = { createSplatNode: createSplatNode };
    if (typeof window !== 'undefined') window.GaussianSplatRenderer = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
