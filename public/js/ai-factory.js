/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
/**
 * AI动作工厂 - 主逻辑
 * 负责角色管理、动作配置、批量生成控制
 */

// ===== 全局状态 =====
const AppState = {
    currentCharacter: null,       // 当前选中的角色
    characters: [],               // 角色列表
    motionConfigs: {},            // 当前角色的动作配置 { motionKey: { enabled, prompt, duration, ... } }
    characterMotions: {},         // 当前角色的已有动作数据
    batchGenerator: null,         // 批量生成器实例
    isGenerating: false,          // 是否正在生成
    isPaused: false,              // 是否暂停
    settings: {
        defaultFps: 30,
        defaultTpose: 'fbx',
        genInterval: 1,
        secretId: '',
        secretKey: ''
    }
};

// ===== 初始化 =====
document.addEventListener('DOMContentLoaded', () => {
    // 加载设置
    loadSettings();
    
    // 加载角色列表
    loadCharacters();
    
    // 绑定面板切换
    bindPanelTabs();
    
    // 更新统计
    updateStats();
});

// ===== 面板切换 =====
function bindPanelTabs() {
    document.querySelectorAll('.panel-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const tabName = tab.dataset.tab;
            
            // 更新tab样式
            document.querySelectorAll('.panel-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            
            // 隐藏所有面板
            const emptyState = document.getElementById('empty-state');
            const motionCategories = document.getElementById('motion-categories');
            const settingsPanel = document.getElementById('settings-panel');
            
            if (emptyState) emptyState.style.display = 'none';
            if (motionCategories) motionCategories.style.display = 'none';
            if (settingsPanel) settingsPanel.style.display = 'none';
            
            // 显示对应的面板
            if (tabName === 'motions') {
                // 判断是否显示empty-state还是motion-categories
                if (AppState.currentCharacter && document.querySelector('.motion-item')) {
                    if (motionCategories) motionCategories.style.display = 'block';
                } else if (emptyState) {
                    emptyState.style.display = 'block';
                }
            } else if (tabName === 'settings') {
                if (settingsPanel) settingsPanel.style.display = 'block';
            }
        });
    });
}

// ===== 角色管理 =====

/**
 * 加载角色列表 - 从后台角色模板库获取
 */
async function loadCharacters() {
    try {
        console.log('[AI Factory] 正在加载角色模板...');
        const res = await fetch('/api/character-templates');
        console.log('[AI Factory] API响应状态:', res.status);
        const data = await res.json();
        console.log('[AI Factory] API返回数据:', data);
        
        if (!data.templates || data.templates.length === 0) {
            console.log('[AI Factory] 没有找到角色模板');
        }
        
        // 转换为AI工厂格式
        AppState.characters = (data.templates || []).map(template => {
            // 计算动作完成度
            const animFields = [
                'anim_idle_url', 'anim_walk_url', 'anim_run_url', 'anim_jump_url',
                'anim_attack1_url', 'anim_attack2_url', 'anim_attack3_url',
                'anim_hit_url', 'anim_death_url',
                'anim_turn_left_url', 'anim_turn_right_url',
                'anim_attack_stab_url', 'anim_attack_slash_url',
                'anim_attack_swing_url', 'anim_attack_uppercut_url',
                'anim_sheath_url', 'anim_draw_sword_url'
            ];
            
            const doneCount = animFields.filter(f => template[f]).length;
            
            return {
                id: template.id,
                name: template.name,
                emoji: '🎭',
                glbUrl: template.glb_url,
                fbxUrl: null, // FBX不存储在模板中，仅用于AI生成
                motionCount: { total: 17, done: doneCount },
                template: template // 保存完整模板数据
            };
        });
        
        renderCharacterList();
    } catch (err) {
        console.error('加载角色列表失败:', err);
        showToast('加载角色模板失败', 'error');
    }
}

/**
 * 渲染角色列表
 */
