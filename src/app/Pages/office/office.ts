import {
  AfterViewInit,
  ChangeDetectorRef,
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  OnInit,
  ViewChild,
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
  description: string;
  tone: AvatarTone;
}

interface GeneralMessage {
  id: string;
  authorId: string;
  authorName: string;
  avatar: AvatarOption;
  content: string;
  createdAt: Date;
  system?: boolean;
}

interface PrivateMessage {
  id: string;
  fromId: string;
  toId: string;
  fromName: string;
  toName: string;
  avatar: AvatarOption;
  content: string;
  createdAt: Date;
}

interface PlayerState extends PlayerPayload {
  avatar: AvatarOption;
  isSelf: boolean;
}

const DEFAULT_SPACE: SpaceDescriptor = { width: 960, height: 560 };
const STORAGE_KEY_SERVER_URL = 'virtualOffice.serverUrl';
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
  @ViewChild('generalMessageList') private generalMessageList?: ElementRef<HTMLDivElement>;
  @ViewChild('privateMessageList') private privateMessageList?: ElementRef<HTMLDivElement>;

  readonly avatars: AvatarOption[] = [
    {
      id: 'pilot',
      label: 'Piloto Espacial',
      emoji: '🧑‍🚀',
      description: 'Explorador intergaláctico listo para despegar.',
      tone: 'sky',
    },
    {
      id: 'engineer',
      label: 'Ingeniera DevOps',
      emoji: '🧑‍💻',
      description: 'Mantiene los microservicios en órbita estable.',
      tone: 'amethyst',
    },
    {
      id: 'botanist',
      label: 'Botánica de Terraformación',
      emoji: '🧑‍🔬',
      description: 'Hace florecer los entornos más hostiles.',
      tone: 'forest',
    },
    {
      id: 'captain',
      label: 'Capitana de la Flota',
      emoji: '🧑‍✈️',
      description: 'Coordina a la tripulación con precisión milimétrica.',
      tone: 'sunset',
    },
    {
      id: 'navigator',
      label: 'Navegante Galáctico',
      emoji: '🧭',
      description: 'Encuentra rutas óptimas entre servicios.',
      tone: 'ocean',
    },
    {
      id: 'guardian',
      label: 'Guardián de Seguridad',
      emoji: '🛡️',
      description: 'Asegura que todo el equipo esté protegido.',
      tone: 'ember',
    },
  ];

  displayName = '';
  messageText = '';
  privateMessageText = '';
  
  // URL del servidor cloud automática
  serverUrl = getVirtualOfficeUrl();

  selectedAvatar: AvatarOption = this.avatars[0];
  readonly systemAvatar: AvatarOption = {
    id: 'system',
    label: 'Sistema',
    description: 'Notificaciones de la oficina virtual.',
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
  generalMessages: GeneralMessage[] = [];
  privateMessages: Record<string, PrivateMessage[]> = {};
  nearbyPlayerIds = new Set<string>();
  activeConversationId: string | null = null;

  space: SpaceDescriptor = DEFAULT_SPACE;

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

  get sortedPlayers(): PlayerState[] {
    return [...this.players].sort((a, b) => (a.id === this.selfId ? 1 : 0) - (b.id === this.selfId ? 1 : 0));
  }

  get nearbyPlayers(): PlayerState[] {
    return this.sortedPlayers.filter((player) => this.nearbyPlayerIds.has(player.id) && player.id !== this.selfId);
  }

  get activeConversation(): PlayerState | null {
    if (!this.activeConversationId) {
      return null;
    }
    return this.players.find((player) => player.id === this.activeConversationId) ?? null;
  }

  selectAvatar(avatar: AvatarOption): void {
    this.selectedAvatar = avatar;
    localStorage.setItem(STORAGE_KEY_AVATAR, avatar.id);
  }

  async joinOffice(): Promise<void> {
    if (!this.serverUrl.trim()) {
      this.connectionError = 'Debes indicar la URL del servidor.';
      return;
    }

    try {
      await this.officeService.connect(this.serverUrl.trim());
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

  sendGeneralMessage(): void {
    const content = this.messageText.trim();
    if (!content) {
      return;
    }

    this.officeService.sendGeneralMessage(content);
    this.messageText = '';
  }

  sendPrivateMessage(): void {
    const content = this.privateMessageText.trim();
    if (!content || !this.activeConversationId) {
      return;
    }

    this.officeService.sendPrivateMessage(this.activeConversationId, content);
    this.privateMessageText = '';
  }

  trackByPlayerId(_: number, player: PlayerState): string {
    return player.id;
  }

  trackByMessageId(_: number, message: GeneralMessage): string {
    return message.id;
  }

  trackByPrivateMessageId(_: number, message: PrivateMessage): string {
    return message.id;
  }

  @HostListener('window:keydown', ['$event'])
  handleKeydown(event: KeyboardEvent): void {
    if (!this.isConnected || !this.selfId) {
      return;
    }

    const target = event.target as HTMLElement | null;
    if (target && ['INPUT', 'TEXTAREA'].includes(target.tagName)) {
      return;
    }

    const direction = this.resolveDirection(event.key);
    if (!direction) {
      return;
    }

    event.preventDefault();
    this.moveSelf(direction);
  }

  setActiveConversation(playerId: string): void {
    this.activeConversationId = playerId;
    this.scrollToBottom(this.privateMessageList);
  }

  clearConversation(): void {
    this.activeConversationId = null;
    this.privateMessageText = '';
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

  private handleWelcome(event: { type: 'welcome'; id: string; players: PlayerPayload[]; generalMessages: GeneralMessagePayload[]; space: SpaceDescriptor }): void {
    this.selfId = event.id;
    this.space = event.space || DEFAULT_SPACE;
    this.players = event.players.map((player) => this.mapPlayer(player, player.id === this.selfId));
    this.generalMessages = event.generalMessages.map((message) => this.mapGeneralMessage(message));
    this.sortMessages();
    this.refreshNearbyPlayers();
    this.scrollToBottom(this.generalMessageList);
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

    if (this.activeConversationId === id) {
      this.activeConversationId = null;
    }

    this.refreshNearbyPlayers();
  }

  private addGeneralMessage(message: GeneralMessagePayload): void {
    this.generalMessages = [...this.generalMessages, this.mapGeneralMessage(message)];
    this.sortMessages();
    this.scrollToBottom(this.generalMessageList);
  }

  private addPrivateMessage(message: PrivateMessagePayload): void {
    const mapped: PrivateMessage = {
      ...message,
      avatar: this.normalizeAvatar(message.avatar),
      createdAt: new Date(message.createdAt),
    };

    const conversationId = message.fromId === this.selfId ? message.toId : message.fromId;
    const current = this.privateMessages[conversationId] ?? [];
    this.privateMessages = {
      ...this.privateMessages,
      [conversationId]: [...current, mapped],
    };

    if (!this.activeConversationId || this.activeConversationId === conversationId) {
      this.activeConversationId = conversationId;
      this.scrollToBottom(this.privateMessageList);
    }
  }

  private handleDisconnected(): void {
    this.selfId = null;
    this.players = [];
    this.generalMessages = [];
    this.nearbyPlayerIds.clear();
    this.activeConversationId = null;
    this.privateMessages = {};
    this.messageText = '';
    this.privateMessageText = '';
  }

  private mapPlayer(payload: PlayerPayload, isSelf: boolean): PlayerState {
    return {
      ...payload,
      avatar: this.normalizeAvatar(payload.avatar),
      isSelf,
    };
  }

  private mapGeneralMessage(message: GeneralMessagePayload): GeneralMessage {
    return {
      ...message,
      avatar: this.normalizeAvatar(message.avatar),
      createdAt: new Date(message.createdAt),
    };
  }

  private resolveAvatar(id?: string): AvatarOption | null {
    if (!id) {
      return null;
    }
    return this.avatars.find((avatar) => avatar.id === id) ?? null;
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

  private normalizeAvatar(descriptor?: AvatarDescriptor | null): AvatarOption {
    if (descriptor?.id === 'system') {
      return this.systemAvatar;
    }

    if (descriptor?.id) {
      const local = this.resolveAvatar(descriptor.id);
      if (local) {
        return local;
      }
    }

    if (descriptor) {
      return {
        id: descriptor.id ?? 'companion',
        label: descriptor.label ?? 'Compañero virtual',
        description: descriptor.label ?? 'Miembro de la oficina virtual.',
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
      return;
    }

    const ids = new Set<string>();
    this.players.forEach((player) => {
      if (player.id === self.id) {
        return;
      }
      const distance = Math.hypot(player.x - self.x, player.y - self.y);
      if (distance <= NEARBY_DISTANCE) {
        ids.add(player.id);
      }
    });
    this.nearbyPlayerIds = ids;

    if (this.activeConversationId && !ids.has(this.activeConversationId)) {
      this.activeConversationId = null;
    }
  }

  private focusWorkspace(): void {
    setTimeout(() => {
      const workspace = document.querySelector<HTMLElement>('.workspace');
      workspace?.focus();
    }, 150);
  }

  private sortMessages(): void {
    this.generalMessages = [...this.generalMessages].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    );
  }

  private scrollToBottom(ref?: ElementRef<HTMLDivElement>): void {
    if (!ref) {
      return;
    }
    requestAnimationFrame(() => {
      const el = ref.nativeElement;
      el.scrollTop = el.scrollHeight;
    });
  }

  private restorePreferences(): void {
    const storedName = localStorage.getItem(STORAGE_KEY_NAME);
    if (storedName) {
      this.displayName = storedName;
    }

    const storedServer = localStorage.getItem(STORAGE_KEY_SERVER_URL);
    if (storedServer) {
      this.serverUrl = storedServer;
    }

    const avatarId = localStorage.getItem(STORAGE_KEY_AVATAR);
    const foundAvatar = this.resolveAvatar(avatarId ?? undefined);
    if (foundAvatar) {
      this.selectedAvatar = foundAvatar;
    }
  }

  private persistPreferences(): void {
    localStorage.setItem(STORAGE_KEY_NAME, this.previewName);
    localStorage.setItem(STORAGE_KEY_SERVER_URL, this.serverUrl.trim());
  }
}
