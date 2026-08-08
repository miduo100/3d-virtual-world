// AI预览面板相关功能

let previewChatHistory = [];
let previewMode = 'threejs'; // 'threejs' | 'model-first'

function confirmAIPreviewScene() {
    const panel = document.getElementById('ai-preview-panel');
    if (!panel) return;

    // 关闭预览面板
    closeAIPreviewPanel();

    // 播放成功声音
    playSound('success');

    // 显示成功通知
    showNotification('✅ 场景已确认添加到编辑器', 'success');
}

function closeAIPreviewPanel() {
    const panel = document.getElementById('ai-preview-panel');
    if (panel) {
        panel.remove();
    }
}

async function sendAIPreviewMessage() {
    const input = document.getElementById('ai-preview-input');
    const message = input.value.trim();
    if (!message) return;

    const chatHistory = document.getElementById('ai-preview-chat-history');
    const sendBtn = document.getElementById('ai-preview-send-btn');

    // 显示用户消息
    previewChatHistory.push({ role: 'user', content: message });
    _renderPreviewChatHistory();

    // 清空输入框
    input.value = '';

    // 禁用发送按钮
    if (sendBtn) {
        sendBtn.disabled = true;
        sendBtn.textContent = 'AI思考中...';
    }

    try {
        const panel = document.getElementById('ai-preview-panel');
        const description = panel.dataset.sceneDescription || '';
        const currentCode = panel.dataset.currentCode;
        const currentLayout = panel.dataset.currentLayout;
        const currentConfig = panel.dataset.currentConfig;

        const response = await fetch(`${API_BASE_AI}/adjust-scene`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                description,
                adjustment: message,
                provider: selectedSceneProvider,
                generation_mode: selectedGenerationMode,
                current_code: currentCode,
                current_layout: currentLayout ? JSON.parse(currentLayout) : null,
                current_config: currentConfig ? JSON.parse(currentConfig) : null
            })
        });

        const data = await response.json();

        if (data.success) {
            // 显示AI回复
            previewChatHistory.push({ role: 'assistant', content: data.response });
            _renderPreviewChatHistory();

            // 更新场景
            if (data.updated_code) {
                // Three.js模式
                panel.dataset.currentCode = data.updated_code;
                _renderThreejsInPreview(data.updated_code);
            } else if (data.updated_layout && data.updated_config) {
                // 模型库优先模式
                panel.dataset.currentLayout = JSON.stringify(data.updated_layout);
                panel.dataset.currentConfig = JSON.stringify(data.updated_config);
                await renderScene(data.updated_layout, data.updated_config);
            }
        } else {
            throw new Error(data.error || '调整失败');
        }
    } catch (error) {
        console.error('发送消息失败:', error);
        let errorMessage = `调整失败: ${error.message}`;
        if (error.name === 'AbortError') {
            errorMessage = '请求超时，请检查网络连接';
        } else if (error.message.includes('404')) {
            errorMessage = 'API端点不存在，请检查服务器配置';
        } else if (error.message.includes('500')) {
            errorMessage = '服务器内部错误，请稍后重试';
        } else if (error.message.includes('NetworkError')) {
            errorMessage = '网络连接错误，请检查网络设置';
        }
        previewChatHistory.push({ role: 'assistant', content: `❌ ${errorMessage}` });
        _renderPreviewChatHistory();
    } finally {
        if (sendBtn) {
            sendBtn.disabled = false;
            sendBtn.textContent = '发送修改 (Ctrl+Enter)';
        }
    }
}

function _renderPreviewChatHistory() {
    const chatHistory = document.getElementById('ai-preview-chat-history');
    if (!chatHistory) return;

    chatHistory.innerHTML = previewChatHistory.map(msg => {
        const isUser = msg.role === 'user';
        return `
            <div style="display:flex;${isUser ? 'justify-content:flex-end' : ''};">
                <div style="
                    max-width:80%;
                    padding:10px 14px;
                    border-radius:12px;
                    ${isUser ? 'background:#667eea;color:white;' : 'background:#1c2030;color:#e6edf3;'}
                    margin-bottom:8px;
                ">
                    ${msg.content}
                </div>
            </div>
        `;
    }).join('');

    // 滚动到底部
    chatHistory.scrollTop = chatHistory.scrollHeight;
}

function _renderThreejsInPreview(threejsCode) {
    const previewArea = document.getElementById('ai-preview-area');
    if (!previewArea) return;

    previewArea.innerHTML = `
        <div style="width:100%;height:100%;position:relative;">
            <div id="threejs-preview-container" style="width:100%;height:100%;"></div>
            <div style="position:absolute;top:10px;right:10px;background:rgba(0,0,0,0.7);color:white;padding:5px 10px;border-radius:6px;font-size:11px;">
                Three.js 预览
            </div>
        </div>
    `;

    // 创建临时脚本执行Three.js代码
    const container = document.getElementById('threejs-preview-container');
    if (container) {
        try {
            // 创建临时场景
            const tempScene = new THREE.Scene();
            const tempCamera = new THREE.PerspectiveCamera(60, container.clientWidth / container.clientHeight, 0.1, 1000);
            const tempRenderer = new THREE.WebGLRenderer({ antialias: true });
            tempRenderer.setSize(container.clientWidth, container.clientHeight);
            container.appendChild(tempRenderer.domElement);

            // 执行Three.js代码
            const execCode = `
                (function() {
                    const scene = tempScene;
                    const camera = tempCamera;
                    const renderer = tempRenderer;
                    ${threejsCode}
                })();
            `;
            eval(execCode);

            // 添加基本光照
            const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
            tempScene.add(ambientLight);
            const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
            directionalLight.position.set(50, 100, 50);
            tempScene.add(directionalLight);

            // 添加相机控制
            const tempControls = new THREE.OrbitControls(tempCamera, tempRenderer.domElement);
            tempControls.enableDamping = true;
            tempControls.dampingFactor = 0.05;

            // 动画循环
            function animate() {
                requestAnimationFrame(animate);
                tempControls.update();
                tempRenderer.render(tempScene, tempCamera);
            }
            animate();

        } catch (error) {
            console.error('执行Three.js代码失败:', error);
            previewArea.innerHTML = `
                <div style="display:flex;align-items:center;justify-content:center;height:100%;color:#ff6b6b;">
                    <div style="text-align:center;">
                        <div style="font-size:40px;">⚠️</div>
                        <div>Three.js代码执行失败</div>
                        <div style="font-size:12px;margin-top:8px;">${error.message}</div>
                    </div>
                </div>
            `;
        }
    }
}

