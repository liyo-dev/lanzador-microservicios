// Configuración de la oficina virtual
export const virtualOfficeConfig = {
  // URLs de servidores por entorno
  production: {
    // Railway (recomendado)
    railway: 'wss://TU_PROYECTO.up.railway.app',
    // Render (alternativa)
    render: 'wss://tu-proyecto.onrender.com',
    // Cyclic (otra alternativa)
    cyclic: 'wss://tu-proyecto.cyclic.app'
  },
  development: {
    local: 'ws://localhost:8974'
  },
  
  // URL por defecto - Servidor en Render
  defaultUrl: 'wss://lanzador-microservicios.onrender.com', // ✅ Servidor cloud configurado
  
  // Configuración de reconexión
  reconnect: {
    attempts: 5,
    delay: 2000
  }
};

// Función para obtener la URL apropiada
export function getVirtualOfficeUrl(): string {
  // Si estamos en producción (dentro de Electron), usar la URL cloud
  const isElectron = !!(window as any).electronAPI;
  const isProduction = !window.location.href.includes('localhost:4200');
  
  if (isElectron || isProduction) {
    return virtualOfficeConfig.defaultUrl;
  }
  
  // En desarrollo, usar servidor local
  return virtualOfficeConfig.development.local;
}