function renderCharacterList() {
    const container = document.getElementById('char-list');
    
    if (AppState.characters.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="icon">🎭</div>
                <div class="text">角色模板库为空</div>
                <div style="font-size:11px;color:#666;margin-top:5px;">点击上方"新建模板"创建</div>
            </div>
        `;
        return;
    }
    
    container.innerHTML = AppState.characters.map(char => {
        const progress = char.motionCount.total > 0 
            ? Math.round((char.motionCount.done / char.motionCount.total) * 100) 
            : 0;
        const isSelected = AppState.currentCharacter && AppState.currentCharacter.id === char.id;
        const hasGlb = !!char.glbUrl;
        
        return `
            <div class="char-card ${isSelected ? 'selected' : ''}" 
                 onclick="selectCharacter('${char.id}')">
                <div class="char-card-header">
                    <span class="char-icon">${char.emoji}</span>
                    <div class="char-info">
                        <div class="char-name">${char.name}</div>
                        <div class="char-files">
                            ${hasGlb 
                                ? '<span class="has" title="已上传GLB模型">🟢 模型已就绪</span>' 
                                : '<span class="missing" title="需要上传GLB模型">🔴 缺少模型</span>'}
                        </div>
                    </div>
                </div>
                <div class="char-progress">
                    <div class="char-progress-bar" style="width: ${progress}%"></div>
                </div>
                <div style="font-size:10px;color:#888;margin-top:4px;">
                    ${char.motionCount.done}/${char.motionCount.total} 动作已完成
                </div>
            </div>
        `;
    }).join('');
}

/**
 * 选择角色
 */
async function selectCharacter(charId) {
    const char = AppState.characters.find(c => c.id === charId);
    if (!char) return;
    
    AppState.currentCharacter = char;
    
    // 更新选中状态
    document.querySelectorAll('.char-card').forEach(card => card.classList.remove('selected'));
    if (event && event.currentTarget) {
        event.currentTarget.classList.add('selected');
    }
    
    // 更新预览区
    document.getElementById('preview-char-name').textContent = char.name;
    document.getElementById('preview-char-motions').textContent = 
        `${char.motionCount.done}/${char.motionCount.total} 动作已完成`;
    
    // 加载角色的动作配置
    loadMotionConfigs(char.id);
    
    // 加载模板详情（获取已有动作状态）
    loadTemplateDetails(char.id);
    
    // 加载模型到3D预览
    if (char.glbUrl) {
        loadCharacterModel(char.glbUrl);
    }
    
    // 显示动作配置区
    showMotionConfig();
    
    showToast('已选择模板: ' + char.name);
}

/**
 * 显示新建角色弹窗
 */
function showCreateChar() {
    // 重置表单
    document.getElementById('create-char-name').value = '';
    removeCreateGlb();
    removeCreateFbx();
    
    // 初始化平台选择器（增加调试+防御性检查）
    var platformContainer = document.getElementById('platform-selector-container');
    if (platformContainer && typeof PlatformSelector !== 'undefined') {
        // 🔍 调试日志：确认全局变量是否存在
        console.log('[Debug] window.SUPPORTED_PLATFORMS 类型:', typeof window.SUPPORTED_PLATFORMS);
        console.log('[Debug] 平台列表:', window.SUPPORTED_PLATFORMS || '❌ 未定义');
        
        // 🛡️ 防御性检查：如果配置未加载，提示用户
        if (!window.SUPPORTED_PLATFORMS || !Array.isArray(window.SUPPORTED_PLATFORMS)) {
            console.warn('[AI Factory] ⚠️ 平台配置未加载！脚本可能加载失败');
            // 显示错误信息到容器内
            platformContainer.innerHTML = '<div style="color:#ff4444;padding:10px;background:rgba(255,0,0,0.1);border-radius:6px;font-size:12px;">⚠️ 平台选择器配置加载失败<br><span style="color:#888;">请按 F12 查看控制台错误，或刷新页面重试</span></div>';
            // 不再继续初始化，但仍然显示弹框
        } else {
            // ✅ 配置正常，执行初始化
            PlatformSelector.init('platform-selector-container');
            PlatformSelector.setGlbFile(createGlbFile);
            PlatformSelector.onPlatformChange(function(platformId, config) {
                if (platformId) {
                    console.log('[AI Factory] 已选择平台:', platformId);
                }
            });
        }
    }
    
    // 显示弹框
    document.getElementById('create-char-modal').classList.add('show');
}

/**
 * 关闭新建角色弹窗
 */
function closeCreateChar() {
    document.getElementById('create-char-modal').classList.remove('show');
}

/**
 * 保存角色到服务器（保留旧API以兼容）
 */
async function saveCharacter(char) {
    try {
        await fetch('/api/ai-factory/characters', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(char)
        });
    } catch (err) {
        console.error('保存角色失败:', err);
    }
}

// ===== 新建模板弹框的文件处理 =====

let createGlbFile = null;
let createFbxFile = null;

/**
 * 处理新建弹框的GLB上传
 */
function handleCreateGlbUpload(input) {
    const file = input.files[0];
    if (!file) return;
    
    if (!file.name.match(/\.(glb|gltf)$/i)) {
        showToast('请上传 GLB 或 GLTF 格式文件', 'error');
        return;
    }
    
    createGlbFile = file;
    
    // 显示文件信息
    document.getElementById('create-glb-file').style.display = 'flex';
    document.getElementById('create-glb-name').textContent = file.name;
    document.getElementById('create-glb-size').textContent = formatFileSize(file.size);
    document.getElementById('create-glb-text').textContent = '已选择: ' + file.name;
    document.getElementById('create-glb-icon').textContent = '✅';
    document.getElementById('create-glb-zone').style.borderColor = '#00ff00';
}

/**
 * 处理新建弹框的FBX上传
 */
function handleCreateFbxUpload(input) {
    const file = input.files[0];
    if (!file) return;
    
    if (!file.name.match(/\.fbx$/i)) {
        showToast('请上传 FBX 格式文件', 'error');
        return;
    }
    
    createFbxFile = file;
    
    // 显示文件信息
    document.getElementById('create-fbx-file').style.display = 'flex';
    document.getElementById('create-fbx-name').textContent = file.name;
    document.getElementById('create-fbx-size').textContent = formatFileSize(file.size);
    document.getElementById('create-fbx-text').textContent = '已选择: ' + file.name;
    document.getElementById('create-fbx-icon').textContent = '✅';
    document.getElementById('create-fbx-zone').style.borderColor = '#ff8800';
}

/**
 * 移除新建弹框的GLB文件
 */
function removeCreateGlb() {
    createGlbFile = null;
    document.getElementById('create-glb-file').style.display = 'none';
    document.getElementById('create-glb-input').value = '';
    document.getElementById('create-glb-text').textContent = '拖拽或点击上传 GLB 模型';
    document.getElementById('create-glb-icon').textContent = '📁';
    document.getElementById('create-glb-zone').style.borderColor = '';
}

/**
 * 移除新建弹框的FBX文件
 */
function removeCreateFbx() {
    createFbxFile = null;
    document.getElementById('create-fbx-file').style.display = 'none';
    document.getElementById('create-fbx-input').value = '';
    document.getElementById('create-fbx-text').textContent = '拖拽或点击上传 FBX T-Pose';
    document.getElementById('create-fbx-icon').textContent = '📁';
    document.getElementById('create-fbx-zone').style.borderColor = '';
}

/**
 * 创建角色模板
 */
async function createCharacter() {
    const name = document.getElementById('create-char-name').value.trim();
    if (!name) {
        showToast('请输入模板名称', 'error');
        return;
    }
    
    if (!createGlbFile) {
        showToast('请上传 GLB 模型文件', 'error');
        return;
    }
    
    const btn = document.getElementById('btn-create-char');
    btn.disabled = true;
    btn.innerHTML = '<span class="loading-spinner"></span> 创建中...';
    
    try {
        const formData = new FormData();
        formData.append('name', name);
        formData.append('glb_file', createGlbFile);
        formData.append('access_level', 'public');
        formData.append('character_role', 'player');
        
        // 添加平台信息和骨骼映射配置
        if (typeof PlatformSelector !== 'undefined') {
            var selectedPlatform = PlatformSelector.getCurrentPlatform();
            if (selectedPlatform) {
                formData.append('model_source_platform', selectedPlatform);
                if (selectedPlatform !== 'manual' && typeof generateSystemBoneMap === 'function') {
                    var boneMap = generateSystemBoneMap(selectedPlatform);
                    formData.append('auto_bone_map', JSON.stringify(boneMap));
                    console.log('[AI Factory] 提交平台配置:', selectedPlatform, boneMap);
                }
            }
        }
        
        const res = await fetch('/api/character-templates', {
            method: 'POST',
            body: formData
        });
        
        const data = await res.json();
        
        if (data.success) {
            // 关闭弹框
            closeCreateChar();
            
            // 重新加载角色列表
            await loadCharacters();
            
            // 选中新创建的角色
            const newChar = AppState.characters.find(c => c.id === data.template.id);
            if (newChar) {
                AppState.currentCharacter = newChar;
                if (newChar.glbUrl) {
                    loadCharacterModel(newChar.glbUrl);
                }
                renderCharacterList();
                showMotionConfig();
            }
            
            showToast('模板创建成功: ' + name, 'success');
        } else {
            showToast('创建失败: ' + (data.error || '未知错误'), 'error');
        }
    } catch (err) {
        console.error('创建模板失败:', err);
        showToast('创建失败: ' + err.message, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '✅ 创建模板';
    }
}

// ===== 拖拽上传绑定（已移除，使用新建弹框上传） =====

// ===== 动作配置 =====

/**
 * 显示动作配置区
 */
function showMotionConfig() { console.log('[AI Factory] showMotionConfig called');
    var es = document.getElementById('empty-state'); var mc = document.getElementById('motion-categories'); console.log('[AI Factory] elements:', es, mc); if (es) es.style.display = 'none'; if (mc) mc.style.display = 'block';
    
    document.getElementById('config-footer').style.display = 'flex';
    
    renderMotionCategories();
}

/**
 * 加载模板详情并更新动作状态
 */
async function loadTemplateDetails(templateId) {
    try {
        const res = await fetch('/api/character-templates/' + templateId);
        const data = await res.json();
        
        if (data.template) {
            // 更新当前角色的完整模板数据
            AppState.currentCharacter.template = data.template;
            
            // 动作字段映射 - 注意：key必须与MOTION_PRESETS中的key一致
            const animFieldMap = {
                'idle': 'anim_idle_url',
                'walk': 'anim_walk_url',
                'run': 'anim_run_url',
                'jump': 'anim_jump_url',
                'turn_left': 'anim_turn_left_url',
                'turn_right': 'anim_turn_right_url',
                'attack_normal': 'anim_attack1_url',
                'attack_stab': 'anim_attack_stab_url',
                'attack_chop': 'anim_attack_chop_url',  // 注意：这里是attack_chop而不是attack_slash
                'attack_swing': 'anim_attack_swing_url',
                'attack_uppercut': 'anim_attack_uppercut_url',
                'combo_2': 'anim_attack2_url',
                'combo_3': 'anim_attack3_url',
                'combo_4': 'anim_attack4_url',  // 添加缺失的combo_4
                'draw_weapon': 'anim_draw_weapon_url',  // 注意：这里是draw_weapon而不是draw_sword
                'sheath_weapon': 'anim_sheath_weapon_url',  // 注意：这里是sheath_weapon而不是sheath
                'hurt': 'anim_hurt_url',  // 注意：这里是hurt而不是hit
                'death': 'anim_death_url'
            };
            
            // 更新动作状态
            const template = data.template;
            Object.entries(animFieldMap).forEach(([motionKey, fieldName]) => {
                if (AppState.motionConfigs[motionKey]) {
                    const hasAnim = template[fieldName] ? true : false;
                    AppState.motionConfigs[motionKey].status = hasAnim ? 'done' : 'pending';
                    AppState.motionConfigs[motionKey].animUrl = template[fieldName] || null;
                }
            });
            
            // 重新渲染动作列表
            renderMotionCategories();
            updateStats();
        }
    } catch (err) {
        console.error('加载模板详情失败:', err);
    }
}

/**
 * 加载动作配置
 */
function loadMotionConfigs(charId) {
    // 初始化默认配置
    AppState.motionConfigs = {};
    
    MOTION_PRESETS.forEach(preset => {
        AppState.motionConfigs[preset.key] = {
            enabled: true,
            prompt: preset.defaultPrompt,
            duration: preset.defaultDuration,
            intensity: preset.intensity,
            templateIndex: null,
            status: 'pending'
        };
    });
    
    // 立即渲染默认配置列表
    renderMotionCategories();
    updateStats();
    
    // 从服务器加载已有配置（异步）
    loadSavedMotionConfigs(charId);
}

/**
 * 加载已保存的动作配置
 */
async function loadSavedMotionConfigs(charId) {
    try {
        const res = await fetch('/api/ai-factory/characters/' + charId + '/configs');
        const data = await res.json();
        
        if (data.configs) {
            Object.assign(AppState.motionConfigs, data.configs);
        }
    } catch (err) {
        console.error('加载动作配置失败:', err);
    }
    
    renderMotionCategories();
    updateStats();
}

/**
 * 渲染动作分类
 */
function renderMotionCategories() {
    const container = document.getElementById('motion-categories');
    const categoryOrder = getCategoryOrder();
    
    container.innerHTML = categoryOrder.map(catKey => {
        const cat = MOTION_CATEGORIES[catKey];
        const motions = getMotionsByCategory(catKey);
        
        return `
            <div class="motion-category" id="cat-${catKey}">
                <div class="cat-header">
                    <span class="cat-icon">${cat.icon}</span>
                    <span class="cat-title">${cat.title}</span>
                    <span class="cat-count">(${motions.length})</span>
                    <div class="cat-actions">
                        <button onclick="toggleCategoryAll('${catKey}', true)">全部启用</button>
                        <button class="skip" onclick="toggleCategoryAll('${catKey}', false)">全部跳过</button>
                    </div>
                </div>
                <div class="cat-body">
                    ${motions.map(m => renderMotionItem(m)).join('')}
                </div>
            </div>
        `;
    }).join('');
}

/**
 * 渲染单个动作项
 */
function renderMotionItem(preset) {
    const config = AppState.motionConfigs[preset.key] || {};
    const isEnabled = config.enabled !== false;
    const isModified = config.prompt !== preset.defaultPrompt;
    const isDone = config.status === 'done';
    const isError = config.status === 'error';
    const hasAnim = config.animUrl && isDone;
    
    let statusClass = '';
    let badgeHtml = '';
    
    if (isError) {
        statusClass = 'error';
        badgeHtml = '<span class="moti-badge error">❌ 失败</span>';
    } else if (isDone) {
        statusClass = 'done';
        badgeHtml = '<span class="moti-badge done">✅ 已生成</span>';
    } else if (isModified) {
        statusClass = 'modified';
        badgeHtml = '<span class="moti-badge modified">✏️ 已修改</span>';
    }
    
    if (!isEnabled) {
        statusClass += ' disabled';
    }
    
    const promptDisplay = config.prompt || preset.defaultPrompt;
    const previewBtn = hasAnim 
        ? `<button class="moti-preview" onclick="previewMotion('${preset.key}')" title="预览动作">▶</button>`
        : `<button class="moti-preview" onclick="generateAndPreviewMotion('${preset.key}')" title="生成并预览">🎬</button>`;
    
    return `
        <div class="motion-item ${statusClass}" id="moti-${preset.key}" data-key="${preset.key}">
            <div class="moti-row">
                <div class="moti-left">
                    <span class="moti-emoji">${preset.emoji}</span>
                    <span class="moti-name">${preset.displayName}</span>
                    ${badgeHtml}
                </div>
                <div class="moti-prompt ${isModified ? 'user-edited' : ''}" 
                     onclick="toggleMotionDetail('${preset.key}')"
                     title="${promptDisplay}">
                    ${promptDisplay.substring(0, 60)}...
                </div>
                <div class="moti-right">
                    ${previewBtn}
                    <label class="moti-toggle">
                        <input type="checkbox" ${isEnabled ? 'checked' : ''} 
                               onchange="toggleMotionEnabled('${preset.key}', this.checked)">
                        <span>启用</span>
                    </label>
                    <button class="moti-expand ${config.expanded ? 'active' : ''}" 
                            onclick="toggleMotionDetail('${preset.key}')">
                        ${config.expanded ? '收起' : '展开'}
                    </button>
                </div>
            </div>
            
            <div class="moti-detail ${config.expanded ? 'show' : ''}" id="detail-${preset.key}">
                <label>📝 AI 提示词（可修改）</label>
                <textarea class="prompt-textarea" id="prompt-${preset.key}" rows="3"
                    placeholder="输入动作描述..."
                    onchange="updateMotionPrompt('${preset.key}', this.value)">${promptDisplay}</textarea>
                <div class="prompt-footer">
                    <span class="char-count"><span id="count-${preset.key}">${promptDisplay.length}</span> / 500</span>
                    <div class="prompt-actions">
                        <button class="btn btn-secondary btn-small" onclick="resetMotionPrompt('${preset.key}')">
                            ↩️ 恢复默认
                        </button>
                    </div>
                </div>
                
                <div class="moti-params">
                    <div class="param-group">
                        <label>⏱️ 时长</label>
                        <input type="range" min="0.5" max="12" step="0.5" 
                               value="${config.duration || preset.defaultDuration}"
                               id="duration-${preset.key}"
                               oninput="updateMotionDuration('${preset.key}', this.value)">
                        <span class="val" id="durval-${preset.key}">${config.duration || preset.defaultDuration}s</span>
                    </div>
                    <div class="param-group">
                        <label>💪 强度</label>
                        <select id="intensity-${preset.key}" onchange="updateMotionIntensity('${preset.key}', this.value)">
                            <option value="weak" ${config.intensity === 'weak' ? 'selected' : ''}>弱</option>
                            <option value="medium" ${config.intensity === 'medium' ? 'selected' : ''}>中</option>
                            <option value="strong" ${config.intensity === 'strong' ? 'selected' : ''}>强</option>
                            <option value="extreme" ${config.intensity === 'extreme' ? 'selected' : ''}>极强</option>
                        </select>
                    </div>
                </div>
                
                <div class="template-chips">
                    <label>💡 快捷模板（点击应用）</label>
                    ${preset.templates.map((t, i) => `
                        <button class="chip" onclick="applyTemplate('${preset.key}', ${i})">
                            ${t.name}
                        </button>
                    `).join('')}
                </div>
            </div>
        </div>
    `;
}

/**
 * 切换动作详情展开
 */
function toggleMotionDetail(key) {
    const config = AppState.motionConfigs[key];
    if (!config) return;
    
    config.expanded = !config.expanded;
    
    // 更新UI
    const detail = document.getElementById('detail-' + key);
    const btn = document.querySelector(`#moti-${key} .moti-expand`);
    
    if (detail) {
        detail.classList.toggle('show', config.expanded);
    }
    if (btn) {
        btn.textContent = config.expanded ? '收起' : '展开';
        btn.classList.toggle('active', config.expanded);
    }
}

/**
 * 切换动作启用状态
 */
function toggleMotionEnabled(key, enabled) {
    const config = AppState.motionConfigs[key];
    if (!config) return;
    
    config.enabled = enabled;
    
    // 更新UI
    const item = document.getElementById('moti-' + key);
    if (item) {
        item.classList.toggle('disabled', !enabled);
    }
    
    updateStats();
}

/**
 * 切换分类全选
 */
function toggleCategoryAll(category, enabled) {
    const motions = getMotionsByCategory(category);
    
    motions.forEach(m => {
        if (AppState.motionConfigs[m.key]) {
            AppState.motionConfigs[m.key].enabled = enabled;
        }
    });
    
    renderMotionCategories();
    updateStats();
}

/**
 * 更新动作提示词
 */
function updateMotionPrompt(key, value) {
    const config = AppState.motionConfigs[key];
    if (!config) return;
    
    config.prompt = value;
    
    // 更新字数统计
    const countEl = document.getElementById('count-' + key);
    if (countEl) {
        countEl.textContent = value.length;
    }
    
    // 更新预览文字样式
    const previewEl = document.querySelector(`#moti-${key} .moti-prompt`);
    if (previewEl) {
        previewEl.textContent = value.substring(0, 60) + '...';
        previewEl.classList.add('user-edited');
    }
    
    // 更新badge
    updateMotionBadge(key);
    
    updateStats();
}

/**
 * 更新动作时长
 */
function updateMotionDuration(key, value) {
    const config = AppState.motionConfigs[key];
    if (!config) return;
    
    config.duration = parseFloat(value);
    
    // 更新显示
    const valEl = document.getElementById('durval-' + key);
    if (valEl) {
        valEl.textContent = value + 's';
    }
}

/**
 * 更新动作强度
 */
function updateMotionIntensity(key, value) {
    const config = AppState.motionConfigs[key];
    if (!config) return;
    
    config.intensity = value;
}

/**
 * 恢复默认提示词
 */
function resetMotionPrompt(key) {
    const preset = getMotionPreset(key);
    if (!preset) return;
    
    const config = AppState.motionConfigs[key];
    if (!config) return;
    
    config.prompt = preset.defaultPrompt;
    config.templateIndex = null;
    
    // 更新UI
    const textarea = document.getElementById('prompt-' + key);
    if (textarea) {
        textarea.value = preset.defaultPrompt;
    }
    
    const countEl = document.getElementById('count-' + key);
    if (countEl) {
        countEl.textContent = preset.defaultPrompt.length;
    }
    
    updateMotionBadge(key);
    updateStats();
}

/**
 * 应用模板
 */
function applyTemplate(key, templateIndex) {
    const preset = getMotionPreset(key);
    if (!preset) return;
    
    const config = AppState.motionConfigs[key];
    if (!config) return;
    
    const template = preset.templates[templateIndex];
    if (!template) return;
    
    config.prompt = template.prompt || preset.defaultPrompt;
    config.templateIndex = templateIndex;
    
    // 更新UI
    const textarea = document.getElementById('prompt-' + key);
    if (textarea) {
        textarea.value = config.prompt;
    }
    
    const countEl = document.getElementById('count-' + key);
    if (countEl) {
        countEl.textContent = config.prompt.length;
    }
    
    updateMotionBadge(key);
    showToast('已应用模板: ' + template.name);
}

/**
 * 更新动作徽章
 */
function updateMotionBadge(key) {
    const config = AppState.motionConfigs[key];
    const preset = getMotionPreset(key);
    const item = document.getElementById('moti-' + key);
    
    if (!item || !config || !preset) return;
    
    // 移除旧badge
    item.querySelectorAll('.moti-badge').forEach(b => b.remove());
    
    // 添加新badge
    const leftDiv = item.querySelector('.moti-left');
    let badgeHtml = '';
    
    if (config.status === 'done') {
        badgeHtml = '<span class="moti-badge done">✅ 已生成</span>';
    } else if (config.prompt !== preset.defaultPrompt) {
        badgeHtml = '<span class="moti-badge modified">✏️ 已修改</span>';
    }
    
    leftDiv.insertAdjacentHTML('beforeend', badgeHtml);
}

/**
 * 恢复所有动作为默认
 */
function resetAllPrompts() {
    if (!confirm('确定要恢复所有动作为默认提示词吗？')) return;
    
    MOTION_PRESETS.forEach(preset => {
        const config = AppState.motionConfigs[preset.key];
        if (config) {
            config.prompt = preset.defaultPrompt;
            config.duration = preset.defaultDuration;
            config.intensity = preset.intensity;
            config.templateIndex = null;
        }
    });
    
    renderMotionCategories();
    updateStats();
    showToast('已恢复所有默认设置');
}

/**
 * 更新统计
 */
function updateStats() {
    let total = MOTION_PRESETS ? MOTION_PRESETS.length : 0;
    let modified = 0;
    let enabled = 0;
    let pending = 0;
    let done = 0;
    
    if (MOTION_PRESETS) {
        MOTION_PRESETS.forEach(preset => {
            const config = AppState.motionConfigs[preset.key];
            if (config) {
                if (config.prompt !== preset.defaultPrompt) modified++;
                if (config.enabled) enabled++;
                if (config.enabled) {
                    if (config.status === 'done') done++;
                    else if (config.status !== 'error') pending++;
                }
            }
        });
    }
    
    // 安全更新元素
    const safeSet = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    safeSet('stat-total', total);
    safeSet('stat-done', done);
    safeSet('stat-pending', pending);
    safeSet('stat-modified', modified);
    safeSet('stat-enabled', enabled);
    safeSet('footer-pending', pending);
    safeSet('footer-done', done);
    safeSet('btn-count', pending);
    
    const cost = estimateCost ? estimateCost(enabled) : { display: '-' };
    safeSet('stat-cost', cost.display);
    
    const dur = estimateDuration ? estimateDuration(enabled) : '-';
    safeSet('footer-duration', dur);
}


// ===== 批量生成 =====

/**
 * 开始批量生成
 */
async function startBatchGenerate() {
    if (!AppState.currentCharacter) {
        showToast('请先选择一个角色', 'error');
        return;
    }
    
    // 检查是否有T-Pose文件
    if (!AppState.currentCharacter.glbUrl && !AppState.currentCharacter.fbxUrl) {
        showToast('请先上传模型文件', 'error');
        return;
    }
    
    // 收集待生成的动作
    const queue = [];
    MOTION_PRESETS.forEach(preset => {
        const config = AppState.motionConfigs[preset.key];
        if (config && config.enabled && config.status !== 'done') {
            queue.push({
                key: preset.key,
                displayName: preset.displayName,
                emoji: preset.emoji,
                prompt: config.prompt,
                duration: config.duration || preset.defaultDuration
            });
        }
    });
    
    if (queue.length === 0) {
        showToast('没有需要生成的动作', 'error');
        return;
    }
    
    // 显示生成面板
    showGenPanel(queue);
    
    // 开始生成
    await runBatchGenerate(queue);
}

/**
 * 显示生成面板
 */
function showGenPanel(queue) {
    AppState.isGenerating = true;
    AppState.isPaused = false;
    
    const panel = document.getElementById('gen-panel');
    panel.classList.add('show');
    
    // 初始化面板
    document.getElementById('gen-progress-text').textContent = `0 / ${queue.length} 完成`;
    document.getElementById('gen-progress-bar').style.width = '0%';
    document.getElementById('gen-current-name').textContent = '准备开始...';
    document.getElementById('gen-current-detail').textContent = '等待中';
    
    // 渲染队列
    const listEl = document.getElementById('gen-completed-list');
    listEl.innerHTML = queue.map(q => `
        <div class="gen-item" id="gen-item-${q.key}">
            <div class="emoji">${q.emoji}</div>
            <div class="name">${q.displayName}</div>
            <div class="time" id="gen-time-${q.key}">等待</div>
        </div>
    `).join('');
    
    // 按钮状态
    document.getElementById('btn-pause-gen').style.display = 'inline-flex';
    document.getElementById('btn-finish-gen').style.display = 'none';
}

/**
 * 运行批量生成
 */
async function runBatchGenerate(queue) {
    let completed = 0;
    let failed = 0;
    const total = queue.length;
    const interval = AppState.settings.genInterval * 1000;
    
    for (let i = 0; i < queue.length; i++) {
        if (!AppState.isGenerating) break;
        
        // 检查暂停
        while (AppState.isPaused && AppState.isGenerating) {
            await sleep(500);
        }
        
        if (!AppState.isGenerating) break;
        
        const item = queue[i];
        const startTime = Date.now();
        
        // 更新当前状态
        document.getElementById('gen-current-name').textContent = `${item.emoji} ${item.displayName}`;
        document.getElementById('gen-current-detail').textContent = '正在生成...';
        
        // 更新队列项状态
        const itemEl = document.getElementById('gen-item-' + item.key);
        if (itemEl) {
            itemEl.classList.add('current');
            itemEl.classList.remove('done', 'error');
        }
        
        try {
            // 更新配置状态
            if (AppState.motionConfigs[item.key]) {
                AppState.motionConfigs[item.key].status = 'generating';
            }
            
            // 调用生成API
            const result = await generateMotion(item);
            
            // 生成成功
            if (AppState.motionConfigs[item.key]) {
                AppState.motionConfigs[item.key].status = 'done';
                AppState.motionConfigs[item.key].keyframes = result.keyframes;
                AppState.motionConfigs[item.key].cost = result.cost || 1.5;
            }
            
            completed++;
            
            // 更新UI
            if (itemEl) {
                itemEl.classList.remove('current');
                itemEl.classList.add('done');
            }
            
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            document.getElementById('gen-time-' + item.key).textContent = elapsed + 's';
            
        } catch (err) {
            console.error('生成失败:', item.key, err);
            failed++;
            
            // 更新配置状态
            if (AppState.motionConfigs[item.key]) {
                AppState.motionConfigs[item.key].status = 'error';
                AppState.motionConfigs[item.key].error = err.message;
            }
            
            // 更新UI
            if (itemEl) {
                itemEl.classList.remove('current');
                itemEl.classList.add('error');
            }
            document.getElementById('gen-time-' + item.key).textContent = '失败';
        }
        
        // 更新进度
        const progress = Math.round(((i + 1) / total) * 100);
        document.getElementById('gen-progress-text').textContent = 
            `${completed + failed} / ${total} 完成 ${failed > 0 ? '(' + failed + '失败)' : ''}`;
        document.getElementById('gen-progress-bar').style.width = progress + '%';
        
        // 更新配置面板
        renderMotionCategories();
        updateStats();
        
        // 保存到服务器
        saveMotionToServer(item.key);
        
        // 间隔
        if (i < queue.length - 1 && AppState.isGenerating) {
            await sleep(interval);
        }
    }
    
    // 全部完成
    AppState.isGenerating = false;
    document.getElementById('gen-current-name').textContent = '🎉 全部完成!';
    document.getElementById('gen-current-detail').textContent = 
        `成功 ${completed} 个${failed > 0 ? '，失败 ' + failed + ' 个' : ''}`;
    
    document.getElementById('btn-pause-gen').style.display = 'none';
    document.getElementById('btn-finish-gen').style.display = 'inline-flex';
}

/**
 * 调用单个动作生成API
 */
async function generateMotion(item) {
    // 获取T-Pose文件
    const tposeFile = AppState.currentCharacter.fbxUrl || AppState.currentCharacter.glbUrl;
    
    const res = await fetch('/api/ai-factory/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            tposeFile: tposeFile,
            characterId: AppState.currentCharacter.id,
            motionKey: item.key,
            textPrompt: item.prompt,
            duration: item.duration
        })
    });
    
    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || '生成失败');
    }
    
    return await res.json();
}

