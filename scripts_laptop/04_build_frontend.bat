@echo off
setlocal
cd /d "%~dp0\..\frontend"

echo ===============================================
echo ElectroGV - Build del frontend
echo ===============================================
echo Carpeta: %CD%
echo.

call npm install
if errorlevel 1 (
  echo ERROR: npm install fallo.
  pause
  exit /b 1
)

call npm run build
if errorlevel 1 (
  echo ERROR: npm run build fallo.
  pause
  exit /b 1
)

echo.
echo Build completado. Archivos en frontend\dist\
echo.
pause
