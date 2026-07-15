import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import gsap from 'gsap';
import { NotificationService } from '../../services/notification.service';
import { ConfirmService } from '../../services/confirm.service';
import { PageHeaderComponent } from '../../Components/page-header/page-header';

export type TodoStatus = 'pending' | 'in-progress' | 'done';
export type TodoPriority = 'low' | 'medium' | 'high';
/**
 * Tipo de entrada. Además de las "tareas" clásicas, dejamos registrar
 * reuniones, tiempo ayudando a alguien, interrupciones y eventos varios
 * (útil para preparar la daily).
 */
export type TodoType = 'task' | 'meeting' | 'help' | 'interruption' | 'other';

export interface TodoTask {
  id: string;
  title: string;
  description?: string;
  status: TodoStatus;
  priority: TodoPriority;
  /** Tipo de elemento (tarea por defecto). */
  type: TodoType;
  /** Día al que se asocia esta entrada (YYYY-MM-DD). Para la vista Daily. */
  workDate?: string;
  dueDate?: string;   // YYYY-MM-DD
  tags: string[];
  createdAt: string;  // ISO
  completedAt?: string;
}

type StatusFilter = 'all' | TodoStatus;
type PriorityFilter = 'all' | TodoPriority;
type SortMode = 'created-desc' | 'created-asc' | 'due-asc' | 'priority-desc';
type ViewMode = 'list' | 'daily';

const LS_KEY = 'launcher.todos';

@Component({
  selector: 'app-todos',
  standalone: true,
  imports: [CommonModule, FormsModule, PageHeaderComponent],
  templateUrl: './todos.html',
  styleUrls: ['./todos.scss'],
})
export class TodosComponent implements OnInit, OnDestroy {
  private router = inject(Router);
  private notify = inject(NotificationService);
  private confirm = inject(ConfirmService);

  /** Todas las tareas (signal para reactividad). */
  tasks = signal<TodoTask[]>([]);

  // Filtros / orden / búsqueda (signals)
  search = signal<string>('');
  statusFilter = signal<StatusFilter>('all');
  priorityFilter = signal<PriorityFilter>('all');
  tagFilter = signal<string>('');
  sortMode = signal<SortMode>('created-desc');

  // Modo de vista (Lista clásica vs Daily)
  viewMode = signal<ViewMode>('list');

  /**
   * Clave del día "real" actual (YYYY-MM-DD). Se re-evalúa cada minuto
   * para que si dejas la app abierta y cruza la medianoche, las columnas
   * del Daily y la auto-purga se mantengan al día.
   */
  nowKey = signal<string>(this.todayKey());
  private nowKeyTimer: any = null;

  /** Día seleccionado en la vista Daily (YYYY-MM-DD). */
  dailyDate = signal<string>(this.todayKey());
  /** Marca si el usuario ha seleccionado explícitamente un día distinto a hoy. */
  private dailyDateUserSet = false;

  /** Texto de alta rápida por columna de la vista Daily. */
  dailyQuickTitle: Record<'yesterday' | 'today' | 'tomorrow', string> = {
    yesterday: '',
    today: '',
    tomorrow: '',
  };

  /** Tipo seleccionado para la alta rápida en cada columna. */
  dailyQuickType: Record<'yesterday' | 'today' | 'tomorrow', TodoType> = {
    yesterday: 'task',
    today: 'task',
    tomorrow: 'task',
  };

  // UI: formulario rápido (siempre visible) y modal de edición completa
  quickTitle = '';
  showEditModal = false;
  editing: TodoTask | null = null;

  // Modelo del modal
  draft: TodoTask = this.emptyTask();

  // Para gestión de tags como string en el modal
  draftTagsInput = '';

  // Plantillas (constantes auxiliares en la plantilla)
  readonly priorities: { key: TodoPriority; label: string; icon: string }[] = [
    { key: 'low',    label: 'Baja',  icon: '🟢' },
    { key: 'medium', label: 'Media', icon: '🟡' },
    { key: 'high',   label: 'Alta',  icon: '🔴' },
  ];

