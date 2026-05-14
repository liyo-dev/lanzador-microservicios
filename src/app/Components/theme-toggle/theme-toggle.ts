import { Component, inject } from '@angular/core';
import { ThemeService } from '../../services/theme.service';

@Component({
  selector: 'app-theme-toggle',
  standalone: true,
  template: `
    <button
      class="theme-toggle"
      type="button"
      (click)="theme.toggle()"
      [attr.aria-label]="theme.theme() === 'dark' ? 'Activar modo claro' : 'Activar modo oscuro'"
      [title]="theme.theme() === 'dark' ? 'Modo claro' : 'Modo oscuro'"
    >
      <span class="icon">{{ theme.theme() === 'dark' ? '☀️' : '🌙' }}</span>
    </button>
  `,
  styles: [`
    .theme-toggle {
      position: fixed;
      bottom: 1.25rem;
      right: 1.25rem;
      z-index: 9999;
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
  `]
})
export class ThemeToggleComponent {
  protected theme = inject(ThemeService);
}
