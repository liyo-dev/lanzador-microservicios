@echo off
echo 🚀 Preparando deploy de Oficina Virtual...

REM Verificar que git esté inicializado
if not exist ".git" (
    echo ❌ No se detectó repositorio git. Inicializando...
    git init
    git add .
    git commit -m "Proyecto inicial para deploy"
)

REM Crear .gitignore si no existe
if not exist ".gitignore" (
    echo 📝 Creando .gitignore...
    echo node_modules/ > .gitignore
    echo dist/ >> .gitignore
    echo *.log >> .gitignore
    echo .env >> .gitignore
    echo .env.local >> .gitignore
    echo .DS_Store >> .gitignore
    echo Thumbs.db >> .gitignore
)

REM Verificar package.json
echo ✅ Verificando package.json...
findstr /c:"start.*node virtual-office-server.js" package.json >nul
if %errorlevel% == 0 (
    echo ✅ Script start configurado correctamente
) else (
    echo ⚠️  Script start no configurado correctamente
    echo    Asegúrate de que package.json tenga: "start": "node virtual-office-server.js"
)

echo.
echo 📋 Archivos de configuración creados:
echo   ✅ railway.json (para Railway)
echo   ✅ render.yaml (para Render) 
echo   ✅ virtual-office.config.ts (configuración Angular)
echo   ✅ DEPLOY-CLOUD.md (guía completa)

echo.
echo 🎯 Siguientes pasos:
echo   1. git add .
echo   2. git commit -m "Configurar para deploy cloud"
echo   3. git push origin main
echo   4. Seguir la guía en DEPLOY-CLOUD.md

echo.
echo 🌐 Servicios recomendados:
echo   🥇 Railway: https://railway.app/ (más fácil)
echo   🥈 Render: https://render.com/ (alternativa)
echo   🥉 Cyclic: https://cyclic.sh/ (simple)

echo.
echo ✨ ¡Listo para deploy!
pause