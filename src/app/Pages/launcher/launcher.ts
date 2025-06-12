import { Component, ViewChild, ElementRef, NgZone } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { ElectronService } from '../../Services/electron';
import { ConfigService } from '../../Services/config';
import { SpinnerComponent } from '../../Components/spinner/spinner';

@Component({
  selector: 'app-launcher',
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
  loading = false; // Spinner flag

  @ViewChild('logBox') logBox!: ElementRef; // para el auto-scroll

  constructor(
    private electronService: ElectronService,
    private configService: ConfigService,
    private ngZone: NgZone
  ) {
    this.configService.getConfig().then((cfg) => {
      this.config = cfg;
    });

    console.log('Launcher component initialized');

    // Obtener último status al iniciar
    this.electronService.invoke('get-last-status').then((statuses) => {
      console.log('👉 Last known statuses:', statuses);

      this.angularMicros.forEach((micro) => {
        const lastStatus = statuses.angular?.[micro.key];
        if (lastStatus) {
          micro.status = lastStatus;

          if (lastStatus === 'starting' || lastStatus === 'running') {
            this.loading = true;
          }
        }
      });
    });

    // Escucha de logs Angular
    this.electronService.on('log-angular', (msg: any) => {
      this.ngZone.run(() => {
        console.log('👉 Angular log received:', msg);

        const matchingMicro = this.angularMicros.find(
          (micro) => micro.key === msg.micro
        );
        if (matchingMicro && msg.status) {
          matchingMicro.status = msg.status;
        }

        if (msg.status === 'starting' && !this.loading) {
          this.loading = true;
          this.logs.push(`[${msg.micro}] 🚀 Lanzando micro...`);
        }

        if (msg.status === 'running') {
          this.loading = false;
          this.logs.push(`[${msg.micro}] ✅ Micro arrancado correctamente.`);
          console.log('quito spinner');
        }

        if (msg.status === 'stopped') {
          this.loading = false;
          this.logs.push(`[${msg.micro}] 🛑 Micro detenido.`);
        }

        if (!msg.status) {
          const logEntry = `[${msg.micro}] ${msg.log}`;
          this.logs.push(logEntry);
        }

        this.scrollToBottom();
      });
    });

    // Escucha de logs Spring
    this.electronService.on('log-spring', (msg: any) => {
      this.ngZone.run(() => {
        const logEntry = `[Spring ${msg.micro}] ${msg.log}`;
        this.logs.push(logEntry);

        if (msg.status === 'starting') {
          this.loading = true;
          this.logs.push(`[Spring ${msg.micro}] 🚀 Lanzando micro Spring...`);
        }

        if (msg.status === 'running') {
          this.loading = false;
          this.logs.push(
            `[Spring ${msg.micro}] ✅ Micro Spring arrancado correctamente.`
          );
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

    this.angularMicros.forEach((micro) => {
      if (micro.selected) {
        const path = this.config.angular[micro.key]?.path;
        const port = this.config.angular[micro.key]?.port;

        if (!path || path.trim() === '') {
          alert(
            `El micro ${micro.label} no tiene ruta configurada. Por favor, configúralo primero.`
          );
          this.loading = false;
          return;
        }

        this.electronService.send('start-angular', {
          micro: micro.key,
          path,
          port,
        });

        this.logs.push(`→ Arrancando ${micro.label}...`);
        micro.status = 'starting';
      }
    });

    this.scrollToBottom();
  }

  stopSelected() {
    this.logs.push('Parando micros seleccionados...');
    this.angularMicros.forEach((micro) => {
      if (micro.selected && micro.status === 'running') {
        this.electronService.send('stop-process', `angular-${micro.key}`);
        this.logs.push(`→ Parando ${micro.label}...`);
        micro.status = 'stopping';
      } else if (micro.selected && micro.status === 'stopped') {
        this.logs.push(`→ El micro ${micro.label} ya está detenido.`);
      }
    });

    this.scrollToBottom();
  }

  private scrollToBottom(): void {
    try {
      if (this.logBox) {
        this.logBox.nativeElement.scrollTop = this.logBox.nativeElement.scrollHeight;
      }
    } catch (err) {}
  }
}
