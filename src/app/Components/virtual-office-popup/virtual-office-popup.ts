import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  OnInit,
  ViewChild,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { NotificationService } from '../../services/notification.service';
import { OfficeWindowService } from '../../services/office-window.service';
import {
  BugHuntRankingEntry,
  ConnectionState,
  PlayerPayload,
  VirtualOfficeService,
} from '../../Pages/office/virtual-office.service';
import { getVirtualOfficeUrl } from '../../config/virtual-office.config';

export interface OfficeAvatar {
  id: string;
  emoji: string;
  label: string;
  tone: 'sky' | 'sunset' | 'forest' | 'amethyst' | 'ocean' | 'ember';
}

export interface OfficeProfile {
  /** Identificador estable del jugador (uuid persistido en localStorage). */
  id: string;
  name: string;
  avatarId: string;
}

interface WindowState {
  open: boolean;
  minimized: boolean;
  maximized: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Ranking local (fallback si no hay conexión). */
export interface BugHuntEntry {
  name: string;
  avatarId: string;
  timeMs: number;
  date: string;
  playedAt: string;
}

const STORAGE_PROFILE = 'virtualOffice.popup.profile';
const STORAGE_WINDOW = 'virtualOffice.popup.window';
const STORAGE_RANKING = 'virtualOffice.bugHunt.rankings';
const STORAGE_LAST_PLAYED = 'virtualOffice.bugHunt.lastPlayed';

const DEFAULT_WIDTH = 780;
const DEFAULT_HEIGHT = 560;
const MIN_WIDTH = 480;
const MIN_HEIGHT = 360;

// Mundo (coordenadas lógicas). Debe coincidir con el server (960x560).
const WORLD_WIDTH = 960;
const WORLD_HEIGHT = 560;
const WORLD_PADDING = 48;
const MOVE_STEP = 24;

const AVATARS: OfficeAvatar[] = [
  { id: 'pilot',      emoji: '🧑‍🚀', label: 'Piloto espacial',  tone: 'sky'      },
  { id: 'engineer',   emoji: '🧑‍💻', label: 'Ingeniera DevOps', tone: 'amethyst' },
  { id: 'botanist',   emoji: '🧑‍🔬', label: 'Botánica',          tone: 'forest'   },
  { id: 'captain',    emoji: '🧑‍✈️', label: 'Capitana',          tone: 'sunset'   },
  { id: 'navigator',  emoji: '🧭',   label: 'Navegante',         tone: 'ocean'    },
  { id: 'guardian',   emoji: '🛡️',   label: 'Guardián',          tone: 'ember'    },
  { id: 'robot',      emoji: '🤖',   label: 'Robot',             tone: 'amethyst' },
  { id: 'unicorn',    emoji: '🦄',   label: 'Unicornio',         tone: 'sunset'   },
  { id: 'fox',        emoji: '🦊',   label: 'Zorro',             tone: 'forest'   },
  { id: 'cat',        emoji: '🐱',   label: 'Gato',              tone: 'sky'      },
  { id: 'panda',      emoji: '🐼',   label: 'Panda',             tone: 'ocean'    },
  { id: 'wizard',     emoji: '🧙‍♂️', label: 'Hechicero',        tone: 'amethyst' },
  { id: 'artist',     emoji: '🎨',   label: 'Artista',           tone: 'sunset'   },
  { id: 'gamer',      emoji: '🎮',   label: 'Gamer',             tone: 'sky'      },
  { id: 'rocket',     emoji: '🚀',   label: 'Cohete',            tone: 'ocean'    },
  { id: 'dino',       emoji: '🦕',   label: 'Dino dev',          tone: 'forest'   },
];

type View = 'onboarding' | 'office' | 'profile' | 'ranking';

interface RankingRow {
  key: string;
  name: string;
  emoji: string;
  tone: string;
  timeMs: number;
  date: string;
}

@Component({
  selector: 'app-virtual-office-popup',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './virtual-office-popup.html',
  styleUrls: ['./virtual-office-popup.scss'],
})
export class VirtualOfficePopupComponent implements OnInit, OnDestroy {
  private readonly notify = inject(NotificationService);
  private readonly office = inject(VirtualOfficeService);
  private readonly windowBus = inject(OfficeWindowService);

