@echo off
setlocal
cd /d "%~dp0"
title ElectroGV - Panel local

:menu
cls
echo ==================================================
echo   ElectroGV - Panel local
echo ==================================================
echo.
echo DEV / prueba local
echo   1  Levantar DEV              ^(backend 8000 / DB electrogv_dev^)
echo   2  Migrar DEV                ^(Alembic^)
echo   3  Seed DEV                  ^(datos base^)
echo   4  Ngrok DEV                 ^(electrogvdev.ngrok.dev^)
echo   5  Apagar DEV
echo.
echo PRODUCCION LOCAL
echo   6  Levantar PROD local       ^(backend 8010 / DB electrogv^)
echo   7  Migrar PROD local         ^(Alembic^)
echo   8  Seed PROD local           ^(datos base^)
echo   9  Ngrok PROD local          ^(electrogv.ngrok.dev^)
echo   10 Apagar PROD local
echo.
echo ANDROID
echo   11 Compilar APK obligatoria
echo.
echo GOOGLE
echo   18 Generar token OAuth Google
echo.
echo DATOS
echo   12 Backup DEV
echo   13 Backup PROD local
echo   14 Restaurar DEV desde backup
echo   15 Restaurar PROD local desde backup
echo   16 Clonar PROD local -^> DEV
echo   17 Promover DEV -^> PROD local
echo.
echo   0  Salir
echo.
set /p OPT="Elegir opcion: "

if "%OPT%"=="1" (
  call :dev_up
  goto menu
)
if "%OPT%"=="2" (
  call :dev_migrate
  goto menu
)
if "%OPT%"=="3" (
  call :dev_seed
  goto menu
)
if "%OPT%"=="4" (
  call :dev_ngrok
  goto menu
)
if "%OPT%"=="5" (
  call :dev_down
  goto menu
)
if "%OPT%"=="6" (
  call :prod_up
  goto menu
)
if "%OPT%"=="7" (
  call :prod_migrate
  goto menu
)
if "%OPT%"=="8" (
  call :prod_seed
  goto menu
)
if "%OPT%"=="9" (
  call :prod_ngrok
  goto menu
)
if "%OPT%"=="10" (
  call :prod_down
  goto menu
)
if "%OPT%"=="11" (
  call :android_required
  goto menu
)
if "%OPT%"=="12" (
  call :backup_dev
  goto menu
)
if "%OPT%"=="13" (
  call :backup_prod
  goto menu
)
if "%OPT%"=="14" (
  call :restore_dev
  goto menu
)
if "%OPT%"=="15" (
  call :restore_prod
  goto menu
)
if "%OPT%"=="16" (
  call :clone_prod_to_dev
  goto menu
)
if "%OPT%"=="17" (
  call :promote_dev_to_prod
  goto menu
)
if "%OPT%"=="18" (
  call :google_oauth_token
  goto menu
)
if "%OPT%"=="0" exit /b 0

echo.
echo Opcion invalida.
pause
goto menu

:check_docker
docker info >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Docker no esta corriendo.
  echo Abri Docker Desktop, espera a que el engine este listo y volve a intentar.
  pause
  exit /b 1
)
exit /b 0

:check_ngrok
where ngrok >nul 2>&1
if errorlevel 1 (
  echo [ERROR] No se encontro ngrok en el PATH.
  echo Instala ngrok y ejecuta: ngrok config add-authtoken TU_TOKEN_NGROK
  pause
  exit /b 1
)
exit /b 0

:ensure_dev_env
if not exist "backend\.env" (
  echo [AVISO] No existe backend\.env.
  echo Copiando backend\.env.docker.example -^> backend\.env ...
  copy "backend\.env.docker.example" "backend\.env" >nul
  notepad "backend\.env"
  pause
  exit /b 1
)
exit /b 0

