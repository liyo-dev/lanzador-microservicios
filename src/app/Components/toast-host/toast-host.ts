import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NotificationService } from '../../services/notification.service';

@Component({
  selector: 'app-toast-host',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="toast-host" aria-live="polite" aria-atomic="false">
      @for (n of notifications.items(); track n.id) {
        <div class="toast" [attr.data-kind]="n.kind" role="status">
          <span class="icon" aria-hidden="true">
            @switch (n.kind) {
              @case ('success') { ✅ }
              @case ('error')   { ⛔ }
              @case ('warning') { ⚠️ }
              @default          { ℹ️ }
            }
          </span>
          <div class="body">
            @if (n.title) { <strong>{{ n.title }}</strong> }
            <span>{{ n.message }}</span>
          </div>
          @if (n.action) {
            <button type="button" class="action" (click)="n.action.run(); notifications.dismiss(n.id)">
              {{ n.action.label }}
            </button>
          }
          <button
            type="button"
            class="close"
            aria-label="Cerrar notificación"
            (click)="notifications.dismiss(n.id)"
          >✕</button>
        </div>
      }
    </div>
  `,
  styles: [`
    .toast-host {
      position: fixed;
      top: 1rem;
      right: 1rem;
      z-index: 10000;
      display: flex;
      flex-direction: column;
      gap: 0.6rem;
      max-width: min(420px, calc(100vw - 2rem));
      pointer-events: none;
    }
    .toast {
      pointer-events: auto;
      display: grid;
      grid-template-columns: auto 1fr auto auto;
      align-items: center;
      gap: 0.65rem;
      padding: 0.75rem 0.9rem;
      border-radius: 12px;
      background: var(--color-surface);
      color: var(--color-text);
      border: 1px solid var(--color-border);
      box-shadow: var(--shadow-md);
      animation: toast-in 0.25s ease-out;
      font-size: 0.9rem;
      line-height: 1.35;
    }
    .toast .icon { font-size: 1.15rem; line-height: 1; }
    .toast .body { display: grid; gap: 0.15rem; min-width: 0; }
    .toast .body strong { font-size: 0.95rem; }
    .toast .body span {
      overflow-wrap: anywhere;
    }
    .toast .action {
      border: 1px solid var(--color-border);
      background: transparent;
      color: var(--color-primary-dark);
      padding: 0.3rem 0.7rem;
      border-radius: 999px;
      font-weight: 600;
      cursor: pointer;
      font-size: 0.82rem;
    }
    .toast .action:hover { background: rgba(99,102,241,0.08); }
    .toast .close {
      background: transparent;
      border: none;
      color: var(--color-muted);
      cursor: pointer;
      font-size: 0.95rem;
      padding: 0.15rem 0.35rem;
      border-radius: 6px;
      line-height: 1;
    }
    .toast .close:hover { color: var(--color-text); background: rgba(148,163,184,0.18); }

    .toast[data-kind='success'] { border-left: 4px solid var(--color-success); }
    .toast[data-kind='error']   { border-left: 4px solid var(--color-danger); }
    .toast[data-kind='warning'] { border-left: 4px solid var(--color-warning); }
    .toast[data-kind='info']    { border-left: 4px solid var(--color-primary); }

    @keyframes toast-in {
      from { opacity: 0; transform: translateY(-8px) scale(0.98); }
      to   { opacity: 1; transform: translateY(0) scale(1); }
    }
  `]
})
export class ToastHostComponent {
  protected notifications = inject(NotificationService);
}
