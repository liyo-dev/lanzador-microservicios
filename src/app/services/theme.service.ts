import { Injectable, signal } from '@angular/core';

/** Tema efectivo aplicado a la UI. */
export type ThemeMode = 'light' | 'dark';

/** Preferencia del usuario: claro, oscuro, o seguir el sistema. */
export type ThemePreference = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'launcher-theme';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  /** Preferencia almacenada del usuario (light/dark/system). */
  private readonly _preference = signal<ThemePreference>(this.readStoredPreference());

  /** Tema efectivo aplicado al DOM (resolución de la preferencia). */
  private readonly _theme = signal<ThemeMode>(this.resolveTheme(this._preference()));

  /** Preferencia actual (reactiva). */
  readonly preference = this._preference.asReadonly();

  /** Tema actual reactivo aplicado al DOM (siempre 'light' o 'dark'). */
  readonly theme = this._theme.asReadonly();

  constructor() {
    this.applyTheme(this._theme());
    this.listenToSystemChanges();
  }

  /** Alterna entre claro y oscuro (descarta el modo 'system' al elegir manualmente). */
  toggle(): void {
    const next: ThemePreference = this._theme() === 'dark' ? 'light' : 'dark';
    this.setPreference(next);
  }

  /** Establece la preferencia del usuario y la persiste. */
  setPreference(pref: ThemePreference): void {
    this._preference.set(pref);
    try {
      if (pref === 'system') {
        localStorage.removeItem(STORAGE_KEY);
      } else {
        localStorage.setItem(STORAGE_KEY, pref);
      }
    } catch {
      // ignore (modo privado / sandbox)
    }
    const resolved = this.resolveTheme(pref);
    this._theme.set(resolved);
    this.applyTheme(resolved);
  }

  /** @deprecated Usa setPreference('light'|'dark') */
  setTheme(mode: ThemeMode): void {
    this.setPreference(mode);
  }

  /** Limpia el override manual y vuelve a seguir la preferencia del SO. */
  followSystem(): void {
    this.setPreference('system');
  }

  private applyTheme(mode: ThemeMode): void {
    if (typeof document === 'undefined') return;
    document.documentElement.setAttribute('data-theme', mode);
  }

  private readStoredPreference(): ThemePreference {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === 'light' || saved === 'dark') return saved;
    } catch {
      // ignore
    }
    return 'system';
  }

  private resolveTheme(pref: ThemePreference): ThemeMode {
    if (pref === 'light' || pref === 'dark') return pref;
    return this.getSystemTheme();
  }

  private getSystemTheme(): ThemeMode {
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }
    return 'light';
  }

  private listenToSystemChanges(): void {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => {
      // Solo reaccionamos al SO si la preferencia es 'system'.
      if (this._preference() !== 'system') return;
      const next: ThemeMode = e.matches ? 'dark' : 'light';
      this._theme.set(next);
      this.applyTheme(next);
    };
    if (mq.addEventListener) {
      mq.addEventListener('change', handler);
    } else if ((mq as any).addListener) {
      (mq as any).addListener(handler);
    }
  }
}
