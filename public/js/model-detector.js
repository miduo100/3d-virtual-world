/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
// 角色模型显示问题检测工具
class ModelDetector {
    constructor(world) {
        this.world = world;
        this.detectionResults = [];
        this.initialized = false;
    }

    // 初始化检测工具
    init() {
        if (this.initialized) return;
        
        console.log('🔍 角色模型检测工具初始化');
        this.initialized = true;
        
        // 监听模型加载事件
        this.setupEventListeners();
        
        // 添加检测按钮到页面
        this.addDetectionButton();
    }

    // 设置事件监听器
    setupEventListeners() {
        // 监听模型加载完成事件
        if (window.addEventListener) {
            window.addEventListener('modelLoaded', (e) => {
                this.onModelLoaded(e.detail);
            });
        }
    }

    // 模型加载完成回调
    onModelLoaded(modelData) {
        console.log('🔍 检测到模型加载完成:', modelData);
        this.detectModelIssues(modelData.characterId);
    }

    // 添加检测按钮
    addDetectionButton() {
        const button = document.createElement('button');
        button.id = 'model-detect-btn';
        button.textContent = '检测角色模型';
        button.style.position = 'fixed';
        button.style.top = '10px';
        button.style.right = '10px';
        button.style.padding = '10px';
        button.style.backgroundColor = '#4CAF50';
        button.style.color = 'white';
        button.style.border = 'none';
        button.style.borderRadius = '5px';
        button.style.cursor = 'pointer';
        button.style.zIndex = '1000';
        
        button.addEventListener('click', () => {
            this.runFullDetection();
        });
        
        document.body.appendChild(button);
    }

    // 运行完整检测
    runFullDetection() {
        console.log('🔍 开始完整角色模型检测');
        this.detectionResults = [];
        
        // 检测所有玩家角色
        this.world.players.forEach((playerData, characterId) => {
            this.detectModelIssues(characterId);
        });
        
        // 显示检测结果
        this.showDetectionResults();
    }

    // 检测模型问题
    detectModelIssues(characterId) {
        const playerData = this.world.players.get(characterId);
        if (!playerData) {
            console.warn(`🔍 未找到角色 ${characterId}`);
            return;
        }

        const result = {
            characterId,
            characterName: playerData.name,
            timestamp: new Date().toISOString(),
            issues: [],
            details: {}
        };

        // 检测1: 模型是否存在
        if (!playerData.group) {
            result.issues.push('角色组不存在');
        } else {
            result.details.groupExists = true;
            
            // 检测2: GLB模型是否加载
            const glbModel = playerData.group.userData.glbModel;
            if (!glbModel) {
                result.issues.push('GLB模型未加载');
            } else {
                result.details.glbModelExists = true;
                
                // 检测3: 模型可见性
                if (!glbModel.visible) {
                    result.issues.push('模型可见性为false');
                } else {
                    result.details.visible = true;
                }
                
                // 检测4: 模型位置
                const position = glbModel.position;
                result.details.position = {
                    x: position.x,
                    y: position.y,
                    z: position.z
                };
                
                // 检测5: 模型缩放
                const scale = glbModel.scale;
                result.details.scale = {
                    x: scale.x,
                    y: scale.y,
                    z: scale.z
                };
                
                // 检测6: 模型是否在场景中
                let inScene = false;
                let current = glbModel.parent;
                while (current) {
                    if (current === this.world.scene) {
                        inScene = true;
                        break;
                    }
                    current = current.parent;
                }
                
                if (!inScene) {
                    result.issues.push('模型不在场景层次结构中');
                } else {
                    result.details.inScene = true;
                }
                
                // 检测7: 模型材质
                let materialIssues = [];
                glbModel.traverse((child) => {
                    if (child.isMesh) {
                        if (!child.material) {
                            materialIssues.push(`Mesh ${child.name} 无材质`);
                        } else {
                            if (child.material.visible === false) {
                                materialIssues.push(`Mesh ${child.name} 材质可见性为false`);
                            }
                            if (child.material.opacity < 0.1) {
                                materialIssues.push(`Mesh ${child.name} 材质透明度过低`);
                            }
                        }
                    }
                });
                
                if (materialIssues.length > 0) {
                    result.issues.push(...materialIssues);
                }
            }
        }

        // 检测8: 网络请求状态
        this.checkNetworkRequests(characterId, result);

        this.detectionResults.push(result);
        return result;
    }