:ensure_prod_env
if not exist "backend\.env.production.local" (
  echo [ERROR] Falta backend\.env.production.local.
  echo Copiando plantilla...
  copy "backend\.env.production.local.example" "backend\.env.production.local" >nul
  notepad "backend\.env.production.local"
  pause
  exit /b 1
)
findstr /I /C:"CAMBIAR_" /C:"TU-FRONTEND" /C:"TU-DOMINIO" /C:"TU_ID_DE_PLANILLA" "backend\.env.production.local" >nul
if not errorlevel 1 (
  echo [ERROR] Hay placeholders pendientes en backend\.env.production.local.
  notepad "backend\.env.production.local"
  pause
  exit /b 1
)
exit /b 0

:load_dev_db
set POSTGRES_USER=electrogv
set POSTGRES_DB=electrogv_dev
if exist "backend\.env" (
  for /f "tokens=1,* delims==" %%A in ('findstr /B "POSTGRES_USER=" "backend\.env"') do set POSTGRES_USER=%%B
  for /f "tokens=1,* delims==" %%A in ('findstr /B "POSTGRES_DB=" "backend\.env"') do set POSTGRES_DB=%%B
)
exit /b 0

:load_prod_db
set PROD_POSTGRES_USER=electrogv_prod
set PROD_POSTGRES_DB=electrogv
if exist "backend\.env.production.local" (
  for /f "tokens=1,* delims==" %%A in ('findstr /B "PROD_POSTGRES_USER=" "backend\.env.production.local"') do set PROD_POSTGRES_USER=%%B
  for /f "tokens=1,* delims==" %%A in ('findstr /B "PROD_POSTGRES_DB=" "backend\.env.production.local"') do set PROD_POSTGRES_DB=%%B
)
exit /b 0

:timestamp
for /f %%I in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd_HH-mm"') do set STAMP=%%I
exit /b 0

:dev_up
call :check_docker || exit /b 1
call :ensure_dev_env || exit /b 1
echo Levantando DEV...
docker compose up -d --build
if errorlevel 1 goto command_error
echo.
echo DEV listo:
echo   Backend: http://localhost:8000/api/health
echo   Adminer: http://localhost:8080
pause
exit /b 0

:dev_down
call :check_docker || exit /b 1
echo Apagando DEV...
docker compose down
pause
exit /b 0

:dev_migrate
call :check_docker || exit /b 1
docker compose exec backend alembic upgrade head
if errorlevel 1 goto command_error
pause
exit /b 0

:dev_seed
call :check_docker || exit /b 1
docker compose exec backend python -m app.seed
if errorlevel 1 goto command_error
pause
exit /b 0

:dev_ngrok
call :check_ngrok || exit /b 1
set DEV_NGROK_DOMAIN=
if exist "backend\.env" (
  for /f "tokens=1,* delims==" %%A in ('findstr /B "DEV_NGROK_DOMAIN=" "backend\.env"') do set DEV_NGROK_DOMAIN=%%B
)
echo Exponiendo DEV http://localhost:8000
if "%DEV_NGROK_DOMAIN%"=="" (
  ngrok http 8000
) else (
  ngrok http 8000 --url=%DEV_NGROK_DOMAIN%
)
exit /b 0

:prod_up
call :check_docker || exit /b 1
call :ensure_prod_env || exit /b 1
echo Levantando PROD local...
docker compose --env-file "backend\.env.production.local" -f docker-compose.prod-local.yml up -d --build
if errorlevel 1 goto command_error
echo.
echo PROD local listo:
echo   Backend: http://localhost:8010/api/health
echo   Adminer: http://localhost:8081
pause
exit /b 0

:prod_down
call :check_docker || exit /b 1
call :ensure_prod_env || exit /b 1
echo Apagando PROD local...
docker compose --env-file "backend\.env.production.local" -f docker-compose.prod-local.yml down
pause
exit /b 0

:prod_migrate
call :check_docker || exit /b 1
call :ensure_prod_env || exit /b 1
docker compose --env-file "backend\.env.production.local" -f docker-compose.prod-local.yml exec backend-prod alembic upgrade head
if errorlevel 1 goto command_error
pause
exit /b 0

