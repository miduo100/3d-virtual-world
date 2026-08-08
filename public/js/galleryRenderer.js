/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
/**
 * 画廊3D渲染器 - 在虚拟世界中渲染照片森林
 * 
 * 坐标 (193, 1, 918) 说明：
 * 193  → 1931年，九一八事变爆发年份
 * 1    → 铭记历史，勿忘国耻
 * 918  → 9月18日，事变发生日期
 * Please remember the history: the Japanese invasion of China
 * began on September 18, 1931.
 * 
 * 核心功能：
 * - 分块加载：只加载用户附近的照片（区块半径50单位）
 * - 动态卸载：远离的照片自动释放纹理内存
 * - 视频处理：静音自动播放，点击取消静音
 * - 纪念显示：9月18日全天显示纪念文字
 * - 文件夹标记：在文件夹切换处显示名称
 */

// 如果 THREE 未加载则从全局获取
const THREE = window.THREE;

// ==================== 常量 ====================
const CHUNK_RADIUS = 50;        // 加载半径（单位）
const UNLOAD_RADIUS = 80;       // 卸载半径（单位）
const CHECK_INTERVAL = 1000;    // 检查间隔（毫秒）
const THUMBNAIL_DISTANCE = 15;  // 缩略图模式的距离阈值
const MAX_CONCURRENT_LOADS = 6; // 同时最多进行6个fetch（限制并发，防止微任务洪峰）

// ==================== 状态管理 ====================
class GalleryRenderer {
    constructor(scene, camera, characterGroup) {
        this.scene = scene;
        this.camera = camera;
        this.characterGroup = characterGroup;
        this.items = [];             // 所有物品元数据
        this.loadedItems = new Map(); // 已加载的物品 {id -> {mesh, videoEl}}
        this.config = null;          // 激活的配置
        this.textureLoader = new THREE.TextureLoader();
        this.videoTextures = new Map(); // 视频纹理
        this.activeVideos = new Set();  // 正在播放的视频
        this.isChecking = false;
        this.initialized = false;
        this.memorialMesh = null;     // 纪念文字网格
        this._loadQueue = [];         // 加载队列（顺滑加载）
        this._isLoading = false;      // 是否正在处理加载队列
        this._inflightLoads = 0;      // 当前进行中的fetch数量（并发限制）
        this._videoInterval = null;   // 视频播放管理器的定时器ID
        this._chunkCheckInterval = null; // 区块检查器的定时器ID
    }

    /**
     * 初始化：从API加载数据并开始渲染
     */
    async init() {
        try {
            // 加载物品元数据
            const res = await fetch('/api/gallery/items/meta');
            const data = await res.json();

            if (!data.success || !data.items || data.items.length === 0) {
                console.log('[galleryRenderer] 没有激活的画廊数据，跳过初始化');
                return;
            }

            this.items = data.items;
            this.config = data.config;
            this.initialized = true;

            console.log(`[galleryRenderer] 初始化完成: ${this.items.length}个物品`);

            // 检查纪念日
            await this.checkMemorialDay();

            // 首次加载附近的物品
            this.checkAndLoadChunks();

            // 启动周期性检查
            this.startChunkChecker();

            // 启动视频播放管理器（只让最近5个视频播放）
            this.startVideoPlaybackManager();

        } catch (err) {
            console.error('[galleryRenderer] 初始化失败:', err);
        }
    }

    /**
     * 获取当前角色位置
     */
    getPlayerPosition() {
        if (this.characterGroup && this.characterGroup.position) {
            return this.characterGroup.position;
        }
        if (this.camera && this.camera.position) {
            return this.camera.position;
        }
        return { x: 193, y: 1, z: 918 };
    }

