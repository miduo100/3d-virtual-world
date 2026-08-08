/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
/**
 * GLB 纹理修复工具
 * 智能检测并修复外部纹理 URI 问题
 * 方案：智能路径 + fetch 下载 + 优雅降级
 */

(function() {
    'use strict';

    // ===== 纹理修复器类 =====
    class GLBTextureFixer {
        constructor() {
            this.textureCache = new Map();
            this.downloadQueue = [];
            this.isProcessing = false;
            this.maxConcurrent = 3; // 最大并发下载数
        }

        /**
         * 检测 GLB 文件中的外部纹理
         * @param {ArrayBuffer} buffer - GLB 文件数据
         * @param {string} baseUrl - 模型基础 URL（用于解析相对路径）
         * @returns {Object} 检测结果
         */
        async analyzeGLB(buffer, baseUrl) {
            const result = {
                hasExternalTextures: false,
                images: [],
                buffers: [],
                issues: []
            };

            try {
                const dataView = new DataView(buffer);
                
                // 解析 GLB Header
                const magic = dataView.getUint32(0, true);
                if (magic !== 0x46546C67) { // 'glTF' in little-endian
                    throw new Error('Invalid GLB file');
                }

                const version = dataView.getUint32(4, true);
                const length = dataView.getUint32(8, true);

                // GLB 1.0 结构
                if (version === 1) {
                    // 找到 JSON chunk
                    const jsonChunkLength = dataView.getUint32(12, true);
                    const jsonChunkType = dataView.getUint32(16, true);
                    
                    if (jsonChunkType === 0x4E4F534A) { // 'JSON'
                        const jsonData = new Uint8Array(buffer, 20, jsonChunkLength);
                        const jsonText = new TextDecoder().decode(jsonData);
                        const gltf = JSON.parse(jsonText);

                        // 分析 images
                        if (gltf.images) {
                            for (let i = 0; i < gltf.images.length; i++) {
                                const image = gltf.images[i];
                                const imageInfo = {
                                    index: i,
                                    uri: image.uri || null,
                                    bufferView: image.bufferView || null,
                                    mimeType: image.mimeType || 'image/png',
                                    name: image.name || `image_${i}`,
                                    isExternal: false,
                                    resolvedUrl: null
                                };

                                if (image.uri && !image.uri.startsWith('data:')) {
                                    // 外部 URI
                                    imageInfo.isExternal = true;
                                    imageInfo.resolvedUrl = this.resolveUrl(image.uri, baseUrl);
                                    result.hasExternalTextures = true;
                                    result.issues.push({
                                        type: 'external_uri',
                                        imageIndex: i,
                                        originalUri: image.uri,
                                        resolvedUrl: imageInfo.resolvedUrl
                                    });
                                }

                                result.images.push(imageInfo);
                            }
                        }

                        // 分析 buffers
                        if (gltf.buffers) {
                            result.buffers = gltf.buffers.map((buf, i) => ({
                                index: i,
                                uri: buf.uri || null,
                                byteLength: buf.byteLength || 0,
                                isExternal: buf.uri && !buf.uri.startsWith('data:')
                            }));
                        }

                        // 分析 textures
                        if (gltf.textures) {
                            result.textures = gltf.textures.map((tex, i) => ({
                                index: i,
                                source: tex.source,
                                sampler: tex.sampler
                            }));
                        }
                    }
                }

            } catch (error) {
                result.error = error.message;
                console.error('[GLBTextureFixer] 分析失败:', error);
            }

            return result;
        }

        /**
         * 解析 URL（支持相对路径）
         */
        resolveUrl(uri, baseUrl) {
            if (!uri) return null;
            
            // 已经是绝对 URL
            if (uri.startsWith('http://') || uri.startsWith('https://')) {
                return uri;
            }

            // data: URL 保持原样
            if (uri.startsWith('data:')) {
                return uri;
            }

            // 相对路径 - 基于 baseUrl 解析
            try {
                const base = new URL(baseUrl);
                return new URL(uri, base).href;
            } catch {
                // 如果 baseUrl 不是有效 URL，直接拼接
                const basePath = baseUrl.substring(0, baseUrl.lastIndexOf('/') + 1);
                return basePath + uri;
            }
        }

        /**
         * 下载外部纹理
         * @param {string} url - 纹理 URL
         * @param {Function} onProgress - 进度回调
         * @returns {Promise<string>} base64 data URL
         */
        async downloadTexture(url, onProgress) {
            // 检查缓存
            if (this.textureCache.has(url)) {
                return this.textureCache.get(url);
            }

            try {
                console.log('[GLBTextureFixer] 下载纹理:', url);
                
                const response = await fetch(url, {
                    mode: 'cors',
                    credentials: 'omit'
                });

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }

                const blob = await response.blob();
                const arrayBuffer = await blob.arrayBuffer();

                // 转换为 base64
                const base64 = await this.blobToBase64(blob);
                const dataUrl = `data:${blob.type || 'image/png'};base64,${base64}`;

                // 缓存
                this.textureCache.set(url, dataUrl);

                if (onProgress) {
                    onProgress({ url, success: true });
                }

                return dataUrl;

            } catch (error) {
                console.warn('[GLBTextureFixer] 纹理下载失败:', url, error);
                
                if (onProgress) {
                    onProgress({ url, success: false, error: error.message });
                }

                return null;
            }
        }

        /**
         * Blob 转 Base64
         */
        blobToBase64(blob) {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => {
                    // 移除 data:...;base64, 前缀
                    const base64 = reader.result.split(',')[1];
                    resolve(base64);
                };
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            });
        }

        /**
         * 下载所有外部纹理
         * @param {Object} analysis - 分析结果
         * @param {Function} onProgress - 进度回调
         * @returns {Promise<Map>} imageIndex -> dataUrl
         */
        async downloadAllTextures(analysis, onProgress) {
            const results = new Map();
            const externalImages = analysis.images.filter(img => img.isExternal);

            if (externalImages.length === 0) {
                return results;
            }

            console.log(`[GLBTextureFixer] 需要下载 ${externalImages.length} 个外部纹理`);

            let completed = 0;
            const total = externalImages.length;

            // 并发下载
            const downloadTasks = externalImages.map(async (img) => {
                const dataUrl = await this.downloadTexture(img.resolvedUrl, (progress) => {
                    if (onProgress) {
                        onProgress({
                            current: ++completed,
                            total,
                            url: progress.url,
                            success: progress.success,
                            error: progress.error
                        });
                    }
                });

                if (dataUrl) {
                    results.set(img.index, dataUrl);
                }

                return { index: img.index, dataUrl };
            });

            await Promise.allSettled(downloadTasks);

            return results;
        }

        /**
         * 修复 GLB 数据中的外部纹理
         * 将外部 URI 替换为内嵌的 base64 data URL
         * @param {ArrayBuffer} buffer - GLB 原始数据
         * @param {Map} textureReplacements - imageIndex -> dataUrl
         * @returns {ArrayBuffer} 修复后的 GLB 数据
         */
        fixGLB(buffer, textureReplacements) {
            if (textureReplacements.size === 0) {
                return buffer;
            }

            // 复制原始数据
            const result = new Uint8Array(buffer);
            
            // 找到 JSON chunk
            const dataView = new DataView(result.buffer);
            const jsonChunkLength = dataView.getUint32(12, true);
            const jsonChunkType = dataView.getUint32(16, true);
            
            if (jsonChunkType !== 0x4E4F534A) {
                console.warn('[GLBTextureFixer] 找不到 JSON chunk');
                return buffer;
            }

            // 解析 JSON
            const jsonOffset = 20;
            const jsonData = result.slice(jsonOffset, jsonOffset + jsonChunkLength);
            const jsonText = new TextDecoder().decode(jsonData);
            const gltf = JSON.parse(jsonText);

            // 替换 external URI
            let modified = false;
            if (gltf.images) {
                gltf.images.forEach((img, index) => {
                    if (img.uri && !img.uri.startsWith('data:') && textureReplacements.has(index)) {
                        img.uri = textureReplacements.get(index);
                        modified = true;
                        console.log(`[GLBTextureFixer] 替换图像 ${index} 的 URI`);
                    }
                });
            }

            if (!modified) {
                return buffer;
            }

            // 重新序列化为 JSON
            const newJsonText = JSON.stringify(gltf);
            const newJsonBytes = new TextEncoder().encode(newJsonText);
            
            // 计算填充（4字节对齐）
            const padding = (4 - (newJsonBytes.length % 4)) % 4;
            const paddedLength = newJsonBytes.length + padding;
            
            // 重建 GLB
            const totalLength = 12 + 8 + paddedLength + 8 + this.getBinaryChunkLength(result);
            const newBuffer = new ArrayBuffer(totalLength);
            const newView = new Uint8Array(newBuffer);
            const newDataView = new DataView(newBuffer);

            // Header
            newDataView.setUint32(0, 0x46546C67, true); // 'glTF'
            newDataView.setUint32(4, 2, true); // version 2
            newDataView.setUint32(8, totalLength, true); // total length

            // JSON chunk header
            newDataView.setUint32(12, paddedLength, true);
            newDataView.setUint32(16, 0x4E4F534A, true); // 'JSON'

            // JSON chunk data
            newView.set(newJsonBytes, 20);
            
            // 复制二进制 chunk（如果有）
            let binaryOffset = 20 + paddedLength;
            const binaryLength = this.getBinaryChunkLength(result);
            if (binaryLength > 0) {
                const binaryChunkOffset = this.findBinaryChunkOffset(result);
                if (binaryChunkOffset >= 0) {
                    newView.set(result.slice(binaryChunkOffset + 8), binaryOffset);
                }
            }

            console.log('[GLBTextureFixer] GLB 重建完成');
            return newBuffer;
        }

        /**
         * 获取二进制 chunk 长度
         */
        getBinaryChunkLength(data) {
            const view = data instanceof DataView ? data : new DataView(data.buffer || data);
            
            // 跳过 header (12) + JSON chunk header (8) + JSON data
            let offset = 20;
            
            // 读取 JSON chunk length
            if (view.byteLength < 20) return 0;
            const jsonLength = view.getUint32(12, true);
            const paddedJsonLength = jsonLength + ((4 - (jsonLength % 4)) % 4);
            offset += 8 + paddedJsonLength;
            
            if (offset + 8 > view.byteLength) return 0;
            
            // 读取二进制 chunk header
            const binLength = view.getUint32(offset, true);
            const binType = view.getUint32(offset + 4, true);
            
            if (binType === 0x004E4942) { // 'BIN\0'
                return 8 + binLength + ((4 - (binLength % 4)) % 4);
            }
            
            return 0;
        }

        /**
         * 查找二进制 chunk 偏移量
         */
        findBinaryChunkOffset(data) {
            const view = data instanceof DataView ? data : new DataView(data.buffer || data);
            let offset = 20;
            
            const jsonLength = view.getUint32(12, true);
            const paddedJsonLength = jsonLength + ((4 - (jsonLength % 4)) % 4);
            offset += 8 + paddedJsonLength;
            
            if (offset + 8 <= view.byteLength) {
                const chunkLength = view.getUint32(offset, true);
                const chunkType = view.getUint32(offset + 4, true);
                if (chunkType === 0x004E4942) {
                    return offset;
                }
            }
            
            return -1;
        }

        /**
         * 生成纯色备用纹理
         * @param {string} color - 颜色值，如 '#808080'
         * @returns {string} base64 data URL
         */
        generateSolidColorTexture(color = '#808080') {
            const canvas = document.createElement('canvas');
            canvas.width = 1;
            canvas.height = 1;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = color;
            ctx.fillRect(0, 0, 1, 1);
            return canvas.toDataURL('image/png');
        }

        /**
         * 清理缓存
         */
        clearCache() {
            this.textureCache.clear();
        }
    }

    // ===== 导出到全局 =====
    window.GLBTextureFixer = GLBTextureFixer;

    // ===== 便捷函数 =====
    window.fixGLBTextures = async function(glbUrl, onProgress) {
        const fixer = new GLBTextureFixer();
        
        try {
            // 1. 获取 GLB 数据
            console.log('[fixGLBTextures] 开始处理:', glbUrl);
            const response = await fetch(glbUrl);
            if (!response.ok) {
                throw new Error(`获取模型失败: ${response.status}`);
            }
            const arrayBuffer = await response.arrayBuffer();

            // 2. 分析 GLB
            const analysis = await fixer.analyzeGLB(arrayBuffer, glbUrl);
            
            if (!analysis.hasExternalTextures) {
                console.log('[fixGLBTextures] 没有外部纹理，无需修复');
                return { 
                    fixed: false, 
                    buffer: arrayBuffer,
                    analysis 
                };
            }

            console.log('[fixGLBTextures] 发现外部纹理:', analysis.issues);

            // 3. 下载所有外部纹理
            const replacements = await fixer.downloadAllTextures(analysis, onProgress);

            // 4. 修复 GLB
            const fixedBuffer = fixer.fixGLB(arrayBuffer, replacements);
            
            const failedCount = analysis.issues.length - replacements.size;
            if (failedCount > 0) {
                console.warn(`[fixGLBTextures] ${failedCount} 个纹理下载失败`);
            }

            return {
                fixed: true,
                buffer: fixedBuffer,
                analysis,
                replacements,
                failedCount
            };

        } catch (error) {
            console.error('[fixGLBTextures] 处理失败:', error);
            return { 
                fixed: false, 
                error: error.message 
            };
        }
    };

    // ===== 诊断工具 =====
    window.analyzeGLBTextures = async function(glbUrl) {
        const fixer = new GLBTextureFixer();
        
        try {
            const response = await fetch(glbUrl);
            const buffer = await response.arrayBuffer();
            const analysis = await fixer.analyzeGLB(buffer, glbUrl);
            
            console.log('========== GLB 纹理分析报告 ==========');
            console.log('模型 URL:', glbUrl);
            console.log('是否有外部纹理:', analysis.hasExternalTextures);
            console.log('图像数量:', analysis.images.length);
            console.log('纹理数量:', analysis.textures?.length || 0);
            console.log('缓冲数量:', analysis.buffers.length);
            
            if (analysis.issues.length > 0) {
                console.log('\n外部纹理列表:');
                analysis.issues.forEach((issue, i) => {
                    console.log(`  ${i + 1}. [${issue.type}] ${issue.originalUri}`);
                    console.log(`     -> ${issue.resolvedUrl}`);
                });
            }
            
            console.log('========================================');
            
            return analysis;
        } catch (error) {
            console.error('[analyzeGLBTextures] 分析失败:', error);
            return null;
        }
    };

    console.log('[GLBTextureFixer] 模块已加载');

})();
