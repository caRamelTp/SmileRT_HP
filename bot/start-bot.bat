@echo off
chcp 65001 >nul 2>&1
cd /d d:\動画保存場所\SmileRT_HP\bot

:loop
echo [%date% %time%] Starting SmileRT Bot...
node src/index.js
echo [%date% %time%] Bot stopped. Restarting in 5 seconds...
timeout /t 5 /nobreak >nul
goto loop