    /**
     * 检查并加载/卸载区块（优化版：顺滑加载，不卡顿）
     * 
     * 核心思路：传送后瞬间有大量图片需要加载，
     * 但每帧只加载1-2个，用户旋转/移动完全不受影响。
     */
    checkAndLoadChunks() {
        if (!this.initialized) return;

        const pos = this.getPlayerPosition();
        const zMin = pos.z - CHUNK_RADIUS;
        const zMax = pos.z + CHUNK_RADIUS;

        // 需要加载的物品（按距离排序，优先加载近处的）
        const toLoad = this.items.filter(item => {
            if (item.is_folder_marker) return true;
            const itemZ = item.pos_z;
            return itemZ >= zMin && itemZ <= zMax && !this.loadedItems.has(item.id);
        }).sort((a, b) => {
            const distA = Math.abs(a.pos_z - pos.z);
            const distB = Math.abs(b.pos_z - pos.z);
            return distA - distB; // 近处的优先加载
        });

        // 需要卸载的物品
        const toUnload = [];
        this.loadedItems.forEach((data, id) => {
            const item = this.items.find(i => i.id === id);
            if (!item) return;
            if (item.is_folder_marker) return;
            const itemZ = item.pos_z;
            if (itemZ < pos.z - UNLOAD_RADIUS || itemZ > pos.z + UNLOAD_RADIUS) {
                toUnload.push(id);
            }
        });

        // 分批卸载（每次5个，避免瞬间卸载卡顿）
        if (toUnload.length > 0) {
            this.unloadInBatches(toUnload);
        }

        // 顺滑加载：放入队列，每帧只加载2个
        if (toLoad.length > 0) {
            this.loadSmoothly(toLoad);
        }
    }

    /**
     * 分批卸载（避免卡顿）
     */
    unloadInBatches(toUnloadIds) {
        const BATCH_SIZE = 5;
        let index = 0;

        const unloadNextBatch = () => {
            const batch = toUnloadIds.slice(index, index + BATCH_SIZE);
            batch.forEach(id => this.unloadItem(id));
            index += BATCH_SIZE;

            if (index < toUnloadIds.length) {
                setTimeout(unloadNextBatch, 50);
            }
        };

        unloadNextBatch();
    }

    /**
     * 顺滑加载（核心：每帧只加载2个，绝不卡顿）
     */
    loadSmoothly(toLoadItems) {
        if (toLoadItems.length === 0) return;

        // 将新物品添加到队列（去重）
        for (const item of toLoadItems) {
            if (!this._loadQueue.find(q => q.id === item.id)) {
                this._loadQueue.push(item);
            }
        }

        // 如果已经在加载中，不需要重复启动
        if (this._isLoading) return;

        this._isLoading = true;
        this.processLoadQueue();
    }

    /**
     * 处理加载队列（并发限制 + rAF 调度，彻底消除卡顿）
     * 
     * 核心策略：
     * 1. MAX_CONCURRENT_LOADS=6：同时最多6个fetch，防止微任务洪峰
     * 2. 超过并发上限时暂停调度，等 callback 回来再补位
     * 3. rAF 调度：每次只dispatch一个，跟渲染帧对齐
     * 4. 几何体/材质创建在 .then() 内也推迟到 setTimeout(fn,0)
     */
    processLoadQueue() {
        // 队列空且无在飞fetch → 完成
        const queueEmpty = !this._loadQueue || this._loadQueue.length === 0;
        if (queueEmpty && this._inflightLoads === 0) {
            this._isLoading = false;
            return;
        }

        // 队列空但还有fetch在飞 → 等回调补位
        if (queueEmpty) return;

        // 并发达到上限 → 暂停，等完成回调触发
        if (this._inflightLoads >= MAX_CONCURRENT_LOADS) return;

        const item = this._loadQueue.shift();
        if (item && !this.loadedItems.has(item.id)) {
            this._inflightLoads++;
            this.createPhotoMesh(item);
        }

        // rAF 调度下一次：与渲染帧对齐，不抢输入事件
        requestAnimationFrame(() => this.processLoadQueue());
    }

