import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import gsap from 'gsap';
import { NotificationService } from '../../services/notification.service';
import { ConfirmService } from '../../services/confirm.service';

interface PortProcess {
  protocol: string;
  localAddress: string;
  port: string;
  foreignAddress: string;
  state: string;
  pid: string;
}

declare global {
  interface Window {
    electronAPI?: {
      findProcessByPort: (port: string) => Promise<{ success: boolean; processes: PortProcess[]; error?: string }>;
      killProcess: (pid: string) => Promise<{ success: boolean; error?: string }>;
    };
  }
}

@Component({
  selector: 'app-ports',
  standalone: true,
  imports: [FormsModule, CommonModule],
  templateUrl: './ports.html',
  styleUrls: ['./ports.scss'],
})
export class PortsComponent implements OnInit {
  private router = inject(Router);
  private notify = inject(NotificationService);
  private confirm = inject(ConfirmService);
  
  searchPort = '';
  isSearching = false;
  processes: PortProcess[] = [];
  errorMessage = '';
  successMessage = '';

  // Puertos comunes para sugerencias
  commonPorts = [
    { port: '8080', name: 'Portal Local' },
    { port: '4200', name: 'Angular Dev' },
  ];

  ngOnInit() {
    this.animateEntrance();
  }

  private animateEntrance() {
    setTimeout(() => {
      gsap.fromTo('.ports-shell', 
        { opacity: 0, y: 30 }, 
        { opacity: 1, y: 0, duration: 0.6, ease: 'power2.out' }
      );
    }, 0);
  }

  async searchProcesses() {
    if (!this.searchPort || !this.searchPort.trim()) {
      this.errorMessage = '⚠️ Introduce un puerto para buscar';
      this.clearMessagesAfterDelay();
      return;
    }

    // Validar que sea un número
    const portNum = parseInt(this.searchPort.trim());
    if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
      this.errorMessage = '⚠️ Puerto inválido. Debe ser un número entre 1 y 65535';
      this.clearMessagesAfterDelay();
      return;
    }

    this.isSearching = true;
    this.errorMessage = '';
    this.successMessage = '';
    this.processes = [];

    try {
      const result = await window.electronAPI!.findProcessByPort(this.searchPort.trim());
      
      if (result.success) {
        this.processes = result.processes;
        
        if (this.processes.length === 0) {
          this.successMessage = `✅ Puerto ${this.searchPort} está libre`;
        } else {
          this.successMessage = `🔍 Encontrados ${this.processes.length} proceso(s) usando el puerto ${this.searchPort}`;
          
          // Animar entrada de resultados
          setTimeout(() => {
            gsap.fromTo('.process-row', 
              { opacity: 0, x: -20 }, 
              { opacity: 1, x: 0, duration: 0.4, stagger: 0.1, ease: 'power2.out' }
            );
          }, 0);
        }
      } else {
        this.errorMessage = `❌ Error: ${result.error}`;
      }
    } catch (error) {
      this.errorMessage = `❌ Error al buscar procesos: ${error}`;
      console.error('Error searching processes:', error);
    } finally {
      this.isSearching = false;
      this.clearMessagesAfterDelay();
    }
  }

  async killProcess(pid: string) {
    const ok = await this.confirm.ask({
      title: 'Terminar proceso',
      message: `¿Seguro que quieres terminar el proceso con PID ${pid}? Se cerrará inmediatamente.`,
      confirmLabel: 'Terminar',
      cancelLabel: 'Cancelar',
      tone: 'danger'
    });
    if (!ok) return;

    try {
      const result = await window.electronAPI!.killProcess(pid);

      if (result.success) {
        this.successMessage = `✅ Proceso ${pid} terminado correctamente`;
        this.notify.success(`Proceso ${pid} terminado.`);

        // Animar salida del proceso eliminado
        const row = document.querySelector(`[data-pid="${pid}"]`);
        if (row) {
          gsap.to(row, {
            opacity: 0,
            x: 20,
            duration: 0.3,
            ease: 'power2.in',
            onComplete: () => {
              // Volver a buscar para actualizar la lista
              this.searchProcesses();
            }
          });
        }
      } else {
        this.errorMessage = `❌ Error al terminar proceso: ${result.error}`;
        this.notify.error(result.error || `No se pudo terminar el proceso ${pid}.`, { title: 'Error' });
      }
    } catch (error) {
      this.errorMessage = `❌ Error: ${error}`;
      this.notify.error(`Error inesperado al terminar el proceso ${pid}.`, { title: 'Error' });
      console.error('Error killing process:', error);
    } finally {
      this.clearMessagesAfterDelay();
    }
  }

  setPort(port: string) {
    this.searchPort = port;
    this.searchProcesses();
  }

  private clearMessagesAfterDelay() {
    setTimeout(() => {
      this.errorMessage = '';
      this.successMessage = '';
    }, 5000);
  }

  goBack() {
    this.router.navigate(['/']);
  }

  goToHome() {
    this.router.navigate(['/']);
  }

  goToConfig() {
    this.router.navigate(['/config']);
  }

  goToLauncher() {
    this.router.navigate(['/launcher']);
  }

  goToUsers() {
    this.router.navigate(['/users']);
  }
}
