/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
/**
 * AI动作工厂 - 3D预览播放器组件
 * 负责Three.js 3D模型加载、预览、播放控制
 */

(function() {
    // ===== 全局播放器实例 =====
    window.AIFactoryPlayer = {
        scene: null,
        camera: null,
        renderer: null,
        controls: null,
        currentModel: null,
        currentAnimation: null,
        mixer: null,
        clock: null,
        isPlaying: false,
        isLooping: true,
        playbackSpeed: 1.0,
        animationTime: 0,
        
        /**
         * 初始化3D场景
         */
        init() {
            const container = document.getElementById('preview-canvas');
            if (!container) {
                console.error('找不到预览容器');
                return;
            }
            
            const width = container.clientWidth;
            const height = container.clientHeight;
            
            // 创建场景
            this.scene = new THREE.Scene();
            this.scene.background = new THREE.Color(0x0a0a1a);
            
            // 创建相机
            this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
            this.camera.position.set(0, 1.5, 3);
            
            // 创建渲染器
            this.renderer = new THREE.WebGLRenderer({ 
                canvas: container,
                antialias: true 
            });
            this.renderer.setSize(width, height);
            this.renderer.setPixelRatio(window.devicePixelRatio);
            this.renderer.shadowMap.enabled = true;
            this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
            
            // 创建轨道控制器
            this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
            this.controls.enableDamping = true;
            this.controls.dampingFactor = 0.05;
            this.controls.minDistance = 0.5;
            this.controls.maxDistance = 10;
            this.controls.target.set(0, 1, 0);
            
            // 添加光源
            this.addLights();
            
            // 添加地面网格
            this.addGround();
            
            // 添加坐标轴辅助
            this.addHelpers();
            
            // 时钟
            this.clock = new THREE.Clock();
            
            // 开始渲染循环
            this.animate();
            
            // 监听窗口大小变化
            window.addEventListener('resize', () => this.onResize());
            
            // 加载默认模型（如果有）
            this.loadDefaultModel();
        },
        
        /**
         * 添加光源
         */
        addLights() {
            // 环境光
            const ambient = new THREE.AmbientLight(0x404040, 0.5);
            this.scene.add(ambient);
            
            // 主光源
            const mainLight = new THREE.DirectionalLight(0xffffff, 1);
            mainLight.position.set(5, 10, 5);
            mainLight.castShadow = true;
            mainLight.shadow.mapSize.width = 2048;
            mainLight.shadow.mapSize.height = 2048;
            mainLight.shadow.camera.near = 0.5;
            mainLight.shadow.camera.far = 50;
            mainLight.shadow.camera.left = -10;
            mainLight.shadow.camera.right = 10;
            mainLight.shadow.camera.top = 10;
            mainLight.shadow.camera.bottom = -10;
            this.scene.add(mainLight);
            
            // 补光
            const fillLight = new THREE.DirectionalLight(0x4488ff, 0.3);
            fillLight.position.set(-5, 5, -5);
            this.scene.add(fillLight);
            
            // 背光
            const backLight = new THREE.DirectionalLight(0xff8844, 0.2);
            backLight.position.set(0, 5, -10);
            this.scene.add(backLight);
        },
        
        /**
         * 添加地面
         */
        addGround() {
            // 圆形地面
            const groundGeo = new THREE.CircleGeometry(3, 64);
            const groundMat = new THREE.MeshStandardMaterial({
                color: 0x1a1a2e,
                roughness: 0.8,
                metalness: 0.2
            });
            const ground = new THREE.Mesh(groundGeo, groundMat);
            ground.rotation.x = -Math.PI / 2;
            ground.position.y = 0;
            ground.receiveShadow = true;
            this.scene.add(ground);
            
            // 网格
            const gridHelper = new THREE.GridHelper(6, 20, 0x00ff00, 0x003300);
            gridHelper.position.y = 0.01;
            gridHelper.visible = true;
            this.scene.add(gridHelper);
            this.gridHelper = gridHelper;
        },
        
        /**
         * 添加辅助对象
         */
        addHelpers() {
            // 坐标轴
            const axesHelper = new THREE.AxesHelper(1);
            axesHelper.position.set(-2, 0.01, -2);
            this.scene.add(axesHelper);
        },
        
        /**
         * 加载默认模型
         */
        loadDefaultModel() {
            // 尝试加载示例模型
            const defaultModel = '/models/blockman_tpose.glb';
            this.loadModel(defaultModel);
        },
        
        /**
         * 加载GLB/GLTF模型（支持纹理自动修复）
         */
        async loadModel(url) {
            if (!url) return;
            
            // 移除旧模型
            if (this.currentModel) {
                this.scene.remove(this.currentModel);
                this.currentModel = null;
            }
            
            if (this.mixer) {
                this.mixer.stopAllAction();
                this.mixer = null;
            }

            // ===== 纹理修复流程 =====
            let modelUrl = url;
            let blobUrl = null;
            
            if (typeof window.fixGLBTextures === 'function') {
                try {
                    console.log('[AIFactoryPlayer] 开始检测/修复外部纹理...');
                    
                    // 显示进度
                    if (typeof showToast === 'function') {
                        showToast('正在检测纹理...', 'info');
                    }
                    
                    const result = await window.fixGLBTextures(url, (progress) => {
                        console.log(`[AIFactoryPlayer] 纹理下载: ${progress.current}/${progress.total} - ${progress.url}`);
                        if (progress.current === progress.total) {
                            if (typeof showToast === 'function') {
                                const msg = progress.success 
                                    ? `纹理修复完成 (${progress.total}个)` 
                                    : `纹理部分失败 (${progress.failedCount || 0}个)`;
                                showToast(msg, progress.success ? 'info' : 'warning');
                            }
                        }
                    });
                    
                    if (result.fixed && result.buffer) {
                        // 创建 Blob URL
                        const blob = new Blob([result.buffer], { type: 'model/gltf-binary' });
                        blobUrl = URL.createObjectURL(blob);
                        modelUrl = blobUrl;
                        
                        console.log('[AIFactoryPlayer] ✅ GLB 纹理已修复并内嵌');
                        if (result.failedCount > 0) {
                            console.warn(`[AIFactoryPlayer] ⚠️ ${result.failedCount} 个纹理下载失败，使用默认颜色`);
                        }
                    } else if (!result.fixed && result.analysis && !result.analysis.hasExternalTextures) {
                        console.log('[AIFactoryPlayer] ✅ 模型无外部纹理，直接加载');
                    } else if (result.error) {
                        console.warn('[AIFactoryPlayer] 纹理修复失败，将尝试直接加载:', result.error);
                    }
                } catch (err) {
                    console.warn('[AIFactoryPlayer] 纹理检测/修复出错，尝试直接加载:', err);
                }
            }
            
            // 保存 blobUrl 以便后续清理
            this._currentBlobUrl = blobUrl;

            // ===== 加载模型 =====
            const loader = new THREE.GLTFLoader();
            
            loader.load(
                modelUrl,
                (gltf) => {
                    console.log('模型加载成功:', url);
                    
                    // 清理 Blob URL
                    if (blobUrl) {
                        URL.revokeObjectURL(blobUrl);
                        this._currentBlobUrl = null;
                    }
                    
                    const model = gltf.scene;
                    
                    // 计算边界并居中
                    const box = new THREE.Box3().setFromObject(model);
                    const center = box.getCenter(new THREE.Vector3());
                    const size = box.getSize(new THREE.Vector3());
                    
                    // 居中并缩放到合适大小
                    const maxDim = Math.max(size.x, size.y, size.z);
                    const scale = 2 / maxDim;
                    model.scale.setScalar(scale);
                    
                    // 调整位置，使模型站在地面上
                    model.position.x = -center.x * scale;
                    model.position.z = -center.z * scale;
                    
                    // 计算y轴偏移，使模型站在地面上
                    const boxBottom = box.min.y * scale;
                    model.position.y = -boxBottom;
                    
                    // 启用阴影
                    model.traverse((child) => {
                        if (child.isMesh) {
                            child.castShadow = true;
                            child.receiveShadow = true;
                        }
                    });
                    
                    this.currentModel = model;
                    this.scene.add(model);
                    
                    // 居中相机
                    this.controls.target.set(0, size.y * scale / 2, 0);
                    
                    // 创建动画混合器并播放待机动画
                    if (gltf.animations && gltf.animations.length > 0) {
                        this.mixer = new THREE.AnimationMixer(model);
                        
                        // 找到待机动画
                        const idleAnim = gltf.animations.find(a => 
                            a.name.toLowerCase().includes('idle') || 
                            a.name.toLowerCase().includes('待机')
                        );
                        
                        if (idleAnim) {
                            this.idleAction = this.mixer.clipAction(idleAnim);
                            this.idleAction.play();
                            this.isPlaying = true;
                            console.log('[AIFactoryPlayer] 播放待机动画:', idleAnim.name);
                        } else {
                            // 播放第一个动画作为待机
                            this.idleAction = this.mixer.clipAction(gltf.animations[0]);
                            this.idleAction.play();
                            this.isPlaying = true;
                        }
                    }
                    
                    showToast('模型加载成功');
                },
                (progress) => {
                    console.log('加载进度:', (progress.loaded / progress.total * 100).toFixed(1) + '%');
                },
                (error) => {
                    console.error('模型加载失败:', error);
                    
                    // 清理 Blob URL
                    if (blobUrl) {
                        URL.revokeObjectURL(blobUrl);
                        this._currentBlobUrl = null;
                    }
                    
                    // 加载失败时创建示例角色
                    this.createDemoCharacter();
                }
            );
        },
        
        /**
         * 创建演示角色（简单的几何体组合）
         */
        createDemoCharacter() {
            const group = new THREE.Group();
            
            // 材质
            const bodyMat = new THREE.MeshStandardMaterial({ 
                color: 0x00aaff,
                roughness: 0.5,
                metalness: 0.3
            });
            const headMat = new THREE.MeshStandardMaterial({ 
                color: 0xffcc99,
                roughness: 0.6
            });
            
            // 身体
            const body = new THREE.Mesh(
                new THREE.BoxGeometry(0.4, 0.6, 0.2),
                bodyMat
            );
            body.position.y = 0.9;
            body.castShadow = true;
            group.add(body);
            
            // 头部
            const head = new THREE.Mesh(
                new THREE.BoxGeometry(0.25, 0.25, 0.2),
                headMat
            );
            head.position.y = 1.4;
            head.castShadow = true;
            group.add(head);
            
            // 左手
            const leftArm = new THREE.Mesh(
                new THREE.BoxGeometry(0.1, 0.4, 0.1),
                bodyMat
            );
            leftArm.position.set(-0.3, 0.9, 0);
            leftArm.castShadow = true;
            group.add(leftArm);
            
            // 右手
            const rightArm = new THREE.Mesh(
                new THREE.BoxGeometry(0.1, 0.4, 0.1),
                bodyMat
            );
            rightArm.position.set(0.3, 0.9, 0);
            rightArm.castShadow = true;
            group.add(rightArm);
            
            // 左腿
            const leftLeg = new THREE.Mesh(
                new THREE.BoxGeometry(0.12, 0.4, 0.12),
                bodyMat
            );
            leftLeg.position.set(-0.1, 0.2, 0);
            leftLeg.castShadow = true;
            group.add(leftLeg);
            
            // 右腿
            const rightLeg = new THREE.Mesh(
                new THREE.BoxGeometry(0.12, 0.4, 0.12),
                bodyMat
            );
            rightLeg.position.set(0.1, 0.2, 0);
            rightLeg.castShadow = true;
            group.add(rightLeg);
            
            // 保存关节引用
            group.userData.joints = {
                body: body,
                head: head,
                leftArm: leftArm,
                rightArm: rightArm,
                leftLeg: leftLeg,
                rightLeg: rightLeg
            };
            
            this.currentModel = group;
            this.scene.add(group);
            
            console.log('使用演示角色模型');
        },
        
        /**
         * 应用动作数据到模型
         */
        applyMotionData() {
            // TODO: 从 AppState.motionConfigs 获取动作数据并应用
            // 目前预留接口
        },
        
        /**
         * 加载动作动画GLB文件并播放
         */
        async loadMotionAnimation(animUrl, motionKey) {
            if (!animUrl) {
                console.warn('没有动作动画URL');
                return;
            }
            
            console.log('[AIFactoryPlayer] 加载动作动画:', animUrl);
            
            // 停止当前动画
            if (this.mixer) {
                this.mixer.stopAllAction();
                this.mixer = null;
            }
            
            const loader = new THREE.GLTFLoader();
            
            try {
                const gltf = await new Promise((resolve, reject) => {
                    loader.load(
                        animUrl,
                        resolve,
                        (progress) => {
                            console.log('动画加载进度:', (progress.loaded / progress.total * 100).toFixed(1) + '%');
                        },
                        reject
                    );
                });
                
                console.log('[AIFactoryPlayer] 动画加载成功:', gltf);
                
                // 如果有动画
                if (gltf.animations && gltf.animations.length > 0) {
                    // 如果有模型，创建动画混合器
                    if (this.currentModel) {
                        this.mixer = new THREE.AnimationMixer(this.currentModel);
                        
                        // 使用第一个动画
                        const animation = gltf.animations[0];
                        const action = this.mixer.clipAction(animation);
                        
                        // 设置循环模式
                        action.setLoop(THREE.LoopOnce);
                        action.clampWhenFinished = true;
                        
                        // 保存当前动画引用
                        this.currentAnimation = action;
                        
                        // 动画播放完毕回调
                        this.mixer.addEventListener('finished', (e) => {
                            if (e.action === action) {
                                console.log('[AIFactoryPlayer] 动画播放完毕:', motionKey);
                                // 播放完毕后切换回待机动画
                                if (this.idleAction) {
                                    this.idleAction.reset().play();
                                }
                            }
                        });
                        
                        console.log('[AIFactoryPlayer] 动画已设置，当前模型:', this.currentModel.type);
                    } else {
                        console.warn('[AIFactoryPlayer] 没有模型，无法应用动画');
                    }
                } else {
                    console.warn('[AIFactoryPlayer] GLB文件中没有动画数据');
                }
                
                showToast('动作加载成功');
                
            } catch (error) {
                console.error('[AIFactoryPlayer] 动画加载失败:', error);
                showToast('动作加载失败', 'error');
            }
        },
        
        /**
         * 加载带动画的完整角色模型
         */
        loadModelWithAnimations(url, onLoaded) {
            if (!url) return;
            
            const loader = new THREE.GLTFLoader();
            
            loader.load(
                url,
                (gltf) => {
                    console.log('[AIFactoryPlayer] 模型加载成功:', url);
                    
                    // 移除旧模型
                    if (this.currentModel) {
                        this.scene.remove(this.currentModel);
                    }
                    
                    const model = gltf.scene;
                    
                    // 计算边界并居中
                    const box = new THREE.Box3().setFromObject(model);
                    const center = box.getCenter(new THREE.Vector3());
                    const size = box.getSize(new THREE.Vector3());
                    
                    // 缩放
                    const maxDim = Math.max(size.x, size.y, size.z);
                    const scale = 2 / maxDim;
                    model.scale.setScalar(scale);
                    
                    // 调整位置
                    model.position.x = -center.x * scale;
                    model.position.z = -center.z * scale;
                    const boxBottom = box.min.y * scale;
                    model.position.y = -boxBottom;
                    
                    // 启用阴影
                    model.traverse((child) => {
                        if (child.isMesh) {
                            child.castShadow = true;
                            child.receiveShadow = true;
                        }
                    });
                    
                    this.currentModel = model;
                    this.scene.add(model);
                    
                    // 居中相机
                    this.controls.target.set(0, size.y * scale / 2, 0);
                    
                    // 创建动画混合器
                    if (gltf.animations && gltf.animations.length > 0) {
                        this.mixer = new THREE.AnimationMixer(model);
                        
                        // 找到待机动画并播放
                        const idleAnim = gltf.animations.find(a => 
                            a.name.toLowerCase().includes('idle') || 
                            a.name.toLowerCase().includes('待机')
                        );
                        
                        if (idleAnim) {
                            this.idleAction = this.mixer.clipAction(idleAnim);
                            this.idleAction.play();
                            console.log('[AIFactoryPlayer] 播放待机动画:', idleAnim.name);
                        } else {
                            // 播放第一个动画
                            this.idleAction = this.mixer.clipAction(gltf.animations[0]);
                            this.idleAction.play();
                            console.log('[AIFactoryPlayer] 播放动画:', gltf.animations[0].name);
                        }
                        
                        this.isPlaying = true;
                    }
                    
                    showToast('模型加载成功');
                    
                    if (onLoaded) onLoaded(gltf);
                },
                (progress) => {
                    console.log('加载进度:', (progress.loaded / progress.total * 100).toFixed(1) + '%');
                },
                (error) => {
                    console.error('[AIFactoryPlayer] 模型加载失败:', error);
                    this.createDemoCharacter();
                }
            );
        },
        
        /**
         * 播放动作
         */
        playAnimation() {
            if (!this.currentModel) {
                showToast('请先加载模型');
                return;
            }
            
            this.isPlaying = true;
            
            // 触发播放事件
            const event = new CustomEvent('playanimation');
            document.dispatchEvent(event);
        },
        
        /**
         * 暂停动作
         */
        pauseAnimation() {
            this.isPlaying = false;
        },
        
        /**
         * 停止动作
         */
        stopAnimation() {
            this.isPlaying = false;
            this.animationTime = 0;
            
            if (this.mixer) {
                this.mixer.setTime(0);
            }
        },
        
        /**
         * 切换循环
         */
        toggleLoop() {
            this.isLooping = !this.isLooping;
            
            const btn = document.getElementById('btn-loop');
            if (btn) {
                btn.classList.toggle('active', this.isLooping);
            }
            
            if (this.currentAnimation) {
                this.currentAnimation.loop = this.isLooping;
            }
        },
        
        /**
         * 设置播放速度
         */
        setAnimationSpeed(speed) {
            this.playbackSpeed = parseFloat(speed);
            
            if (this.mixer) {
                this.mixer.timeScale = this.playbackSpeed;
            }
        },
        
        /**
         * 重置相机
         */
        resetCamera() {
            this.camera.position.set(0, 1.5, 3);
            this.controls.target.set(0, 1, 0);
            this.controls.update();
        },
        
        /**
         * 切换网格显示
         */
        toggleGrid() {
            if (this.gridHelper) {
                this.gridHelper.visible = !this.gridHelper.visible;
            }
        },
        
        /**
         * 窗口大小变化
         */
        onResize() {
            const container = document.getElementById('preview-canvas');
            if (!container) return;
            
            const width = container.clientWidth;
            const height = container.clientHeight;
            
            this.camera.aspect = width / height;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(width, height);
        },
        
        /**
         * 渲染循环
         */
        animate() {
            requestAnimationFrame(() => this.animate());
            
            // 更新控制器
            if (this.controls) {
                this.controls.update();
            }
            
            // 更新动画混合器
            if (this.mixer && this.isPlaying) {
                const delta = this.clock.getDelta();
                this.mixer.update(delta * this.playbackSpeed);
            }
            
            // 渲染场景
            if (this.renderer && this.scene && this.camera) {
                this.renderer.render(this.scene, this.camera);
            }
        }
    };
    
    // ===== 播放控制函数（供HTML调用）=====
    
    window.playAnimation = function() {
        if (window.AIFactoryPlayer) {
            window.AIFactoryPlayer.playAnimation();
        }
    };
    
    window.pauseAnimation = function() {
        if (window.AIFactoryPlayer) {
            window.AIFactoryPlayer.pauseAnimation();
        }
    };
    
    window.stopAnimation = function() {
        if (window.AIFactoryPlayer) {
            window.AIFactoryPlayer.stopAnimation();
        }
    };
    
    window.toggleLoop = function() {
        if (window.AIFactoryPlayer) {
            window.AIFactoryPlayer.toggleLoop();
        }
    };
    
    window.setAnimationSpeed = function(speed) {
        if (window.AIFactoryPlayer) {
            window.AIFactoryPlayer.setAnimationSpeed(speed);
        }
    };
    
    window.resetCamera = function() {
        if (window.AIFactoryPlayer) {
            window.AIFactoryPlayer.resetCamera();
        }
    };
    
    window.toggleGrid = function() {
        if (window.AIFactoryPlayer) {
            window.AIFactoryPlayer.toggleGrid();
        }
    };
    
    // ===== 初始化 =====
    document.addEventListener('DOMContentLoaded', () => {
        // 等待Three.js加载
        if (typeof THREE === 'undefined') {
            console.error('Three.js 未加载');
            return;
        }
        
        // 延迟初始化，确保DOM已就绪
        setTimeout(() => {
            if (window.AIFactoryPlayer) {
                window.AIFactoryPlayer.init();
            }
        }, 100);
    });
    
})();