:prod_seed
call :check_docker || exit /b 1
call :ensure_prod_env || exit /b 1
docker compose --env-file "backend\.env.production.local" -f docker-compose.prod-local.yml exec backend-prod python -m app.seed
if errorlevel 1 goto command_error
pause
exit /b 0

:prod_ngrok
call :check_ngrok || exit /b 1
call :ensure_prod_env || exit /b 1
set PROD_BACKEND_PORT=8010
set PROD_NGROK_DOMAIN=
for /f "tokens=1,* delims==" %%A in ('findstr /B "PROD_BACKEND_PORT=" "backend\.env.production.local"') do set PROD_BACKEND_PORT=%%B
for /f "tokens=1,* delims==" %%A in ('findstr /B "PROD_NGROK_DOMAIN=" "backend\.env.production.local"') do set PROD_NGROK_DOMAIN=%%B
echo Exponiendo PROD local http://localhost:%PROD_BACKEND_PORT%
if "%PROD_NGROK_DOMAIN%"=="" (
  ngrok http %PROD_BACKEND_PORT%
) else (
  ngrok http %PROD_BACKEND_PORT% --url=%PROD_NGROK_DOMAIN%
)
exit /b 0

:android_required
echo Compilando APK obligatoria...
pushd frontend
npm.cmd run android:apk -- --required --changelog "Actualizacion obligatoria: entorno dev/prod separado y APK publicado desde Vercel."
set ANDROID_EXIT=%ERRORLEVEL%
popd
if not "%ANDROID_EXIT%"=="0" goto command_error
pause
exit /b 0

:google_oauth_token
echo Generando token OAuth de Google desde Windows...
if not exist "backend\.venv\Scripts\python.exe" (
  echo [ERROR] No existe backend\.venv\Scripts\python.exe.
  echo Crea/instala el entorno virtual del backend antes de generar el token.
  pause
  exit /b 1
)
if not exist "backend\storage\private\credentials.local.json" (
  echo [ERROR] Falta backend\storage\private\credentials.local.json.
  echo Copia el credentials OAuth ahi y volve a intentar.
  pause
  exit /b 1
)
pushd backend
.venv\Scripts\python.exe scripts\google_oauth_bootstrap.py
set GOOGLE_EXIT=%ERRORLEVEL%
popd
if not "%GOOGLE_EXIT%"=="0" goto command_error
echo.
echo Token generado en backend\storage\private\token.json.
echo Si la app ya estaba abierta, tocá "Actualizar estado" en OAuth Google.
pause
exit /b 0

:backup_dev
call :check_docker || exit /b 1
call :load_dev_db
if not exist "backend\backups" mkdir "backend\backups"
call :timestamp
set OUT=backend\backups\manual-dev-%STAMP%.sql
echo Generando backup DEV de %POSTGRES_DB% en %OUT% ...
docker compose exec -T postgres pg_dump -U "%POSTGRES_USER%" "%POSTGRES_DB%" > "%OUT%"
if errorlevel 1 goto command_error
echo Backup listo: %OUT%
pause
exit /b 0

:backup_prod
call :check_docker || exit /b 1
call :ensure_prod_env || exit /b 1
call :load_prod_db
if not exist "backend\backups-prod" mkdir "backend\backups-prod"
call :timestamp
set OUT=backend\backups-prod\manual-prod-%STAMP%.dump
echo Generando backup PROD local de %PROD_POSTGRES_DB% en %OUT% ...
docker compose --env-file "backend\.env.production.local" -f docker-compose.prod-local.yml exec -T postgres-prod pg_dump -U "%PROD_POSTGRES_USER%" -d "%PROD_POSTGRES_DB%" --format=custom --blobs > "%OUT%"
if errorlevel 1 goto command_error
echo Backup listo: %OUT%
pause
exit /b 0

