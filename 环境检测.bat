@echo off
chcp 65001 >nul
title virtual-world 环境检测
cd /d "%~dp0"
echo.
echo ╔══════════════════════════════════════════════════════╗
echo ║       virtual-world 环境检测脚本                      ║
echo ╚══════════════════════════════════════════════════════╝
echo.
node check-env.js
echo.
pause