  readonly avatars = AVATARS;

  /** Estado de la ventana (posición, tamaño, min/max/open). */
  readonly window = signal<WindowState>({
    open: true,
    minimized: false,
    maximized: false,
    x: 80,
    y: 80,
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
  });

  readonly profile = signal<OfficeProfile | null>(null);
  readonly view = signal<View>('onboarding');
  readonly userMenuOpen = signal(false);

  // -------- Onboarding / edición de perfil --------
  formName = '';
  readonly formAvatarId = signal(AVATARS[0].id);

  // -------- Multijugador --------
  readonly connectionState = signal<ConnectionState>('disconnected');
  readonly players = signal<PlayerPayload[]>([]);
  readonly myId = signal<string | null>(null);
  /** Posición local (autoritaria hasta que el server la confirma). */
  readonly myPosition = signal<{ x: number; y: number }>({
    x: WORLD_WIDTH / 2,
    y: WORLD_HEIGHT / 2,
  });
  readonly worldSize = signal<{ width: number; height: number }>({
    width: WORLD_WIDTH,
    height: WORLD_HEIGHT,
  });

  /** Otros jugadores (todos menos yo). */
  readonly otherPlayers = computed<PlayerPayload[]>(() => {
    const me = this.myId();
    return this.players().filter(p => p.id !== me);
  });

  // -------- Bug Hunt --------
  readonly bug = signal<{ x: number; y: number } | null>(null);
  readonly bugHuntStatus = signal<'idle' | 'running' | 'done'>('idle');
  readonly elapsedMs = signal(0);
  private bugTimer: any = null;
  private bugStartAt = 0;
  /** Ranking (mezcla server + local). */
  readonly ranking = signal<RankingRow[]>([]);
  readonly hasPlayedToday = signal(false);
  readonly rankingSource = signal<'server' | 'local'>('local');

  @ViewChild('officeScene') officeScene?: ElementRef<HTMLDivElement>;

  private eventsSub?: Subscription;
  private connSub?: Subscription;
  private positionSendTimer: any = null;
  private lastSentX = -1;
  private lastSentY = -1;

  /** Escucha peticiones externas para reabrir la oficina (p. ej. desde la Home). */
  private readonly openRequestEffect = effect(() => {
    const count = this.windowBus.openRequests();
    if (count > 0) {
      this.openWindow();
    }
  });

