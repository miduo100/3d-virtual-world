// 用户体验模块 - 通知、加载状态和操作反馈

/**
 * 通知管理器
 */
const notificationManager = {
    /**
     * 显示通知
     * @param {string} message - 通知消息
     * @param {string} type - 通知类型: 'success', 'error', 'info', 'warning'
     * @param {number} duration - 显示持续时间（毫秒）
     */
    showNotification(message, type = 'info', duration = 3000) {
        const notification = document.getElementById('notification');
        if (!notification) {
            // 创建通知元素
            const notificationElement = document.createElement('div');
            notificationElement.id = 'notification';
            notificationElement.style.cssText = `
                position: absolute;
                top: 100px;
                right: 20px;
                background: rgba(0, 0, 0, 0.9);
                color: white;
                padding: 15px 20px;
                border-radius: 10px;
                font-size: 14px;
                z-index: 200;
                display: none;
                max-width: 300px;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
                transition: all 0.3s ease;
            `;
            document.body.appendChild(notificationElement);
        }

        const notificationEl = document.getElementById('notification');
        notificationEl.textContent = message;
        notificationEl.className = type;
        notificationEl.style.display = 'block';
        notificationEl.style.opacity = '0';
        notificationEl.style.transform = 'translateX(100%)';

        // 动画显示
        setTimeout(() => {
            notificationEl.style.opacity = '1';
            notificationEl.style.transform = 'translateX(0)';
        }, 10);

        // 自动隐藏
        setTimeout(() => {
            notificationEl.style.opacity = '0';
            notificationEl.style.transform = 'translateX(100%)';
            setTimeout(() => {
                notificationEl.style.display = 'none';
            }, 300);
        }, duration);
    },

    /**
     * 显示成功通知
     * @param {string} message - 通知消息
     * @param {number} duration - 显示持续时间（毫秒）
     */
    success(message, duration = 3000) {
        this.showNotification(message, 'success', duration);
    },

    /**
     * 显示错误通知
     * @param {string} message - 通知消息
     * @param {number} duration - 显示持续时间（毫秒）
     */
    error(message, duration = 4000) {
        this.showNotification(message, 'error', duration);
    },

    /**
     * 显示信息通知
     * @param {string} message - 通知消息
     * @param {number} duration - 显示持续时间（毫秒）
     */
    info(message, duration = 3000) {
        this.showNotification(message, 'info', duration);
    },

    /**
     * 显示警告通知
     * @param {string} message - 通知消息
     * @param {number} duration - 显示持续时间（毫秒）
     */
    warning(message, duration = 3500) {
        this.showNotification(message, 'warning', duration);
    }
};

/**
 * 加载状态管理器
 */
const loadingManager = {
    /**
     * 显示加载状态
     * @param {string} message - 加载消息
     * @param {string} containerId - 容器ID
     * @returns {string} 加载状态ID
     */
    showLoading(message = '加载中...', containerId = null) {
        const loadingId = 'loading-' + Date.now();
        const loadingElement = document.createElement('div');
        loadingElement.id = loadingId;
        loadingElement.style.cssText = `
            position: ${containerId ? 'relative' : 'fixed'};
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: ${containerId ? 'rgba(255, 255, 255, 0.8)' : 'rgba(0, 0, 0, 0.7)'};
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            z-index: 1000;
            ${containerId ? '' : 'backdrop-filter: blur(5px);'}
        `;
        loadingElement.innerHTML = `
            <div style="width: 40px; height: 40px; border: 4px solid rgba(102, 126, 234, 0.3); border-radius: 50%; border-top-color: #667eea; animation: spin 1s linear infinite;"></div>
            <div style="margin-top: 16px; font-size: 16px; color: ${containerId ? '#333' : 'white'}; font-weight: 600;">${message}</div>
        `;

        if (containerId) {
            const container = document.getElementById(containerId);
            if (container) {
                container.style.position = 'relative';
                container.appendChild(loadingElement);
            }
        } else {
            document.body.appendChild(loadingElement);
        }

        return loadingId;
    },

    /**
     * 隐藏加载状态
     * @param {string} loadingId - 加载状态ID
     */
    hideLoading(loadingId) {
        const loadingElement = document.getElementById(loadingId);
        if (loadingElement) {
            loadingElement.style.opacity = '0';
            loadingElement.style.transition = 'opacity 0.3s ease';
            setTimeout(() => {
                loadingElement.remove();
            }, 300);
        }
    }
};

/**
 * 进度条管理器
 */
