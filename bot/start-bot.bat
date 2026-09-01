@echo off
cd /d d:\動画保存場所\SmileRT_HP\bot

:loop
echo [%date% %time%] SmileRT Bot 起動中...
node src/index.js
echo [%date% %time%] Bot が停止しました。5秒後に再起動...
timeout /t 5 /nobreak >nul
goto loop
