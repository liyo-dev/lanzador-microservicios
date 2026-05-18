import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ConfirmService } from '../../services/confirm.service';

@Component({
  selector: 'app-confirm-host',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (svc.current(); as c) {
      <div class="confirm-backdrop" (click)="svc.cancel()">
        <div class="confirm-dialog" role="alertdialog" aria-modal="true" (click)="$event.stopPropagation()" [attr.data-tone]="c.tone || 'primary'">
          <h3>{{ c.title }}</h3>
          <p>{{ c.message }}</p>
          <div class="actions">
            <button type="button" class="ghost" (click)="svc.cancel()">{{ c.cancelLabel || 'Cancelar' }}</button>
            <button type="button" class="primary" (click)="svc.accept()">{{ c.confirmLabel || 'Aceptar' }}</button>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    .confirm-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(15, 23, 42, 0.45);
      backdrop-filter: blur(4px);
      display: grid;
      place-items: center;
      z-index: 10001;
      animation: fade 0.18s ease-out;
    }
    .confirm-dialog {
      background: var(--color-surface);
      color: var(--color-text);
      border: 1px solid var(--color-border);
      border-radius: 16px;
      padding: 1.5rem 1.6rem;
      width: min(460px, calc(100vw - 2rem));
      box-shadow: var(--shadow-lg);
      animation: pop 0.22s ease-out;
    }
    .confirm-dialog h3 { margin: 0 0 0.5rem; font-size: 1.15rem; }
    .confirm-dialog p  { margin: 0 0 1.25rem; color: var(--color-muted); line-height: 1.5; }
    .actions {
      display: flex;
      justify-content: flex-end;
      gap: 0.6rem;
    }
    .actions button {
      border: none;
      cursor: pointer;
      padding: 0.55rem 1.1rem;
      border-radius: 999px;
      font-weight: 600;
      font-size: 0.9rem;
      transition: transform 0.15s ease, box-shadow 0.15s ease, background 0.15s ease;
    }
    .ghost {
      background: rgba(148, 163, 184, 0.18);
      color: var(--color-muted);
    }
    .ghost:hover { color: var(--color-text); background: rgba(148, 163, 184, 0.28); }
    .primary {
      background: linear-gradient(135deg, var(--color-primary), #60a5fa);
      color: #fff;
      box-shadow: var(--shadow-sm);
    }
    .primary:hover { transform: translateY(-1px); box-shadow: var(--shadow-md); }

    .confirm-dialog[data-tone='danger'] .primary {
      background: linear-gradient(135deg, #ef4444, #f87171);
    }
    .confirm-dialog[data-tone='warning'] .primary {
      background: linear-gradient(135deg, #f59e0b, #fbbf24);
      color: #1f2937;
    }

    @keyframes fade { from { opacity: 0; } to { opacity: 1; } }
    @keyframes pop  { from { opacity: 0; transform: scale(0.96); } to { opacity: 1; transform: scale(1); } }
  `]
})
export class ConfirmHostComponent {
  protected svc = inject(ConfirmService);
}
