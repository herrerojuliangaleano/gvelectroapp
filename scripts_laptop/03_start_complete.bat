@echo off
setlocal
title ElectroGV Web Tools - Backend + Ngrok

echo ===============================================
echo ElectroGV Web Tools - Inicio completo
echo ===============================================
echo.

cd /d "%~dp0\..\backend"

echo Carpeta backend:
echo %CD%
echo.

if not exist ".env" (
  echo ERROR: No existe backend\.env
  echo Copia .env.laptop.example como .env y completalo.
  pause
  exit /b 1
)

if not exist ".venv\Scripts\python.exe" (
  echo Creando entorno virtual con Python 3.11...
  py -3.11 -m venv .venv
  if errorlevel 1 (
    echo ERROR: No se pudo crear .venv con Python 3.11.
    echo Instala Python 3.11 y proba de nuevo.
    pause
    exit /b 1
  )
)

echo Instalando/actualizando dependencias...
.venv\Scripts\python.exe -m pip install --upgrade pip
.venv\Scripts\python.exe -m pip install -r requirements.txt

if not exist "storage\private" mkdir "storage\private"

echo.
echo Iniciando backend local en puerto 8080...
echo Backend: http://127.0.0.1:8080
echo Health:  http://127.0.0.1:8080/api/health
echo.

start "ElectroGV Backend" cmd /k ".venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8080"

timeout /t 5 /nobreak >nul

echo Iniciando ngrok...
echo Ngrok: https://electrogv.ngrok.dev
echo.

start "ElectroGV Ngrok" cmd /k "ngrok http --domain=electrogv.ngrok.dev 8080"

echo.
echo ===============================================
echo Sistema iniciado
echo ===============================================
echo Backend local: http://127.0.0.1:8080
echo Backend publico: https://electrogv.ngrok.dev
echo Frontend: https://electrogv.vayori.net
echo ===============================================
echo.
pause