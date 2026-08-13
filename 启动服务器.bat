@echo off
chcp 65001 >nul
title 创世虚拟世界服务器
cd /d "%~dp0"
echo ========================================
echo   创世虚拟世界 - 服务器启动中...
echo ========================================
echo.
echo   访问地址:  http://localhost:3002
echo   管理后台:  http://localhost:3002/admin_login.html
echo   默认账号:  admin / admin123456
echo.
echo   按 Ctrl+C 停止服务器
echo ========================================
echo.
npm start
pause
