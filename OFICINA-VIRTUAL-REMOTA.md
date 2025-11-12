# 🏢 Guía para usar la Oficina Virtual entre ciudades

## 🚀 ¿Qué necesitas?

Para que tú y tu compañero en otra ciudad puedan usar la oficina virtual juntos, necesitan:

1. **Un servidor WebSocket accesible desde internet**
2. **La misma URL de conexión configurada en ambas aplicaciones**

## 📋 Pasos para configurar

### 1. Iniciar el servidor (Solo UNA persona)

Uno de ustedes debe ejecutar el servidor. Puede ser cualquiera:

```bash
# En el directorio del proyecto
npm run office:server
```

Verás algo como:
```
🚀 Servidor de oficina virtual escuchando en el puerto 8974
```

### 2. Obtener tu IP pública

La persona que ejecuta el servidor necesita obtener su IP pública:

1. **Visita**: https://whatismyipaddress.com/
2. **Copia** la dirección IP que aparece (ej: 123.456.789.012)

### 3. Configurar router/firewall (Importante)

La persona con el servidor debe:

1. **Abrir el puerto 8974** en su router/firewall
2. **Crear regla de port forwarding** del puerto 8974 a su PC
3. **Desactivar temporalmente el firewall** de Windows (solo para pruebas)

### 4. Configurar la URL en ambas aplicaciones

**Ambos** deben cambiar la URL del servidor:

1. Abrir la aplicación Electron
2. Ir a **"Oficina Virtual"**
3. En el campo **"Servidor de la oficina"** poner:
   ```
   ws://IP_PUBLICA_DEL_SERVIDOR:8974
   ```
   
   Ejemplo: `ws://123.456.789.012:8974`

### 5. ¡Conectarse!

1. **Elegir nombres y avatares** diferentes
2. **Hacer click en "Entrar a la oficina"**
3. **¡Disfrutar la oficina virtual!**

---

## 🔧 Alternativas si no funciona

### Opción A: Usar ngrok (Más fácil)

Si tienes problemas con el router, usa ngrok:

1. **Instalar ngrok**: https://ngrok.com/
2. **Ejecutar**:
   ```bash
   ngrok http 8974
   ```
3. **Copiar la URL** que aparece (ej: `wss://abc123.ngrok.io`)
4. **Usar esa URL** en ambas aplicaciones

### Opción B: Usar un servidor en la nube

Puedes subir el servidor a:
- **Heroku** (gratis)
- **Railway** (gratis)
- **Render** (gratis)

---

## 💬 ¿Cómo funciona?

- **Movimiento**: WASD o flechas para mover tu avatar
- **Chat general**: Todos ven los mensajes
- **Chat privado**: Acércate a alguien para chatear en privado
- **Avatares**: 6 personajes diferentes disponibles

---

## 🐛 Resolución de problemas

### "No se pudo conectar al servidor"
- ✅ Verificar que el servidor esté ejecutándose
- ✅ Comprobar que la IP/URL sea correcta
- ✅ Verificar que el puerto 8974 esté abierto

### "Se desconecta constantemente"
- ✅ Verificar la conexión a internet
- ✅ Comprobar firewall/antivirus
- ✅ Intentar con ngrok si persiste

### "No veo a mi compañero"
- ✅ Ambos deben usar la MISMA URL
- ✅ Verificar que ambos estén conectados
- ✅ Refrescar la página si es necesario

---

¡Listo! Ahora pueden coordinar proyectos desde sus oficinas virtuales 🚀