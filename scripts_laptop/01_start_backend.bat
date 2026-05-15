@echo off
setlocal
cd /d "%~dp0\..\backend"

echo ===============================================
echo ElectroGV - Backend local laptop
echo ===============================================
echo Carpeta: %CD%
echo.

if not exist ".env" (
  echo No existe backend\.env.
  echo Se va a copiar .env.laptop.example como .env.
  echo Despues abrilo y completalo con tus URLs reales.
  copy ".env.laptop.example" ".env" >nul
  notepad ".env"
)

if not exist ".venv\Scripts\python.exe" (
  echo Creando entorno virtual con Python 3.11...
  py -3.11 -m venv .venv
  if errorlevel 1 (
    echo ERROR: No se pudo crear .venv con Python 3.11.
    echo Instalá Python 3.11 y probá de nuevo.
    pause
    exit /b 1
  )
)

echo Instalando/actualizando dependencias...
.venv\Scripts\python.exe -m pip install --upgrade pip
.venv\Scripts\python.exe -m pip install -r requirements.txt

if not exist "storage\private" mkdir "storage\private"

echo.
echo Backend en: http://127.0.0.1:8080
echo Health:     http://127.0.0.1:8080/api/health
echo.
.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8080

pause
