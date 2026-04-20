@echo off
chcp 65001 > nul
title Aragon Write ✍
cd /d "%~dp0"
echo.
echo   ✍  Aragon Write — جاري التشغيل...
echo.
start /min "" cmd /c "timeout /t 6 /nobreak > nul && start http://localhost:5173"
npm run dev
