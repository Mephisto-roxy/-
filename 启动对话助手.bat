@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title 学习通AI实践-对话助手
set "NODE_EXE="
if exist "node\node.exe" set "NODE_EXE=node\node.exe"
if not defined NODE_EXE (
  where node >nul 2>nul
  if not errorlevel 1 set "NODE_EXE=node"
)
if not defined NODE_EXE (
  echo [x] 未找到 Node.js, 请安装 Node 21 或更高版本: https://nodejs.org
  pause
  exit /b 1
)
if not exist chat-url.txt echo [i] 提示: 尚未配置作业链接, 可先运行「设置作业链接.bat」。
if "%~1"=="" (
  "%NODE_EXE%" cdp-chat.js --launch
) else (
  "%NODE_EXE%" cdp-chat.js %*
)
echo.
pause