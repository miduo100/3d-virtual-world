// 性能优化和资源管理模块

/**
 * 性能监控对象
 */
const performanceMonitor = {
    startTime: Date.now(),
    frameCount: 0,
    lastFrameTime: 0,
    fps: 0,
    
    /**
     * 更新性能监控
     */
    update() {
        this.frameCount++;
        const now = Date.now();
        if (now - this.lastFrameTime >= 1000) {
            this.fps = this.frameCount;
            this.frameCount = 0;
            this.lastFrameTime = now;
            // 可以在这里添加性能报警逻辑
            if (this.fps < 30) {
                console.warn(`⚠️ 性能警告：FPS = ${this.fps}`);
            }
        }
    },
    
    /**
     * 获取当前FPS
     * @returns {number} 当前FPS值
     */
    getFPS() {
        return this.fps;
    }
};

/**
 * 资源管理器
 */
const resourceManager = {
    resources: new Map(),
    loading: new Map(),
    
    /**
     * 加载模型资源
     * @param {string} url - 资源URL
     * @param {Function} onLoad - 加载完成回调
     * @param {Function} onProgress - 进度回调
     * @param {Function} onError - 错误回调
     */
    loadModel(url, onLoad, onProgress, onError) {
        if (this.resources.has(url)) {
            // 资源已加载，直接返回
            onLoad(this.resources.get(url));
            return;
        }
        
        if (this.loading.has(url)) {
            // 资源正在加载，添加回调
            const callbacks = this.loading.get(url);
            callbacks.push({ onLoad, onProgress, onError });
            return;
        }
        
        // 开始加载
        this.loading.set(url, [{ onLoad, onProgress, onError }]);
        
        const loader = new THREE.GLTFLoader();
        loader.load(
            url,
            (gltf) => {
                // 缓存资源
                this.resources.set(url, gltf);
                
                // 调用所有回调
                const callbacks = this.loading.get(url);
                callbacks.forEach(callback => {
                    if (callback.onLoad) {
                        callback.onLoad(gltf);
                    }
                });
                
                this.loading.delete(url);
            },
            (progress) => {
                const callbacks = this.loading.get(url);
                callbacks.forEach(callback => {
                    if (callback.onProgress) {
                        callback.onProgress(progress);
                    }
                });
            },
            (error) => {
                console.error('加载模型失败:', error);
                const callbacks = this.loading.get(url);
                callbacks.forEach(callback => {
                    if (callback.onError) {
                        callback.onError(error);
                    }
                });
                this.loading.delete(url);
            }
        );
    },
    
    /**
     * 释放资源
     * @param {string} url - 资源URL
     */
    releaseResource(url) {
        if (this.resources.has(url)) {
            const resource = this.resources.get(url);
            if (resource.scene) {
                // 递归释放场景中的所有材质和纹理
                resource.scene.traverse((object) => {
                    if (object.material) {
                        if (Array.isArray(object.material)) {
                            object.material.forEach(material => {
                                if (material.map) material.map.dispose();
                                if (material.normalMap) material.normalMap.dispose();
                                if (material.specularMap) material.specularMap.dispose();
                                material.dispose();
                            });
                        } else {
                            if (object.material.map) object.material.map.dispose();
                            if (object.material.normalMap) object.material.normalMap.dispose();
                            if (object.material.specularMap) object.material.specularMap.dispose();
                            object.material.dispose();
                        }
                    }
                });
            }
            this.resources.delete(url);
        }
    },
    
    /**
     * 清理所有资源
     */
    clear() {
        this.resources.forEach((resource, url) => {
            this.releaseResource(url);
        });
        this.resources.clear();
    }
};

/**
 * 场景优化器
 */