/**
 * 保存动作到服务器（更新角色模板库）
 */
async function saveMotionToServer(motionKey) {
    const config = AppState.motionConfigs[motionKey];
    if (!config || !AppState.currentCharacter) return;
    
    // 动作字段映射
    const animFieldMap = {
        'idle': 'anim_idle',
        'walk': 'anim_walk',
        'run': 'anim_run',
        'jump': 'anim_jump',
        'turn_left': 'anim_turn_left',
        'turn_right': 'anim_turn_right',
        'attack_normal': 'anim_attack1',
        'attack_stab': 'anim_attack_stab',
        'attack_slash': 'anim_attack_slash',
        'attack_swing': 'anim_attack_swing',
        'attack_uppercut': 'anim_attack_uppercut',
        'combo_2': 'anim_attack2',
        'combo_3': 'anim_attack3',
        'draw_sword': 'anim_draw_sword',
        'sheath': 'anim_sheath',
        'hit': 'anim_hit',
        'death': 'anim_death'
    };
    
    const fieldName = animFieldMap[motionKey];
    if (!fieldName) return;
    
    // 如果有生成的动画文件URL，需要上传到服务器
    if (config.animUrl) {
        try {
            // 从AI生成获取的是动画GLB文件，需要上传
            const formData = new FormData();
            formData.append(fieldName, dataURItoBlob(config.animUrl), motionKey + '.glb');
            
            const res = await fetch('/api/character-templates/' + AppState.currentCharacter.id, {
                method: 'PUT',
                body: formData
            });
            
            const data = await res.json();
            if (data.success) {
                console.log('动作已保存到模板库:', motionKey);
                
                // 更新本地模板数据
                if (AppState.currentCharacter.template) {
                    const urlField = fieldName + '_url';
                    AppState.currentCharacter.template[urlField] = data.template[urlField];
                    
                    // 更新完成度
                    AppState.currentCharacter.motionCount.done++;
                    renderCharacterList();
                }
            }
        } catch (err) {
            console.error('保存动作到模板库失败:', err);
        }
    }
}

