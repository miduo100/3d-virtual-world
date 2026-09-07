@echo off
chcp 65001 >nul
title 创世虚拟世界服务器

REM ============ 项目根目录自检（防止误启动其他目录的项目） ============
REM 期望本项目根目录；如果项目移动了，请修改下面这一行
set "EXPECTED_ROOT=L:\shegnjir185"

cd /d "%~dp0"

REM 取当前目录的规范化绝对路径（去掉结尾的反斜杠）
set "CURRENT_ROOT=%CD%"
if "%CURRENT_ROOT:~-1%"=="\" set "CURRENT_ROOT=%CURRENT_ROOT:~0,-1%"

REM 规范化期望路径（去掉结尾的反斜杠）
set "EXPECTED_NORM=%EXPECTED_ROOT%"
if "%EXPECTED_NORM:~-1%"=="\" set "EXPECTED_NORM=%EXPECTED_NORM:~0,-1%"

echo [自检] 当前目录   : %CURRENT_ROOT%
echo [自检] 期望目录   : %EXPECTED_NORM%
echo [自检] server.js  : %CD%\src\server.js

if /i not "%CURRENT_ROOT%"=="%EXPECTED_NORM%" (
  echo.
  echo [错误] 此启动脚本不在本项目目录，已中止启动！
  echo   当前目录: %CURRENT_ROOT%
  echo   期望目录: %EXPECTED_NORM%
  echo   请确认你双击的是 %EXPECTED_NORM%\启动服务器.bat
  echo.
  pause
  exit /b 1
)

if not exist "src\server.js" (
  echo.
  echo [错误] 当前目录下未找到 src\server.js，可能不是完整的项目目录！
  echo.
  pause
  exit /b 1
)

echo [自检] 通过：即将启动本项目 (l:\shegnjir185)
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