const sceneOptimizer = {
    /**
     * 优化场景
     * @param {THREE.Scene} scene - Three.js场景
     */
    optimizeScene(scene) {
        // 合并几何体
        this.mergeGeometries(scene);
        
        // 优化材质
        this.optimizeMaterials(scene);
        
        // 设置LOD (Level of Detail)
        this.setupLOD(scene);
    },
    
    /**
     * 合并几何体
     * @param {THREE.Scene} scene - Three.js场景
     */
    mergeGeometries(scene) {
        const meshesByMaterial = new Map();
        
        // 收集相同材质的网格
        scene.traverse((object) => {
            if (object.isMesh) {
                const materialKey = object.material.uuid;
                if (!meshesByMaterial.has(materialKey)) {
                    meshesByMaterial.set(materialKey, []);
                }
                meshesByMaterial.get(materialKey).push(object);
            }
        });
        
        // 合并相同材质的网格
        meshesByMaterial.forEach((meshes, materialKey) => {
            if (meshes.length > 1) {
                const material = meshes[0].material;
                const geometries = [];
                const matrixes = [];
                
                meshes.forEach(mesh => {
                    geometries.push(mesh.geometry);
                    matrixes.push(mesh.matrix);
                    scene.remove(mesh);
                });
                
                try {
                    const mergedGeometry = BufferGeometryUtils.mergeBufferGeometries(geometries, true);
                    const mergedMesh = new THREE.Mesh(mergedGeometry, material);
                    scene.add(mergedMesh);
                    console.log(`✅ 合并了 ${meshes.length} 个网格`);
                } catch (error) {
                    console.warn('合并几何体失败:', error);
                    // 如果合并失败，重新添加原始网格
                    meshes.forEach(mesh => scene.add(mesh));
                }
            }
        });
    },
    
    /**
     * 优化材质
     * @param {THREE.Scene} scene - Three.js场景
     */
    optimizeMaterials(scene) {
        const materials = new Map();
        
        scene.traverse((object) => {
            if (object.isMesh) {
                const materialKey = JSON.stringify(object.material.toJSON());
                if (!materials.has(materialKey)) {
                    materials.set(materialKey, object.material);
                } else {
                    // 使用共享材质
                    object.material = materials.get(materialKey);
                }
            }
        });
        
        console.log(`✅ 优化材质，共享了 ${materials.size} 种材质`);
    },
    
    /**
     * 设置LOD
     * @param {THREE.Scene} scene - Three.js场景
     */
    setupLOD(scene) {
        // 这里可以实现LOD逻辑
        // 例如根据相机距离自动切换模型细节
    }
};

/**
 * 内存管理
 */
const memoryManager = {
    /**
     * 清理未使用的对象
     * @param {THREE.Scene} scene - Three.js场景
     */
    cleanupUnusedObjects(scene) {
        const objectsToRemove = [];
        
        scene.traverse((object) => {
            // 这里可以添加清理逻辑
            // 例如移除不可见的对象
        });
        
        objectsToRemove.forEach(object => scene.remove(object));
    },
    
    /**
     * 检查内存使用情况
     */
    checkMemoryUsage() {
        if (performance && performance.memory) {
            const memory = performance.memory;
            console.log('内存使用情况:', {
                used: (memory.usedJSHeapSize / 1024 / 1024).toFixed(2) + 'MB',
                total: (memory.totalJSHeapSize / 1024 / 1024).toFixed(2) + 'MB',
                limit: (memory.jsHeapSizeLimit / 1024 / 1024).toFixed(2) + 'MB'
            });
        }
    }
};

/**
 * 初始化性能优化
 * @param {THREE.Scene} scene - Three.js场景
 * @param {THREE.WebGLRenderer} renderer - Three.js渲染器
 */
function initPerformanceOptimization(scene, renderer) {
    // 启用抗锯齿
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    
    // 启用阴影贴图
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    
    // 启用自动垃圾回收
    renderer.setAnimationLoop(() => {
        performanceMonitor.update();
        // 每60帧检查一次内存
        if (performanceMonitor.frameCount % 60 === 0) {
            memoryManager.checkMemoryUsage();
        }
    });
    
    console.log('✅ 性能优化初始化完成');
}

// 导出函数
window.performanceMonitor = performanceMonitor;
window.resourceManager = resourceManager;
window.sceneOptimizer = sceneOptimizer;
window.memoryManager = memoryManager;
window.initPerformanceOptimization = initPerformanceOptimization;