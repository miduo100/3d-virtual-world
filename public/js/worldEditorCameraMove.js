/**
 * worldEditorCameraMove.js
 * 世界编辑器 WASD 相机移动（第一人称式水平平移）
 *
 * 按键：
 *   W / S    前 / 后移动（沿相机朝向，投影到水平面）
 *   A / D    左 / 右平移
 *   空格     加速（3 倍，避免与 Shift 多选冲突）
 *
 * 细节说明：
 *   - 焦点在输入控件（input/textarea/select/contenteditable）时自动忽略
 *   - IME 组合输入（isComposing）期间忽略，中文输入不误触
 *   - TransformControls 拖动中 controls.enabled === false → 自动禁用 WASD
 *   - 平移时同步移动 OrbitControls.target，旋转中心跟随、视角不漂移
 *   - 移动时刷新主页面 _idleSince（空闲降帧计时），保持全帧率手感
 *   - 窗口失焦清空按键状态，防止"卡键"
 *
 * 用法（world_editor.html）：
 *   1. 引入：<script src="js/worldEditorCameraMove.js"></script>
 *   2. initThreeJS() 中 OrbitControls 创建后：window.initWASDCameraMove(camera, controls);
 *   3. animate() 中 controls.update() 之后：window.tickWASDCameraMove();
 */
(function () {
    'use strict';

    let _camera = null;    // THREE.PerspectiveCamera
    let _controls = null;  // THREE.OrbitControls
    let _keys = {};        // 当前按住的按键（小写 key）
    let _lastTime = 0;     // 上一帧时间戳
    let _bound = false;    // 事件监听是否已绑定

    // 速度配置（单位/秒）。世界场景范围约 ±250，基础 40 适中，空格 3 倍加速
    const BASE_SPEED = 40;
    const FAST_MULTIPLIER = 3;

    // 焦点是否在输入控件上（打字时不触发移动）
    function _isTyping(el) {
        if (!el) return false;
        const tag = el.tagName;
        return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
    }

    function _onKeyDown(e) {
        if (e.isComposing) return; // IME 组合输入中不响应
        const k = e.key.toLowerCase();
        const isMoveKey = k === 'w' || k === 'a' || k === 's' || k === 'd';
        const isSpace = k === ' '; // 空格键 e.key 为单个空格字符
        if (!isMoveKey && !isSpace) return;
        if (_isTyping(document.activeElement)) return; // 输入控件中不响应（含空格打字）
        if (isMoveKey && (e.ctrlKey || e.altKey || e.metaKey)) return; // 组合键不响应
        _keys[k] = true;
        _wakeIdle();
        e.preventDefault(); // 防止 WASD/空格 触发页面滚动、按钮激活等默认行为
    }

    function _onKeyUp(e) {
        const k = e.key.toLowerCase();
        if (_keys[k]) _keys[k] = false;
        _wakeIdle();
    }

    function _onBlur() {
        _keys = {}; // 窗口失焦清空按键，防止"卡键"
    }

    // 重置主页面空闲降帧计时（_idleSince 为内联 script 的 let 全局变量，typeof 探测防耦合）
    function _wakeIdle() {
        if (typeof _idleSince !== 'undefined') _idleSince = performance.now();
    }

    // 每帧驱动：由 animate() 调用
    function tick() {
        if (!_camera || !_controls) return;
        // TransformControls 拖动中 controls.enabled === false → 禁用 WASD
        if (!_controls.enabled) return;

        const now = performance.now();
        const delta = _lastTime ? Math.min((now - _lastTime) / 1000, 0.05) : 0;
        _lastTime = now;
        if (delta <= 0) return;

        // 前方向：相机朝向投影到水平面
        const forward = new THREE.Vector3();
        _camera.getWorldDirection(forward);
        forward.y = 0;
        if (forward.lengthSq() < 1e-6) return; // 相机几乎垂直俯视时退化
        forward.normalize();

        // 右方向：相机本地 X 轴投影到水平面
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(_camera.quaternion);
        right.y = 0;
        if (right.lengthSq() < 1e-6) return;
        right.normalize();

        // 合成移动方向
        let mx = 0, mz = 0;
        if (_keys['w']) { mx += forward.x; mz += forward.z; }
        if (_keys['s']) { mx -= forward.x; mz -= forward.z; }
        if (_keys['d']) { mx += right.x; mz += right.z; }
        if (_keys['a']) { mx -= right.x; mz -= right.z; }

        const len = Math.hypot(mx, mz);
        if (len < 1e-6) return;

        // 归一化 × 速度 × 帧间隔（斜向移动不加速）
        const speed = (_keys[' '] ? BASE_SPEED * FAST_MULTIPLIER : BASE_SPEED) * delta;
        const dx = mx / len * speed;
        const dz = mz / len * speed;

        // 平移相机 + 同步 OrbitControls 目标点（旋转中心跟随，视角不漂移）
        _camera.position.x += dx;
        _camera.position.z += dz;
        _controls.target.x += dx;
        _controls.target.z += dz;

        _wakeIdle(); // 持续移动期间保持全帧率
    }

    // 初始化：传入相机与轨道控制器
    function init(camera, controls) {
        if (!camera || !controls) return;
        _camera = camera;
        _controls = controls;
        if (!_bound) {
            window.addEventListener('keydown', _onKeyDown, { passive: false });
            window.addEventListener('keyup', _onKeyUp);
            window.addEventListener('blur', _onBlur);
            _bound = true;
        }
    }

    window.initWASDCameraMove = init;
    window.tickWASDCameraMove = tick;
})();
