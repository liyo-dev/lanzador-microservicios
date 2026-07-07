// ============================================================
// Tipado global del puente Electron ↔ Angular
// ------------------------------------------------------------
// Este fichero declara la forma completa de `window.electronAPI`
// (expuesto desde preload.js) para eliminar cualquier `any` en la
// aplicación y para dar autocompletado en el editor.
//
// Reglas para mantener este contrato:
//  1. Cada método listado aquí debe existir en preload.js.
//  2. Los payloads deben coincidir con los `ipcMain.handle` /
//     `ipcMain.on` correspondientes en main.js.
//  3. Si añades una llamada IPC nueva, actualiza SIEMPRE este archivo.
// ============================================================

// ---------- Tipos compartidos de dominio ----------

type MicroStatus = 'stopped' | 'starting' | 'running' | 'stopping';
type MicroType = 'angular' | 'spring';

interface AngularMicroConfig {
  path: string;
  port: number;
}

interface SpringMicroConfig {
  path: string;
  javaProfile?: 'java8' | 'java17';
}

interface JavaProfileConfig {
  javaHome: string;
  settingsXml: string;
  m2RepoPath: string;
}

interface CustomMicro {
  key: string;
  label: string;
}

interface LauncherConfig {
  angular: Record<string, AngularMicroConfig> & Record<string, any>;
  spring: {
    mavenHome?: string;
    javaHome?: string;
    settingsXml?: string;
    m2RepoPath?: string;
    profiles?: {
      java8: JavaProfileConfig;
      java17: JavaProfileConfig;
    };
    [key: string]: any;
  };
  customMicros?: {
    angular: CustomMicro[];
    spring: CustomMicro[];
  };
  /** Perfiles de arranque: grupos de micros que se lanzan juntos. */
  startupProfiles?: StartupProfile[];
}

interface StartupProfile {
  id: string;
  name: string;
  description?: string;
  angular: string[];
  spring: string[];
}

interface LastStatuses {
  angular: Record<string, MicroStatus>;
  spring: Record<string, MicroStatus>;
}

// ---------- Payloads IPC ----------

interface StartAngularPayload {
  micro: string;
  path: string;
  port: number;
  useLegacyProvider?: boolean;
}

interface StartSpringPayload {
  micro: string;
  path: string;
  javaHome?: string;
  mavenHome?: string;
  settingsXml?: string;
  m2RepoPath?: string;
}

interface AngularLog {
  micro: string;
  log: string;
  status?: MicroStatus;
}

interface SpringLog {
  micro: string;
  log: string;
  status?: MicroStatus;
}

interface GitInfoResult {
  success: boolean;
  branch?: string;
  branches?: string[];
  hasChanges?: boolean;
  ahead?: number;
  behind?: number;
  upstream?: string;
  error?: string;
}

interface GitActionResult {
  success: boolean;
  error?: string;
  details?: string;
}

interface PortProcess {
  protocol: string;
  localAddress: string;
  port: string;
  foreignAddress: string;
  state: string;
  pid: string;
}

interface FindPortResult {
  success: boolean;
  processes: PortProcess[];
  error?: string;
}

interface KillProcessResult {
  success: boolean;
  error?: string;
}

interface LoginData {
  url: string;
  incognito?: boolean;
  user: {
    name: string;
    companyID?: string;
    username: string;
    password: string;
    environment: string;
  };
}

interface LoginResult {
  success: boolean;
  error?: string;
  message?: string;
}

interface OpenDialogOptions {
  title?: string;
  defaultPath?: string;
  buttonLabel?: string;
  properties?: Array<'openFile' | 'openDirectory' | 'multiSelections' | 'showHiddenFiles'>;
  filters?: Array<{ name: string; extensions: string[] }>;
}

interface OpenDialogResult {
  canceled: boolean;
  filePaths: string[];
  error?: string;
}

interface PathCheckResult {
  exists: boolean;
  isDirectory?: boolean;
  isFile?: boolean;
}

// ---------- API principal expuesta ----------

interface ElectronAPI {
  // Configuración
  getConfig(): Promise<LauncherConfig>;
  saveConfig(config: LauncherConfig): Promise<void>;
  clearConfig(): Promise<void>;
  getLastStatus(): Promise<LastStatuses>;

  // Sistema de ficheros / diálogos
  showOpenDialog(options?: OpenDialogOptions): Promise<OpenDialogResult>;
  checkPath?(pathToCheck: string): Promise<PathCheckResult>;
  showSaveDialog?(options?: any): Promise<{ canceled: boolean; filePath?: string }>;
  writeFile?(filePath: string, content: string): Promise<{ success: boolean; error?: string }>;
  readFile?(filePath: string): Promise<{ success: boolean; content?: string; error?: string }>;

  // Lanzamiento de servicios
  startAngular(data: StartAngularPayload): void;
  startSpring(data: StartSpringPayload): void;
  stopProcess(processKey: string): void;
  onLogAngular(cb: (data: AngularLog) => void): void;
  onLogSpring(cb: (data: SpringLog) => void): void;

  // Usuarios (opcional; hoy los almacena el renderer en localStorage)
  getUsers(): Promise<any[]>;
  saveUsers(users: any[]): Promise<{ success: boolean }>;

  // Portales / auto-login
  openChromeWithUrl(url: string): Promise<{ success: boolean; error?: string; message?: string }>;
  openPortalAutoLogin(data: LoginData): Promise<LoginResult>;

  // Git por micro
  getGitInfo(payload: { path: string }): Promise<GitInfoResult>;
  gitFetch(payload: { path: string }): Promise<GitActionResult>;
  gitPull(payload: { path: string; force?: boolean }): Promise<GitActionResult>;
  gitCheckout(payload: { path: string; branch: string; force?: boolean }): Promise<GitActionResult>;

  // Puertos
  findProcessByPort(port: string | number): Promise<FindPortResult>;
  killProcess(pid: string | number): Promise<KillProcessResult>;
  checkPort?(port: number | string): Promise<boolean>;
  probeHttp?(port: number | string, pathToProbe?: string): Promise<boolean>;

  // Cifrado local (safeStorage)
  cryptoIsAvailable(): Promise<boolean>;
  encryptText(plain: string): Promise<string>;
  decryptText(cipher: string): Promise<string>;
  encryptTexts(list: string[]): Promise<string[]>;
  decryptTexts(list: string[]): Promise<string[]>;

  // Metadatos de la app
  getAppVersion?(): Promise<string>;
}

interface Window {
  require: any;
  process: any;
  electronAPI: ElectronAPI;
}

