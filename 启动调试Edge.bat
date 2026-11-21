@echo off
chcp 65001 >nul
echo 正在启动调试版 Edge（独立配置，不影响平时的浏览器）...
start "" "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --remote-debugging-port=9222 --remote-allow-origins=* --user-data-dir="C:\Users\a\AppData\Local\Temp\edge-cdp" --no-first-run --no-default-browser-check --noerrdialogs --window-position=2560,300 --window-size=1707,1067 "https://mooc2-ans.chaoxing.com/mooc2-ans-vue/situationalDialogue/chat?courseid=262868280&clazzid=150426303&cpi=563371672&publishRelationUuid=037bff9c-2e11-4f83-bf49-3603f4e56176"
echo 若页面要求登录，请在窗口内扫码/输入账号登录（登录一次后长期有效）。
timeout /t 5 >nul