  // -------- Drag --------
  private dragState: {
    active: boolean;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null = null;

  readonly currentAvatar = computed<OfficeAvatar>(() => {
    const p = this.profile();
    return this.getAvatar(p?.avatarId) ?? AVATARS[0];
  });

  readonly previewAvatar = computed<OfficeAvatar>(
    () => this.getAvatar(this.formAvatarId()) ?? AVATARS[0],
  );

  ngOnInit(): void {
    this.loadWindowState();
    this.loadProfile();
    this.loadLocalRanking();
    this.refreshTodayFlag();
    this.ensureInViewport();

    this.subscribeToOffice();

    if (this.profile()) {
      // Conectar en cuanto haya perfil.
      this.connectToServer();
    }
  }

  ngOnDestroy(): void {
    this.stopBugTimer();
    document.removeEventListener('pointermove', this.onPointerMove);
    document.removeEventListener('pointerup', this.onPointerUp);
    this.eventsSub?.unsubscribe();
    this.connSub?.unsubscribe();
    this.office.disconnect();
  }

  // ============================================================
  // Ventana
  // ============================================================

  openWindow(): void {
    this.window.update(w => ({ ...w, open: true, minimized: false }));
    this.persistWindow();
  }

  closeWindow(): void {
    this.window.update(w => ({ ...w, open: false, minimized: false }));
    this.persistWindow();
    this.userMenuOpen.set(false);
  }

  toggleMinimize(): void {
    this.window.update(w => ({ ...w, minimized: !w.minimized }));
    this.persistWindow();
  }

  toggleMaximize(): void {
    this.window.update(w => ({ ...w, maximized: !w.maximized, minimized: false }));
    this.persistWindow();
  }

  onHeaderPointerDown(event: PointerEvent): void {
    const target = event.target as HTMLElement;
    if (target.closest('button, input, select, .no-drag')) return;

    const w = this.window();
    if (w.maximized) return;

    this.dragState = {
      active: true,
      startX: event.clientX,
      startY: event.clientY,
      originX: w.x,
      originY: w.y,
    };

    document.addEventListener('pointermove', this.onPointerMove);
    document.addEventListener('pointerup', this.onPointerUp);
    event.preventDefault();
  }

  private onPointerMove = (event: PointerEvent) => {
    if (!this.dragState?.active) return;
    const dx = event.clientX - this.dragState.startX;
    const dy = event.clientY - this.dragState.startY;
    const w = this.window();
    const nextX = this.clamp(this.dragState.originX + dx, 0, Math.max(0, window.innerWidth - 80));
    const nextY = this.clamp(this.dragState.originY + dy, 0, Math.max(0, window.innerHeight - 40));
    this.window.set({ ...w, x: nextX, y: nextY });
  };

  private onPointerUp = () => {
    if (!this.dragState?.active) return;
    this.dragState = null;
    document.removeEventListener('pointermove', this.onPointerMove);
    document.removeEventListener('pointerup', this.onPointerUp);
    this.persistWindow();
  };

  @HostListener('window:resize')
  onWindowResize(): void {
    this.ensureInViewport();
  }

  private ensureInViewport(): void {
    const w = this.window();
    const maxX = Math.max(0, window.innerWidth - 200);
    const maxY = Math.max(0, window.innerHeight - 80);
    if (w.x <= maxX && w.y <= maxY) return;
    this.window.set({
      ...w,
      x: Math.min(w.x, maxX),
      y: Math.min(w.y, maxY),
    });
    this.persistWindow();
  }

  // ============================================================
  // Menú de usuario
  // ============================================================

  toggleUserMenu(): void {
    this.userMenuOpen.update(v => !v);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.userMenuOpen()) return;
    const target = event.target as HTMLElement;
    if (target.closest('.user-menu, .user-menu-trigger')) return;
    this.userMenuOpen.set(false);
  }

  openProfileEditor(): void {
    const p = this.profile();
    this.formName = p?.name ?? '';
    this.formAvatarId.set(p?.avatarId ?? AVATARS[0].id);
    this.view.set('profile');
    this.userMenuOpen.set(false);
  }

  openOffice(): void {
    this.view.set('office');
    this.userMenuOpen.set(false);
  }

  openRanking(): void {
    this.refreshTodayFlag();
    this.view.set('ranking');
    this.userMenuOpen.set(false);
  }

  // ============================================================
  // Perfil
  // ============================================================

  selectFormAvatar(id: string): void {
    this.formAvatarId.set(id);
  }

  canSaveProfile(): boolean {
    return this.formName.trim().length >= 2 && !!this.getAvatar(this.formAvatarId());
  }

  saveProfile(): void {
    const name = this.formName.trim();
    if (!this.canSaveProfile()) {
      this.notify.warning('Escribe un nombre (mínimo 2 caracteres) y selecciona un avatar.');
      return;
    }
    const wasFirstTime = !this.profile();
    const previousId = this.profile()?.id;
    const profile: OfficeProfile = {
      id: previousId || this.generateStableId(),
      name,
      avatarId: this.formAvatarId(),
    };
    this.profile.set(profile);
    this.persistProfile();
    this.view.set('office');
    this.notify.success('Perfil guardado.');

    if (wasFirstTime) {
      this.connectToServer();
    } else {
      // Reenvía hello con los nuevos datos si ya estábamos conectados.
      this.sendHelloIfConnected();
    }
  }

  cancelProfile(): void {
    if (this.profile()) {
      this.view.set('office');
    }
  }

  private loadProfile(): void {
    try {
      const raw = localStorage.getItem(STORAGE_PROFILE);
      if (!raw) {
        this.view.set('onboarding');
        return;
      }
      const parsed = JSON.parse(raw) as Partial<OfficeProfile>;
      if (!parsed?.name || !parsed.avatarId || !this.getAvatar(parsed.avatarId)) {
        this.view.set('onboarding');
        return;
      }
      // Migración: si el perfil guardado no tiene id, generáselo y persiste.
      const profile: OfficeProfile = {
        id: parsed.id || this.generateStableId(),
        name: parsed.name,
        avatarId: parsed.avatarId,
      };
      this.profile.set(profile);
      if (!parsed.id) {
        this.persistProfile();
      }
      this.formName = profile.name;
      this.formAvatarId.set(profile.avatarId);
      this.view.set('office');
    } catch {
      this.view.set('onboarding');
    }
  }

