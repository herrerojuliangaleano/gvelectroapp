@echo off
setlocal
cd /d "%~dp0"
title ElectroGV - Apagar app (Docker)

echo Apagando ElectroGV...
docker compose down
echo.
echo Listo. La base y los archivos quedan guardados en backend\storage.
echo.
pause
