@echo off
setlocal

REM Cambiar este valor por tu dev domain de ngrok.
REM Ejemplo: abc123xyz.ngrok-free.dev
set NGROK_DOMAIN=TU_DOMINIO_NGROK.ngrok-free.dev

echo ===============================================
echo ElectroGV - ngrok tunnel fijo para backend
echo ===============================================
echo Backend local: http://127.0.0.1:8000
echo URL publica:  https://%NGROK_DOMAIN%
echo.
echo Si ngrok no esta instalado o no tiene authtoken:
echo   ngrok config add-authtoken TU_TOKEN_NGROK
echo.

ngrok http 8000 --url=%NGROK_DOMAIN%

pause
