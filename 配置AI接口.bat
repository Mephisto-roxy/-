@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
echo ============================================================
echo  配置自动模式的 AI 接口（完全可选）
echo  不配置 = 手动模式，不调用任何 API，不花钱
echo ============================================================
echo  1) DeepSeek
echo  2) 智谱 GLM
echo  3) OpenAI
echo  4) 自定义（任意 OpenAI 兼容接口）
set /p CHOICE=选择 1-4 后回车: 
set "API="
set "DEFMODEL="
if "%CHOICE%"=="1" ( set "API=https://api.deepseek.com/chat/completions" & set "DEFMODEL=deepseek-chat" )
if "%CHOICE%"=="2" ( set "API=https://open.bigmodel.cn/api/paas/v4/chat/completions" & set "DEFMODEL=glm-4.5" )
if "%CHOICE%"=="3" ( set "API=https://api.openai.com/v1/chat/completions" & set "DEFMODEL=gpt-4o-mini" )
if "%CHOICE%"=="4" ( set /p "API=输入完整接口地址: " & set /p "DEFMODEL=输入模型名: " )
if not defined API ( echo 未选择，已取消。 & pause & exit /b 0 )
set /p "KEY=粘贴你的 API Key 后回车: "
if "%KEY%"=="" ( echo Key 不能为空，已取消 & pause & exit /b 0 )
set /p "MODEL=模型名（直接回车=%DEFMODEL%）: "
if "%MODEL%"=="" set "MODEL=%DEFMODEL%"
set /p "ROUNDS=每次自动对话轮数（回车=5）: "
if "%ROUNDS%"=="" set "ROUNDS=5"
(
  echo api=%API%
  echo key=%KEY%
  echo model=%MODEL%
  echo rounds=%ROUNDS%
) > llm-config.txt
echo.
echo [OK] 已保存到 llm-config.txt（含你的私钥，已被 .gitignore 忽略，请勿外传）
echo 之后运行: 启动对话助手.bat --auto   即可全自动对话
pause