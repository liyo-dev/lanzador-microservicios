# 🚀 Deploy de Oficina Virtual a la Cloud

## 🎯 Objetivo
Desplegar el servidor WebSocket en un servicio cloud para que funcione automáticamente sin configuración manual.

## 🏆 Opción Recomendada: Railway

### ✅ Por qué Railway:
- ✅ **Gratis**: Plan gratuito generoso
- ✅ **Fácil**: Deploy con git push
- ✅ **WebSockets**: Soporte nativo
- ✅ **SSL automático**: HTTPS/WSS gratis

### 📋 Pasos para Railway:

#### 1. Crear cuenta en Railway
- Ve a: https://railway.app/
- Regístrate con GitHub

#### 2. Hacer commit de cambios
```bash
git add .
git commit -m "Configurar para deploy Railway"
git push origin main
```

#### 3. Crear proyecto en Railway
1. Click en **"New Project"**
2. Seleccionar **"Deploy from GitHub repo"**
3. Elegir tu repositorio `lanzador-microservicios`
4. Railway detectará automáticamente que es un proyecto Node.js

#### 4. Configurar variables de entorno (opcional)
```
NODE_ENV=production
VIRTUAL_OFFICE_WIDTH=960
VIRTUAL_OFFICE_HEIGHT=560
```

#### 5. Obtener URL del deploy
1. Ve a la pestaña **"Settings"**
2. En **"Domains"** click **"Generate Domain"**
3. Copia la URL (ej: `tu-proyecto.up.railway.app`)

#### 6. Actualizar URL en el proyecto
Edita `src/app/config/virtual-office.config.ts`:
```typescript
export const virtualOfficeConfig = {
  defaultUrl: 'wss://TU_URL_DE_RAILWAY.up.railway.app',
  // resto del config...
};
```

#### 7. Commit y redeploy
```bash
git add .
git commit -m "Actualizar URL cloud"
git push origin main
```

¡Listo! Railway automáticamente redesplegará con la nueva configuración.

---

## 🔧 Opción Alternativa: Render

### 📋 Pasos para Render:

#### 1. Crear cuenta en Render
- Ve a: https://render.com/
- Regístrate con GitHub

#### 2. Crear Web Service
1. Click **"New +"** → **"Web Service"**
2. Conecta tu repositorio
3. Configurar:
   - **Name**: virtual-office
   - **Environment**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `node virtual-office-server.js`

#### 3. Obtener URL y actualizar config
- Copia la URL (ej: `tu-proyecto.onrender.com`)
- Actualiza `virtual-office.config.ts` como antes

---

## 🔧 Opción Alternativa: Cyclic

### 📋 Pasos para Cyclic:

#### 1. Ir a Cyclic
- Ve a: https://cyclic.sh/
- Regístrate con GitHub

#### 2. Deploy automático
1. Click **"Deploy"**
2. Selecciona tu repositorio
3. Cyclic hace el resto automáticamente

---

## ⚡ Después del Deploy

### ✅ Verificar funcionamiento:
1. **Abrir aplicación Electron**
2. **Ir a "Oficina Virtual"**
3. **Verificar que la URL sea la correcta**
4. **Probar conexión**

### 🐛 Solución de problemas:

**"No se puede conectar"**:
- ✅ Verifica que el servicio esté activo en Railway/Render
- ✅ Comprueba los logs del servicio
- ✅ Verifica que la URL sea correcta (wss:// no ws://)

**"Se desconecta constantemente"**:
- ✅ Los servicios gratuitos duermen después de inactividad
- ✅ Es normal un delay inicial al conectar

### 📊 URLs finales:
Una vez desplegado tendrás algo como:
- **Railway**: `wss://tu-proyecto-123.up.railway.app`
- **Render**: `wss://tu-proyecto.onrender.com`  
- **Cyclic**: `wss://tu-proyecto.cyclic.app`

---

## 🎉 Resultado final

Después del deploy:
1. **Tú y tu compañero abren sus aplicaciones Electron**
2. **Van a "Oficina Virtual"**
3. **¡Se conectan automáticamente al mismo servidor!**
4. **No necesitan configurar nada manualmente**

¡Perfecto para trabajar en equipo desde ciudades diferentes! 🌍