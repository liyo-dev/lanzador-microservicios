# 🏢 Oficina Virtual - Colaboración Remota

## 🚀 ¿Qué es esto?

Un espacio virtual donde equipos pueden trabajar juntos desde cualquier lugar del mundo.

## 📋 Configuración Automática

### Para usuarios regulares (Recomendado)

La aplicación **ya está configurada** para conectarse automáticamente al servidor en la nube:

1. **Abre la aplicación**
2. **Ve a "Oficina Virtual"**
3. **Elige tu avatar**
4. **¡Entra a la oficina!**

**No necesitas configurar nada más.** El servidor ya está desplegado en Render.

### Para desarrolladores (Desarrollo local)

Si quieres ejecutar el servidor localmente:

```bash
# En el directorio del proyecto
npm run office:server
```

---

## 🔧 Alternativas si necesitas servidor propio

### Opción A: Usar ngrok (Temporal)

Para pruebas locales con acceso externo:

1. **Instalar ngrok**: https://ngrok.com/
2. **Ejecutar**:
   ```bash
   ngrok http 8974
   ```
3. **Usar la URL generada** en la configuración

### Opción B: Desplegar en Render (Recomendado)

El servidor actual está en Render. Para tu propio deploy:

1. **Fork este repositorio**
2. **Conectar con Render**
3. **Deploy automático**

---

## 💬 ¿Cómo usar la oficina?

- **Movimiento**: WASD o flechas para mover tu avatar
- **Chat general**: Todos ven los mensajes  
- **Chat privado**: Acércate a alguien para chatear en privado
- **Avatares**: 6 personajes diferentes disponibles

---

## 🐛 Resolución de problemas

### "No se pudo conectar al servidor"
- ✅ Verificar conexión a internet
- ✅ Comprobar que el servidor de Render esté activo
- ✅ Reiniciar la aplicación

### "Se desconecta constantemente"
- ✅ Verificar la conexión a internet estable
- ✅ Comprobar firewall/antivirus
- ✅ El servidor en Render puede tardar en activarse

### "No veo a mi compañero"
- ✅ Ambos deben estar conectados al mismo servidor
- ✅ Verificar que ambos estén en la oficina
- ✅ Refrescar si es necesario

---

¡Listo para colaborar remotamente! 🚀