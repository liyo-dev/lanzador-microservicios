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
  untracked,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { NotificationService } from '../../services/notification.service';
import { OfficeWindowService } from '../../services/office-window.service';
import {
  BugHuntRankingEntry,
  ConnectionState,
  DinoGameState,
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

const STORAGE_PROFILE = 'virtualOffice.popup.profile';
const STORAGE_WINDOW = 'virtualOffice.popup.window';

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
  /** Ranking global (viene siempre del servidor). */
  readonly ranking = signal<RankingRow[]>([]);
  /** True si el jugador ya tiene una entrada del día de hoy en el ranking del servidor. */
  readonly hasPlayedToday = signal(false);

  // -------- Pizarra colaborativa de píxeles --------
  readonly pixelBoardWidth = signal(24);
  readonly pixelBoardHeight = signal(12);
  /** Estado del lienzo: `{ "x,y": "#rrggbb" }`. */
  readonly pixelBoardPixels = signal<Record<string, string>>({});
  readonly pixelPalette: readonly string[] = [
    '#000000', '#ffffff', '#ef4444', '#f97316',
    '#f59e0b', '#22c55e', '#06b6d4', '#3b82f6',
    '#8b5cf6', '#ec4899', '#78350f', '#94a3b8',
  ];
  readonly pixelSelectedColor = signal<string>(this.pixelPalette[2]);
  readonly pixelEraserMode = signal(false);
  readonly pixelRows = computed(() => {
    const w = this.pixelBoardWidth();
    const h = this.pixelBoardHeight();
    const rows: { y: number; cols: number[] }[] = [];
    for (let y = 0; y < h; y++) {
      const cols: number[] = [];
      for (let x = 0; x < w; x++) cols.push(x);
      rows.push({ y, cols });
    }
    return rows;
  });

  // -------- Mini-juego "Caza al Dinosaurio" --------
  /** Estado autoritativo del juego (viene del servidor). */
  readonly dinoGame = signal<DinoGameState | null>(null);
  /** Segundos restantes en el lobby (calculados localmente a partir de `endsAt`). */
  readonly dinoLobbySeconds = signal(0);
  /** Segundos restantes para la siguiente ronda (fase `inter-round`). */
  readonly dinoInterRoundSeconds = signal(0);
  /** Nº de rondas seleccionado al crear la partida (impar entre 1 y 9). */
  readonly dinoRoundsChoice = signal(3);
  private dinoTickTimer: any = null;

  /** True si el juego está en fase lobby. */
  readonly dinoLobbyActive = computed(() => this.dinoGame()?.phase === 'lobby');
  /** True si estamos en la fase de captura con dino visible. */
  readonly dinoRoundActive = computed(() => this.dinoGame()?.phase === 'round');
  /** True si hay pausa entre rondas (mostrando resultado de la anterior). */
  readonly dinoInterRoundActive = computed(() => this.dinoGame()?.phase === 'inter-round');
  /** True si la serie terminó y aún se muestra el resultado global. */
  readonly dinoRoundDone = computed(() => this.dinoGame()?.phase === 'done');
  /** True si el usuario local se unió a la partida (participante). */
  readonly dinoIsParticipant = computed(() => {
    const g = this.dinoGame();
    const me = this.myId();
    return !!(g && me && g.participantIds.includes(me));
  });
  /** True si el usuario local es el creador (subset de participante). */
  readonly dinoIsCreator = computed(() => {
    const g = this.dinoGame();
    const me = this.myId();
    return !!(g && me && g.creatorId === me);
  });
  /** True si hay una ronda activa pero no soy participante (modo espectador). */
  readonly dinoIsSpectator = computed(
    () => this.dinoRoundActive() && !this.dinoIsParticipant(),
  );
  /** ID del creador si hay lobby abierto y no soy yo (para mostrar el tooltip
   *  encima de su avatar remoto). */
  readonly dinoLobbyCreatorRemoteId = computed<string | null>(() => {
    const g = this.dinoGame();
    if (!g || g.phase !== 'lobby') return null;
    if (g.creatorId === this.myId()) return null;
    return g.creatorId;
  });

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
      // ⚠️ Muy importante: envolver en untracked() para que este effect
      // sólo se suscriba a `openRequests`. Sin esto, `openWindow()` lee la
      // señal `window` vía `persistWindow()`, el effect empieza a rastrearla
      // y cualquier cambio posterior (cerrar / minimizar / mover) reejecuta
      // el effect, que vuelve a llamar a `openWindow()` y "deshace" la
      // acción del usuario (los botones parecen no funcionar).
      untracked(() => this.openWindow());
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
    this.ensureInViewport();

    this.subscribeToOffice();

    if (this.profile()) {
      // Conectar en cuanto haya perfil.
      this.connectToServer();
    }
  }

  ngOnDestroy(): void {
    this.stopBugTimer();
    this.stopDinoTick();
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
    this.view.set('ranking');
    this.userMenuOpen.set(false);
  }

  retryConnection(): void {
    if (this.connectionState() === 'connecting' || this.connectionState() === 'connected') {
      return;
    }

    if (!this.profile()) {
      this.view.set('onboarding');
      this.notify.warning('Configura tu perfil antes de conectarte a la oficina virtual.');
      return;
    }

    this.connectToServer();
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
          if (event.pixelBoard) {
            this.pixelBoardWidth.set(event.pixelBoard.width);
            this.pixelBoardHeight.set(event.pixelBoard.height);
            this.pixelBoardPixels.set({ ...(event.pixelBoard.pixels || {}) });
          }
          if (event.dinoGame) {
            this.applyDinoGame(event.dinoGame);
          } else {
            this.applyDinoGame(null);
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
        case 'pixel-board-paint': {
          const key = `${event.x},${event.y}`;
          this.pixelBoardPixels.update(m => {
            const next = { ...m };
            if (event.color) next[key] = event.color;
            else delete next[key];
            return next;
          });
          break;
        }
        case 'dino-lobby-open': {
          this.applyDinoGame(event.game);
          const g = event.game;
          if (g.creatorId !== this.myId()) {
            this.notify.info(`🦕 ${g.creatorName} ha creado una partida. ¡Únete!`);
          }
          break;
        }
        case 'dino-lobby-update': {
          this.applyDinoGame(event.game);
          break;
        }
        case 'dino-round-start': {
          const prevRound = this.dinoGame()?.currentRound ?? 0;
          this.applyDinoGame(event.game);
          const g = event.game;
          const isNewRound = g.currentRound > prevRound;
          const label = `Ronda ${g.currentRound}/${g.totalRounds}`;
          if (this.dinoIsParticipant()) {
            this.notify.info(
              isNewRound && g.currentRound === 1
                ? `🦕 ¡Empieza la partida! ${label}. Atrapa al dinosaurio.`
                : `🎯 ${label}. ¡Atrápalo!`,
            );
          } else {
            this.notify.info(`👀 ${label} (modo espectador).`);
          }
          break;
        }
        case 'dino-round-end': {
          this.applyDinoGame(event.game);
          const g = event.game;
          const time = g.lastRoundTimeMs ? `${((g.lastRoundTimeMs || 0) / 1000).toFixed(2)}s` : '';
          if (g.phase === 'done') {
            const overall = g.overallWinnerName || '—';
            if (g.overallWinnerId === this.myId()) {
              this.notify.success(`🏆 ¡Has ganado la partida! (${overall})`);
            } else {
              this.notify.info(`🏆 Fin de la partida. Ganador global: ${overall}.`);
            }
          } else {
            // inter-round: se muestra ganador de la ronda actual
            const label = `Ronda ${g.currentRound}/${g.totalRounds}`;
            if (g.lastRoundWinnerId === this.myId()) {
              this.notify.success(`✅ Ganaste la ${label} en ${time}.`);
            } else if (g.lastRoundWinnerName) {
              this.notify.info(`🎯 ${label}: ${g.lastRoundWinnerName} atrapó al dino (${time}).`);
            }
          }
          break;
        }
        case 'dino-cancelled': {
          this.applyDinoGame(null);
          this.notify.warning(event.reason || 'La partida se ha cancelado.');
          break;
        }
        case 'dino-cleared': {
          this.applyDinoGame(null);
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
      .catch(() => {
        this.notify.warning('No se pudo conectar con la oficina virtual. Modo local activo.');
      });
    // El hello se envía al recibir el evento `welcome` del servidor.
    // Si lo enviamos también aquí generamos un doble join que dispara la
    // notificación "X se ha unido a la oficina" dos veces en el resto de clientes.
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
  // Mini-juego "Caza al Dinosaurio"
  // ============================================================

  /** Aplica el estado del servidor al signal local y sincroniza el temporizador. */
  private applyDinoGame(game: DinoGameState | null): void {
    this.dinoGame.set(game);
    this.refreshDinoCountdown();
    if (game && (game.phase === 'lobby' || game.phase === 'inter-round')) {
      this.startDinoTick();
    } else {
      this.stopDinoTick();
    }
  }

  private refreshDinoCountdown(): void {
    const g = this.dinoGame();
    if (!g) {
      this.dinoLobbySeconds.set(0);
      this.dinoInterRoundSeconds.set(0);
      return;
    }
    if (g.phase === 'lobby' && g.endsAt) {
      const remainingMs = Math.max(0, g.endsAt - Date.now());
      this.dinoLobbySeconds.set(Math.ceil(remainingMs / 1000));
      this.dinoInterRoundSeconds.set(0);
    } else if (g.phase === 'inter-round' && g.nextRoundStartsAt) {
      const remainingMs = Math.max(0, g.nextRoundStartsAt - Date.now());
      this.dinoInterRoundSeconds.set(Math.ceil(remainingMs / 1000));
      this.dinoLobbySeconds.set(0);
    } else {
      this.dinoLobbySeconds.set(0);
      this.dinoInterRoundSeconds.set(0);
    }
  }

  private startDinoTick(): void {
    if (this.dinoTickTimer) return;
    this.dinoTickTimer = setInterval(() => this.refreshDinoCountdown(), 250);
  }

  private stopDinoTick(): void {
    if (this.dinoTickTimer) {
      clearInterval(this.dinoTickTimer);
      this.dinoTickTimer = null;
    }
  }

  /** Establece el número de rondas para la próxima partida a crear. */
  setDinoRoundsChoice(value: number): void {
    const n = Math.max(1, Math.min(9, Math.round(value)));
    // Preferimos rondas impares para evitar empates en best-of.
    this.dinoRoundsChoice.set(n % 2 === 0 ? Math.min(9, n + 1) : n);
  }

  createDinoGame(): void {
    if (this.connectionState() !== 'connected') {
      this.notify.warning('Necesitas estar conectado para crear una partida.');
      return;
    }
    if (this.dinoGame()) {
      this.notify.info('Ya hay una partida activa.');
      return;
    }
    this.office.sendDinoCreate(this.dinoRoundsChoice());
  }

  joinDinoGame(): void {
    const g = this.dinoGame();
    if (!g || g.phase !== 'lobby') return;
    if (this.dinoIsParticipant()) return;
    this.office.sendDinoJoin(g.id);
  }

  startDinoNow(): void {
    const g = this.dinoGame();
    if (!g || g.phase !== 'lobby') return;
    if (!this.dinoIsCreator()) return;
    this.office.sendDinoStart(g.id);
  }

  cancelDinoGame(): void {
    const g = this.dinoGame();
    if (!g) return;
    if (!this.dinoIsCreator()) return;
    this.office.sendDinoCancel(g.id);
  }

  onDinoClick(event: MouseEvent): void {
    event.stopPropagation();
    const g = this.dinoGame();
    if (!g || g.phase !== 'round') return;
    // Guardia adicional: los espectadores no deberían poder disparar el
    // click, pero por seguridad reforzamos aquí antes de enviar al servidor.
    if (!this.dinoIsParticipant()) return;
    this.office.sendDinoCatch(g.id);
  }

  formatDinoLobbyLabel(): string {
    const s = this.dinoLobbySeconds();
    return s > 0 ? `${s}s` : '¡ya!';
  }

  formatDinoInterRoundLabel(): string {
    const s = this.dinoInterRoundSeconds();
    return s > 0 ? `${s}s` : '¡ya!';
  }

  /** Track function para el marcador. */
  trackDinoScore = (_: number, item: { id: string }) => item.id;

  // ============================================================
  // Bug Hunt
  // ============================================================

  startBugHunt(): void {
    if (this.connectionState() !== 'connected') {
      this.notify.warning('Necesitas estar conectado a la oficina para participar en el ranking.');
      return;
    }
    if (this.hasPlayedToday()) {
      this.notify.info('Ya has jugado hoy. Vuelve mañana para intentar batir tu marca.');
      return;
    }
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

    if (this.connectionState() !== 'connected') {
      this.notify.warning('Sin conexión con la oficina: tu marca no se ha podido registrar.');
      return;
    }

    // El ranking es 100% global: enviamos al servidor. El servidor bloqueará
    // el registro si ya jugaste hoy y difundirá el ranking actualizado a todos.
    this.office.sendBugHuntResult(timeMs);
    this.hasPlayedToday.set(true);
    this.notify.success(`¡Bug cazado en ${this.formatTime(timeMs)}! Enviado al ranking global.`);
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

    // Actualiza el flag "ya jugué hoy" en función del ranking global del servidor.
    const myStableId = this.profile()?.id;
    const today = this.todayIso();
    const mine = myStableId
      ? entries.find(e => e.stableId === myStableId)
      : undefined;
    this.hasPlayedToday.set(!!(mine && mine.date === today));
  }

  private normalizeTone(tone: string | undefined): string {
    const valid = new Set(['sky', 'sunset', 'forest', 'amethyst', 'ocean', 'ember']);
    return tone && valid.has(tone) ? tone : 'sky';
  }

  // ============================================================
  // Pizarra colaborativa de píxeles
  // ============================================================

  pixelColorAt(x: number, y: number): string | null {
    return this.pixelBoardPixels()[`${x},${y}`] ?? null;
  }

  pickPixelColor(color: string): void {
    this.pixelSelectedColor.set(color);
    this.pixelEraserMode.set(false);
  }

  toggleEraser(): void {
    this.pixelEraserMode.update(v => !v);
  }

  paintPixel(x: number, y: number): void {
    if (this.connectionState() !== 'connected') {
      this.notify.warning('Necesitas conexión al servidor para pintar en la pizarra.');
      return;
    }
    const color = this.pixelEraserMode() ? null : this.pixelSelectedColor();
    const key = `${x},${y}`;
    // Optimistic update local.
    this.pixelBoardPixels.update(m => {
      const next = { ...m };
      if (color) next[key] = color;
      else delete next[key];
      return next;
    });
    this.office.sendPixelPaint(x, y, color);
  }

  trackPixelRow = (_: number, item: { y: number }) => item.y;
  trackPixelCol = (_: number, item: number) => item;

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
