import { Component, ViewChild, ElementRef, NgZone } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { SpinnerComponent } from '../../Components/spinner/spinner';
import { Router } from '@angular/router';
import gsap from 'gsap';

@Component({
  selector: 'app-launcher',
  standalone: true,
  imports: [FormsModule, CommonModule, SpinnerComponent],
  templateUrl: './launcher.html',
  styleUrls: ['./launcher.scss'],
})
export class Launcher {
  config: any = {};

  angularMicros = [
    { key: 'intradia', label: 'intradía', selected: false, status: 'stopped' },
    { key: 'upload', label: 'upload', selected: false, status: 'stopped' },
    { key: 'reportes', label: 'reportes', selected: false, status: 'stopped' },
    { key: 'pagos', label: 'pagos', selected: false, status: 'stopped' },
  ];

  logs: string[] = [];
  loading = false;
  showLogs = false;
  showSuccessMessage = false;

  @ViewChild('logBox') logBox!: ElementRef;

  constructor(private ngZone: NgZone, private router: Router) {
    (window as any).electronAPI.getConfig().then((cfg: any) => {
      this.config = cfg;
    });

    // ✅ Verifica correctamente si algún micro estaba arrancando
    (window as any).electronAPI.getLastStatus().then((statuses: any) => {
      let anyStarting = false;

      this.angularMicros.forEach((micro) => {
        const lastStatus = statuses.angular?.[micro.key];
        if (lastStatus) {
          micro.status = lastStatus;

          if (lastStatus === 'starting' || lastStatus === 'running') {
            anyStarting = true;
          }
        }
      });

      this.loading = anyStarting;
    });

    // Angular logs
    (window as any).electronAPI.onLogAngular((msg: any) => {
      this.ngZone.run(() => {
        const micro = this.angularMicros.find((m) => m.key === msg.micro);
        if (micro && msg.status) {
          micro.status = msg.status;
        }

        if (msg.status === 'starting' && !this.loading) {
          this.loading = true;
          this.logs.push(`[${msg.micro}] 🚀 Lanzando micro...`);
        }

        if (msg.status === 'running') {
          this.loading = false;
          this.logs.push(`[${msg.micro}] ✅ Micro arrancado correctamente.`);
          this.showSuccessMessage = true;
        }

        if (msg.status === 'stopped') {
          this.loading = false;
          this.logs.push(`[${msg.micro}] 🛑 Micro detenido.`);
        }

        if (!msg.status) {
          this.logs.push(`[${msg.micro}] ${msg.log}`);
        }

        this.scrollToBottom();
      });
    });

    // Spring logs
    (window as any).electronAPI.onLogSpring((msg: any) => {
      this.ngZone.run(() => {
        this.logs.push(`[Spring ${msg.micro}] ${msg.log}`);

        if (msg.status === 'starting') {
          this.loading = true;
          this.logs.push(`[Spring ${msg.micro}] 🚀 Lanzando micro Spring...`);
        }

        if (msg.status === 'running') {
          this.loading = false;
          this.logs.push(
            `[Spring ${msg.micro}] ✅ Micro Spring arrancado correctamente.`
          );
          this.showSuccessMessage = true;
        }

        if (msg.status === 'stopped') {
          this.loading = false;
          this.logs.push(`[Spring ${msg.micro}] 🛑 Micro Spring detenido.`);
        }

        this.scrollToBottom();
      });
    });
  }

  startSelected() {
    this.logs.push('Arrancando micros seleccionados...');
    this.loading = true;
    this.showSuccessMessage = false;

    let started = false;

    this.angularMicros.forEach((micro) => {
      if (micro.selected) {
        const path = this.config.angular[micro.key]?.path;
        const port = this.config.angular[micro.key]?.port;

        if (!path || path.trim() === '') {
          alert(`El micro ${micro.label} no tiene ruta configurada.`);
          this.loading = false;
          return;
        }

        (window as any).electronAPI.startAngular({
          micro: micro.key,
          path,
          port,
        });
        this.logs.push(`→ Arrancando ${micro.label}...`);
        micro.status = 'starting';
        started = true;
      }
    });

    if (!started) this.loading = false;

    this.scrollToBottom();
  }

  stopSelected() {
    this.logs.push('Parando micros seleccionados...');
    this.angularMicros.forEach((micro) => {
      if (micro.selected && micro.status === 'running') {
        (window as any).electronAPI.stopProcess(`angular-${micro.key}`);
        this.logs.push(`→ Parando ${micro.label}...`);
        micro.status = 'stopping';
      } else if (micro.selected && micro.status === 'stopped') {
        this.logs.push(`→ El micro ${micro.label} ya está detenido.`);
      }
    });

    this.scrollToBottom();
  }

  scrollToBottom() {
    try {
      if (this.logBox) {
        setTimeout(() => {
          this.logBox.nativeElement.scrollTop =
            this.logBox.nativeElement.scrollHeight;
        }, 0);
      }
    } catch {}
  }

  toggleLogs() {
    this.showLogs = !this.showLogs;
    if (this.showLogs) {
      setTimeout(() => {
        gsap.from('.log-box', { opacity: 0, y: 20, duration: 0.4 });
      }, 0);
    }
  }

  goToConfig() {
    const microsActivos = this.angularMicros.filter(
      (m) => m.status !== 'stopped'
    );

    if (microsActivos.length > 0) {
      alert('⚠️ No puedes ir a la configuración mientras haya micros activos.');
      return;
    }

    this.router.navigate(['/config']);
  }
}
