# 🚀 Lanzador de Microservicios

Aplicación de escritorio para lanzar y gestionar microservicios de Angular y Spring Boot sin necesidad de abrir una consola o un IDE. Pensada para facilitar el trabajo diario en entornos locales y mantener todos los servicios controlados desde una sola interfaz visual.

---

## 📦 Formatos disponibles

- **`.exe` (instalador)**: instala la aplicación en el sistema con acceso desde el menú de inicio.
- **`.portable`**: ejecuta la aplicación sin instalación. Ideal para llevar en un USB o usar sin permisos de administrador.

---

## 🖥️ Requisitos previos

Para que el lanzador funcione correctamente es necesario tener instaladas algunas herramientas y configurar ciertas variables de entorno en tu usuario de Windows.

| Tecnología     | Requisito                                                                 |
|----------------|---------------------------------------------------------------------------|
| Node.js        | Instalar desde https://nodejs.org (recomendado LTS 18+)                   |
| Angular CLI    | Ejecutar `npm install -g @angular/cli` para disponer del comando `ng`     |
| Java (JDK)     | Instalar JDK (por ejemplo: https://adoptium.net/)                         |
| JAVA_HOME      | Variable de entorno apuntando a la carpeta del JDK (ej: `C:\Java\jdk-21`) |
| Maven (opcional) | Si no se usa `mvnw.cmd`, instalar desde https://maven.apache.org/       |
| MAVEN_HOME     | (Opcional) Variable apuntando a la carpeta de Maven                       |
| PATH           | Debe incluir `%JAVA_HOME%\bin` y, si aplica, `%MAVEN_HOME%\bin`           |

> ✅ El lanzador también permite definir estas rutas de forma manual si no quieres configurar las variables de entorno permanentemente.

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

## 🛠️ Resolución de errores comunes

### ❌ No se encuentra el comando `ng`
Este error aparece si Angular CLI no está instalado globalmente o si el sistema no puede encontrar el ejecutable `ng.cmd`.

#### Solución:
1. Abre una terminal (CMD o PowerShell).
2. Ejecuta:

   ```bash
   npm install -g @angular/cli
   ```

3. Asegúrate de que la carpeta `%APPDATA%\npm` esté incluida en la variable de entorno `PATH`.

Puedes verificar con:

```cmd
where ng
```

Debería mostrar una ruta similar a:

```
C:\Users\TU_USUARIO\AppData\Roaming\npm\ng.cmd
```

---

### ❌ No se encuentra Node.js

El lanzador necesita Node.js para ejecutar microservicios Angular.

#### Solución:
1. Instala Node.js desde https://nodejs.org (elige la versión LTS).
2. Reinicia el sistema si no lo reconoce tras instalarlo.
3. Verifica desde la consola con:

   ```cmd
   node -v
   npm -v
   ```

---

### ❌ No se encuentra Java o Maven

Consulta la sección **🖥️ Requisitos previos** para verificar que:

- `JAVA_HOME` esté correctamente definido.
- `PATH` incluya `%JAVA_HOME%\bin`.
- Si usas Maven externo, define también `MAVEN_HOME` y `%MAVEN_HOME%\bin`.

---
## 📝 Licencia

@Liyodev

---