/**
 * 将DataURL转换为Blob
 */
function dataURItoBlob(dataURI) {
    const byteString = atob(dataURI.split(',')[1]);
    const mimeString = dataURI.split(',')[0].split(':')[1].split(';')[0];
    const ab = new ArrayBuffer(byteString.length);
    const ia = new Uint8Array(ab);
    for (let i = 0; i < byteString.length; i++) {
        ia[i] = byteString.charCodeAt(i);
    }
    return new Blob([ab], { type: mimeString });
}

/**
 * 暂停/继续生成
 */
function togglePauseGen() {
    AppState.isPaused = !AppState.isPaused;
    
    const btn = document.getElementById('btn-pause-gen');
    if (AppState.isPaused) {
        btn.innerHTML = '▶ 继续';
        document.getElementById('gen-current-detail').textContent = '已暂停';
    } else {
        btn.innerHTML = '⏸ 暂停';
        document.getElementById('gen-current-detail').textContent = '继续生成...';
    }
}

/**
 * 取消批量生成
 */
function cancelBatchGen() {
    if (!confirm('确定要取消剩余的生成任务吗？')) return;
    
    AppState.isGenerating = false;
    AppState.isPaused = false;
    
    document.getElementById('gen-panel').classList.remove('show');
    showToast('已取消批量生成');
}

