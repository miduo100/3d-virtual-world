@echo off
chcp 65001 >nul
title 创世虚拟世界服务器

REM ============ 工作目录自检（以批处理自身所在目录为准，不依赖硬编码路径） ============
REM 无论从何处启动，都切换到本 .bat 文件所在的目录作为工作目录
cd /d "%~dp0"

echo [自检] 工作目录   : %CD%
echo [自检] server.js  : %CD%\src\server.js

if not exist "src\server.js" (
  echo.
  echo [错误] 当前目录下未找到 src\server.js，可能不是完整的项目目录！
  echo.
  pause
  exit /b 1
)

echo [自检] 通过：即将启动本项目 (%CD%)
echo.

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
node src/server.js
if errorlevel 1 (
  echo.
  echo [错误] 服务器启动失败！请查看上方红色错误信息。
  echo 常见原因:
  echo   1. 端口 3002 已被占用  - 可运行: netstat -ano ^| findstr :3002 查看占用进程
  echo   2. 数据库(PostgreSQL)未启动或密码错误
  echo   3. 依赖缺失  - 请运行: npm install
  echo 也可先运行 环境检测.bat 排查环境问题。
)
echo.
pause
