import { Injectable, signal } from '@angular/core';

export type NotificationKind = 'success' | 'error' | 'info' | 'warning';

export interface AppNotification {
  id: number;
  kind: NotificationKind;
  title?: string;
  message: string;
  /** ms; 0 = sticky */
  duration: number;
  /** Acción opcional con botón ("Deshacer", "Reintentar"…) */
  action?: { label: string; run: () => void };
}

interface ShowOptions {
  title?: string;
  duration?: number;
  action?: AppNotification['action'];
}

@Injectable({ providedIn: 'root' })
export class NotificationService {
  private nextId = 1;
  private readonly _items = signal<AppNotification[]>([]);
  /** Lista de toasts visibles (reactiva). */
  readonly items = this._items.asReadonly();

  success(message: string, opts: ShowOptions = {}) {
    return this.push('success', message, opts);
  }

  error(message: string, opts: ShowOptions = {}) {
    return this.push('error', message, { duration: 6000, ...opts });
  }

  info(message: string, opts: ShowOptions = {}) {
    return this.push('info', message, opts);
  }

  warning(message: string, opts: ShowOptions = {}) {
    return this.push('warning', message, opts);
  }

  dismiss(id: number) {
    this._items.update(list => list.filter(n => n.id !== id));
  }

  clear() {
    this._items.set([]);
  }

  private push(kind: NotificationKind, message: string, opts: ShowOptions) {
    const id = this.nextId++;
    const duration = opts.duration ?? 3500;
    const item: AppNotification = {
      id,
      kind,
      message,
      title: opts.title,
      duration,
      action: opts.action
    };
    this._items.update(list => [...list, item]);
    if (duration > 0) {
      setTimeout(() => this.dismiss(id), duration);
    }
    return id;
  }
}