/**
 * 完成批量生成
 */
function finishBatchGen() {
    document.getElementById('gen-panel').classList.remove('show');
    showToast('动作生成完成!', 'success');
}

// ===== 设置 =====

/**
 * 加载设置
 */
function loadSettings() {
    try {
        const saved = localStorage.getItem('ai-factory-settings');
        if (saved) {
            Object.assign(AppState.settings, JSON.parse(saved));
        }
    } catch (err) {
        console.error('加载设置失败:', err);
    }
    
    // 更新UI
    document.getElementById('default-fps').value = AppState.settings.defaultFps;
    document.getElementById('default-tpose').value = AppState.settings.defaultTpose;
    document.getElementById('gen-interval').value = AppState.settings.genInterval;
    document.getElementById('tencent-secret-id').value = AppState.settings.secretId || '';
    document.getElementById('tencent-secret-key').value = AppState.settings.secretKey || '';
}

/**
 * 保存设置
 */
function saveSettings() {
    AppState.settings.defaultFps = parseInt(document.getElementById('default-fps').value);
    AppState.settings.defaultTpose = document.getElementById('default-tpose').value;
    AppState.settings.genInterval = parseFloat(document.getElementById('gen-interval').value);
    AppState.settings.secretId = document.getElementById('tencent-secret-id').value;
    AppState.settings.secretKey = document.getElementById('tencent-secret-key').value;
    
    localStorage.setItem('ai-factory-settings', JSON.stringify(AppState.settings));
    
    showToast('设置已保存', 'success');
}

