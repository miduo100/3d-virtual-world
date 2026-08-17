/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 *
 * 3D 高斯泼溅 (3D Gaussian Splatting) - INRIA 标准二进制小端 PLY 解析器
 *
 * 特性:
 * - fetch 流式下载(ReadableStream 分块) + onDownload 进度回调
 * - SH 球谐颜色展开(DC 项 + 一阶增强), opacity logit→sigmoid, scale log→exp
 * - 重要度排序(score = opacity × 实际尺度向量长度) 降序, 渐进加载先出关键点
 * - 可选 maxPoints 等距抽稀; 计算 boundingSphere 供视锥剔除
 *
 * 挂载: window.GaussianSplatLoader (浏览器) / module.exports (Node, 便于验证)
 * 仅 r128 兼容 API; 输入支持 URL 或 ArrayBuffer。
 */
(function () {
    'use strict';

    var C0 = 0.28209479177387814; // SH DC 基函数 Y00
    var C1 = 0.4886025119029199;  // 一阶 SH 基函数归一化 sqrt(3/(4π))

    function typeSize(type) {
        switch (type) {
            case 'char': case 'int8': case 'uchar': case 'uint8': return 1;
            case 'short': case 'int16': case 'ushort': case 'uint16': return 2;
            case 'int': case 'int32': case 'uint': case 'uint32': return 4;
            case 'float': case 'float32': return 4;
            case 'double': case 'float64': return 8;
            default: return 0;
        }
    }

    // 输入纯头部字节(Uint8Array) → { count, stride, offsets }
    function parseHeader(headerBytes) {
        var text = new TextDecoder('latin1').decode(headerBytes);
        var lines = text.split(/\r?\n/);
        if (!lines.length || lines[0].trim() !== 'ply') {
            throw new Error('不是合法的 PLY 文件');
        }
        var count = 0, stride = 0, formatOk = false, inVertex = false;
        var props = [];
        for (var i = 1; i < lines.length; i++) {
            var line = lines[i].trim();
            if (!line) continue;
            if (line === 'format binary_little_endian 1.0') { formatOk = true; continue; }
            if (line.indexOf('format ') === 0) throw new Error('仅支持 binary_little_endian 1.0');
            if (line.indexOf('comment') === 0 || line.indexOf('obj_info') === 0) continue;
            if (line.indexOf('element ') === 0) {
                var ep = line.split(/\s+/);
                inVertex = (ep[1] === 'vertex');
                if (inVertex) count = parseInt(ep[2], 10);
                continue;
            }
            if (inVertex && line.indexOf('property ') === 0) {
                var pp = line.split(/\s+/);
                if (pp[1] === 'list') continue; // 忽略 list(面片) 属性
                var sz = typeSize(pp[1]);
                if (!sz) throw new Error('不支持的属性类型: ' + pp[1]);
                props.push({ name: pp[2], offset: stride, size: sz });
                stride += sz;
            }
        }
        if (!formatOk) throw new Error('缺少 format binary_little_endian 1.0');
        if (!count) throw new Error('未找到 vertex 元素');

        var offsets = {};
        for (var j = 0; j < props.length; j++) offsets[props[j].name] = props[j].offset;

        var required = ['x', 'y', 'z', 'opacity',
            'scale_0', 'scale_1', 'scale_2',
            'rot_0', 'rot_1', 'rot_2', 'rot_3',
            'f_dc_0', 'f_dc_1', 'f_dc_2'];
        for (var k = 0; k < required.length; k++) {
            if (offsets[required[k]] === undefined) {
                throw new Error('PLY 缺少 3DGS 属性: ' + required[k]);
            }
        }
        return { count: count, stride: stride, offsets: offsets };
    }

    // 从字节流中定位 end_header → { headerBytes, dataLeft }
    function locateHeader(bytes) {
        var probeLen = Math.min(bytes.length, 262144);
        var text = new TextDecoder('latin1').decode(bytes.subarray(0, probeLen));
        var idx = text.indexOf('end_header');
        if (idx < 0) return null;
        var end = idx + 'end_header'.length;
        while (end < probeLen && (text.charCodeAt(end) === 10 || text.charCodeAt(end) === 13)) end++;
        return { headerBytes: bytes.subarray(0, end), dataLeft: bytes.subarray(end) };
    }

    // 流式读取头部(兼容任意分块大小)
    async function readHeaderStream(reader) {
        var buf = new Uint8Array(0);
        var decoder = new TextDecoder('latin1');
        while (true) {
            var r = await reader.read();
            if (r.done) throw new Error('文件在头部结束前被截断');
            var nb = new Uint8Array(buf.length + r.value.length);
            nb.set(buf); nb.set(r.value, buf.length);
            buf = nb;
            var probe = buf.subarray(0, Math.min(buf.length, 262144));
            if (decoder.decode(probe).indexOf('end_header') >= 0) break;
            if (buf.length > 262144) throw new Error('PLY 头部异常过大');
        }
        return locateHeader(buf);
    }

    // 下载剩余数据, 返回去掉头部后的完整顶点数据
    async function readDataStream(reader, first, headerLen, totalBytes, onDownload) {
        var chunks = [first];
        var loaded = headerLen + first.length;
        while (true) {
            var r = await reader.read();
            if (r.done) break;
            chunks.push(r.value);
            loaded += r.value.length;
            if (onDownload && totalBytes > 0) onDownload(Math.min(1, loaded / totalBytes));
        }
        var out = new Uint8Array(loaded - headerLen);
        var off = 0;
        for (var i = 0; i < chunks.length; i++) { out.set(chunks[i], off); off += chunks[i].length; }
        return out;
    }

    // 解析顶点 → 列式数组(未排序)
    function parseVertices(data, info, onParse) {
        var N = info.count, stride = info.stride, O = info.offsets;
        var view = new DataView(data.buffer, data.byteOffset, data.byteLength);

        var positions = new Float32Array(N * 3);
        var colors = new Float32Array(N * 3);
        var scales = new Float32Array(N * 3);
        var rotations = new Float32Array(N * 4);
        var opacities = new Float32Array(N);
        var scores = new Float64Array(N);

        // 高阶 SH(一阶增强) 可选: 需同时具备法线与 f_rest_0..8
        var hasSH = (O.nx !== undefined && O.ny !== undefined && O.nz !== undefined &&
            O.f_rest_0 !== undefined && O.f_rest_1 !== undefined && O.f_rest_2 !== undefined &&
            O.f_rest_3 !== undefined && O.f_rest_4 !== undefined && O.f_rest_5 !== undefined &&
            O.f_rest_6 !== undefined && O.f_rest_7 !== undefined && O.f_rest_8 !== undefined);
        var minx = Infinity, miny = Infinity, minz = Infinity;
        var maxx = -Infinity, maxy = -Infinity, maxz = -Infinity;
        var BATCH = 32768;

        for (var i = 0; i < N; i++) {
            var b = i * stride;
            var px = view.getFloat32(b + O.x, true);
            var py = view.getFloat32(b + O.y, true);
            var pz = view.getFloat32(b + O.z, true);
            positions[i * 3] = px; positions[i * 3 + 1] = py; positions[i * 3 + 2] = pz;

            // 颜色: DC 项 + 一阶 SH(INRIA 符号: -sh1·y + sh2·z - sh3·x)
            var r = view.getFloat32(b + O.f_dc_0, true) * C0 + 0.5;
            var g = view.getFloat32(b + O.f_dc_1, true) * C0 + 0.5;
            var bl = view.getFloat32(b + O.f_dc_2, true) * C0 + 0.5;
            if (hasSH) {
                var dx = view.getFloat32(b + O.nx, true);
                var dy = view.getFloat32(b + O.ny, true);
                var dz = view.getFloat32(b + O.nz, true);
                var len = Math.sqrt(dx * dx + dy * dy + dz * dz);
                if (len > 1e-6) {
                    dx /= len; dy /= len; dz /= len;
                    r += C1 * (-view.getFloat32(b + O.f_rest_0, true) * dy
                        + view.getFloat32(b + O.f_rest_1, true) * dz
                        - view.getFloat32(b + O.f_rest_2, true) * dx);
                    g += C1 * (-view.getFloat32(b + O.f_rest_3, true) * dy
                        + view.getFloat32(b + O.f_rest_4, true) * dz
                        - view.getFloat32(b + O.f_rest_5, true) * dx);
                    bl += C1 * (-view.getFloat32(b + O.f_rest_6, true) * dy
                        + view.getFloat32(b + O.f_rest_7, true) * dz
                        - view.getFloat32(b + O.f_rest_8, true) * dx);
                }
            }
            colors[i * 3] = r < 0 ? 0 : (r > 1 ? 1 : r);
            colors[i * 3 + 1] = g < 0 ? 0 : (g > 1 ? 1 : g);
            colors[i * 3 + 2] = bl < 0 ? 0 : (bl > 1 ? 1 : bl);

            // 尺度: log 空间 → 实际尺度
            var s0 = Math.exp(view.getFloat32(b + O.scale_0, true));
            var s1 = Math.exp(view.getFloat32(b + O.scale_1, true));
            var s2 = Math.exp(view.getFloat32(b + O.scale_2, true));
            scales[i * 3] = s0; scales[i * 3 + 1] = s1; scales[i * 3 + 2] = s2;

            // 四元数: PLY 存 (w,x,y,z) → 输出 (x,y,z,w)
            rotations[i * 4] = view.getFloat32(b + O.rot_1, true);
            rotations[i * 4 + 1] = view.getFloat32(b + O.rot_2, true);
            rotations[i * 4 + 2] = view.getFloat32(b + O.rot_3, true);
            rotations[i * 4 + 3] = view.getFloat32(b + O.rot_0, true);

            // 不透明度: logit → sigmoid
            var op = 1 / (1 + Math.exp(-view.getFloat32(b + O.opacity, true)));
            opacities[i] = op;

            // 重要度 = 不透明度 × 实际尺度向量长度
            scores[i] = op * Math.sqrt(s0 * s0 + s1 * s1 + s2 * s2);

            if (px < minx) minx = px; if (px > maxx) maxx = px;
            if (py < miny) miny = py; if (py > maxy) maxy = py;
            if (pz < minz) minz = pz; if (pz > maxz) maxz = pz;

            if (((i + 1) % BATCH) === 0 && onParse) onParse((i + 1) / N);
        }
        if (onParse) onParse(1);

        return {
            positions: positions, colors: colors, scales: scales,
            rotations: rotations, opacities: opacities, scores: scores,
            minx: minx, miny: miny, minz: minz,
            maxx: maxx, maxy: maxy, maxz: maxz
        };
    }

    // 重要度降序排序 + 可选等距抽稀, 返回重排输出与包围球
    function reorderByScore(src, maxPoints) {
        var N = src.positions.length / 3;
        var order = new Uint32Array(N);
        for (var i = 0; i < N; i++) order[i] = i;
        var sc = src.scores;
        order.sort(function (a, b) { return sc[b] - sc[a]; });

        var final = order;
        if (maxPoints > 0 && maxPoints < N) {
            var step = N / maxPoints;
            final = new Uint32Array(maxPoints);
            for (var j = 0; j < maxPoints; j++) {
                final[j] = order[Math.min(N - 1, Math.floor(j * step))];
            }
        }
        var M = final.length;

        var outP = new Float32Array(M * 3);
        var outC = new Float32Array(M * 3);
        var outS = new Float32Array(M * 3);
        var outR = new Float32Array(M * 4);
        var outO = new Float32Array(M);

        for (var k = 0; k < M; k++) {
            var si = final[k] * 3, di = k * 3;
            outP[di] = src.positions[si]; outP[di + 1] = src.positions[si + 1]; outP[di + 2] = src.positions[si + 2];
            outC[di] = src.colors[si]; outC[di + 1] = src.colors[si + 1]; outC[di + 2] = src.colors[si + 2];
            outS[di] = src.scales[si]; outS[di + 1] = src.scales[si + 1]; outS[di + 2] = src.scales[si + 2];
            var sr = final[k] * 4, dr = k * 4;
            outR[dr] = src.rotations[sr]; outR[dr + 1] = src.rotations[sr + 1];
            outR[dr + 2] = src.rotations[sr + 2]; outR[dr + 3] = src.rotations[sr + 3];
            outO[k] = src.opacities[final[k]];
        }

        var cx = (src.minx + src.maxx) / 2;
        var cy = (src.miny + src.maxy) / 2;
        var cz = (src.minz + src.maxz) / 2;
        // 功能级修复: 点云整体中心化到本地原点, 包围球中心归零。
        // 所有高斯模型(世界内/编辑器预览/已保存对象/测试页)共用本 loader,
        // 无论调用方是否做 -center 平移都自洽, 杜绝 r128 剔除球偏移导致的
        // "相机转动整对象消失/闪现"。半径不受平移影响。
        var radius2 = 0;
        for (var m = 0; m < M; m++) {
            var ox = outP[m * 3] - cx, oy = outP[m * 3 + 1] - cy, oz = outP[m * 3 + 2] - cz;
            outP[m * 3] = ox; outP[m * 3 + 1] = oy; outP[m * 3 + 2] = oz;
            var d2 = ox * ox + oy * oy + oz * oz;
            if (d2 > radius2) radius2 = d2;
        }

        // 底部贴地支持: 基于全量原始点算最低点相对中心偏移(负数)。
        // 不用抽稀后数据是因为抽稀可能丢失最底点, 故用 src.miny(全量点最低值)。
        // 调用方把 splat.position.y 设为 -minY 后, 点云最低点落在放置点(y=0),
        // 且该偏移与顶点同受 group/root 缩放, 底部严格贴地, 与 scale 无关。
        var minY = (src.miny !== undefined && isFinite(src.miny)) ? (src.miny - cy) : 0;

        return {
            count: M,
            positions: outP, colors: outC, scales: outS,
            rotations: outR, opacities: outO,
            minY: minY,
            boundingSphere: { center: [0, 0, 0], radius: Math.sqrt(radius2) }
        };
    }

    // 页面内解析缓存: url -> parsed(未排序 parseVertices 结果)
    // 大场景(如荷花 157 万点/83MB)避免重复下载+解析; FIFO 淘汰, 最多 2 条
    var parsedCache = Object.create(null);
    var parsedCacheOrder = [];
    var PARSED_CACHE_MAX = 2;

    function cacheGet(url) { return parsedCache[url] || null; }

    function cacheSet(url, parsed) {
        parsedCache[url] = parsed;
        parsedCacheOrder.push(url);
        while (parsedCacheOrder.length > PARSED_CACHE_MAX) {
            var oldUrl = parsedCacheOrder.shift();
            delete parsedCache[oldUrl];
        }
    }

    // 主入口: input 为 URL 字符串或 ArrayBuffer/Buffer
    async function loadPLY(input, options) {
        var opts = options || {};
        var onDownload = opts.onDownload || null;
        var onParse = opts.onParse || null;
        var maxPoints = opts.maxPoints || 0;

        if (typeof input === 'string') {
            // 命中缓存: 跳过下载+解析, 直接按需排序抽稀
            var cached = parsedCache[input];
            if (cached && !opts.noCache) {
                if (onDownload) onDownload(1);
                if (onParse) onParse(1);
                return reorderByScore(cached, maxPoints);
            }
        }

        var info, data, headerLen = 0;

        if (typeof input === 'string') {
            var res = await fetch(input);
            if (!res.ok) throw new Error('下载失败: HTTP ' + res.status);
            var total = parseInt(res.headers.get('Content-Length') || '0', 10);
            var reader = res.body.getReader();
            var head = await readHeaderStream(reader);
            info = parseHeader(head.headerBytes);
            headerLen = head.headerBytes.length;
            if (onDownload && total > 0) onDownload(headerLen / total);
            data = await readDataStream(reader, head.dataLeft, headerLen, total, onDownload);
        } else if (input instanceof ArrayBuffer || ArrayBuffer.isView(input)) {
            var bytes = (input instanceof ArrayBuffer)
                ? new Uint8Array(input)
                : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
            var h = locateHeader(bytes);
            if (!h) throw new Error('PLY 缺少 end_header');
            info = parseHeader(h.headerBytes);
            data = h.dataLeft;
            if (onDownload) onDownload(1);
        } else {
            throw new Error('loadPLY 需要 URL 字符串或 ArrayBuffer');
        }

        var parsed = parseVertices(data, info, onParse);
        if (typeof input === 'string' && !opts.noCache) cacheSet(input, parsed);
        return reorderByScore(parsed, maxPoints);
    }

    var api = { loadPLY: loadPLY };
    if (typeof window !== 'undefined') window.GaussianSplatLoader = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