    // 检查网络请求
    checkNetworkRequests(characterId, result) {
        // 模拟网络请求检查
        // 实际项目中可以通过Performance API或网络监控工具获取
        result.details.network = {
            checked: true,
            status: '模拟检查完成'
        };
    }

    // 显示检测结果
    showDetectionResults() {
        // 创建结果面板
        let panel = document.getElementById('model-detection-panel');
        if (!panel) {
            panel = document.createElement('div');
            panel.id = 'model-detection-panel';
            panel.style.position = 'fixed';
            panel.style.top = '50px';
            panel.style.right = '10px';
            panel.style.width = '400px';
            panel.style.maxHeight = '600px';
            panel.style.overflowY = 'auto';
            panel.style.backgroundColor = 'white';
            panel.style.border = '1px solid #ddd';
            panel.style.borderRadius = '5px';
            panel.style.padding = '15px';
            panel.style.zIndex = '1000';
            panel.style.boxShadow = '0 0 10px rgba(0,0,0,0.1)';
            document.body.appendChild(panel);
        }

        // 生成结果HTML
        let html = '<h3>角色模型检测结果</h3>';
        
        this.detectionResults.forEach((result, index) => {
            html += `<div style="margin: 10px 0; padding: 10px; border: 1px solid #eee; border-radius: 5px;">
                <h4>角色: ${result.characterName} (${result.characterId})</h4>
                <p><strong>检测时间:</strong> ${new Date(result.timestamp).toLocaleString()}</p>
            `;
            
            if (result.issues.length > 0) {
                html += `<div style="background-color: #f8d7da; padding: 10px; border-radius: 4px; margin: 10px 0;">
                    <h5 style="margin-top: 0; color: #721c24;">发现问题:</h5>
                    <ul style="margin: 5px 0;">
                `;
                result.issues.forEach(issue => {
                    html += `<li>${issue}</li>`;
                });
                html += `</ul></div>`;
            } else {
                html += `<div style="background-color: #d4edda; padding: 10px; border-radius: 4px; margin: 10px 0;">
                    <p style="margin: 0; color: #155724;">✅ 未发现问题</p>
                </div>`;
            }
            
            html += `<div style="margin: 10px 0;">
                <h5>详细信息:</h5>
                <pre style="background-color: #f8f9fa; padding: 10px; border-radius: 4px; font-size: 12px; white-space: pre-wrap;">
                    ${JSON.stringify(result.details, null, 2)}
                </pre>
            </div></div>`;
        });
        
        html += `<button id="close-detection-panel" style="margin-top: 10px; padding: 5px 10px; background-color: #6c757d; color: white; border: none; border-radius: 4px; cursor: pointer;">关闭</button>`;
        
        panel.innerHTML = html;
        
        // 添加关闭按钮事件
        document.getElementById('close-detection-panel').addEventListener('click', () => {
            panel.style.display = 'none';
        });
        
        // 显示面板
        panel.style.display = 'block';
        
        // 同时在控制台输出结果
        console.log('🔍 角色模型检测结果:', this.detectionResults);
    }

    // 导出检测结果
    exportResults() {
        const dataStr = JSON.stringify(this.detectionResults, null, 2);
        const dataBlob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(dataBlob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `model-detection-results-${new Date().toISOString().split('T')[0]}.json`;
        link.click();
        URL.revokeObjectURL(url);
    }
}

// 导出到全局作用域
if (typeof window !== 'undefined') {
    window.ModelDetector = ModelDetector;
}

// 自动初始化
window.addEventListener('load', () => {
    setTimeout(() => {
        if (window.world) {
            window.modelDetector = new ModelDetector(window.world);
            window.modelDetector.init();
            console.log('🔍 角色模型检测工具已自动初始化');
        }
    }, 1000);
});