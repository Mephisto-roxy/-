@echo off
chcp 65001 >nul
title 学习通AI实践-对话助手(CDP)
set "NODE_EXE=node"
where node >nul 2>nul
if errorlevel 1 set "NODE_EXE=C:\Users\a\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
if "%~1"=="" (
  "%NODE_EXE%" "%~dp0cdp-chat.js" --launch
) else (
  "%NODE_EXE%" "%~dp0cdp-chat.js" %*
)
echo.
pause