:restore_dev
call :check_docker || exit /b 1
call :load_dev_db
echo Backups DEV disponibles:
dir /b backend\backups\*.sql 2>nul
echo.
set /p INFILE="Archivo a restaurar: "
set RESTORE_FILE=%INFILE%
if not exist "%RESTORE_FILE%" if exist "backend\backups\%INFILE%" set RESTORE_FILE=backend\backups\%INFILE%
if not exist "%RESTORE_FILE%" (
  echo [ERROR] No existe: %INFILE%
  pause
  exit /b 1
)
echo ATENCION: esto BORRA DEV "%POSTGRES_DB%".
set /p CONFIRM="Escribi RESTORE para confirmar: "
if /i not "%CONFIRM%"=="RESTORE" exit /b 0
docker compose exec -T postgres psql -U "%POSTGRES_USER%" -d postgres -c "DROP DATABASE IF EXISTS %POSTGRES_DB% WITH (FORCE);"
if errorlevel 1 goto command_error
docker compose exec -T postgres psql -U "%POSTGRES_USER%" -d postgres -c "CREATE DATABASE %POSTGRES_DB%;"
if errorlevel 1 goto command_error
docker compose exec -T postgres psql -U "%POSTGRES_USER%" -d "%POSTGRES_DB%" < "%RESTORE_FILE%"
if errorlevel 1 goto command_error
pause
exit /b 0

:restore_prod
call :check_docker || exit /b 1
call :ensure_prod_env || exit /b 1
call :load_prod_db
echo Backups PROD disponibles:
dir /b backend\backups-prod\*.dump 2>nul
echo.
set /p INFILE="Archivo a restaurar: "
set RESTORE_FILE=%INFILE%
if not exist "%RESTORE_FILE%" if exist "backend\backups-prod\%INFILE%" set RESTORE_FILE=backend\backups-prod\%INFILE%
if not exist "%RESTORE_FILE%" (
  echo [ERROR] No existe: %INFILE%
  pause
  exit /b 1
)
echo ATENCION: esto BORRA PROD local "%PROD_POSTGRES_DB%".
set /p CONFIRM="Escribi RESTORE-PROD para confirmar: "
if /i not "%CONFIRM%"=="RESTORE-PROD" exit /b 0
docker compose --env-file "backend\.env.production.local" -f docker-compose.prod-local.yml stop backend-prod db-backup-prod
docker compose --env-file "backend\.env.production.local" -f docker-compose.prod-local.yml exec -T postgres-prod psql -U "%PROD_POSTGRES_USER%" -d postgres -c "DROP DATABASE IF EXISTS %PROD_POSTGRES_DB% WITH (FORCE);"
if errorlevel 1 goto prod_restore_error
docker compose --env-file "backend\.env.production.local" -f docker-compose.prod-local.yml exec -T postgres-prod psql -U "%PROD_POSTGRES_USER%" -d postgres -c "CREATE DATABASE %PROD_POSTGRES_DB%;"
if errorlevel 1 goto prod_restore_error
docker compose --env-file "backend\.env.production.local" -f docker-compose.prod-local.yml exec -T postgres-prod pg_restore -U "%PROD_POSTGRES_USER%" -d "%PROD_POSTGRES_DB%" --no-owner --no-acl < "%RESTORE_FILE%"
if errorlevel 1 goto prod_restore_error
docker compose --env-file "backend\.env.production.local" -f docker-compose.prod-local.yml up -d backend-prod db-backup-prod
pause
exit /b 0

