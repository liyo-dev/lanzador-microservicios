@echo off
REM Script para actualizar la URL del servidor después del deploy
REM Uso: update-server-url.bat "tu-nueva-url.onrender.com"

if "%~1"=="" (
    echo ❌ Error: Proporciona la URL del servidor
    echo 💡 Uso: update-server-url.bat tu-app.onrender.com
    exit /b 1
)

set SERVER_URL=%~1
set CONFIG_FILE=src\app\config\virtual-office.config.ts

REM Verificar que el archivo existe
if not exist "%CONFIG_FILE%" (
    echo ❌ Error: No se encuentra %CONFIG_FILE%
    exit /b 1
)

echo 🔄 Actualizando URL del servidor...
echo 📍 Nueva URL: wss://%SERVER_URL%

REM Crear respaldo
copy "%CONFIG_FILE%" "%CONFIG_FILE%.backup" >nul

REM Actualizar la configuración usando PowerShell
powershell -Command "(Get-Content '%CONFIG_FILE%') -replace 'defaultUrl: ''[^'']*''', 'defaultUrl: ''wss://%SERVER_URL%''' | Set-Content '%CONFIG_FILE%'"

echo ✅ URL actualizada en %CONFIG_FILE%
echo.
echo 🎯 Siguientes pasos:
echo   1. git add .
echo   2. git commit -m "Actualizar URL servidor Render"
echo   3. git push origin main
echo.
echo 🚀 ¡Listo para probar la oficina virtual!
pause