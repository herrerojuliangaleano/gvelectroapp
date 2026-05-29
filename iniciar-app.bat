@echo off
setlocal
cd /d "%~dp0"
title ElectroGV - Iniciar app (Docker)

echo ================================================
echo   ElectroGV - Iniciar app (Docker)
echo ================================================
echo.

REM 1) Verificar que Docker este corriendo
docker info >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Docker no esta corriendo.
  echo Abri "Docker Desktop", espera a que diga "Engine running" y volve a ejecutar este archivo.
  echo.
  pause
  exit /b 1
)

REM 2) Asegurar que exista backend\.env
if not exist "backend\.env" (
  echo [AVISO] No existe backend\.env
  echo Copiando plantilla backend\.env.docker.example -^> backend\.env ...
  copy "backend\.env.docker.example" "backend\.env" >nul
  echo.
  echo Edita backend\.env con tus valores reales ^(AUTH_SECRET, CORS, etc.^) y volve a ejecutar.
  notepad "backend\.env"
  pause
  exit /b 0
)

REM 3) Levantar (la primera vez compila la imagen; despues es rapido)
echo Levantando contenedores... (la primera vez puede tardar varios minutos)
docker compose up -d --build
if errorlevel 1 (
  echo.
  echo [ERROR] No se pudo levantar. Mira el detalle con:  docker compose logs -f
  pause
  exit /b 1
)

echo.
echo ================================================
echo   App lista.
echo   Backend:   http://localhost:8000/api/health
echo   Logs:      docker compose logs -f
echo   Apagar:    apagar-app.bat
echo.
echo   Para exponerla con ngrok:  iniciar-ngrok.bat
echo ================================================
echo.
pause