function _switchPanelToChat(threejsCode, layout, config) {
    const panel = document.getElementById('ai-preview-panel');
    if (!panel) return;

    if (threejsCode) panel.dataset.currentCode = threejsCode;
    if (layout) panel.dataset.currentLayout = JSON.stringify(layout);
    if (config) panel.dataset.currentConfig = JSON.stringify(config);

    // 更新顶部状态
    const statusEl = document.getElementById('ai-preview-status');
    if (statusEl) {
        statusEl.textContent = '对话调整中';
        statusEl.style.color = '#a5b4fc';
    }

    // 显示确认按钮
    const confirmBtn = document.getElementById('ai-preview-confirm-btn');
    if (confirmBtn) {
        confirmBtn.style.display = 'flex';
    }

    // 找到右侧对话区，替换内容
    const chatArea = panel.querySelector('div[style*="width:400px"]');
    if (chatArea) {
        const modeLabel = previewMode === 'threejs' ? '⚡ Three.js 完全生成' : '📦 模型库优先';
        chatArea.innerHTML = `
            <div style="padding:14px 16px 10px;border-bottom:1px solid rgba(102,126,234,0.15);flex-shrink:0;">
                <div style="font-size:14px;font-weight:700;color:#a5b4fc;">🤖 AI对话调整</div>
                <div style="font-size:11px;color:#555;margin-top:3px;">${modeLabel} · 告诉AI如何修改场景</div>
            </div>
            <div id="ai-preview-chat-history" style="flex:1;overflow-y:auto;padding:12px 14px;display:flex;flex-direction:column;gap:10px;"></div>
            <div style="padding:12px 14px;border-top:1px solid rgba(102,126,234,0.15);flex-shrink:0;background:#0d1117;">
                <textarea id="ai-preview-input" rows="3"
                    placeholder="告诉AI你想修改的地方...&#10;例如：再加几辆小汽车，把楼变高一些，换成夜晚的灯光"
                    style="width:100%;padding:10px;border:1px solid rgba(102,126,234,0.3);border-radius:8px;
                    background:#1c2030;color:#e6edf3;font-size:13px;font-family:inherit;resize:none;
                    line-height:1.5;box-sizing:border-box;margin-bottom:8px;"
                    onkeydown="if(event.ctrlKey&&event.key==='Enter'){sendAIPreviewMessage();}"
                ></textarea>
                <button id="ai-preview-send-btn" onclick="sendAIPreviewMessage()" style="
                    width:100%;padding:9px;border:none;border-radius:8px;cursor:pointer;font-size:13px;font-weight:700;
                    background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);color:#fff;
                ">发送修改 (Ctrl+Enter)</button>
                <div style="font-size:11px;color:#444;text-align:center;margin-top:6px;">💡 AI修改后会自动刷新预览</div>
            </div>
        `;
    }

    // 渲染对话历史
    _renderPreviewChatHistory();

    // 渲染预览内容
    if (previewMode === 'threejs' && threejsCode) {
        _renderThreejsInPreview(threejsCode);
    } else if (previewMode === 'model-first') {
        const previewArea = document.getElementById('ai-preview-area');
        if (previewArea) {
            previewArea.innerHTML = `
                <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:16px;padding:30px;text-align:center;">
                    <div style="font-size:48px;">🌆</div>
                    <div style="font-size:18px;font-weight:700;color:#a5b4fc;">场景已在编辑器中渲染</div>
                    <div style="font-size:13px;color:#666;max-width:300px;line-height:1.6;">
                        场景已加载到右侧3D视图<br>
                        如需调整，在右侧对话框告诉AI
                    </div>
                    <div id="model-first-preview-stats" style="font-size:12px;color:#888;padding:10px 16px;background:rgba(102,126,234,0.1);border-radius:8px;">
                        ${layout && config ? `场景类型: ${config.scene_type || '未知'} | 物体数量: ${layout.length}` : '已加载场景'}
                    </div>
                </div>
            `;
        }
    }
}

// 导出函数
window.confirmAIPreviewScene = confirmAIPreviewScene;
window.closeAIPreviewPanel = closeAIPreviewPanel;
window.sendAIPreviewMessage = sendAIPreviewMessage;
window._renderPreviewChatHistory = _renderPreviewChatHistory;
window._renderThreejsInPreview = _renderThreejsInPreview;
window._switchPanelToChat = _switchPanelToChat;
window.previewChatHistory = previewChatHistory;
window.previewMode = previewMode;