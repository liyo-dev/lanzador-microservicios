import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { ElectronService } from '../../Services/electron';
import { ConfigService } from '../../Services/config';

@Component({
  selector: 'app-launcher',
  standalone: true,
  imports: [FormsModule, CommonModule],
  templateUrl: './launcher.html',
  styleUrl: './launcher.scss',
})
export class Launcher implements OnInit {
  angularMicros = [
    { key: 'intradia', label: 'intradía', selected: false, status: 'stopped' },
    { key: 'upload', label: 'upload', selected: false, status: 'stopped' },
    { key: 'reportes', label: 'reportes', selected: false, status: 'stopped' },
    { key: 'pagos', label: 'pagos', selected: false, status: 'stopped' }
  ];

  logs: string[] = [];
  config: any = {};

  constructor(
    private electronService: ElectronService,
    private configService: ConfigService
  ) {}

  ngOnInit() {
    this.configService.getConfig().then((cfg) => {
      this.config = cfg;
    });

    this.electronService.on('log-angular', (_event, data) => {
      this.logs.push(`[${data.micro}] ${data.log}`);
      // actualizar estado visual
      const micro = this.angularMicros.find(m => m.key === data.micro);
      if (micro && data.status) {
        micro.status = data.status;
      }
    });
  }

  startSelected() {
    this.logs.push('Arrancando micros seleccionados...');
    this.angularMicros.forEach((micro) => {
      if (micro.selected) {
        const path = this.config.angular[micro.key]?.path;
        const port = this.config.angular[micro.key]?.port;
        if (!path || path.trim() === '') {
          alert(
            `El micro ${micro.label} no tiene ruta configurada. Por favor, configúralo primero.`
          );
          return;
        }
        // Aquí sí lanzas el proceso
        this.electronService.send('start-angular', {
          path,
          port,
          micro: micro.key
        });
        this.logs.push(`→ Arrancando ${micro.label}...`);
        micro.status = 'running';
      }
    });
  }

  stopSelected() {
    this.logs.push('Parando micros seleccionados...');
    this.angularMicros.forEach((micro) => {
      if (micro.selected && micro.status === 'running') {
        this.electronService.send('stop-process', `angular-${micro.key}`);
        this.logs.push(`→ Parando ${micro.label}...`);
      }
    });
  }
}
