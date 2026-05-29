@echo off
setlocal
title ElectroGV - ngrok (exponer backend)

REM Requiere tener ngrok instalado y en el PATH (https://ngrok.com/download)
where ngrok >nul 2>&1
if errorlevel 1 (
  echo [ERROR] No se encontro ngrok en el PATH.
  echo Instalalo desde https://ngrok.com/download y volve a intentar.
  pause
  exit /b 1
)

echo Exponiendo el backend (http://localhost:8000) con ngrok...
echo Copia la URL https://....ngrok-free.dev y ponela como API del frontend (Vercel).
echo.
ngrok http 8000
