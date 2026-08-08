/**
 * 管理员个人设置模块
 * 功能：修改密码、修改个人信息（显示名称、邮箱）
 * 依赖：后端 API /api/admin-auth/* (adminAuth.js)
 */
(function() {
  'use strict';

  var API_BASE = '/api/admin-auth';
  var token = localStorage.getItem('adminToken');

  // ===== 初始化 =====
  function init() {
    loadProfile();
    bindEvents();
  }

  // ===== 加载个人信息 =====
  function loadProfile() {
    fetch(API_BASE + '/profile', {
      headers: { 'Authorization': 'Bearer ' + token }
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.success && data.adminUser) {
        var u = data.adminUser;
        document.getElementById('profileUsername').textContent = u.username || '-';
        document.getElementById('profileFullName').value = u.full_name || '';
        document.getElementById('profileEmail').value = u.email || '';
        // 同步更新侧边栏显示名称
        var sidebarName = document.getElementById('adminName');
        if (sidebarName) sidebarName.textContent = u.full_name || u.username;
      }
    })
    .catch(function(err) {
      console.error('加载个人信息失败:', err);
    });
  }

  // ===== 绑定事件 =====
  function bindEvents() {
    // 保存个人信息
    document.getElementById('btnSaveProfile').addEventListener('click', saveProfile);
    // 修改密码
    document.getElementById('btnChangePassword').addEventListener('click', changePassword);
  }

  // ===== 保存个人信息 =====
  function saveProfile() {
    var fullName = document.getElementById('profileFullName').value.trim();
    var email = document.getElementById('profileEmail').value.trim();

    if (!fullName) {
      showMsg('profileMsg', '请输入显示名称', 'error');
      return;
    }

    var btn = document.getElementById('btnSaveProfile');
    btn.disabled = true;
    btn.textContent = '保存中...';
    hideMsg('profileMsg');

    fetch(API_BASE + '/profile', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token
      },
      body: JSON.stringify({ full_name: fullName, email: email })
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.success) {
        showMsg('profileMsg', '✅ 信息更新成功', 'success');
        // 更新 localStorage
        var adminUser = JSON.parse(localStorage.getItem('adminUser') || '{}');
        adminUser.full_name = fullName;
        adminUser.email = email;
        localStorage.setItem('adminUser', JSON.stringify(adminUser));
        // 更新侧边栏
        var sidebarName = document.getElementById('adminName');
        if (sidebarName) sidebarName.textContent = fullName;
      } else {
        showMsg('profileMsg', data.error || '更新失败', 'error');
      }
    })
    .catch(function(err) {
      showMsg('profileMsg', '网络错误，请稍后重试', 'error');
      console.error('保存信息失败:', err);
    })
    .finally(function() {
      btn.disabled = false;
      btn.textContent = '保存修改';
    });
  }

  // ===== 修改密码 =====
  function changePassword() {
    var currentPwd = document.getElementById('currentPassword').value;
    var newPwd = document.getElementById('newPassword').value;
    var confirmPwd = document.getElementById('confirmPassword').value;

    // 验证
    if (!currentPwd) { showMsg('pwdMsg', '请输入当前密码', 'error'); return; }
    if (!newPwd) { showMsg('pwdMsg', '请输入新密码', 'error'); return; }
    if (newPwd.length < 8) { showMsg('pwdMsg', '新密码长度不能少于8位', 'error'); return; }
    if (newPwd !== confirmPwd) { showMsg('pwdMsg', '两次输入的新密码不一致', 'error'); return; }

    var btn = document.getElementById('btnChangePassword');
    btn.disabled = true;
    btn.textContent = '修改中...';
    hideMsg('pwdMsg');

    fetch(API_BASE + '/change-password', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token
      },
      body: JSON.stringify({
        currentPassword: currentPwd,
        newPassword: newPwd
      })
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.success) {
        showMsg('pwdMsg', '✅ 密码修改成功！下次登录请使用新密码。', 'success');
        // 清空表单
        document.getElementById('currentPassword').value = '';
        document.getElementById('newPassword').value = '';
        document.getElementById('confirmPassword').value = '';
      } else {
        showMsg('pwdMsg', data.error || '修改失败', 'error');
      }
    })
    .catch(function(err) {
      showMsg('pwdMsg', '网络错误，请稍后重试', 'error');
      console.error('修改密码失败:', err);
    })
    .finally(function() {
      btn.disabled = false;
      btn.textContent = '修改密码';
    });
  }

  // ===== 消息提示 =====
  function showMsg(id, text, type) {
    var el = document.getElementById(id);
    el.textContent = text;
    el.className = 'form-msg ' + (type === 'success' ? 'msg-success' : 'msg-error');
    el.style.display = 'block';
  }

  function hideMsg(id) {
    var el = document.getElementById(id);
    if (el) el.style.display = 'none';
  }

  // ===== 暴露给全局 =====
  window.initAdminProfile = init;

})();