    /**
     * 创建照片平面网格（并发限流版，彻底不卡主线程）
     *
     * 关键设计：
     *  - fetch 不 await，完全异步
     *  - .then() 回调中也不直接创建几何体/材质
     *  - 而是再用 setTimeout(fn,0) 推迟到 macrotask
     *  - 这样渲染循环和输入事件可以随时插队
     *  - 同时 _inflightLoads 计数器控制并发上限
     */
    createPhotoMesh(item) {
        if (this.loadedItems.has(item.id)) {
            this._inflightLoads--;
            this.processLoadQueue();
            return;
        }

        if (item.is_folder_marker) {
            this.createFolderMarker(item);
            this._inflightLoads--;
            this.processLoadQueue();
            return;
        }

        const isImage = item.file_type === 'image';

        if (isImage) {
            // fetch 完全异步，不阻塞
            this.loadImageTextureAsync(item.file_path).then(result => {
                this._inflightLoads--;
                // 关键：几何体/材质创建推迟到macrotask，让渲染循环插队
                setTimeout(() => {
                    const { texture, width: imgW, height: imgH } = result;
                    const imgAspect = imgW / imgH;

                    const baseHeight = item.height || 1.5;
                    let planeWidth = baseHeight * imgAspect;
                    let planeHeight = baseHeight;

                    const MAX_WIDTH = 3;
                    if (planeWidth > MAX_WIDTH) {
                        planeWidth = MAX_WIDTH;
                        planeHeight = MAX_WIDTH / imgAspect;
                    }

                    const geometry = new THREE.PlaneGeometry(planeWidth, planeHeight);
                    const material = new THREE.MeshBasicMaterial({
                        map: texture,
                        side: THREE.DoubleSide,
                        transparent: true
                    });

                    this._finalizePhotoMesh(item, geometry, material);
                }, 0);
                this.processLoadQueue();
            }).catch(err => {
                this._inflightLoads--;
                setTimeout(() => {
                    console.warn('[galleryRenderer] 无法加载图片:', item.file_path, err);
                    const geometry = new THREE.PlaneGeometry(item.width || 2, item.height || 1.5);
                    const material = new THREE.MeshBasicMaterial({
                        color: 0x333333,
                        side: THREE.DoubleSide,
                        transparent: true
                    });
                    this._finalizePhotoMesh(item, geometry, material);
                }, 0);
                this.processLoadQueue();
            });
        } else {
            // 视频：同步创建但立即恢复计数
            const geometry = new THREE.PlaneGeometry(item.width || 2, item.height || 1.5);
            const material = this.createVideoMaterial(item);
            this._finalizePhotoMesh(item, geometry, material);
            this._inflightLoads--;
            this.processLoadQueue();
        }
    }

    /**
     * 最终化 Mesh：创建 mesh 对象并延迟添加到场景（非阻塞）
     */
    _finalizePhotoMesh(item, geometry, material) {
        if (this.loadedItems.has(item.id)) return;  // 防止重复添加

        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(item.pos_x, item.pos_y, item.pos_z);
        mesh.rotation.y = item.rot_y || 0;
        mesh.userData = {
            galleryItem: item,
            galleryId: item.id
        };

        mesh.callback = () => {
            this.handleItemClick(item, mesh);
        };

        // 关键：用 setTimeout(fn, 0) 延迟 scene.add
        // 这样 GPU 纹理上传不会阻塞当前帧
        setTimeout(() => {
            if (this.loadedItems.has(item.id)) return;
            this.scene.add(mesh);
            this.loadedItems.set(item.id, { mesh, item });
        }, 0);
    }

    /**
     * 异步加载图片纹理（使用 createImageBitmap 真正离线解码）
     * 
     * 核心原理：
     * - createImageBitmap: 在独立线程解码图片，完全不阻塞主线程
     * - 解码完成后才创建 THREE.Texture，GPU 上传只做一次
     * - 这是解决"加载图片时卡顿"的根本方案
     */
    async loadImageTextureAsync(url) {
        try {
            // 第一步：fetch 下载图片原始数据（有缓存时直接走内存）
            const response = await fetch(url, { mode: 'cors' });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const blob = await response.blob();

            // 第二步：createImageBitmap 在独立线程解码（真正不阻塞主线程！）
            // imageOrientation: 'flipY' → 解码时就翻转图片，解决 ImageBitmap 作为纹理源时 flipY 失效的问题
            const bitmap = await createImageBitmap(blob, { imageOrientation: 'flipY' });

            // 第三步：创建纹理（bitmap 已解码完毕，GPU 上传很快）
            const texture = new THREE.Texture(bitmap);
            texture.minFilter = THREE.LinearFilter;
            texture.magFilter = THREE.LinearFilter;
            texture.flipY = false;  // bitmap 已经翻转过了，告诉 Three.js 不要再翻转
            texture.needsUpdate = true;
            return { texture, width: bitmap.width, height: bitmap.height };
        } catch (err) {
            console.warn('[galleryRenderer] createImageBitmap 失败，降级到 Image 解码:', url, err);
            // 降级方案：用 Image 元素（解码在主线程，但至少能工作）
            return new Promise((resolve, reject) => {
                const img = new Image();
                img.crossOrigin = 'anonymous';
                img.onload = () => {
                    const texture = new THREE.Texture(img);
                    texture.minFilter = THREE.LinearFilter;
                    texture.magFilter = THREE.LinearFilter;
                    texture.needsUpdate = true;
                    resolve({ texture, width: img.naturalWidth, height: img.naturalHeight });
                };
                img.onerror = reject;
                img.src = url;
            });
        }
    }

