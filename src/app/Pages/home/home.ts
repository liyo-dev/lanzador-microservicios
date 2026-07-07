import { Component, AfterViewInit, OnDestroy, inject } from '@angular/core';
import { Router } from '@angular/router';
import { gsap } from 'gsap';
import packageJson from '../../../../package.json';

@Component({
  selector: 'app-home',
  templateUrl: './home.html',
  styleUrl: './home.scss',
  standalone: true,
})
export class Home implements AfterViewInit, OnDestroy {
  private router = inject(Router);
  version = packageJson.version;

  // Estadísticas en vivo
  stats = {
    runningCount: 0,
    stoppedCount: 0,
    totalConfigured: 0,
    lastError: '' as string | null,
  };
  private statsTimer: any = null;

  constructor() {
    this.refreshStats();
  }

  ngAfterViewInit(): void {
    const tl = gsap.timeline();

    tl.from('#logo', {
      scale: 0,
      opacity: 0,
      duration: 1,
      ease: 'back.out(1.7)',
    })
      .from('#title h2', {
        y: -50,
        opacity: 0,
        duration: 1,
        ease: 'power2.out',
      })
      .from(
        '#title p',
        {
          opacity: 0,
          y: 20,
          duration: 0.6,
        },
        '-=0.5'
      )
      .from('#buttons button', {
        opacity: 0,
        y: 30,
        stagger: 0.2,
        duration: 0.8,
        ease: 'back.out(1.7)',
      });

    // Refrescar estadísticas cada 5s mientras la home esté visible
    this.statsTimer = setInterval(() => this.refreshStats(), 5000);
  }

  ngOnDestroy(): void {
    if (this.statsTimer) {
      clearInterval(this.statsTimer);
      this.statsTimer = null;
    }
  }

  private async refreshStats() {
    const api = (window as any).electronAPI;
    if (!api) return;
    try {
      const [cfg, statuses] = await Promise.all([
        api.getConfig?.() ?? Promise.resolve({}),
        api.getLastStatus?.() ?? Promise.resolve({}),
      ]);
      const angularKeys = Object.keys(cfg?.angular || {});
      const springKeys = Object.keys(cfg?.spring || {}).filter(
        (k) => k !== 'mavenHome' && k !== 'javaHome' && k !== 'profiles' && k !== 'settingsXml' && k !== 'm2RepoPath'
      );
      const total = angularKeys.length + springKeys.length;
      let running = 0;
      let stopped = 0;
      if (statuses && typeof statuses === 'object') {
        for (const key of Object.values(statuses) as string[]) {
          if (key === 'running') running++;
          else if (key === 'stopped') stopped++;
        }
      }
      this.stats = {
        runningCount: running,
        stoppedCount: stopped,
        totalConfigured: total,
        lastError: null,
      };
    } catch (err: any) {
      this.stats = {
        ...this.stats,
        lastError: err?.message || 'No se pudo leer el estado.',
      };
    }
  }

  goToConfig() {
    this.router.navigate(['/config']);
  }

  goToUsers() {
    this.router.navigate(['/users']);
  }

  goToLauncher() {
    this.router.navigate(['/launcher']);
  }

  goToPorts() {
    this.router.navigate(['/ports']);
  }

  goToTodos() {
    this.router.navigate(['/todos']);
  }
}