const progressManager = {
    /**
     * 显示进度条
     * @param {string} containerId - 容器ID
     * @returns {string} 进度条ID
     */
    showProgress(containerId = 'canvas-container') {
        const progressId = 'progress-' + Date.now();
        const progressElement = document.createElement('div');
        progressElement.id = progressId;
        progressElement.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 4px;
            background: rgba(0, 0, 0, 0.1);
            z-index: 1000;
        `;
        progressElement.innerHTML = `
            <div id="${progressId}-bar" style="
                width: 0%;
                height: 100%;
                background: linear-gradient(90deg, #667eea 0%, #764ba2 100%);
                transition: width 0.3s ease;
            "></div>
        `;

        const container = document.getElementById(containerId);
        if (container) {
            container.style.position = 'relative';
            container.appendChild(progressElement);
        }

        return progressId;
    },

    /**
     * 更新进度
     * @param {string} progressId - 进度条ID
     * @param {number} progress - 进度值 (0-100)
     */
    updateProgress(progressId, progress) {
        const progressBar = document.getElementById(`${progressId}-bar`);
        if (progressBar) {
            progressBar.style.width = `${Math.min(100, Math.max(0, progress))}%`;
        }
    },

    /**
     * 隐藏进度条
     * @param {string} progressId - 进度条ID
     */
    hideProgress(progressId) {
        const progressElement = document.getElementById(progressId);
        if (progressElement) {
            progressElement.style.opacity = '0';
            progressElement.style.transition = 'opacity 0.3s ease';
            setTimeout(() => {
                progressElement.remove();
            }, 300);
        }
    }
};

/**
 * 操作反馈管理器
 */
const feedbackManager = {
    /**
     * 显示操作反馈
     * @param {string} message - 反馈消息
     * @param {string} type - 反馈类型: 'success', 'error', 'info'
     * @param {HTMLElement} target - 目标元素
     */
    showFeedback(message, type = 'success', target = null) {
        const feedbackId = 'feedback-' + Date.now();
        const feedbackElement = document.createElement('div');
        feedbackElement.id = feedbackId;
        feedbackElement.style.cssText = `
            position: ${target ? 'absolute' : 'fixed'};
            top: ${target ? '50%' : '50%'};
            left: ${target ? '50%' : '50%'};
            transform: ${target ? 'translate(-50%, -50%)' : 'translate(-50%, -50%)'};
            background: ${type === 'success' ? 'rgba(76, 175, 80, 0.95)' : type === 'error' ? 'rgba(244, 67, 54, 0.95)' : 'rgba(33, 150, 243, 0.95)'};
            color: white;
            padding: 12px 20px;
            border-radius: 8px;
            font-size: 14px;
            font-weight: 600;
            z-index: 2000;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
            opacity: 0;
            transform: ${target ? 'translate(-50%, -50%) scale(0.8)' : 'translate(-50%, -50%) scale(0.8)'};
            transition: all 0.3s ease;
        `;
        feedbackElement.textContent = message;

        if (target) {
            target.style.position = 'relative';
            target.appendChild(feedbackElement);
        } else {
            document.body.appendChild(feedbackElement);
        }

        // 动画显示
        setTimeout(() => {
            feedbackElement.style.opacity = '1';
            feedbackElement.style.transform = target ? 'translate(-50%, -50%) scale(1)' : 'translate(-50%, -50%) scale(1)';
        }, 10);

        // 自动隐藏
        setTimeout(() => {
            feedbackElement.style.opacity = '0';
            feedbackElement.style.transform = target ? 'translate(-50%, -50%) scale(0.8)' : 'translate(-50%, -50%) scale(0.8)';
            setTimeout(() => {
                feedbackElement.remove();
            }, 300);
        }, 2000);

        return feedbackId;
    },

    /**
     * 显示成功反馈
     * @param {string} message - 反馈消息
     * @param {HTMLElement} target - 目标元素
     */
    success(message, target = null) {
        return this.showFeedback(message, 'success', target);
    },

    /**
     * 显示错误反馈
     * @param {string} message - 反馈消息
     * @param {HTMLElement} target - 目标元素
     */
    error(message, target = null) {
        return this.showFeedback(message, 'error', target);
    },

    /**
     * 显示信息反馈
     * @param {string} message - 反馈消息
     * @param {HTMLElement} target - 目标元素
     */
    info(message, target = null) {
        return this.showFeedback(message, 'info', target);
    }
};

/**
 * 初始化用户体验模块
 */
function initUserExperience() {
    // 添加CSS动画
    const style = document.createElement('style');
    style.textContent = `
        @keyframes spin {
            to { transform: rotate(360deg); }
        }
        
        #notification.success {
            background: rgba(76, 175, 80, 0.95);
        }
        
        #notification.error {
            background: rgba(244, 67, 54, 0.95);
        }
        
        #notification.info {
            background: rgba(33, 150, 243, 0.95);
        }
        
        #notification.warning {
            background: rgba(255, 193, 7, 0.95);
        }
    `;
    document.head.appendChild(style);

    console.log('✅ 用户体验模块初始化完成');
}

// 导出函数
window.notificationManager = notificationManager;
window.loadingManager = loadingManager;
window.progressManager = progressManager;
window.feedbackManager = feedbackManager;
window.initUserExperience = initUserExperience;

// 导出常用函数别名
window.showNotification = notificationManager.showNotification.bind(notificationManager);
window.showLoading = loadingManager.showLoading.bind(loadingManager);
window.hideLoading = loadingManager.hideLoading.bind(loadingManager);
window.showProgress = progressManager.showProgress.bind(progressManager);
window.updateProgress = progressManager.updateProgress.bind(progressManager);
window.hideProgress = progressManager.hideProgress.bind(progressManager);
window.showFeedback = feedbackManager.showFeedback.bind(feedbackManager);