import { Component, HostListener, inject, signal } from '@angular/core';
import { ThemeService, ThemePreference } from '../../services/theme.service';

interface ThemeOption {
  key: ThemePreference;
  icon: string;
  label: string;
}

/**
 * Selector de tema con 3 estados: Claro / Oscuro / Sistema.
 * Aparece como boton flotante; al pulsar abre un selector segmentado.
 * Si la preferencia es 'system', el icono mostrado representa el monitor
 * y el tema efectivo sigue al SO (reactivo a prefers-color-scheme).
 */
@Component({
  selector: 'app-theme-toggle',
  standalone: true,
  template: `
    <div class="theme-toggle-wrapper" [class.open]="open()">
      @if (open()) {
        <div class="theme-popover" role="dialog" aria-label="Selector de tema">
          <span class="popover-title">Tema</span>
          <div class="seg-group" role="radiogroup" aria-label="Modo de tema">
            @for (opt of options; track opt.key) {
              <button
                type="button"
                class="seg-btn"
                role="radio"
                [class.active]="theme.preference() === opt.key"
                [attr.aria-checked]="theme.preference() === opt.key"
                [title]="opt.label"
                (click)="select(opt.key)"
              >
                <span class="seg-icon" aria-hidden="true">{{ opt.icon }}</span>
                <span class="seg-label">{{ opt.label }}</span>
              </button>
            }
          </div>
          @if (theme.preference() === 'system') {
            <small class="hint">
              Siguiendo al sistema: actualmente {{ theme.theme() === 'dark' ? 'oscuro' : 'claro' }}.
            </small>
          }
        </div>
      }

      <button
        type="button"
        class="theme-toggle"
        (click)="toggleOpen($event)"
        [attr.aria-label]="'Cambiar tema (actual: ' + currentLabel() + ')'"
        [attr.aria-expanded]="open()"
        aria-haspopup="dialog"
        [title]="'Tema: ' + currentLabel()"
      >
        <span class="icon" aria-hidden="true">{{ currentIcon() }}</span>
      </button>
    </div>
  `,
  styles: [`
    .theme-toggle-wrapper {
      position: fixed;
      bottom: 1.25rem;
      left: 1.25rem;
      z-index: 9500;
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 0.5rem;
    }

    @media (max-width: 768px) {
      .theme-toggle-wrapper {
        left: 0.85rem;
        bottom: 0.85rem;
      }
      .theme-toggle {
        width: 44px;
        height: 44px;
        font-size: 1.2rem;
      }
      .theme-popover {
        min-width: 200px;
      }
    }

    .theme-toggle {
      width: 48px;
      height: 48px;
      border-radius: 50%;
      border: 1px solid var(--color-border);
      background: var(--color-surface);
      color: var(--color-text);
      box-shadow: var(--shadow-md);
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 1.35rem;
      line-height: 1;
      transition: transform 0.2s ease, box-shadow 0.2s ease, background 0.2s ease;
    }
    .theme-toggle:hover {
      transform: translateY(-2px) rotate(-8deg);
      box-shadow: var(--shadow-lg);
    }
    .theme-toggle:active {
      transform: translateY(0) scale(0.95);
    }
    .icon {
      display: inline-block;
      pointer-events: none;
    }

    .theme-popover {
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: 12px;
      padding: 0.85rem;
      box-shadow: var(--shadow-lg);
      min-width: 220px;
      display: flex;
      flex-direction: column;
      gap: 0.55rem;
      animation: pop-in 0.18s ease-out;
    }

    @keyframes pop-in {
      from { opacity: 0; transform: translateY(6px) scale(0.96); }
      to   { opacity: 1; transform: translateY(0)  scale(1); }
    }

    .popover-title {
      font-size: 0.75rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--color-muted, #64748b);
    }

    .seg-group {
      display: flex;
      background: rgba(148, 163, 184, 0.15);
      padding: 3px;
      border-radius: 10px;
      gap: 2px;
    }

    .seg-btn {
      flex: 1;
      border: none;
      background: transparent;
      padding: 0.45rem 0.55rem;
      border-radius: 7px;
      cursor: pointer;
      display: inline-flex;
      flex-direction: column;
      align-items: center;
      gap: 0.15rem;
      font-size: 0.7rem;
      font-weight: 600;
      color: var(--color-muted, #64748b);
      transition: background 0.18s ease, color 0.18s ease, box-shadow 0.18s ease;
    }

    .seg-btn:hover {
      color: var(--color-text);
    }

    .seg-btn.active {
      background: var(--color-surface);
      color: var(--color-text);
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
    }

    .seg-icon {
      font-size: 1.05rem;
      line-height: 1;
    }
    .seg-label {
      line-height: 1;
    }

    .hint {
      font-size: 0.72rem;
      color: var(--color-muted, #64748b);
      line-height: 1.3;
    }
  `]
})
export class ThemeToggleComponent {
  protected theme = inject(ThemeService);

  readonly options: ThemeOption[] = [
    { key: 'light',  icon: '☀️', label: 'Claro' },
    { key: 'dark',   icon: '🌙', label: 'Oscuro' },
    { key: 'system', icon: '🖥️', label: 'Sistema' },
  ];

  protected open = signal(false);

  currentIcon(): string {
    const pref = this.theme.preference();
    if (pref === 'system') return '🖥️';
    return pref === 'dark' ? '🌙' : '☀️';
  }

  currentLabel(): string {
    return this.options.find(o => o.key === this.theme.preference())?.label ?? 'Claro';
  }

  toggleOpen(e: Event) {
    e.stopPropagation();
    this.open.update(v => !v);
  }

  select(pref: ThemePreference) {
    this.theme.setPreference(pref);
    // Cerramos tras pequeño retardo para que se vea el cambio
    setTimeout(() => this.open.set(false), 150);
  }

  /** Cierra el popover al hacer clic fuera o pulsar Escape. */
  @HostListener('document:click', ['$event'])
  onDocClick(e: MouseEvent) {
    if (!this.open()) return;
    const target = e.target as HTMLElement | null;
    if (target && target.closest('.theme-toggle-wrapper')) return;
    this.open.set(false);
  }

  @HostListener('document:keydown.escape')
  onEscape() {
    if (this.open()) this.open.set(false);
  }
}