  readonly statusesUi: { key: TodoStatus; label: string; icon: string }[] = [
    { key: 'pending',     label: 'Pendiente',    icon: '⏳' },
    { key: 'in-progress', label: 'En curso',     icon: '🚀' },
    { key: 'done',        label: 'Completada',   icon: '✅' },
  ];

  readonly types: { key: TodoType; label: string; icon: string }[] = [
    { key: 'task',         label: 'Tarea',        icon: '📝' },
    { key: 'meeting',      label: 'Reunión',      icon: '📅' },
    { key: 'help',         label: 'Ayuda',        icon: '🤝' },
    { key: 'interruption', label: 'Interrupción', icon: '⚡' },
    { key: 'other',        label: 'Otro',         icon: '💬' },
  ];

  // ============================================================
  // Derivados
  // ============================================================
  stats = computed(() => {
    const list = this.tasks();
    return {
      total: list.length,
      pending: list.filter(t => t.status === 'pending').length,
      inProgress: list.filter(t => t.status === 'in-progress').length,
      done: list.filter(t => t.status === 'done').length,
      overdue: list.filter(t => this.isOverdue(t)).length,
    };
  });

  /** Lista única de tags presentes (para el filtro). */
  allTags = computed(() => {
    const set = new Set<string>();
    for (const t of this.tasks()) {
      for (const tag of t.tags) {
        if (tag) set.add(tag);
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'es'));
  });