  private generateStableId(): string {
    try {
      if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
      }
    } catch { /* ignore */ }
    // Fallback: timestamp + random hex.
    return `pid-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  private persistProfile(): void {
    const p = this.profile();
    if (!p) return;
    try {
      localStorage.setItem(STORAGE_PROFILE, JSON.stringify(p));
    } catch { /* ignore */ }
  }

  // ============================================================
  // Conexión al servidor
  // ============================================================

  private subscribeToOffice(): void {
    this.connSub = this.office.connectionState$.subscribe(state => {
      this.connectionState.set(state);
    });

    this.eventsSub = this.office.events$.subscribe(event => {
      switch (event.type) {
        case 'welcome': {
          this.myId.set(event.id);
          this.players.set(event.players ?? []);
          this.worldSize.set(event.space ?? { width: WORLD_WIDTH, height: WORLD_HEIGHT });
          if (event.bugHuntRanking && event.bugHuntRanking.length) {
            this.applyServerRanking(event.bugHuntRanking);
          }
          // Empuja mi hello con la posición inicial.
          this.sendHelloIfConnected();
          break;
        }
        case 'player-joined':
        case 'player-updated': {
          this.upsertPlayer(event.player);
          if (event.type === 'player-joined' && event.player.id !== this.myId()) {
            this.notify.info(`${event.player.name} se ha unido a la oficina.`);
          }
          break;
        }
        case 'player-left': {
          this.players.update(list => list.filter(p => p.id !== event.id));
          break;
        }
        case 'bug-hunt-ranking': {
          this.applyServerRanking(event.entries);
          break;
        }
        case 'error': {
          this.notify.warning(event.message);
          break;
        }
        case 'disconnected': {
          this.notify.warning('Se perdió la conexión con la oficina virtual.');
          break;
        }
      }
    });
  }

  private connectToServer(): void {
    const url = getVirtualOfficeUrl();
    this.office
      .connect(url)
      .then(() => {
        this.sendHelloIfConnected();
      })
      .catch(() => {
        this.notify.warning('No se pudo conectar con la oficina virtual. Modo local activo.');
      });
  }

  private sendHelloIfConnected(): void {
    if (this.connectionState() !== 'connected') return;
    const profile = this.profile();
    if (!profile) return;
    const avatar = this.currentAvatar();
    const pos = this.myPosition();
    this.office.sendHello({
      playerId: profile.id,
      name: profile.name,
      avatar: {
        id: avatar.id,
        emoji: avatar.emoji,
        label: avatar.label,
        tone: avatar.tone,
      },
      position: { x: pos.x, y: pos.y, direction: 'down' },
    });
    this.lastSentX = pos.x;
    this.lastSentY = pos.y;
  }

  private upsertPlayer(player: PlayerPayload): void {
    this.players.update(list => {
      const idx = list.findIndex(p => p.id === player.id);
      if (idx === -1) return [...list, player];
      const next = [...list];
      next[idx] = player;
      return next;
    });
    if (player.id === this.myId()) {
      // El servidor puede ajustar (sanitize) la posición.
      this.myPosition.set({ x: player.x, y: player.y });
    }
  }

  // ============================================================
  // Movimiento del avatar (WASD / flechas)
  // ============================================================

  @HostListener('document:keydown', ['$event'])
  onKeyDown(event: KeyboardEvent): void {
    if (this.view() !== 'office' || !this.window().open || this.window().minimized) return;
    // Ignora si el foco está en un input/textarea.
    const t = event.target as HTMLElement;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;

    let dx = 0;
    let dy = 0;
    switch (event.key) {
      case 'ArrowUp':
      case 'w':
      case 'W':
        dy = -MOVE_STEP; break;
      case 'ArrowDown':
      case 's':
      case 'S':
        dy = MOVE_STEP; break;
      case 'ArrowLeft':
      case 'a':
      case 'A':
        dx = -MOVE_STEP; break;
      case 'ArrowRight':
      case 'd':
      case 'D':
        dx = MOVE_STEP; break;
      default: return;
    }
    event.preventDefault();

    const size = this.worldSize();
    const pos = this.myPosition();
    const next = {
      x: this.clamp(pos.x + dx, WORLD_PADDING, size.width - WORLD_PADDING),
      y: this.clamp(pos.y + dy, WORLD_PADDING, size.height - WORLD_PADDING),
    };
    this.myPosition.set(next);
    this.queuePositionSend(next.x, next.y);
  }

  private queuePositionSend(x: number, y: number): void {
    if (this.connectionState() !== 'connected') return;
    if (Math.round(x) === Math.round(this.lastSentX) &&
        Math.round(y) === Math.round(this.lastSentY)) return;

    // Throttle 80 ms.
    if (this.positionSendTimer) return;
    this.positionSendTimer = setTimeout(() => {
      this.positionSendTimer = null;
      const p = this.myPosition();
      this.office.sendPosition({ x: p.x, y: p.y, direction: 'down' });
      this.lastSentX = p.x;
      this.lastSentY = p.y;
    }, 80);
  }

  // ============================================================
  // Bug Hunt
  // ============================================================

  startBugHunt(): void {
    // Ya no hay límite "una vez por día": puedes intentar mejorar tu marca.
    const rect = this.officeScene?.nativeElement.getBoundingClientRect();
    const w = rect?.width ?? 520;
    const h = rect?.height ?? 300;
    const padding = 32;
    const x = this.clamp(Math.random() * w, padding, w - padding);
    const y = this.clamp(Math.random() * h, padding, h - padding);
    this.bug.set({ x, y });

    this.elapsedMs.set(0);
    this.bugStartAt = performance.now();
    this.bugHuntStatus.set('running');

    this.stopBugTimer();
    this.bugTimer = setInterval(() => {
      this.elapsedMs.set(Math.round(performance.now() - this.bugStartAt));
    }, 53);
  }

  onBugClick(event: MouseEvent): void {
    event.stopPropagation();
    if (this.bugHuntStatus() !== 'running') return;
    const elapsed = Math.round(performance.now() - this.bugStartAt);
    this.stopBugTimer();
    this.elapsedMs.set(elapsed);
    this.bugHuntStatus.set('done');
    this.bug.set(null);
    this.registerBugRun(elapsed);
  }

  cancelBugHunt(): void {
    this.stopBugTimer();
    this.bug.set(null);
    this.bugHuntStatus.set('idle');
    this.elapsedMs.set(0);
  }

  private registerBugRun(timeMs: number): void {
    const profile = this.profile();
    if (!profile) return;
    const today = this.todayIso();

    // Marca informativa "jugué hoy" (útil para UI pero ya no bloquea).
    try {
      localStorage.setItem(STORAGE_LAST_PLAYED, today);
    } catch { /* ignore */ }
    this.hasPlayedToday.set(true);

    // Ranking local fallback — también dedupe por id + nos quedamos con el mejor.
    const localEntry: BugHuntEntry = {
      name: profile.name,
      avatarId: profile.avatarId,
      timeMs,
      date: today,
      playedAt: new Date().toISOString(),
    };
    this.appendLocalRanking(localEntry);

    // Envía al servidor si conectado; si no, queda solo en local.
    if (this.connectionState() === 'connected') {
      this.office.sendBugHuntResult(timeMs);
      this.notify.success(`¡Bug cazado en ${this.formatTime(timeMs)}! Enviado al ranking global.`);
    } else {
      this.notify.success(`¡Bug cazado en ${this.formatTime(timeMs)}! (Guardado local)`);
    }
  }

  private stopBugTimer(): void {
    if (this.bugTimer) {
      clearInterval(this.bugTimer);
      this.bugTimer = null;
    }
  }

  // ---- Ranking ----

  private applyServerRanking(entries: BugHuntRankingEntry[]): void {
    const rows: RankingRow[] = entries.map(e => ({
      key: e.id,
      name: e.name,
      emoji: e.avatarEmoji || this.getAvatar(e.avatarId)?.emoji || '🙂',
      tone: this.normalizeTone(e.avatarTone || this.getAvatar(e.avatarId)?.tone),
      timeMs: e.timeMs,
      date: e.date,
    }));
    this.ranking.set(rows.sort((a, b) => a.timeMs - b.timeMs).slice(0, 50));
    this.rankingSource.set('server');
  }

  private loadLocalRanking(): void {
    try {
      const raw = localStorage.getItem(STORAGE_RANKING);
      if (!raw) return;
      const parsed = JSON.parse(raw) as BugHuntEntry[];
      if (!Array.isArray(parsed)) return;
      const rows = this.mapLocalToRows(parsed);
      // Sólo aplica si no hay ya un ranking del server.
      if (this.rankingSource() === 'local') {
        this.ranking.set(rows);
      }
    } catch { /* ignore */ }
  }

  private appendLocalRanking(entry: BugHuntEntry): void {
    try {
      const raw = localStorage.getItem(STORAGE_RANKING);
      const list: BugHuntEntry[] = raw ? JSON.parse(raw) : [];
      // Dedupe por (name+avatarId) quedándonos con el mejor tiempo.
      const key = (e: BugHuntEntry) => `${(e.name || '').toLowerCase()}::${e.avatarId || ''}`;
      const bestByKey = new Map<string, BugHuntEntry>();
      for (const e of [...list, entry]) {
        const k = key(e);
        const prev = bestByKey.get(k);
        if (!prev || e.timeMs < prev.timeMs) {
          bestByKey.set(k, e);
        }
      }
      const next = Array.from(bestByKey.values())
        .sort((a, b) => a.timeMs - b.timeMs)
        .slice(0, 50);
      localStorage.setItem(STORAGE_RANKING, JSON.stringify(next));
      // Si el ranking mostrado es local, refrescarlo.
      if (this.rankingSource() === 'local') {
        this.ranking.set(this.mapLocalToRows(next));
      }
    } catch { /* ignore */ }
  }

  private mapLocalToRows(list: BugHuntEntry[]): RankingRow[] {
    return list
      .sort((a, b) => a.timeMs - b.timeMs)
      .map((e, i) => ({
        key: `local-${i}-${e.playedAt}`,
        name: e.name,
        emoji: this.getAvatar(e.avatarId)?.emoji || '🙂',
        tone: this.getAvatar(e.avatarId)?.tone || 'sky',
        timeMs: e.timeMs,
        date: e.date,
      }));
  }

  private normalizeTone(tone: string | undefined): string {
    const valid = new Set(['sky', 'sunset', 'forest', 'amethyst', 'ocean', 'ember']);
    return tone && valid.has(tone) ? tone : 'sky';
  }

  private refreshTodayFlag(): void {
    try {
      const last = localStorage.getItem(STORAGE_LAST_PLAYED);
      this.hasPlayedToday.set(last === this.todayIso());
    } catch {
      this.hasPlayedToday.set(false);
    }
  }

  // ============================================================
  // Helpers
  // ============================================================

  getAvatar(id: string | undefined | null): OfficeAvatar | undefined {
    if (!id) return undefined;
    return AVATARS.find(a => a.id === id);
  }

  formatTime(ms: number): string {
    const seconds = ms / 1000;
    return `${seconds.toFixed(2)}s`;
  }

  /** % horizontal en la escena para una x en coordenadas de mundo. */
  worldToPctX(x: number): number {
    return (x / this.worldSize().width) * 100;
  }

  /** % vertical en la escena para una y en coordenadas de mundo. */
  worldToPctY(y: number): number {
    return (y / this.worldSize().height) * 100;
  }

  trackAvatar = (_: number, item: OfficeAvatar) => item.id;
  trackEntry = (_: number, item: RankingRow) => item.key;
  trackPlayer = (_: number, item: PlayerPayload) => item.id;

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }

  private todayIso(): string {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  private loadWindowState(): void {
    try {
      const raw = localStorage.getItem(STORAGE_WINDOW);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<WindowState>;
      this.window.update(w => ({ ...w, ...parsed }));
    } catch { /* ignore */ }
  }

  private persistWindow(): void {
    try {
      localStorage.setItem(STORAGE_WINDOW, JSON.stringify(this.window()));
    } catch { /* ignore */ }
  }
}