:clone_prod_to_dev
call :check_docker || exit /b 1
call :ensure_prod_env || exit /b 1
call :load_dev_db
call :load_prod_db
echo Esto BORRA DEV "%POSTGRES_DB%" y copia encima PROD local "%PROD_POSTGRES_DB%".
set /p CONFIRM="Escribi CLONAR para confirmar: "
if /i not "%CONFIRM%"=="CLONAR" exit /b 0
if not exist "backend\backups" mkdir "backend\backups"
call :timestamp
set OUT=backend\backups\clone-prod-to-dev-%STAMP%.dump
docker compose --env-file "backend\.env.production.local" -f docker-compose.prod-local.yml exec -T postgres-prod pg_dump -U "%PROD_POSTGRES_USER%" -d "%PROD_POSTGRES_DB%" --format=custom --blobs > "%OUT%"
if errorlevel 1 goto command_error
docker compose exec -T postgres psql -U "%POSTGRES_USER%" -d postgres -c "DROP DATABASE IF EXISTS %POSTGRES_DB% WITH (FORCE);"
if errorlevel 1 goto command_error
docker compose exec -T postgres psql -U "%POSTGRES_USER%" -d postgres -c "CREATE DATABASE %POSTGRES_DB%;"
if errorlevel 1 goto command_error
docker compose exec -T postgres pg_restore -U "%POSTGRES_USER%" -d "%POSTGRES_DB%" --no-owner --no-acl < "%OUT%"
if errorlevel 1 goto command_error
echo Clonado completo. Backup usado: %OUT%
pause
exit /b 0

:promote_dev_to_prod
call :check_docker || exit /b 1
call :ensure_prod_env || exit /b 1
call :load_dev_db
call :load_prod_db
echo ATENCION: esto BORRA PROD local "%PROD_POSTGRES_DB%" y copia encima DEV "%POSTGRES_DB%".
echo Usalo solo durante el corte, sin usuarios cargando datos.
set /p CONFIRM="Escribi PROMOVER para confirmar: "
if /i not "%CONFIRM%"=="PROMOVER" exit /b 0
if not exist "backend\backups-prod" mkdir "backend\backups-prod"
call :timestamp
set PRE_BACKUP=backend\backups-prod\pre-promote-prod-%STAMP%.dump
set DEV_DUMP=backend\backups-prod\promote-dev-to-prod-%STAMP%.dump
docker compose --env-file "backend\.env.production.local" -f docker-compose.prod-local.yml stop backend-prod db-backup-prod
docker compose --env-file "backend\.env.production.local" -f docker-compose.prod-local.yml exec -T postgres-prod pg_dump -U "%PROD_POSTGRES_USER%" -d "%PROD_POSTGRES_DB%" --format=custom --blobs > "%PRE_BACKUP%"
if errorlevel 1 goto prod_restore_error
docker compose exec -T postgres pg_dump -U "%POSTGRES_USER%" -d "%POSTGRES_DB%" --format=custom --blobs > "%DEV_DUMP%"
if errorlevel 1 goto prod_restore_error
docker compose --env-file "backend\.env.production.local" -f docker-compose.prod-local.yml exec -T postgres-prod psql -U "%PROD_POSTGRES_USER%" -d postgres -c "DROP DATABASE IF EXISTS %PROD_POSTGRES_DB% WITH (FORCE);"
if errorlevel 1 goto prod_restore_error
docker compose --env-file "backend\.env.production.local" -f docker-compose.prod-local.yml exec -T postgres-prod psql -U "%PROD_POSTGRES_USER%" -d postgres -c "CREATE DATABASE %PROD_POSTGRES_DB%;"
if errorlevel 1 goto prod_restore_error
docker compose --env-file "backend\.env.production.local" -f docker-compose.prod-local.yml exec -T postgres-prod pg_restore -U "%PROD_POSTGRES_USER%" -d "%PROD_POSTGRES_DB%" --no-owner --no-acl < "%DEV_DUMP%"
if errorlevel 1 goto prod_restore_error
docker compose --env-file "backend\.env.production.local" -f docker-compose.prod-local.yml up -d backend-prod db-backup-prod
echo Promocion completa.
echo Backup defensivo de PROD anterior: %PRE_BACKUP%
pause
exit /b 0

:prod_restore_error
echo [ERROR] Fallo una operacion sobre PROD local.
echo Intentando levantar backend-prod otra vez...
docker compose --env-file "backend\.env.production.local" -f docker-compose.prod-local.yml up -d backend-prod db-backup-prod
pause
exit /b 1

:command_error
echo.
echo [ERROR] La operacion fallo. Revisa la salida anterior.
pause
exit /b 1
