// 输入验证和XSS防护模块

/**
 * 转义HTML特殊字符，防止XSS攻击
 * @param {string} str - 需要转义的字符串
 * @returns {string} 转义后的字符串
 */
function escapeHtml(str) {
    if (!str) return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * 验证场景描述输入
 * @param {string} description - 场景描述
 * @returns {object} 验证结果 { valid: boolean, error: string }
 */
function validateSceneDescription(description) {
    if (!description || description.trim() === '') {
        return { valid: false, error: '场景描述不能为空' };
    }
    if (description.length < 5) {
        return { valid: false, error: '场景描述至少需要5个字符' };
    }
    if (description.length > 1000) {
        return { valid: false, error: '场景描述不能超过1000个字符' };
    }
    // 检查是否包含恶意脚本
    if (/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi.test(description)) {
        return { valid: false, error: '描述中包含不允许的内容' };
    }
    return { valid: true, error: '' };
}

/**
 * 验证模型描述输入
 * @param {string} description - 模型描述
 * @returns {object} 验证结果 { valid: boolean, error: string }
 */
function validateModelDescription(description) {
    if (!description || description.trim() === '') {
        return { valid: false, error: '模型描述不能为空' };
    }
    if (description.length < 3) {
        return { valid: false, error: '模型描述至少需要3个字符' };
    }
    if (description.length > 500) {
        return { valid: false, error: '模型描述不能超过500个字符' };
    }
    // 检查是否包含恶意脚本
    if (/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi.test(description)) {
        return { valid: false, error: '描述中包含不允许的内容' };
    }
    return { valid: true, error: '' };
}

/**
 * 验证文件上传
 * @param {File} file - 上传的文件
 * @param {string[]} allowedTypes - 允许的文件类型
 * @param {number} maxSize - 最大文件大小（字节）
 * @returns {object} 验证结果 { valid: boolean, error: string }
 */
function validateFileUpload(file, allowedTypes = ['image/jpeg', 'image/png', 'image/webp'], maxSize = 10 * 1024 * 1024) {
    if (!file) {
        return { valid: false, error: '请选择文件' };
    }
    if (!allowedTypes.includes(file.type)) {
        return { valid: false, error: `不支持的文件类型，允许的类型：${allowedTypes.join(', ')}` };
    }
    if (file.size > maxSize) {
        const maxSizeMB = (maxSize / (1024 * 1024)).toFixed(1);
        return { valid: false, error: `文件大小不能超过 ${maxSizeMB}MB` };
    }
    return { valid: true, error: '' };
}

/**
 * 验证数字输入
 * @param {string|number} value - 输入值
 * @param {number} min - 最小值
 * @param {number} max - 最大值
 * @returns {object} 验证结果 { valid: boolean, error: string }
 */
function validateNumber(value, min = -Infinity, max = Infinity) {
    const num = parseFloat(value);
    if (isNaN(num)) {
        return { valid: false, error: '请输入有效的数字' };
    }
    if (num < min) {
        return { valid: false, error: `数值不能小于 ${min}` };
    }
    if (num > max) {
        return { valid: false, error: `数值不能大于 ${max}` };
    }
    return { valid: true, error: '' };
}

/**
 * 清理和验证用户输入
 * @param {string} input - 用户输入
 * @returns {string} 清理后的输入
 */
function sanitizeInput(input) {
    if (!input) return '';
    // 转义HTML特殊字符
    let sanitized = escapeHtml(input);
    // 移除潜在的危险字符序列
    sanitized = sanitized.replace(/javascript:/gi, '');
    sanitized = sanitized.replace(/data:/gi, '');
    sanitized = sanitized.replace(/vbscript:/gi, '');
    return sanitized;
}

// 导出函数
window.escapeHtml = escapeHtml;
window.validateSceneDescription = validateSceneDescription;
window.validateModelDescription = validateModelDescription;
window.validateFileUpload = validateFileUpload;
window.validateNumber = validateNumber;
window.sanitizeInput = sanitizeInput;