@echo off
title Professor Maluco (TESTE RAPIDO)
cd /d "%~dp0"
echo Ligando o Professor Maluco no modo de TESTE (rodadas de 20 s)...
start "" cmd /c "timeout /t 2 >nul & start http://localhost:3000/painel & start http://localhost:3000"
node servidor.js --rapido
pause
