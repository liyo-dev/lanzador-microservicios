import { Injectable, signal } from '@angular/core';

export interface ConfirmRequest {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'primary' | 'warning';
}

interface InternalConfirm extends ConfirmRequest {
  resolve: (ok: boolean) => void;
}

@Injectable({ providedIn: 'root' })
export class ConfirmService {
  private readonly _current = signal<InternalConfirm | null>(null);
  readonly current = this._current.asReadonly();

  ask(req: ConfirmRequest): Promise<boolean> {
    return new Promise(resolve => {
      this._current.set({ ...req, resolve });
    });
  }

  accept() {
    const c = this._current();
    if (!c) return;
    this._current.set(null);
    c.resolve(true);
  }

  cancel() {
    const c = this._current();
    if (!c) return;
    this._current.set(null);
    c.resolve(false);
  }
}
