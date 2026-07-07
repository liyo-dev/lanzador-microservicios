import { Component, Input, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs/operators';

interface NavItem {
  path: string;
  icon: string;
  title: string;
  ariaLabel: string;
}

/**
 * Cabecera de página reutilizable.
 *
 * Renderiza:
 *  - Bloque de título/subtítulo (con icono opcional a la izquierda).
 *  - Barra de acciones con enlaces de navegación (Home, Launcher, Users,
 *    Ports, Todos, Config), ocultando automáticamente el enlace de la
 *    página actual.
 *  - Slot `<ng-content>` al final de la barra para acciones específicas
 *    de la página (botones primarios, toggles, etc.).
 *  - Slot con selector `[page-subtitle]` para subtítulos con contenido
 *    dinámico (p.ej. contadores reactivos en Tareas).
 *
 * Uso mínimo:
 *   <app-page-header title="Mi página" subtitle="Descripción" />
 *
 * Uso con acciones extra y subtítulo dinámico:
 *   <app-page-header title="Tareas" titleIcon="✅">
 *     <p page-subtitle class="page-subtitle">{{ pending }} pendientes</p>
 *     <button class="primary-btn">➕ Nueva</button>
 *   </app-page-header>
 */
@Component({
  selector: 'app-page-header',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './page-header.html',
  styleUrl: './page-header.scss',
})
export class PageHeaderComponent {
  @Input() title = '';
  @Input() subtitle?: string;
  @Input() titleIcon?: string;

  private router = inject(Router);

  /** URL actual observable como signal para recalcular ítems visibles. */
  private currentUrl = signal<string>(this.normalize(this.router.url));

  constructor() {
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe(e => this.currentUrl.set(this.normalize(e.urlAfterRedirects)));
  }

  /** Lista completa de destinos de navegación de la app. */
  private readonly navItems: NavItem[] = [
    { path: '/',         icon: '🏠', title: 'Inicio',             ariaLabel: 'Ir al inicio' },
    { path: '/launcher', icon: '🚀', title: 'Launcher',           ariaLabel: 'Ir al launcher' },
    { path: '/users',    icon: '👥', title: 'Usuarios Portal',    ariaLabel: 'Ir a usuarios del portal' },
    { path: '/ports',    icon: '🔌', title: 'Gestión de Puertos', ariaLabel: 'Ir a gestión de puertos' },
    { path: '/todos',    icon: '✅', title: 'Tareas',             ariaLabel: 'Ir a tareas' },
    { path: '/config',   icon: '⚙️', title: 'Configuración',      ariaLabel: 'Ir a configuración' },
  ];

  /** Ítems visibles = todos menos el de la ruta activa. */
  readonly visibleItems = computed(() =>
    this.navItems.filter(item => !this.isCurrent(item.path))
  );

  private isCurrent(path: string): boolean {
    const cur = this.currentUrl();
    if (path === '/') return cur === '/' || cur === '';
    return cur === path || cur.startsWith(path + '/');
  }

  private normalize(url: string): string {
    return (url || '/').split('?')[0].split('#')[0] || '/';
  }

  navigate(path: string) {
    this.router.navigateByUrl(path);
  }
}
