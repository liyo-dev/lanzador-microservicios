import { Injectable, signal } from '@angular/core';

export type ThemeMode = 'light' | 'dark';

const STORAGE_KEY = 'launcher-theme';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  /** True si el tema actual viene de una elección manual del usuario. */
  private userOverride = this.hasStoredTheme();
  private readonly _theme = signal<ThemeMode>(this.readInitialTheme());

  /** Tema actual reactivo (signal). */
  readonly theme = this._theme.asReadonly();

  constructor() {
    this.applyTheme(this._theme());
    this.listenToSystemChanges();
  }

  toggle(): void {
    const next: ThemeMode = this._theme() === 'dark' ? 'light' : 'dark';
    this.setTheme(next);
  }

  setTheme(mode: ThemeMode): void {
    this.userOverride = true;
    this._theme.set(mode);
    this.applyTheme(mode);
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // ignore (modo privado / sandbox)
    }
  }

  /** Limpia el override manual y vuelve a seguir la preferencia del SO. */
  followSystem(): void {
    this.userOverride = false;
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* noop */ }
    const sys = this.getSystemTheme();
    this._theme.set(sys);
    this.applyTheme(sys);
  }

  private applyTheme(mode: ThemeMode): void {
    if (typeof document === 'undefined') return;
    document.documentElement.setAttribute('data-theme', mode);
  }

  private hasStoredTheme(): boolean {
    try {
      const v = localStorage.getItem(STORAGE_KEY);
      return v === 'light' || v === 'dark';
    } catch {
      return false;
    }
  }

  private readInitialTheme(): ThemeMode {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === 'light' || saved === 'dark') return saved;
    } catch {
      // ignore
    }
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
      // Solo seguimos al SO si el usuario no eligió manualmente.
      if (this.userOverride) return;
      const next: ThemeMode = e.matches ? 'dark' : 'light';
      this._theme.set(next);
      this.applyTheme(next);
    };
    if (mq.addEventListener) {
      mq.addEventListener('change', handler);
    } else if ((mq as any).addListener) {
      // Safari < 14
      (mq as any).addListener(handler);
    }
  }
}
