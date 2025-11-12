#!/bin/bash

# Script para actualizar la URL del servidor después del deploy
# Uso: ./update-server-url.sh "tu-nueva-url.onrender.com"

if [ -z "$1" ]; then
    echo "❌ Error: Proporciona la URL del servidor"
    echo "💡 Uso: ./update-server-url.sh tu-app.onrender.com"
    exit 1
fi

SERVER_URL="$1"
CONFIG_FILE="src/app/config/virtual-office.config.ts"

# Verificar que el archivo existe
if [ ! -f "$CONFIG_FILE" ]; then
    echo "❌ Error: No se encuentra $CONFIG_FILE"
    exit 1
fi

echo "🔄 Actualizando URL del servidor..."
echo "📍 Nueva URL: wss://$SERVER_URL"

# Actualizar la configuración
sed -i "s|defaultUrl: '[^']*'|defaultUrl: 'wss://$SERVER_URL'|g" "$CONFIG_FILE"

echo "✅ URL actualizada en $CONFIG_FILE"
echo ""
echo "🎯 Siguientes pasos:"
echo "  1. git add ."
echo "  2. git commit -m 'Actualizar URL servidor Render'"
echo "  3. git push origin main"
echo ""
echo "🚀 ¡Listo para probar la oficina virtual!"