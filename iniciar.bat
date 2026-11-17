@echo off
title Professor Maluco
cd /d "%~dp0"
echo Ligando o Professor Maluco...
start "" cmd /c "timeout /t 2 >nul & start http://localhost:3000/painel & start http://localhost:3000"
node servidor.js
pause
