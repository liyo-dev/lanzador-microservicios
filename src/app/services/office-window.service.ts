import { Injectable, signal } from '@angular/core';

/**
 * Puente global para pedir la apertura de la ventana de la oficina virtual
 * desde cualquier pantalla (p. ej. la Home). El popup escucha el signal
 * `openRequests` y abre / restaura la ventana cuando cambia.
 */
@Injectable({ providedIn: 'root' })
export class OfficeWindowService {
  /** Contador que se incrementa cada vez que se solicita abrir la oficina. */
  readonly openRequests = signal(0);

  /** Pide al popup que abra (o restaure si está minimizada / cerrada) la oficina. */
  requestOpen(): void {
    this.openRequests.update(v => v + 1);
  }
}
