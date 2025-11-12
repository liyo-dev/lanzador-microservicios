# 🔥 Firebase + Google Cloud Run para WebSockets

## ⚠️ ADVERTENCIA
Esta opción es **MUCHO más compleja** que Railway/Render. Solo úsala si ya tienes experiencia con Firebase.

## 🏗️ Arquitectura necesaria:
1. **Firebase Realtime Database** → Para mensajes y estado
2. **Google Cloud Run** → Para el servidor WebSocket
3. **Firebase Hosting** → Para la web (opcional)

## 📋 Pasos (COMPLEJO):

### 1. Configurar Firebase Project
```bash
npm install -g firebase-tools
firebase login
firebase init
```

### 2. Modificar servidor para usar Firebase
```javascript
// Necesitarías cambiar virtual-office-server.js para usar Firebase Admin SDK
const admin = require('firebase-admin');
const serviceAccount = require('./path/to/serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://tu-proyecto.firebaseio.com"
});

const db = admin.database();
// ... resto del código adaptado
```

### 3. Configurar Google Cloud Run
- Crear Dockerfile
- Subir imagen a Google Container Registry
- Configurar Cloud Run service

### 4. Variables de entorno
```bash
GOOGLE_APPLICATION_CREDENTIALS=./serviceAccountKey.json
FIREBASE_DATABASE_URL=https://tu-proyecto.firebaseio.com
```

## 💰 Costos:
- **Firebase**: Gratis hasta ciertos límites
- **Cloud Run**: Pago por uso (puede ser gratis con poco tráfico)

## 🕐 Tiempo estimado: 4-6 horas de configuración