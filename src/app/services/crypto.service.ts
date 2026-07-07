import { Injectable } from '@angular/core';

/**
 * Fachada tipada sobre el puente `electronAPI` para cifrar/descifrar
 * cadenas usando `safeStorage` (DPAPI en Windows, Keychain en macOS,
 * kwallet/gnome-keyring en Linux).
 *
 * Todas las cadenas cifradas se serializan con el prefijo `enc:v1:` en
 * base64. Esto permite:
 *  - Detectar si un dato ya está cifrado (idempotencia en `encryptText`).
 *  - Migrar transparentemente cadenas heredadas guardadas en claro:
 *    `decryptText('foo') → 'foo'`.
 *
 * Si el entorno no soporta cifrado (por ejemplo en desarrollo cuando
 * Angular sirve fuera de Electron), los métodos devuelven la cadena
 * original y `isAvailable()` devuelve `false`, para que el consumidor
 * pueda decidir avisar al usuario.
 */
@Injectable({ providedIn: 'root' })
export class CryptoService {
  private availableCache: boolean | null = null;

  private get api(): any {
    return (window as any).electronAPI;
  }

  /** ¿El proceso principal ofrece cifrado disponible? Se cachea la respuesta. */
  async isAvailable(): Promise<boolean> {
    if (this.availableCache !== null) return this.availableCache;
    try {
      const res = await this.api?.cryptoIsAvailable?.();
      this.availableCache = !!res;
    } catch {
      this.availableCache = false;
    }
    return this.availableCache;
  }

  /** Cifra una cadena. Si ya está cifrada, la devuelve tal cual. */
  async encrypt(plain: string | null | undefined): Promise<string> {
    if (!plain) return plain ?? '';
    try {
      return (await this.api?.encryptText?.(plain)) ?? plain;
    } catch {
      return plain;
    }
  }

  /** Descifra una cadena. Si no está cifrada, la devuelve tal cual. */
  async decrypt(cipher: string | null | undefined): Promise<string> {
    if (!cipher) return cipher ?? '';
    try {
      return (await this.api?.decryptText?.(cipher)) ?? cipher;
    } catch {
      return cipher;
    }
  }

  /** Cifra un lote de cadenas de forma más eficiente (una sola llamada IPC). */
  async encryptMany(list: string[]): Promise<string[]> {
    if (!list?.length) return [];
    try {
      return (await this.api?.encryptTexts?.(list)) ?? list;
    } catch {
      return list;
    }
  }

  /** Descifra un lote de cadenas. */
  async decryptMany(list: string[]): Promise<string[]> {
    if (!list?.length) return [];
    try {
      return (await this.api?.decryptTexts?.(list)) ?? list;
    } catch {
      return list;
    }
  }
}
