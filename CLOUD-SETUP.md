# 🚀 OFICINA VIRTUAL CLOUD - SETUP AUTOMÁTICO

## ⚡ Resumen Rápido

Tu proyecto ya está **100% configurado** para desplegar en servicios cloud. Solo necesitas:

1. **Elegir servicio** (Railway recomendado)
2. **Conectar tu repo**  
3. **Copiar URL generada**
4. **Actualizar configuración**
5. **¡Listo! Funciona automáticamente**

---

## 🎯 Lo que tienes configurado

### ✅ **Archivos de deploy:**
- `railway.json` - Configuración para Railway
- `render.yaml` - Configuración para Render
- `virtual-office-server.js` - Servidor optimizado para cloud
- `virtual-office.config.ts` - Gestión automática de URLs

### ✅ **Scripts listos:**
- `npm start` → Inicia servidor en producción
- `npm run office:server` → Inicia servidor local
- `deploy-setup.bat` → Script helper para Windows

### ✅ **Características:**
- 🔐 **SSL automático** (wss://)
- 🌍 **Acceso global** desde cualquier ciudad
- ⚡ **Sin configuración manual** por usuario
- 🔄 **Auto-reconexión** si se cae la conexión

---

## 🏆 OPCIÓN RECOMENDADA: Railway

### ¿Por qué Railway?
- ✅ **Más fácil** de configurar
- ✅ **Deploy automático** con git push  
- ✅ **Gratis** para proyectos pequeños
- ✅ **WebSockets** funciona perfecto

### 🚀 Deploy en Railway (5 minutos):

1. **Regístrate**: https://railway.app/
2. **New Project** → **Deploy from GitHub**
3. **Selecciona** tu repo `lanzador-microservicios`
4. **Generate Domain** en Settings
5. **Copia la URL** (ej: `abc123.up.railway.app`)
6. **Edita** `src/app/config/virtual-office.config.ts`:
   ```typescript
   defaultUrl: 'wss://TU_URL.up.railway.app',
   ```
7. **Git commit + push**

¡Ya está! Tu oficina virtual funciona globalmente.

---

## 🔧 Alternativas

### Render (alternativa sólida)
- Ve a: https://render.com/
- Sigue `DEPLOY-CLOUD.md` para pasos detallados

### Cyclic (más simple)
- Ve a: https://cyclic.sh/ 
- Deploy con 1 click

---

## ✨ Resultado Final

Después del deploy:

### 👥 **Para ti y tu compañero:**
1. Abrir aplicación Electron
2. Ir a **"Oficina Virtual"**  
3. ¡Se conecta automáticamente!
4. **Sin configurar nada manualmente**

### 🎮 **Funcionalidades:**
- 🕹️ **Movimiento**: WASD/flechas
- 💬 **Chat global**: Todos ven mensajes
- 🤫 **Chat privado**: Acercarse para chatear
- 🎭 **6 avatares** diferentes
- 🌍 **Funciona** desde cualquier ciudad

### 🔄 **Auto-gestión:**
- La app **detecta automáticamente** si usar servidor local o cloud
- **No necesitas** cambiar configuración manual
- **Funciona igual** en desarrollo y producción

---

## 🆘 Ayuda rápida

**¿No funciona el deploy?**
- Lee `DEPLOY-CLOUD.md` para guía detallada
- Ejecuta `deploy-setup.bat` para verificar config
- Revisa logs del servicio cloud

**¿URL incorrecta?**
- Edita `src/app/config/virtual-office.config.ts`
- Cambia `defaultUrl` por tu URL real
- Haz commit y push

**¿Se desconecta?**
- Servicios gratuitos "duermen" tras inactividad
- Es normal un delay inicial
- La reconexión es automática

---

🎉 **¡Tu oficina virtual ya está lista para el mundo!**