  /** Tareas filtradas + ordenadas. */
  visibleTasks = computed(() => {
    const term = this.search().trim().toLowerCase();
    const status = this.statusFilter();
    const priority = this.priorityFilter();
    const tag = this.tagFilter().trim();

    let list = this.tasks().filter(t => {
      if (status !== 'all' && t.status !== status) return false;
      if (priority !== 'all' && t.priority !== priority) return false;
      if (tag && !t.tags.includes(tag)) return false;
      if (term) {
        const haystack = (
          t.title +
          ' ' + (t.description ?? '') +
          ' ' + t.tags.join(' ')
        ).toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      return true;
    });

    const priorityRank: Record<TodoPriority, number> = { high: 0, medium: 1, low: 2 };

    list = [...list].sort((a, b) => {
      switch (this.sortMode()) {
        case 'created-asc':
          return a.createdAt.localeCompare(b.createdAt);
        case 'due-asc': {
          const ad = a.dueDate || '\uffff';
          const bd = b.dueDate || '\uffff';
          return ad.localeCompare(bd);
        }
        case 'priority-desc':
          return priorityRank[a.priority] - priorityRank[b.priority];
        case 'created-desc':
        default:
          return b.createdAt.localeCompare(a.createdAt);
      }
    });

    return list;
  });

  // ============================================================
  // Ciclo de vida
  // ============================================================
  ngOnInit(): void {
    this.loadTasks();
    // Refresco periódico (cada 60s) por si dejan la app abierta
    this.nowKeyTimer = setInterval(() => {
      const fresh = this.todayKey();
      if (fresh !== this.nowKey()) {
        this.nowKey.set(fresh);
        // Si el usuario no había navegado explícitamente, snap a hoy real
        if (!this.dailyDateUserSet) this.dailyDate.set(fresh);
        // Purga las completadas que ya hayan caducado (ayer real ya pasó)
        const purged = this.purgeExpiredCompleted(this.tasks());
        if (purged.length !== this.tasks().length) {
          this.tasks.set(purged);
          this.persist();
        }
      }
    }, 60_000);

    setTimeout(() => {
      gsap.fromTo(
        '.todos-shell',
        { opacity: 0, y: 24 },
        { opacity: 1, y: 0, duration: 0.5, ease: 'power2.out' }
      );
    }, 0);
  }

  ngOnDestroy(): void {
    if (this.nowKeyTimer) {
      clearInterval(this.nowKeyTimer);
      this.nowKeyTimer = null;
    }
  }

  // ============================================================
  // Persistencia
  // ============================================================
  private loadTasks() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as TodoTask[];
        // Normaliza por si faltase algún campo (migraciones antiguas)
        const normalized = parsed.map(t => ({
          ...t,
          tags: Array.isArray(t.tags) ? t.tags : [],
          status: t.status ?? 'pending',
          priority: t.priority ?? 'medium',
          type: (t as TodoTask).type ?? 'task',
        }));
        // Auto-purga: tareas completadas hace más de un día (ayer real ya pasó)
        const purged = this.purgeExpiredCompleted(normalized);
        this.tasks.set(purged);
        if (purged.length !== normalized.length) this.persist();
      } else {
        // Seed inicial para que el usuario vea cómo se usa
        this.tasks.set([
          {
            id: this.id(),
            title: 'Bienvenido a tu lista de tareas 🎉',
            description: 'Cambia entre las pestañas Lista y Daily. En Daily verás qué hiciste ayer y qué toca hoy.',
            status: 'pending',
            priority: 'medium',
            type: 'task',
            tags: ['demo'],
            createdAt: new Date().toISOString(),
          },
        ]);
        this.persist();
      }
    } catch (e) {
      console.warn('No se pudieron cargar tareas:', e);
      this.tasks.set([]);
    }
  }

  /**
   * Borra tareas completadas con `completedAt` anterior a ayer real.
   * Es decir, las completadas hoy o ayer permanecen; las anteriores se eliminan.
   */
  private purgeExpiredCompleted(list: TodoTask[]): TodoTask[] {
    const today = this.todayKey();
    const yesterday = this.shiftKey(today, -1);
    return list.filter(t => {
      if (t.status !== 'done') return true;
      const key = this.completionKey(t);
      if (!key) return true; // sin fecha de completado, no la borramos
      return key === today || key === yesterday;
    });
  }

  private persist() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(this.tasks()));
    } catch (e) {
      console.warn('No se pudieron guardar tareas:', e);
    }
  }

  // ============================================================
  // Alta rápida (input de cabecera)
  // ============================================================
  quickAdd() {
    const title = this.quickTitle.trim();
    if (!title) return;
    const task: TodoTask = {
      id: this.id(),
      title,
      status: 'pending',
      priority: 'medium',
      type: 'task',
      tags: [],
      createdAt: new Date().toISOString(),
    };
    this.tasks.update(list => [task, ...list]);
    this.persist();
    this.quickTitle = '';
    this.notify.success('Tarea añadida.', { duration: 1500 });
  }

  // ============================================================
  // Modal de edición / nueva tarea con todos los campos
  // ============================================================
  openNew() {
    this.editing = null;
    this.draft = this.emptyTask();
    this.draftTagsInput = '';
    this.showEditModal = true;
  }

  openEdit(task: TodoTask) {
    this.editing = task;
    this.draft = { ...task, tags: [...task.tags] };
    this.draftTagsInput = task.tags.join(', ');
    this.showEditModal = true;
  }

  closeModal() {
    this.showEditModal = false;
    this.editing = null;
    this.draft = this.emptyTask();
    this.draftTagsInput = '';
  }

  saveDraft() {
    const title = (this.draft.title || '').trim();
    if (!title) {
      this.notify.warning('El título es obligatorio.', { title: 'Faltan datos' });
      return;
    }
    const tags = this.draftTagsInput
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);

    const result: TodoTask = {
      ...this.draft,
      title,
      tags,
    };

    if (this.editing) {
      this.tasks.update(list => list.map(t => (t.id === this.editing!.id ? result : t)));
      this.notify.success('Tarea actualizada.');
    } else {
      result.id = this.id();
      result.createdAt = new Date().toISOString();
      this.tasks.update(list => [result, ...list]);
      this.notify.success('Tarea creada.');
    }
    this.persist();
    this.closeModal();
  }

  // ============================================================
  // Acciones sobre una tarea
  // ============================================================
  toggleDone(task: TodoTask) {
    const now = new Date().toISOString();
    const next: TodoTask = task.status === 'done'
      ? { ...task, status: 'pending', completedAt: undefined }
      : { ...task, status: 'done',    completedAt: now };
    this.tasks.update(list => list.map(t => (t.id === task.id ? next : t)));
    this.persist();
  }

  cycleStatus(task: TodoTask) {
    // pending → in-progress → done → pending
    const order: TodoStatus[] = ['pending', 'in-progress', 'done'];
    const idx = order.indexOf(task.status);
    const nextStatus = order[(idx + 1) % order.length];
    const next: TodoTask = {
      ...task,
      status: nextStatus,
      completedAt: nextStatus === 'done' ? new Date().toISOString() : undefined,
    };
    this.tasks.update(list => list.map(t => (t.id === task.id ? next : t)));
    this.persist();
  }

  async deleteTask(task: TodoTask) {
    const ok = await this.confirm.ask({
      title: 'Eliminar tarea',
      message: `¿Borrar la tarea "${task.title}"?`,
      confirmLabel: 'Eliminar',
      cancelLabel: 'Cancelar',
      tone: 'danger',
    });
    if (!ok) return;
    this.tasks.update(list => list.filter(t => t.id !== task.id));
    this.persist();
    this.notify.info('Tarea eliminada.');
  }

  async clearCompleted() {
    const count = this.tasks().filter(t => t.status === 'done').length;
    if (!count) {
      this.notify.info('No hay tareas completadas que borrar.');
      return;
    }
    const ok = await this.confirm.ask({
      title: 'Borrar completadas',
      message: `¿Eliminar las ${count} tareas completadas?`,
      confirmLabel: 'Borrar',
      tone: 'danger',
    });
    if (!ok) return;
    this.tasks.update(list => list.filter(t => t.status !== 'done'));
    this.persist();
    this.notify.success('Listo: tareas completadas eliminadas.');
  }

  // ============================================================
  // Helpers de UI
  // ============================================================
  isOverdue(task: TodoTask): boolean {
    if (!task.dueDate || task.status === 'done') return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const due = new Date(task.dueDate + 'T00:00:00');
    return due.getTime() < today.getTime();
  }

  isDueSoon(task: TodoTask): boolean {
    if (!task.dueDate || task.status === 'done') return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const due = new Date(task.dueDate + 'T00:00:00');
    const diff = (due.getTime() - today.getTime()) / 86_400_000;
    return diff >= 0 && diff <= 2;
  }

  priorityIcon(p: TodoPriority): string {
    return this.priorities.find(x => x.key === p)?.icon ?? '⚪';
  }
  priorityLabel(p: TodoPriority): string {
    return this.priorities.find(x => x.key === p)?.label ?? p;
  }
  statusIcon(s: TodoStatus): string {
    return this.statusesUi.find(x => x.key === s)?.icon ?? '⏳';
  }
  statusLabel(s: TodoStatus): string {
    return this.statusesUi.find(x => x.key === s)?.label ?? s;
  }
  typeIcon(t: TodoType): string {
    return this.types.find(x => x.key === t)?.icon ?? '📝';
  }
  typeLabel(t: TodoType): string {
    return this.types.find(x => x.key === t)?.label ?? t;
  }

  clearSearch()       { this.search.set(''); }
  clearTagFilter()    { this.tagFilter.set(''); }
  resetFilters() {
    this.search.set('');
    this.statusFilter.set('all');
    this.priorityFilter.set('all');
    this.tagFilter.set('');
    this.sortMode.set('created-desc');
  }

  // Navegación
  goToHome()     { this.router.navigate(['']); }
  goToLauncher() { this.router.navigate(['/launcher']); }
  goToUsers()    { this.router.navigate(['/users']); }
  goToConfig()   { this.router.navigate(['/config']); }
  goToPorts()    { this.router.navigate(['/ports']); }

  // ============================================================
  // Vista Daily
  // ============================================================

  /** Computeds reactivos por columna del Daily. */
  readonly dailyToday = computed(() => this.computeDailyColumn('today'));
  readonly dailyYesterday = computed(() => this.computeDailyColumn('yesterday'));
  readonly dailyTomorrow = computed(() => this.computeDailyColumn('tomorrow'));

  /**
   * Tareas que deben aparecer en una columna del Daily.
   *
   * Reglas:
   * - En curso (pending / in-progress) se arrastran SIEMPRE a la columna "Hoy".
   *   Si su `createdAt` es anterior al día seleccionado, también aparecen en "Ayer"
   *   (porque ya estaban pendientes el día anterior).
   * - Completadas: aparecen en la columna del día en que se completaron (Ayer u Hoy).
   *   Las completadas hace más tiempo se purgan al cargar.
   * - "Mañana": pensado para planificación → tareas con `workDate` asignado a ese día.
   */
  tasksForDailyColumn(column: 'yesterday' | 'today' | 'tomorrow'): TodoTask[] {
    return column === 'today'
      ? this.dailyToday()
      : column === 'yesterday' ? this.dailyYesterday()
      : this.dailyTomorrow();
  }

  private computeDailyColumn(column: 'yesterday' | 'today' | 'tomorrow'): TodoTask[] {
    // Forzamos dependencia con nowKey para refresco automático al cruzar días.
    this.nowKey();

    const selected = this.dailyDate();
    const yKey = this.shiftKey(selected, -1);
    const mKey = this.shiftKey(selected, 1);

    const all = this.tasks();

    let matches: TodoTask[];

    if (column === 'today') {
      matches = all.filter(t => {
        if (t.status === 'done') {
          // Si no hay completedAt válido (legacy), lo tratamos como completada hoy real
          const ck = this.completionKey(t) || this.nowKey();
          return ck === selected;
        }
        // En curso: aparecen en "Hoy" si fueron creadas hasta el día seleccionado
        const created = this.creationKey(t);
        return created <= selected;
      });
    } else if (column === 'yesterday') {
      matches = all.filter(t => {
        if (t.status === 'done') {
          const ck = this.completionKey(t);
          if (!ck) return false; // sin completedAt no la situamos en ayer
          return ck === yKey;
        }
        // Solo tareas en curso (in-progress): se arrastran a "Ayer" si ya existían antes del día seleccionado
        // Las tareas abiertas (pending) no deben aparecer en la columna de ayer
        if (t.status !== 'in-progress') return false;
        const created = this.creationKey(t);
        return created < selected;
      });
    } else {
      // "Mañana": planificación explícita con workDate
      matches = all.filter(t => t.workDate === mKey && t.status !== 'done');
    }

    return [...matches].sort((a, b) => {
      // Orden cronológico: por timestamp relevante (completedAt si done, si no createdAt)
      const ka = a.status === 'done' ? (a.completedAt || a.createdAt) : a.createdAt;
      const kb = b.status === 'done' ? (b.completedAt || b.createdAt) : b.createdAt;
      return ka.localeCompare(kb);
    });
  }

  /** (Legacy) Tareas asignadas a un día concreto (workDate === dateKey). */
  tasksOnDay(dateKey: string): TodoTask[] {
    if (!dateKey) return [];
    return this.tasks().filter(t => t.workDate === dateKey);
  }

  /** Fecha en formato YYYY-MM-DD para hoy en hora local. */
  todayKey(): string {
    return this.toKey(new Date());
  }

  /** Desplaza el día seleccionado n días (puede ser negativo). */
  shiftDailyDate(deltaDays: number) {
    const d = this.parseKey(this.dailyDate());
    d.setDate(d.getDate() + deltaDays);
    const next = this.toKey(d);
    this.dailyDate.set(next);
    this.dailyDateUserSet = next !== this.nowKey();
  }

  setDailyToToday() {
    this.dailyDate.set(this.nowKey());
    this.dailyDateUserSet = false;
  }

  /** Llamado desde el input date del Daily. */
  onDailyDateChange(value: string) {
    const next = value || this.nowKey();
    this.dailyDate.set(next);
    this.dailyDateUserSet = next !== this.nowKey();
  }

  /** Devuelve el día anterior al seleccionado (YYYY-MM-DD). */
  dailyYesterdayKey(): string {
    const d = this.parseKey(this.dailyDate());
    d.setDate(d.getDate() - 1);
    return this.toKey(d);
  }

  /** Devuelve el día siguiente al seleccionado (YYYY-MM-DD). */
  dailyTomorrowKey(): string {
    const d = this.parseKey(this.dailyDate());
    d.setDate(d.getDate() + 1);
    return this.toKey(d);
  }

  /** Formatea YYYY-MM-DD como "lun, 24 jun 2026". */
  formatDayLabel(dateKey: string): string {
    if (!dateKey) return '';
    try {
      return this.parseKey(dateKey).toLocaleDateString('es-ES', {
        weekday: 'short',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      });
    } catch {
      return dateKey;
    }
  }

  /** ¿Es hoy esa fecha? */
  isToday(dateKey: string): boolean {
    return dateKey === this.todayKey();
  }

  /** Alta rápida en una columna de la vista Daily. */
  dailyQuickAdd(column: 'yesterday' | 'today' | 'tomorrow') {
    const title = (this.dailyQuickTitle[column] || '').trim();
    if (!title) return;

    const type = this.dailyQuickType[column];
    const nowIso = new Date().toISOString();

    let task: TodoTask;

    if (column === 'yesterday') {
      // Ya hecha ayer: se crea directamente como completada con completedAt = ayer
      const yKey = this.shiftKey(this.dailyDate(), -1);
      const completedAtIso = this.endOfDayIso(yKey);
      // createdAt antes del completado para coherencia visual
      task = {
        id: this.id(),
        title,
        status: 'done',
        priority: 'medium',
        type,
        tags: [],
        createdAt: completedAtIso,
        completedAt: completedAtIso,
      };
    } else if (column === 'tomorrow') {
      // Planificada: se anota con workDate = mañana
      const mKey = this.shiftKey(this.dailyDate(), 1);
      task = {
        id: this.id(),
        title,
        status: 'pending',
        priority: 'medium',
        type,
        workDate: mKey,
        tags: [],
        createdAt: nowIso,
      };
    } else {
      // Hoy: tarea normal en curso
      task = {
        id: this.id(),
        title,
        status: 'pending',
        priority: 'medium',
        type,
        tags: [],
        createdAt: nowIso,
      };
    }

    this.tasks.update(list => [task, ...list]);
    this.persist();
    this.dailyQuickTitle[column] = '';
  }

  /** Mueve una tarea al día seleccionado (cambia workDate y completedAt si aplica). */
  moveToSelectedDay(task: TodoTask) {
    const target = this.dailyDate();
    const next: TodoTask = { ...task, workDate: target };
    if (task.status === 'done') {
      next.completedAt = this.endOfDayIso(target);
    }
    this.tasks.update(list => list.map(t => (t.id === task.id ? next : t)));
    this.persist();
    this.notify.info(`Movida a ${this.formatDayLabel(target)}.`, { duration: 1500 });
  }

  /** Mueve una tarea n días respecto a su workDate (o al día seleccionado si no tiene). */
  shiftTaskDay(task: TodoTask, deltaDays: number) {
    const base = task.workDate ? this.parseKey(task.workDate) : this.parseKey(this.dailyDate());
    base.setDate(base.getDate() + deltaDays);
    const next: TodoTask = { ...task, workDate: this.toKey(base) };
    this.tasks.update(list => list.map(t => (t.id === task.id ? next : t)));
    this.persist();
  }

  /**
   * Construye el texto del daily (ayer + hoy) para copiar al portapapeles.
   * Pensado para pegar en Teams/Slack: usa viñetas y agrupa por tipo.
   */
  buildDailyText(): string {
    const today = this.dailyDate();
    const yesterday = this.shiftKey(today, -1);

    const renderBlock = (label: string, column: 'yesterday' | 'today') => {
      const dateKey = column === 'yesterday' ? yesterday : today;
      const items = this.tasksForDailyColumn(column);
      const header = `${label} (${this.formatDayLabel(dateKey)}):`;
      if (!items.length) return `${header}\n  - (sin entradas)`;
      const lines = items.map(t => {
        const icon = this.typeIcon(t.type);
        const status =
          t.status === 'done' ? '[x]'
          : t.status === 'in-progress' ? '[~]'
          : '[ ]';
        return `  - ${status} ${icon} ${t.title}`;
      });
      return `${header}\n${lines.join('\n')}`;
    };

    return [
      `📅 Daily · ${this.formatDayLabel(today)}`,
      '',
      renderBlock('✅ Ayer', 'yesterday'),
      '',
      renderBlock('🎯 Hoy', 'today'),
    ].join('\n');
  }

  copyDailyToClipboard() {
    const text = this.buildDailyText();
    const done = () => this.notify.success('Daily copiado al portapapeles.', { duration: 1800 });
    try {
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(text).then(done).catch(() => {
          this.fallbackCopy(text); done();
        });
      } else {
        this.fallbackCopy(text); done();
      }
    } catch {
      this.fallbackCopy(text); done();
    }
  }

  private fallbackCopy(text: string) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    } catch (e) {
      console.warn('No se pudo copiar al portapapeles', e);
    }
  }

  // Utilidades privadas
  private id(): string {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  /** Convierte un Date a YYYY-MM-DD respetando la zona local. */
  private toKey(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  /** Parsea YYYY-MM-DD a Date local (sin desfase UTC). */
  private parseKey(key: string): Date {
    if (!key) return new Date();
    const [y, m, d] = key.split('-').map(n => parseInt(n, 10));
    return new Date(y, (m || 1) - 1, d || 1);
  }

  /** Devuelve un YYYY-MM-DD desplazado n días respecto al de partida. */
  private shiftKey(key: string, deltaDays: number): string {
    const d = this.parseKey(key);
    d.setDate(d.getDate() + deltaDays);
    return this.toKey(d);
  }

  /** Clave del día en que se completó la tarea ("" si no procede). */
  private completionKey(t: TodoTask): string {
    if (!t.completedAt) return '';
    const d = new Date(t.completedAt);
    if (Number.isNaN(d.getTime())) return '';
    return this.toKey(d);
  }

  /** Clave del día de creación. */
  private creationKey(t: TodoTask): string {
    if (!t.createdAt) return this.todayKey();
    const d = new Date(t.createdAt);
    if (Number.isNaN(d.getTime())) return this.todayKey();
    return this.toKey(d);
  }

  /** ISO al final del día (útil para fijar completedAt en un día concreto). */
  private endOfDayIso(key: string): string {
    const d = this.parseKey(key);
    d.setHours(23, 59, 0, 0);
    return d.toISOString();
  }

  private emptyTask(): TodoTask {
    return {
      id: '',
      title: '',
      description: '',
      status: 'pending',
      priority: 'medium',
      type: 'task',
      dueDate: '',
      workDate: '',
      tags: [],
      createdAt: '',
    };
  }
}
