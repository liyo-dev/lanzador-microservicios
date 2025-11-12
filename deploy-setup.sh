#!/bin/bash

echo "🚀 Preparando deploy de Oficina Virtual..."

# Verificar que git esté inicializado
if [ ! -d ".git" ]; then
    echo "❌ No se detectó repositorio git. Inicializando..."
    git init
    git add .
    git commit -m "Proyecto inicial para deploy"
fi

# Crear .gitignore si no existe
if [ ! -f ".gitignore" ]; then
    echo "📝 Creando .gitignore..."
    cat > .gitignore << EOF
node_modules/
dist/
*.log
.env
.env.local
.DS_Store
Thumbs.db
EOF
fi

# Verificar que package.json tenga el script start correcto
echo "✅ Verificando package.json..."
if grep -q '"start": "node virtual-office-server.js"' package.json; then
    echo "✅ Script start configurado correctamente"
else
    echo "⚠️  Script start no configurado correctamente"
    echo "   Asegúrate de que package.json tenga: \"start\": \"node virtual-office-server.js\""
fi

# Mostrar archivos de configuración
echo ""
echo "📋 Archivos de configuración creados:"
echo "  ✅ railway.json (para Railway)"
echo "  ✅ render.yaml (para Render)"
echo "  ✅ virtual-office.config.ts (configuración Angular)"
echo "  ✅ DEPLOY-CLOUD.md (guía completa)"

echo ""
echo "🎯 Siguientes pasos:"
echo "  1. git add ."
echo "  2. git commit -m 'Configurar para deploy cloud'"
echo "  3. git push origin main"
echo "  4. Seguir la guía en DEPLOY-CLOUD.md"
echo ""
echo "🌐 Servicios recomendados:"
echo "  🥇 Railway: https://railway.app/ (más fácil)"
echo "  🥈 Render: https://render.com/ (alternativa)"
echo "  🥉 Cyclic: https://cyclic.sh/ (simple)"

echo ""
echo "✨ ¡Listo para deploy!"