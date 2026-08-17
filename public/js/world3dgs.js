/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 *
 * 世界主场景 - 3DGS 高斯场景对象真实渲染接入
 *
 * 加载流程:
 *   1) addGaussianSplat(modelData) 从 model_path 取 PLY URL（形如 /scenes/3dgs/xxx.ply）
 *   2) 加载期间保留紫色线框占位 + 名称标签 + Sprite 进度（下载/解析/上屏百分比）
 *   3) 加载完成 → 移除占位视觉 → GaussianSplatRenderer.createSplatNode 创建真实节点
 *      （沿用 _addModelToScene 注册进 generatedBuildings，支持选中/删除）
 *   4) 渲染驱动: monkey-patch world.renderer.render（保存原函数, 每帧先遍历 splat 调
 *      update(camera, renderer) 再调用原 render）— 不修改 world.js（299KB 黑名单）
 *   5) 对象删除/卸载: monkey-patch World.prototype.unloadObject / removeObject → dispose()
 *
 * 依赖引入顺序（均在 world.js 之后）:
 *   gaussianSplatLoader.js → gaussianSplatRenderer.js → world3dgs.js
 */
(function () {
    'use strict';

    // 每个 gaussian_splat 对象的运行记录
    // { id, group, label, progressSprite, splat, data, disposed, lastPct }
    var splatRecords = new Map();

    /* ---------------- 内部工具 ---------------- */

    // PLY URL 规范化：绝对 URL 原样；相对路径补服务器根斜杠
    function normalizeUrl(path) {
        if (!path) return '';
        if (/^https?:\/\//i.test(path)) return path;
        return path.charAt(0) === '/' ? path : '/' + path;
    }

    // 递归释放 Object3D 的 geometry/material（含 map 纹理）
    function disposeObject(obj) {
        if (!obj) return;
        if (obj.children && obj.children.length) {
            for (var i = obj.children.length - 1; i >= 0; i--) disposeObject(obj.children[i]);
        }
        if (obj.geometry && obj.geometry.dispose) {
            try { obj.geometry.dispose(); } catch (e) {}
        }
        if (obj.material) {
            var mats = Array.isArray(obj.material) ? obj.material : [obj.material];
            for (var j = 0; j < mats.length; j++) {
                if (mats[j].map && mats[j].map.dispose) { try { mats[j].map.dispose(); } catch (e) {} }
                if (mats[j].dispose) { try { mats[j].dispose(); } catch (e) {} }
            }
        }
    }

    // 创建进度百分比 Sprite（CanvasTexture，无 DOM 泄漏）
    function makeProgressSprite(text) {
        var canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 64;
        var ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.font = 'bold 24px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.strokeStyle = 'rgba(0,0,0,0.85)';
        ctx.lineWidth = 4;
        ctx.strokeText(text, 128, 32);
        ctx.fillStyle = '#FFD700';
        ctx.fillText(text, 128, 32);
        var texture = new THREE.CanvasTexture(canvas);
        var material = new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true });
        var sprite = new THREE.Sprite(material);
        sprite.scale.set(2.2, 0.55, 1);
        return sprite;
    }

    // 更新进度 Sprite 文本（复用同一 CanvasTexture）
    function setProgressText(record, text) {
        var sp = record.progressSprite;
        if (!sp || !sp.material || !sp.material.map) return;
        var canvas = sp.material.map.image;
        if (!canvas || !canvas.getContext) return;
        var ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.font = 'bold 24px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.strokeStyle = 'rgba(0,0,0,0.85)';
        ctx.lineWidth = 4;
        ctx.strokeText(text, canvas.width / 2, canvas.height / 2);
        ctx.fillStyle = '#FFD700';
        ctx.fillText(text, canvas.width / 2, canvas.height / 2);
        sp.material.map.needsUpdate = true;
    }

    // 移除占位视觉（线框盒/中心点），保留进度 Sprite 与名称标签
    function removePlaceholderVisuals(record) {
        var group = record.group;
        if (!group) return;
        var drop = [];
        for (var i = 0; i < group.children.length; i++) {
            var child = group.children[i];
            if (child.userData && child.userData.gsPlaceholder && !child.userData.isProgress) {
                drop.push(child);
            }
        }
        for (var j = 0; j < drop.length; j++) {
            group.remove(drop[j]);
            disposeObject(drop[j]);
        }
    }

    // 点云对齐 + 尺寸适配：中心平移到组原点；scale_x/scale_y 解释为"目标显示跨度(米)"，
    // 点云按真实包围球半径归一化到该跨度（scale_z 跟随宽度，与编辑器面板/保存逻辑一致）。
    // 修复：场景级大点云（如荷花 157 万点/半径几十米）若把 scale 当整体倍率会放大到
    // 数百米、笼罩全场景导致"所有模型都压住荷花"。
    function fitSplatToGroup(record, data) {
        var group = record.group;
        var splat = record.splat;
        if (!group || !splat || !splat.object3D) return;
        var md = record.data || {};
        var bs = data && data.boundingSphere;
        var radius = bs ? bs.radius : 0;
        if (radius > 0.01) {
            // scale_x = 编辑器面板宽度 w = 目标显示跨度(米)；未设置默认跨度 20
            var userW = parseFloat(md.scale_x);
            var userH = parseFloat(md.scale_y);
            var spanW = (isFinite(userW) && userW > 0) ? userW : 20;
            var spanH = (isFinite(userH) && userH > 0) ? userH : spanW;
            group.scale.set(
                spanW / (2 * radius),
                spanH / (2 * radius),
                spanW / (2 * radius)
            );
        }
        // 底部贴地: loader 已把点云中心化(center=[0,0,0])并输出 minY
        // (中心化后最低点相对中心的偏移, 负数)。抬高 -minY 使点云最低点落在
        // 放置点, 与 GLB 模型底贴地语义一致, 修复 3DGS 半埋地下被地面切掉。
        // 必须在 group 缩放之后设置: position 随 group.scale 同步缩放,
        // minY 与点云同坐标系, 缩放比例一致, 故任意 scale 下底部严格贴地。
        var minY = (data && typeof data.minY === 'number') ? data.minY : 0;
        splat.object3D.position.set(0, -minY, 0);
    }

    /* ---------------- 渲染驱动（monkey-patch renderer.render） ---------------- */

    function ensureRenderPatch(world) {
        var renderer = world && world.renderer;
        if (!renderer || typeof renderer.render !== 'function') return;
        if (renderer.render.__gsWrapped) return;
        var origRender = renderer.render.bind(renderer);
        var wrapped = function (scene, camera) {
            if (camera) {
                splatRecords.forEach(function (rec) {
                    if (!rec.disposed && rec.splat && rec.splat.update) {
                        try { rec.splat.update(camera, renderer); } catch (e) {}
                    }
                });
            }
            return origRender(scene, camera);
        };
        wrapped.__gsWrapped = true;
        renderer.render = wrapped;
    }

    /* ---------------- 卸载/删除钩子（monkey-patch World.prototype） ---------------- */

    function disposeSplat(world, id) {
        var rec = splatRecords.get(id);
        if (!rec) return;
        splatRecords.delete(id);
        rec.disposed = true;
        if (rec.group && rec.group.parent) {
            rec.group.parent.remove(rec.group);
        }
        if (rec.splat && rec.splat.dispose) {
            try { rec.splat.dispose(); } catch (e) {}
        }
        disposeObject(rec.group);
        if (world && world.generatedBuildings) {
            var entry = world.generatedBuildings.get(id);
            if (entry && entry.model === rec.group) world.generatedBuildings.delete(id);
        }
    }

    function installUnloadHooks() {
        var proto = window.World && window.World.prototype;
        if (!proto) return;

        // unloadObject(obj)：距离卸载/对象删除主路径（world.js switch 不含 gaussian_splat）
        if (typeof proto.unloadObject === 'function' && !proto.__gsUnloadPatched) {
            var origUnload = proto.unloadObject;
            proto.unloadObject = function (obj) {
                if (obj && obj.type === 'gaussian_splat') {
                    disposeSplat(this, obj.id);
                }
                return origUnload.call(this, obj);
            };
            proto.__gsUnloadPatched = true;
        }

        // removeObject(objId)：websocket objectRemove 只改数组，这里补场景/GPU 清理
        if (typeof proto.removeObject === 'function' && !proto.__gsRemovePatched) {
            var origRemove = proto.removeObject;
            proto.removeObject = function (objId) {
                disposeSplat(this, objId);
                return origRemove.call(this, objId);
            };
            proto.__gsRemovePatched = true;
        }
    }

    /* ---------------- 主入口 ---------------- */

    function addGaussianSplat(modelData) {
        var world = this;
        var id = modelData.id;
        var name = modelData.name || '3DGS场景';
        var modelPath = modelData.model_path || '';

        // 已加载 / 加载中检查
        // 注意：world.js "两阶段加载"会为所有有 model_path 的对象预先放置占位符
        // （generatedBuildings entry 形如 {model, isPlaceholder:true}），因此这里的
        // 检查必须容忍占位符 entry：仅当存在真实 splat 节点（已完成）或 splatRecords
        // 有加载中记录时才跳过，否则占位符会把真实 3DGS 加载永久拦截。
        if (splatRecords.has(id)) {
            console.log('3DGS 正在加载，跳过:', id);
            return;
        }
        var existing = world.generatedBuildings && world.generatedBuildings.get(id);
        if (existing && existing.splat) {
            console.log('3DGS 已加载，跳过:', id);
            return;
        }

        var url = normalizeUrl(modelPath);
        if (!url) {
            console.warn('3DGS model_path 为空:', modelData);
            return;
        }
        if (!window.GaussianSplatLoader || !window.GaussianSplatRenderer) {
            console.error('3DGS 模块未加载（请检查脚本引入顺序）:', id);
            return;
        }

        ensureRenderPatch(world);
        installUnloadHooks();

        // ---- 阶段1: 紫色占位 + 名称标签 + 进度 Sprite ----
        var group = new THREE.Group();
        group.position.set(
            modelData.position_x || 0, modelData.position_y || 0, modelData.position_z || 0);
        group.rotation.set(
            modelData.rotation_x || 0, modelData.rotation_y || 0, modelData.rotation_z || 0);
        group.scale.set(
            modelData.scale_x || 1, modelData.scale_y || 1, modelData.scale_z || 1);

        var box = new THREE.Mesh(
            new THREE.BoxGeometry(3, 3, 3),
            new THREE.MeshBasicMaterial({ color: 0xa78bfa, wireframe: true })
        );
        box.userData.gsPlaceholder = true;
        group.add(box);

        var dot = new THREE.Mesh(
            new THREE.SphereGeometry(0.2, 12, 12),
            new THREE.MeshBasicMaterial({ color: 0xa78bfa })
        );
        dot.userData.gsPlaceholder = true;
        group.add(dot);

        var label = null;
        if (typeof world.createNameSprite === 'function') {
            label = world.createNameSprite(name);
            if (label) {
                label.position.y = 2.5;
                group.add(label);
            }
        }

        var progressSprite = makeProgressSprite('下载 0%');
        progressSprite.position.y = -3;
        progressSprite.userData.gsPlaceholder = true;
        progressSprite.userData.isProgress = true;
        group.add(progressSprite);

        group.userData.worldObjectId = id;
        group.userData.name = name;
        group.userData.objectType = 'gaussian_splat';

        world.removePlaceholder(id);
        world._addModelToScene(group);
        if (!world.generatedBuildings) world.generatedBuildings = new Map();
        world.generatedBuildings.set(id, {
            model: group, data: modelData, isGaussianLoading: true
        });

        var record = {
            id: id, group: group, label: label,
            progressSprite: progressSprite, splat: null,
            data: modelData, disposed: false, lastPct: -1
        };
        splatRecords.set(id, record);

        // ---- 阶段2: 流式下载 + 解析（真实进度） ----
        // 性能: 大场景全量渲染(如荷花 157 万点)会卡成幻灯片, 按重要度抽稀到 5 万点,
        // 配合渲染器距离 LOD 与视锥剔除, 远处/屏外几乎零开销。
        var lastShown = -1;
        window.GaussianSplatLoader.loadPLY(url, {
            maxPoints: 50000,
            onDownload: function (p) {
                var pct = Math.round(p * 100);
                if (pct !== lastShown) {
                    lastShown = pct;
                    setProgressText(record, '下载 ' + pct + '%');
                }
            },
            onParse: function (p) {
                var pct = Math.round(p * 100);
                if (pct !== lastShown) {
                    lastShown = pct;
                    setProgressText(record, '解析 ' + pct + '%');
                }
            }
        }).then(function (data) {
            if (record.disposed) return; // 加载期间被卸载，丢弃结果
            try {
                // 移除占位视觉（盒/点），保留进度 Sprite 显示"上屏 X%"
                removePlaceholderVisuals(record);

                var splat = window.GaussianSplatRenderer.createSplatNode(data, {
                    maxPointSize: 10,
                    initialCount: Math.min(20000, data.count),
                    incrementPerFrame: Math.max(2000, Math.ceil(data.count / 120))
                });
                splat.setProgressCallback(function (pct) {
                    var p = Math.round(pct * 100);
                    if (p !== record.lastPct) {
                        record.lastPct = p;
                        if (record.progressSprite) {
                            if (p < 100) {
                                setProgressText(record, '上屏 ' + p + '%');
                            } else {
                                group.remove(record.progressSprite);
                                disposeObject(record.progressSprite);
                                record.progressSprite = null;
                            }
                        }
                    }
                });
                record.splat = splat;
                group.add(splat.object3D);
                fitSplatToGroup(record, data);

                // 注册表升级（供选中/删除/卸载识别）
                world.generatedBuildings.set(id, {
                    model: group, data: modelData, splat: splat
                });

                var radius = data.boundingSphere ? data.boundingSphere.radius.toFixed(2) : '?';
                console.log('3DGS 真实渲染已接入:', id, name, '点数=' + data.count, '半径=' + radius);
            } catch (e) {
                console.error('3DGS 创建渲染节点失败:', id, e);
                setProgressText(record, '渲染失败');
            }
        }).catch(function (err) {
            console.error('3DGS 加载失败:', id, url, err && err.message);
            setProgressText(record, '加载失败');
        });
    }

    // 挂载到 World 原型
    if (window.World && window.World.prototype) {
        if (!window.World.prototype.addGaussianSplat) {
            window.World.prototype.addGaussianSplat = addGaussianSplat;
        }
    }
})();
