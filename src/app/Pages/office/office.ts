import {
  AfterViewInit,
  ChangeDetectorRef,
  Component,
  HostListener,
  OnDestroy,
  OnInit,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import {
  AvatarDescriptor,
  ConnectionState,
  GeneralMessagePayload,
  PlayerDirection,
  PlayerPayload,
  PrivateMessagePayload,
  SpaceDescriptor,
  VirtualOfficeService,
} from './virtual-office.service';
import { getVirtualOfficeUrl } from '../../config/virtual-office.config';

export type AvatarTone = 'sky' | 'sunset' | 'forest' | 'amethyst' | 'ocean' | 'ember';

export interface AvatarOption extends AvatarDescriptor {
  label: string;
  tone: AvatarTone;
}

interface SpeechBubble {
  content: string;
  kind: 'private' | 'broadcast';
  authorId: string;
}

type RpsMove = 'rock' | 'paper' | 'scissors';
type RpsOutcome = 'win' | 'lose' | 'draw';

interface MiniGameRound {
  round: number;
  playerMove: RpsMove;
  opponentMove: RpsMove;
  outcome: RpsOutcome;
}

interface MiniGameState {
  status: 'idle' | 'playing' | 'won' | 'lost';
  round: number;
  playerScore: number;
  opponentScore: number;
  history: MiniGameRound[];
}

interface PlayerState extends PlayerPayload {
  avatar: AvatarOption;
  isSelf: boolean;
}

const DEFAULT_SPACE: SpaceDescriptor = { width: 960, height: 560 };
const STORAGE_KEY_NAME = 'virtualOffice.displayName';
const STORAGE_KEY_AVATAR = 'virtualOffice.avatar';
const NEARBY_DISTANCE = 140;
const MOVEMENT_STEP = 32;
const EDGE_PADDING = 48;

@Component({
  selector: 'app-office',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './office.html',
  styleUrls: ['./office.scss'],
})
export class OfficeComponent implements OnInit, AfterViewInit, OnDestroy {
  readonly avatars: AvatarOption[] = [
    { id: 'pilot', label: 'Piloto espacial', emoji: '🧑‍🚀', tone: 'sky' },
    { id: 'engineer', label: 'Ingeniera DevOps', emoji: '🧑‍💻', tone: 'amethyst' },
    { id: 'botanist', label: 'Botánica de terraformación', emoji: '🧑‍🔬', tone: 'forest' },
    { id: 'captain', label: 'Capitana de la flota', emoji: '🧑‍✈️', tone: 'sunset' },
    { id: 'navigator', label: 'Navegante galáctico', emoji: '🧭', tone: 'ocean' },
    { id: 'guardian', label: 'Guardián de seguridad', emoji: '🛡️', tone: 'ember' },
    { id: 'robot', label: 'Compañero robótico', emoji: '🤖', tone: 'amethyst' },
    { id: 'unicorn', label: 'Unicornio entusiasta', emoji: '🦄', tone: 'sunset' },
    { id: 'fox', label: 'Zorro ágil', emoji: '🦊', tone: 'forest' },
    { id: 'cat', label: 'Gato curioso', emoji: '🐱', tone: 'sky' },
    { id: 'panda', label: 'Panda tranquilo', emoji: '🐼', tone: 'ocean' },
    { id: 'ember-spirit', label: 'Espíritu ardiente', emoji: '🔥', tone: 'ember' },
    { id: 'wizard', label: 'Hechicero digital', emoji: '🧙‍♂️', tone: 'amethyst' },
    { id: 'artist', label: 'Artista cósmico', emoji: '🎨', tone: 'sunset' },
    { id: 'gamer', label: 'Gamer intergaláctico', emoji: '🎮', tone: 'sky' },
    { id: 'rocket', label: 'Tripulación rocket', emoji: '🚀', tone: 'ocean' },
    { id: 'dino', label: 'Dino dev', emoji: '🦕', tone: 'forest' },
    { id: 'lightbulb', label: 'Idea brillante', emoji: '💡', tone: 'sky' },
  ];

  displayName = '';
  chatInput = '';
  broadcastInput = '';

  readonly serverUrl = getVirtualOfficeUrl();

  selectedAvatar: AvatarOption = this.avatars[0];
  readonly systemAvatar: AvatarOption = {
    id: 'system',
    label: 'Sistema',
    emoji: '✨',
    tone: 'amethyst',
  };

  connectionState: ConnectionState = 'disconnected';
  connectionError = '';
  readonly connectionLabels: Record<ConnectionState, string> = {
    disconnected: 'Desconectado',
    connecting: 'Conectando…',
    connected: 'Conectado',
    error: 'Error',
  };

  players: PlayerState[] = [];
  speechBubbles: Record<string, SpeechBubble | undefined> = {};
  nearbyPlayerIds = new Set<string>();
  closestNearbyPlayerId: string | null = null;
  interactionTargetId: string | null = null;
  interactionView: 'menu' | 'chat' | 'broadcast' | 'game' | null = null;

  space: SpaceDescriptor = DEFAULT_SPACE;

  readonly miniGameMoves: Array<{ id: RpsMove; label: string; emoji: string }> = [
    { id: 'rock', label: 'Piedra', emoji: '🪨' },
    { id: 'paper', label: 'Papel', emoji: '📄' },
    { id: 'scissors', label: 'Tijeras', emoji: '✂️' },
  ];
  miniGameState: MiniGameState = this.createMiniGameState('idle');

  selfId: string | null = null;
  private subscriptions: Subscription[] = [];
  private lastMovementSentAt = 0;

  constructor(
    private readonly officeService: VirtualOfficeService,
    private readonly cdr: ChangeDetectorRef,
    private readonly router: Router,
  ) {}

  ngOnInit(): void {
    this.restorePreferences();

    this.subscriptions.push(
      this.officeService.connectionState$.subscribe((state) => {
        this.connectionState = state;
        if (state !== 'error') {
          this.connectionError = '';
        }
        this.cdr.markForCheck();
      }),
    );

    this.subscriptions.push(
      this.officeService.events$.subscribe((event) => {
        switch (event.type) {
          case 'welcome':
            this.handleWelcome(event);
            break;
          case 'player-joined':
            this.upsertPlayer(event.player);
            break;
          case 'player-updated':
            this.upsertPlayer(event.player);
            break;
          case 'player-left':
            this.removePlayer(event.id);
            break;
          case 'general-message':
            this.addGeneralMessage(event.message);
            break;
          case 'private-message':
            this.addPrivateMessage(event.message);
            break;
          case 'error':
            this.connectionError = event.message;
            break;
          case 'disconnected':
            this.handleDisconnected();
            break;
        }
        this.cdr.markForCheck();
      }),
    );
  }

  ngAfterViewInit(): void {
    this.focusWorkspace();
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach((subscription) => subscription.unsubscribe());
    this.officeService.disconnect();
  }

  get previewName(): string {
    return this.displayName.trim() || 'Invitado';
  }

  get isConnected(): boolean {
    return this.connectionState === 'connected';
  }

  get connectionLabel(): string {
    return this.connectionLabels[this.connectionState];
  }

  get miniGameLastRound(): MiniGameRound | null {
    const { history } = this.miniGameState;
    return history.length ? history[history.length - 1] : null;
  }

  formatRpsMove(move: RpsMove): string {
    return this.miniGameMoves.find((item) => item.id === move)?.label ?? move;
  }

  formatRpsOutcome(outcome: RpsOutcome): string {
    switch (outcome) {
      case 'win':
        return 'Ganaste la ronda';
      case 'lose':
        return 'Perdiste la ronda';
      default:
        return 'Empate';
    }
  }

  get interactionTarget(): PlayerState | null {
    if (!this.interactionTargetId) {
      return null;
    }
    return this.players.find((player) => player.id === this.interactionTargetId) ?? null;
  }

  get nearbyPlayers(): PlayerState[] {
    const self = this.players.find((player) => player.id === this.selfId);
    if (!self) {
      return [];
    }

    const result: Array<{ player: PlayerState; distance: number }> = [];
    this.players.forEach((player) => {
      if (player.id === self.id) {
        return;
      }
      if (!this.nearbyPlayerIds.has(player.id)) {
        return;
      }
      const distance = this.distanceBetween(self, player);
      result.push({ player, distance });
    });

    return result
      .sort((a, b) => a.distance - b.distance)
      .map((entry) => entry.player);
  }

  selectAvatar(avatar: AvatarOption): void {
    this.selectedAvatar = avatar;
    localStorage.setItem(STORAGE_KEY_AVATAR, avatar.id);
  }

  async joinOffice(): Promise<void> {
    try {
      await this.officeService.connect(this.serverUrl);
      this.persistPreferences();
      this.sendHello();
      this.focusWorkspace();
    } catch (error) {
      this.connectionError = (error as Error).message || 'No se pudo conectar al servidor.';
    }
  }

  exitOffice(): void {
    this.officeService.disconnect();
    this.router.navigateByUrl('/');
  }

  openInteraction(playerId: string): void {
    this.interactionTargetId = playerId;
    this.interactionView = 'menu';
  }

  closeInteraction(): void {
    this.interactionTargetId = null;
    this.interactionView = null;
    this.chatInput = '';
    this.broadcastInput = '';
    this.miniGameState = this.createMiniGameState('idle');
  }

  openBroadcast(): void {
    this.interactionTargetId = null;
    this.chooseInteraction('broadcast');
  }

  chooseInteraction(view: 'chat' | 'broadcast' | 'game'): void {
    if (!this.interactionTargetId && view !== 'broadcast') {
      return;
    }

    if (view === 'game') {
      this.miniGameState = this.createMiniGameState('playing');
    }

    this.interactionView = view;

    setTimeout(() => {
      if (view === 'chat') {
        document.querySelector<HTMLInputElement>('input[name="interactionChat"]')?.focus();
      }
      if (view === 'broadcast') {
        document.querySelector<HTMLInputElement>('input[name="interactionBroadcast"]')?.focus();
      }
    });
  }

  sendChatMessage(): void {
    const content = this.chatInput.trim();
    const target = this.interactionTarget;
    if (!content || !target) {
      return;
    }

    this.officeService.sendPrivateMessage(target.id, content);
    this.chatInput = '';
  }

  sendBroadcastMessage(): void {
    const content = this.broadcastInput.trim();
    if (!content) {
      return;
    }

    this.officeService.sendGeneralMessage(content);
    this.broadcastInput = '';
    this.closeInteraction();
  }

  playMiniGame(move: RpsMove): void {
    if (this.miniGameState.status !== 'playing') {
      return;
    }

    const opponentMove = this.randomRpsMove();
    const outcome = this.resolveRpsOutcome(move, opponentMove);

    const playerScore = this.miniGameState.playerScore + (outcome === 'win' ? 1 : 0);
    const opponentScore = this.miniGameState.opponentScore + (outcome === 'lose' ? 1 : 0);

    const history = [
      ...this.miniGameState.history,
      {
        round: this.miniGameState.history.length + 1,
        playerMove: move,
        opponentMove,
        outcome,
      },
    ];

    const hasWinner = playerScore >= 2 || opponentScore >= 2;
    const status: MiniGameState['status'] = hasWinner
      ? playerScore >= 2
        ? 'won'
        : 'lost'
      : 'playing';

    const round = hasWinner ? history.length : history.length + 1;

    this.miniGameState = {
      status,
      round,
      playerScore,
      opponentScore,
      history,
    };
  }

  replayMiniGame(): void {
    this.miniGameState = this.createMiniGameState('playing');
  }

  trackByPlayerId(_: number, player: PlayerState): string {
    return player.id;
  }

  shouldShowInteractHint(player: PlayerState): boolean {
    if (player.id === this.selfId) {
      return false;
    }
    if (!this.nearbyPlayerIds.has(player.id)) {
      return false;
    }
    if (this.interactionTargetId && this.interactionTargetId !== player.id) {
      return false;
    }
    return true;
  }

  isActiveTarget(player: PlayerState): boolean {
    return this.interactionTargetId === player.id;
  }

  @HostListener('window:keydown', ['$event'])
  handleKeydown(event: KeyboardEvent): void {
    if (!this.isConnected) {
      return;
    }

    const target = event.target as HTMLElement | null;
    if (target && ['INPUT', 'TEXTAREA'].includes(target.tagName)) {
      return;
    }

    if (event.key === 'e' || event.key === 'E') {
      const chosenTarget = this.interactionTargetId ?? this.closestNearbyPlayerId ?? this.nearbyPlayers[0]?.id;
      if (chosenTarget) {
        event.preventDefault();
        this.openInteraction(chosenTarget);
      }
      return;
    }

    if (event.key === 'Escape') {
      if (this.interactionView) {
        event.preventDefault();
        this.closeInteraction();
      }
      return;
    }

    if (event.code === 'Space' || event.key === ' ') {
      event.preventDefault();
      this.openBroadcast();
      return;
    }

    const direction = this.resolveDirection(event.key);
    if (!direction) {
      return;
    }

    event.preventDefault();
    this.moveSelf(direction);
  }

  private sendHello(): void {
    const player = this.players.find((p) => p.isSelf);
    const fallbackDirection: PlayerDirection = 'down';
    const position = player
      ? { x: player.x, y: player.y, direction: player.direction }
      : {
          x: this.clampCoordinate(this.space.width / 2, this.space.width),
          y: this.clampCoordinate(this.space.height / 2, this.space.height),
          direction: fallbackDirection,
        };

    this.officeService.sendHello({
      name: this.previewName,
      avatar: {
        id: this.selectedAvatar.id,
        emoji: this.selectedAvatar.emoji,
        tone: this.selectedAvatar.tone,
        label: this.selectedAvatar.label,
      },
      position,
    });
  }

  private handleWelcome(event: {
    type: 'welcome';
    id: string;
    players: PlayerPayload[];
    generalMessages: GeneralMessagePayload[];
    space: SpaceDescriptor;
  }): void {
    this.selfId = event.id;
    this.space = event.space || DEFAULT_SPACE;
    this.players = event.players.map((player) => this.mapPlayer(player, player.id === this.selfId));
    this.speechBubbles = {};
    this.refreshNearbyPlayers();
    this.focusWorkspace();
  }

  private upsertPlayer(payload: PlayerPayload): void {
    const index = this.players.findIndex((player) => player.id === payload.id);
    const player = this.mapPlayer(payload, payload.id === this.selfId);

    if (index >= 0) {
      this.players[index] = player;
    } else {
      this.players = [...this.players, player];
    }

    if (player.isSelf && !this.selfId) {
      this.selfId = player.id;
    }

    this.refreshNearbyPlayers();
  }

  private removePlayer(id: string): void {
    this.players = this.players.filter((item) => item.id !== id);
    this.clearSpeechBubble(id);

    if (this.interactionTargetId === id) {
      this.closeInteraction();
    }

    this.refreshNearbyPlayers();
  }

  private addGeneralMessage(message: GeneralMessagePayload): void {
    this.setSpeechBubble(message.authorId, {
      content: message.content,
      kind: 'broadcast',
      authorId: message.authorId,
    });
  }

  private addPrivateMessage(message: PrivateMessagePayload): void {
    const bubble: SpeechBubble = {
      content: message.content,
      kind: 'private',
      authorId: message.fromId,
    };

    this.setSpeechBubble(message.fromId, bubble);
    this.setSpeechBubble(message.toId, bubble);

    if (message.fromId === this.selfId) {
      this.chatInput = '';
    }

    if (message.toId === this.selfId) {
      this.interactionTargetId = message.fromId;
      if (this.interactionView !== 'chat') {
        this.interactionView = 'chat';
      }
    }
  }

  private setSpeechBubble(playerId: string, bubble: SpeechBubble): void {
    this.speechBubbles = {
      ...this.speechBubbles,
      [playerId]: bubble,
    };
  }

  private clearSpeechBubble(playerId: string): void {
    if (!(playerId in this.speechBubbles)) {
      return;
    }
    const next = { ...this.speechBubbles };
    delete next[playerId];
    this.speechBubbles = next;
  }

  private handleDisconnected(): void {
    this.selfId = null;
    this.players = [];
    this.speechBubbles = {};
    this.nearbyPlayerIds.clear();
    this.closestNearbyPlayerId = null;
    this.closeInteraction();
  }

  private mapPlayer(payload: PlayerPayload, isSelf: boolean): PlayerState {
    return {
      ...payload,
      avatar: this.normalizeAvatar(payload.avatar),
      isSelf,
    };
  }

  private normalizeAvatar(descriptor?: AvatarDescriptor | null): AvatarOption {
    if (descriptor?.id === 'system') {
      return this.systemAvatar;
    }

    if (descriptor?.id) {
      const local = this.avatars.find((avatar) => avatar.id === descriptor.id);
      if (local) {
        return local;
      }
    }

    if (descriptor) {
      return {
        id: descriptor.id ?? 'companion',
        label: descriptor.label ?? 'Compañero virtual',
        emoji: descriptor.emoji ?? '🙂',
        tone: this.normalizeTone(descriptor.tone),
      };
    }

    return this.avatars[0];
  }

  private normalizeTone(tone?: string): AvatarTone {
    const tones: AvatarTone[] = ['sky', 'sunset', 'forest', 'amethyst', 'ocean', 'ember'];
    return tones.includes(tone as AvatarTone) ? (tone as AvatarTone) : 'sky';
  }

  private resolveDirection(key: string): PlayerDirection | null {
    switch (key) {
      case 'ArrowUp':
      case 'w':
      case 'W':
        return 'up';
      case 'ArrowDown':
      case 's':
      case 'S':
        return 'down';
      case 'ArrowLeft':
      case 'a':
      case 'A':
        return 'left';
      case 'ArrowRight':
      case 'd':
      case 'D':
        return 'right';
      default:
        return null;
    }
  }

  private moveSelf(direction: PlayerDirection): void {
    const self = this.players.find((player) => player.id === this.selfId);
    if (!self) {
      return;
    }

    let { x, y } = self;
    switch (direction) {
      case 'up':
        y -= MOVEMENT_STEP;
        break;
      case 'down':
        y += MOVEMENT_STEP;
        break;
      case 'left':
        x -= MOVEMENT_STEP;
        break;
      case 'right':
        x += MOVEMENT_STEP;
        break;
    }

    const clampedX = this.clampCoordinate(x, this.space.width);
    const clampedY = this.clampCoordinate(y, this.space.height);

    const updated = { ...self, x: clampedX, y: clampedY, direction };
    this.players = this.players.map((player) => (player.id === self.id ? updated : player));
    this.refreshNearbyPlayers();

    const now = Date.now();
    if (now - this.lastMovementSentAt > 40) {
      this.officeService.sendPosition({ x: clampedX, y: clampedY, direction });
      this.lastMovementSentAt = now;
    }
  }

  private refreshNearbyPlayers(): void {
    const self = this.players.find((player) => player.id === this.selfId);
    if (!self) {
      this.nearbyPlayerIds.clear();
      this.closestNearbyPlayerId = null;
      return;
    }

    const ids = new Set<string>();
    let closestId: string | null = null;
    let closestDistance = Infinity;

    this.players.forEach((player) => {
      if (player.id === self.id) {
        return;
      }
      const distance = this.distanceBetween(self, player);
      if (distance <= NEARBY_DISTANCE) {
        ids.add(player.id);
        if (distance < closestDistance) {
          closestDistance = distance;
          closestId = player.id;
        }
      }
    });

    this.nearbyPlayerIds = ids;
    this.closestNearbyPlayerId = closestId;

    if (this.interactionTargetId && !this.nearbyPlayerIds.has(this.interactionTargetId)) {
      this.closeInteraction();
    }
  }

  private focusWorkspace(): void {
    setTimeout(() => {
      document.querySelector<HTMLElement>('.workspace')?.focus();
    }, 150);
  }

  private clampCoordinate(value: number, size: number): number {
    const padding = Math.min(EDGE_PADDING, size / 2);
    const min = padding;
    const max = size - padding;
    if (max <= min) {
      return size / 2;
    }
    return Math.max(min, Math.min(max, value));
  }

  private distanceBetween(a: PlayerState, b: PlayerState): number {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  private createMiniGameState(status: 'idle' | 'playing'): MiniGameState {
    return {
      status,
      round: status === 'playing' ? 1 : 0,
      playerScore: 0,
      opponentScore: 0,
      history: [],
    };
  }

  private randomRpsMove(): RpsMove {
    const moves: RpsMove[] = ['rock', 'paper', 'scissors'];
    const index = Math.floor(Math.random() * moves.length);
    return moves[index];
  }

  private resolveRpsOutcome(player: RpsMove, opponent: RpsMove): RpsOutcome {
    if (player === opponent) {
      return 'draw';
    }

    const winsAgainst: Record<RpsMove, RpsMove> = {
      rock: 'scissors',
      paper: 'rock',
      scissors: 'paper',
    };

    return winsAgainst[player] === opponent ? 'win' : 'lose';
  }

  private restorePreferences(): void {
    const storedName = localStorage.getItem(STORAGE_KEY_NAME);
    if (storedName) {
      this.displayName = storedName;
    }

    const avatarId = localStorage.getItem(STORAGE_KEY_AVATAR);
    if (avatarId) {
      const found = this.avatars.find((avatar) => avatar.id === avatarId);
      if (found) {
        this.selectedAvatar = found;
      }
    }
  }

  private persistPreferences(): void {
    localStorage.setItem(STORAGE_KEY_NAME, this.previewName);
  }
}
