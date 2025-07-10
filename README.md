# 🚀 Lanzador de Microservicios

Aplicación de escritorio para lanzar y gestionar microservicios de Angular y Spring Boot sin necesidad de abrir una consola o un IDE. Pensada para facilitar el trabajo diario en entornos locales y mantener todos los servicios controlados desde una sola interfaz visual.

---

## 📦 Formatos disponibles

- **`.exe` (instalador)**: instala la aplicación en el sistema con acceso desde el menú de inicio.
- **`.portable`**: ejecuta la aplicación sin instalación. Ideal para llevar en un USB o usar sin permisos de administrador.

---

## 🖥️ Requisitos previos

| Tecnología | Requisito                                        |
|------------|--------------------------------------------------|
| Node.js    | Necesario para ejecutar microservicios Angular   |
| Java (JDK) | Necesario para ejecutar microservicios Spring    |
| Maven      | Recomendado (si no se usa el `mvnw` del micro)   |

> ✅ El lanzador permite configurar rutas personalizadas para `JAVA_HOME`, `MAVEN_HOME` y `settings.xml`.

---

## 🔧 Instalación

### Opción 1: Instalador `.exe`
1. Descarga el archivo `launcher.7z` desde la sección [Releases](../../releases).
2. Ejecuta el instalador y sigue los pasos.
3. Una vez instalado, abre la aplicación desde el menú inicio.

### Opción 2: Versión portable
1. Descarga el archivo `launcher.7z` desde la sección [Releases](../../releases).
2. Abre la carpeta `win-unpacked`.
3. Ejecuta directamente el archivo `Launcher.exe`.

> ⚠️ **Importante:** asegúrate de no ubicar la carpeta en un path con espacios si los servicios tienen problemas al arrancar.

---

## ⚙️ Configuración inicial

1. Pulsa el botón **⚙️ Configuración** desde la pantalla principal.
2. Introduce las rutas de los microservicios Angular y Spring.
3. Configura si es necesario:
   - JAVA_HOME
   - MAVEN_HOME
   - Ruta de `settings.xml`
   - Repositorio `.m2` local
4. Guarda los cambios.

---

## 🏁 Arrancar microservicios

1. Desde la pantalla principal, selecciona los microservicios que deseas arrancar.
2. Pulsa el botón **🚀 Arrancar**.
3. Observa los logs en la consola integrada o verifica el estado visual.
4. Puedes detenerlos con **🛑 Parar**.

---

## 📝 Licencia

@Liyodev

---

