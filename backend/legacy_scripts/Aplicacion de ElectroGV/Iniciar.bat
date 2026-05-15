@echo off
chcp 65001 >nul
title Herramientas Google Drive

echo ================================================
echo    Herramientas Google Drive - Iniciando...
echo ================================================
echo.

REM Verificar Python
python --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python no está instalado o no está en el PATH.
    echo.
    echo Instalá Python desde: https://www.python.org/downloads/
    echo Asegurate de tildar "Add Python to PATH" al instalar.
    pause
    exit /b 1
)

REM Instalar dependencias si no están
echo Verificando dependencias...
pip install google-auth google-auth-oauthlib google-auth-httplib2 google-api-python-client gspread pandas openpyxl >nul 2>&1
echo Dependencias OK.
echo.

REM Ejecutar la app
python "%~dp0launcher.py"

if errorlevel 1 (
    echo.
    echo [ERROR] La aplicacion cerro con un error.
    pause
)