// ===== 工具函数 =====

/**
 * 格式化文件大小
 */
function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

/**
 * 显示Toast提示
 */
function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = 'toast ' + type;
    toast.classList.add('show');
    
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

/**
 * 睡眠函数
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ===== 3D预览相关（委托给ai-factory-player.js）=====

/**
 * 加载角色模型到3D预览
 */
function loadCharacterModel(url) {
    if (window.AIFactoryPlayer) {
        window.AIFactoryPlayer.loadModel(url);
    } else {
        console.warn('AIFactoryPlayer 未加载');
    }
}

// 导出给全局
window.AppState = AppState;
window.selectCharacter = selectCharacter;
window.showCreateChar = showCreateChar;
window.closeCreateChar = closeCreateChar;
window.handleCreateGlbUpload = handleCreateGlbUpload;
window.handleCreateFbxUpload = handleCreateFbxUpload;
window.removeCreateGlb = removeCreateGlb;
window.removeCreateFbx = removeCreateFbx;
window.createCharacter = createCharacter;
window.toggleMotionDetail = toggleMotionDetail;
window.toggleMotionEnabled = toggleMotionEnabled;
window.toggleCategoryAll = toggleCategoryAll;
window.updateMotionPrompt = updateMotionPrompt;
window.updateMotionDuration = updateMotionDuration;
window.updateMotionIntensity = updateMotionIntensity;
window.resetMotionPrompt = resetMotionPrompt;
window.applyTemplate = applyTemplate;
window.resetAllPrompts = resetAllPrompts;
window.startBatchGenerate = startBatchGenerate;
window.togglePauseGen = togglePauseGen;
window.cancelBatchGen = cancelBatchGen;
window.finishBatchGen = finishBatchGen;
window.saveSettings = saveSettings;
window.loadCharacterModel = loadCharacterModel;
window.previewMotion = previewMotion;
window.generateAndPreviewMotion = generateAndPreviewMotion;

