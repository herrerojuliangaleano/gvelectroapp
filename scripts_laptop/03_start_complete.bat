@echo off
title ElectroGV Web Tools - Inicio completo

echo ===============================================
echo ElectroGV - Inicio completo (Backend + Ngrok)
echo ===============================================
echo.
echo Abriendo terminal del Backend...
start "ElectroGV Backend" cmd /k "call \"%~dp001_start_backend.bat\""

timeout /t 5 /nobreak >nul

echo Abriendo terminal de Ngrok...
start "ElectroGV Ngrok" cmd /k "call \"%~dp002_start_ngrok_fixed_backend.bat\""

echo.
echo Ambas terminales se abrieron.
echo Backend:  http://127.0.0.1:8000
echo Ngrok:    ver la terminal de Ngrok para la URL publica
echo Frontend: (ver VITE_API_BASE_URL en frontend/.env o configuracion de Render)
echo.
pause