    /**
     * 创建视频材质（懒加载：创建时不播放，由 updateVideoPlayback 按需控制）
     * 
     * 1万张视频规模下，绝对不能所有视频同时 play()
     * 只加载 metadata，不下载完整视频数据
     */
    createVideoMaterial(item) {
        const video = document.createElement('video');
        video.src = item.file_path;
        video.muted = true;
        video.loop = true;
        video.playsInline = true;
        video.crossOrigin = 'anonymous';
        video.preload = 'metadata';  // 只加载元数据，不下载整个视频

        const texture = new THREE.VideoTexture(video);
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;

        this.videoTextures.set(item.id, {
            video,
            texture,
            isMuted: true,
            isPlaying: false   // 初始状态：未播放
        });

        return new THREE.MeshBasicMaterial({
            map: texture,
            side: THREE.DoubleSide
        });
    }

    /**
     * 创建文件夹标记（自适应文字宽度和自动换行）
     */
    createFolderMarker(item) {
        const folderName = '📁 ' + (item.folder_name || '');
        const fontSize = 22;          // 缩小字体
        const padding = 20;           // 减小内边距
        const lineHeight = fontSize * 1.4;
        const maxCanvasWidth = 400;   // 最大canvas宽度（像素），限制3D标签宽度

        // 第一步：测量文字，计算换行
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        ctx.font = `bold ${fontSize}px sans-serif`;

        const chars = folderName.split('');
        let lines = [];
        let currentLine = '';

        for (let i = 0; i < chars.length; i++) {
            const testLine = currentLine + chars[i];
            const metrics = ctx.measureText(testLine);
            if (metrics.width > maxCanvasWidth - padding * 2 && currentLine.length > 0) {
                lines.push(currentLine);
                currentLine = chars[i];
            } else {
                currentLine = testLine;
            }
        }
        lines.push(currentLine);

        // 最多显示2行，超出截断（更紧凑）
        if (lines.length > 2) {
            lines = lines.slice(0, 2);
            const lastLine = lines[1];
            if (ctx.measureText(lastLine).width > maxCanvasWidth - padding * 2 - 30) {
                lines[1] = lastLine.slice(0, -3) + '...';
            }
        }

        const longestLine = lines.reduce((a, b) => a.length > b.length ? a : b, '');
        const textWidth = Math.min(
            ctx.measureText(longestLine).width + padding * 2,
            maxCanvasWidth
        );
        const textHeight = lines.length * lineHeight + padding;

        // 第二步：绘制 canvas
        canvas.width = Math.max(textWidth, 160);
        canvas.height = textHeight;

        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.roundRect(0, 0, canvas.width, canvas.height, 16);
        ctx.fill();

        ctx.fillStyle = '#ffffff';
        ctx.font = `bold ${fontSize}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        const totalTextHeight = lines.length * lineHeight;
        const startY = (canvas.height - totalTextHeight) / 2 + lineHeight / 2;
        lines.forEach((line, i) => {
            ctx.fillText(line, canvas.width / 2, startY + i * lineHeight);
        });

        // 第三步：创建 mesh，限制3D标签最大宽度
        const texture = new THREE.CanvasTexture(canvas);
        const aspectRatio = canvas.width / canvas.height;
        const baseHeight = item.height || 0.5;
        // 限制3D标签宽度不超过 3.5 单位
        const planeWidth = Math.min(Math.max(item.width || 1.5, aspectRatio * baseHeight), 3.5);
        const planeHeight = item.height || 0.5;
        const geometry = new THREE.PlaneGeometry(planeWidth, planeHeight);
        const material = new THREE.MeshBasicMaterial({
            map: texture,
            side: THREE.DoubleSide,
            transparent: true
        });

        const mesh = new THREE.Mesh(geometry, material);
        mesh.rotation.y = Math.PI; // 水平翻转180度
        mesh.position.set(item.pos_x, item.pos_y, item.pos_z);
        mesh.userData = {
            galleryItem: item,
            galleryId: item.id,
            isFolderMarker: true
        };

        this.scene.add(mesh);
        this.loadedItems.set(item.id, { mesh, item });
    }

    /**
     * 更新视频播放状态：只让玩家最近的 N 个视频播放，其余暂停
     * 
     * 这是应对1万+视频规模的关键优化：
     * - 10K个视频同时 play() → 10K个解码线程 → OOM/卡死
     * - 只让最近5个播放 → 同时只有5个解码线程 → 完全不卡
     * - 由 setTimeout 循环每500ms执行一次，不干扰主渲染循环
     */
    updateVideoPlayback() {
        if (this.videoTextures.size === 0) return;

        const pos = this.getPlayerPosition();
        const MAX_PLAYING = 5;  // 最多同时播放5个视频

        // 收集所有已加载视频与玩家的距离
        const videoDistances = [];
        for (const [id, videoData] of this.videoTextures) {
            const loaded = this.loadedItems.get(id);
            if (!loaded || !loaded.mesh) continue;
            const meshPos = loaded.mesh.position;
            // 主要按Z轴距离排序（照片森林沿Z轴排列）
            const distZ = Math.abs(meshPos.z - pos.z);
            const distX = Math.abs(meshPos.x - pos.x);
            const dist = Math.sqrt(distX * distX + distZ * distZ);
            videoDistances.push({ id, dist, videoData });
        }

        // 按距离排序，近的优先
        videoDistances.sort((a, b) => a.dist - b.dist);

        // 前 MAX_PLAYING 个播放，其余暂停
        for (let i = 0; i < videoDistances.length; i++) {
            const { id, videoData } = videoDistances[i];
            if (i < MAX_PLAYING) {
                if (!videoData.isPlaying) {
                    // 只 play() 成功后才标记为播放中，失败则下次继续重试
                    videoData.video.play().then(() => {
                        videoData.isPlaying = true;
                        this.activeVideos.add(id);
                    }).catch(() => {
                        // 自动播放被浏览器策略阻止，保持 isPlaying=false 以便重试
                    });
                }
            } else {
                if (videoData.isPlaying) {
                    videoData.video.pause();
                    videoData.isPlaying = false;
                    this.activeVideos.delete(id);
                }
            }
        }
    }

    /**
     * 启动视频播放管理器（每500ms检测一次，不干扰渲染）
     */
    startVideoPlaybackManager() {
        this._videoInterval = setInterval(() => {
            this.updateVideoPlayback();
        }, 500);
    }

    /**
     * 停止视频播放管理器
     */
    stopVideoPlaybackManager() {
        if (this._videoInterval) {
            clearInterval(this._videoInterval);
            this._videoInterval = null;
        }
    }

    /**
     * 处理物品点击
     */
    handleItemClick(item, mesh) {
        if (item.file_type === 'video') {
            const videoData = this.videoTextures.get(item.id);
            if (videoData) {
                if (videoData.isMuted) {
                    videoData.video.muted = false;
                    videoData.isMuted = false;
                    // 显示取消静音提示（通过更改材质颜色或覆盖文字）
                    console.log('[galleryRenderer] 视频取消静音:', item.file_name);
                } else {
                    videoData.video.muted = true;
                    videoData.isMuted = true;
                    console.log('[galleryRenderer] 视频静音:', item.file_name);
                }
            }
        }
        // 照片点击暂不做特殊处理
    }

    /**
     * 卸载物品（释放内存）
     */
    unloadItem(id) {
        const data = this.loadedItems.get(id);
        if (!data) return;

        const { mesh } = data;

        // 释放材质和纹理
        if (mesh.material) {
            if (mesh.material.map && !(mesh.material.map instanceof THREE.VideoTexture)) {
                mesh.material.map.dispose();
            }
            mesh.material.dispose();
        }

        // 释放几何体
        if (mesh.geometry) {
            mesh.geometry.dispose();
        }

        // 从场景中移除
        this.scene.remove(mesh);
        this.loadedItems.delete(id);

        // 如果是视频，停止播放并清理所有视频资源
        // 注意：不限于 activeVideos，所有 videoTextures 都要清理
        const videoData = this.videoTextures.get(id);
        if (videoData) {
            videoData.video.pause();
            videoData.video.src = '';
            videoData.video.load();
            videoData.texture.dispose();
            this.videoTextures.delete(id);
            this.activeVideos.delete(id);
        }
    }

    /**
     * 启动区块检查器
     */
    startChunkChecker() {
        this._chunkCheckInterval = setInterval(() => {
            if (this.isChecking) return;
            this.isChecking = true;
            this.checkAndLoadChunks();
            this.isChecking = false;
        }, CHECK_INTERVAL);
    }

    /**
     * 检查今天是否为9月18日并显示纪念内容
     */
    async checkMemorialDay() {
        try {
            const res = await fetch('/api/gallery/memorial');
            const data = await res.json();

            if (data.isSep18) {
                this.showMemorial();
            }
        } catch (err) {
            // 在客户端也做一次本地检查
            const today = new Date();
            if (today.getMonth() === 8 && today.getDate() === 18) {
                this.showMemorial();
            }
        }
    }

    /**
     * 显示纪念文字
     * 坐标 (193, 1, 918) 含义：1931年9月18日 日军侵华
     */
    showMemorial() {
        if (this.memorialMesh) return; // 已显示

        const canvas = document.createElement('canvas');
        canvas.width = 1024;
        canvas.height = 512;
        const ctx = canvas.getContext('2d');

        // 背景（半透明黑色）
        ctx.fillStyle = 'rgba(20, 0, 0, 0.85)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // 边框
        ctx.strokeStyle = '#cc0000';
        ctx.lineWidth = 6;
        ctx.strokeRect(10, 10, canvas.width - 20, canvas.height - 20);

        // 中文标题
        ctx.fillStyle = '#cc0000';
        ctx.font = 'bold 64px serif';
        ctx.textAlign = 'center';
        ctx.fillText('铭记历史  勿忘国耻', canvas.width / 2, 120);

        // 日期
        ctx.fillStyle = '#ff6b6b';
        ctx.font = 'bold 48px serif';
        ctx.fillText('1931年9月18日', canvas.width / 2, 200);

        // 事件
        ctx.fillStyle = '#ffffff';
        ctx.font = '36px serif';
        ctx.fillText('日军侵华战争开始', canvas.width / 2, 260);

        // 英文
        ctx.fillStyle = '#cccccc';
        ctx.font = '28px serif';
        ctx.fillText('Please remember the history:', canvas.width / 2, 330);
        ctx.fillText('the Japanese invasion of China', canvas.width / 2, 375);
        ctx.fillText('began on September 18, 1931.', canvas.width / 2, 420);

        const texture = new THREE.CanvasTexture(canvas);
        const geometry = new THREE.PlaneGeometry(8, 4);
        const material = new THREE.MeshBasicMaterial({
            map: texture,
            side: THREE.DoubleSide,
            transparent: true
        });

        // 坐标说明：193→1931年, 1→铭记历史, 918→9月18日
        // Please remember the history: the Japanese invasion of China began on September 18, 1931.
        this.memorialMesh = new THREE.Mesh(geometry, material);
        this.memorialMesh.position.set(193, 3.5, 918); // 悬浮在空中
        this.memorialMesh.userData = { isMemorial: true };

        this.scene.add(this.memorialMesh);
        console.log('[galleryRenderer] 纪念文字已显示于坐标 (193, 1, 918)');
    }

    /**
     * 销毁渲染器（清理所有资源）
     */
    dispose() {
        // 停止视频播放管理器
        this.stopVideoPlaybackManager();

        // 停止区块检查器
        if (this._chunkCheckInterval) {
            clearInterval(this._chunkCheckInterval);
            this._chunkCheckInterval = null;
        }

        // 卸载所有物品
        const ids = Array.from(this.loadedItems.keys());
        for (const id of ids) {
            this.unloadItem(id);
        }

        // 移除纪念文字
        if (this.memorialMesh) {
            this.scene.remove(this.memorialMesh);
            this.memorialMesh.material.map.dispose();
            this.memorialMesh.material.dispose();
            this.memorialMesh.geometry.dispose();
            this.memorialMesh = null;
        }

        this.items = [];
        this.initialized = false;
        console.log('[galleryRenderer] 已清理所有资源');
    }
}

// ==================== 全局入口 ====================
let galleryRenderer = null;

/**
 * 初始化画廊系统
 * 由 world.js 在场景加载后调用
 */
window.initGallerySystem = function(scene, camera, characterGroup) {
    if (!THREE) {
        console.error('[galleryRenderer] THREE.js 未加载，跳过画廊初始化');
        return;
    }

    if (galleryRenderer) {
        galleryRenderer.dispose();
    }

    galleryRenderer = new GalleryRenderer(scene, camera, characterGroup);
    window.galleryRenderer = galleryRenderer;  // 同步到全局
    galleryRenderer.init();
};

/**
 * 销毁画廊系统
 */
window.disposeGallerySystem = function() {
    if (galleryRenderer) {
        galleryRenderer.dispose();
        galleryRenderer = null;
        window.galleryRenderer = null;  // 同步到全局
    }
};

// 暴露给控制台调试
window.galleryRenderer = galleryRenderer;

/**
 * 更新画廊视频播放状态（供 gameLoop 等外部调用）
 * 只让玩家最近5个视频播放，其余暂停
 */
window.updateGalleryVideos = function() {
    if (galleryRenderer) galleryRenderer.updateVideoPlayback();
};