/**
 * 预览已生成的动作
 */
async function previewMotion(motionKey) {
    const config = AppState.motionConfigs[motionKey];
    const preset = getMotionPreset(motionKey);
    
    if (!config || !preset) {
        showToast('动作配置不存在', 'error');
        return;
    }
    
    if (!config.animUrl) {
        showToast('该动作尚未生成，请先生成', 'error');
        return;
    }
    
    showToast('正在加载动作预览...');
    
    // 调用播放器的动作加载功能
    if (window.AIFactoryPlayer) {
        await window.AIFactoryPlayer.loadMotionAnimation(config.animUrl, motionKey);
        window.AIFactoryPlayer.playAnimation();
        showToast('正在预览: ' + preset.displayName, 'success');
    } else {
        showToast('播放器未初始化', 'error');
    }
}

/**
 * 生成并预览动作
 */
async function generateAndPreviewMotion(motionKey) {
    const config = AppState.motionConfigs[motionKey];
    const preset = getMotionPreset(motionKey);
    
    if (!config || !preset) {
        showToast('动作配置不存在', 'error');
        return;
    }
    
    if (!AppState.currentCharacter) {
        showToast('请先选择一个角色', 'error');
        return;
    }
    
    // 检查是否有模型
    const modelUrl = AppState.currentCharacter.glbUrl || AppState.currentCharacter.fbxUrl;
    if (!modelUrl) {
        showToast('当前角色没有模型文件', 'error');
        return;
    }
    
    showToast('正在生成动作: ' + preset.displayName + '...');
    
    try {
        // 调用生成API
        const result = await fetch('/api/ai-factory/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                tposeFile: modelUrl,
                characterId: AppState.currentCharacter.id,
                motionKey: motionKey,
                textPrompt: config.prompt || preset.defaultPrompt,
                duration: config.duration || preset.defaultDuration
            })
        });
        
        if (!result.ok) {
            const err = await result.json();
            throw new Error(err.message || '生成失败');
        }
        
        const data = await result.json();
        
        // 更新配置状态
        config.status = 'done';
        config.animUrl = data.animUrl;
        
        // 重新渲染动作列表
        renderMotionCategories();
        updateStats();
        
        showToast('生成成功，正在预览...');
        
        // 播放预览
        if (window.AIFactoryPlayer && data.animUrl) {
            await window.AIFactoryPlayer.loadMotionAnimation(data.animUrl, motionKey);
            window.AIFactoryPlayer.playAnimation();
        }
        
    } catch (err) {
        console.error('生成失败:', err);
        config.status = 'error';
        config.error = err.message;
        renderMotionCategories();
        showToast('生成失败: ' + err.message, 'error');
    }
}
