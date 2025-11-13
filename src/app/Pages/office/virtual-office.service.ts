import { Injectable, NgZone } from '@angular/core';
import { BehaviorSubject, Observable, Subject } from 'rxjs';

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface AvatarDescriptor {
  id: string;
  label?: string;
  emoji: string;
  tone: string;
}

export interface PlayerPayload {
  id: string;
  name: string;
  avatar: AvatarDescriptor;
  x: number;
  y: number;
  direction: PlayerDirection;
  connectedAt: string;
  updatedAt: string;
}

export type PlayerDirection = 'up' | 'down' | 'left' | 'right';

export interface GeneralMessagePayload {
  id: string;
  authorId: string;
  authorName: string;
  avatar: AvatarDescriptor;
  content: string;
  createdAt: string;
  system?: boolean;
}

export interface PrivateMessagePayload {
  id: string;
  fromId: string;
  toId: string;
  fromName: string;
  toName: string;
  avatar: AvatarDescriptor;
  content: string;
  createdAt: string;
}

export interface MiniGameChallengePayload {
  id: string;
  fromId: string;
  fromName: string;
  toId: string;
  avatar: AvatarDescriptor;
  createdAt: string;
}

export interface MiniGameResponsePayload {
  id: string;
  fromId: string;
  toId: string;
  accepted: boolean;
  createdAt: string;
}

export interface MiniGameReadyPayload {
  id: string;
  fromId: string;
  toId: string;
  ready: boolean;
  createdAt: string;
}

export interface MiniGameCancelPayload {
  id: string;
  fromId: string;
  toId: string;
  createdAt: string;
}

export interface MiniGameMovePayload {
  id: string;
  fromId: string;
  toId: string;
  round: number;
  move: 'rock' | 'paper' | 'scissors';
  createdAt: string;
}

export interface SpaceDescriptor {
  width: number;
  height: number;
}

export type ServerEvent =
  | { type: 'welcome'; id: string; players: PlayerPayload[]; generalMessages: GeneralMessagePayload[]; space: SpaceDescriptor }
  | { type: 'player-joined'; player: PlayerPayload }
  | { type: 'player-updated'; player: PlayerPayload }
  | { type: 'player-left'; id: string }
  | { type: 'general-message'; message: GeneralMessagePayload }
  | { type: 'private-message'; message: PrivateMessagePayload }
  | { type: 'mini-game-challenge'; challenge: MiniGameChallengePayload }
  | { type: 'mini-game-challenge-ack'; challenge: MiniGameChallengePayload }
  | { type: 'mini-game-response'; response: MiniGameResponsePayload }
  | { type: 'mini-game-response-ack'; response: MiniGameResponsePayload }
  | { type: 'mini-game-ready'; payload: MiniGameReadyPayload }
  | { type: 'mini-game-cancel'; payload: MiniGameCancelPayload }
  | { type: 'mini-game-move'; payload: MiniGameMovePayload }
  | { type: 'error'; message: string }
  | { type: 'disconnected' };

export interface HelloPayload {
  name: string;
  avatar: AvatarDescriptor;
  position: { x: number; y: number; direction: PlayerDirection };
}

export interface PositionPayload {
  x: number;
  y: number;
  direction: PlayerDirection;
}

@Injectable({ providedIn: 'root' })
export class VirtualOfficeService {
  private socket?: WebSocket;

  private readonly eventsSubject = new Subject<ServerEvent>();
  private readonly connectionStateSubject = new BehaviorSubject<ConnectionState>('disconnected');

  readonly events$: Observable<ServerEvent> = this.eventsSubject.asObservable();
  readonly connectionState$: Observable<ConnectionState> = this.connectionStateSubject.asObservable();

  constructor(private readonly zone: NgZone) {}

  async connect(url: string): Promise<void> {
    this.disconnect();

    this.connectionStateSubject.next('connecting');

    await new Promise<void>((resolve, reject) => {
      let settled = false;

      try {
        const socket = new WebSocket(url);
        this.socket = socket;

        socket.onopen = () => {
          this.zone.run(() => {
            settled = true;
            this.connectionStateSubject.next('connected');
            resolve();
          });
        };

        socket.onerror = () => {
          this.zone.run(() => {
            if (!settled) {
              settled = true;
              this.connectionStateSubject.next('error');
              reject(new Error('No se pudo conectar con el servidor de la oficina.'));
            } else {
              this.connectionStateSubject.next('error');
              this.eventsSubject.next({ type: 'error', message: 'Se ha producido un error en la conexión.' });
            }
          });
        };

        socket.onclose = () => {
          this.zone.run(() => {
            if (!settled) {
              settled = true;
              this.connectionStateSubject.next('error');
              reject(new Error('La conexión se cerró antes de establecerse.'));
            } else {
              this.connectionStateSubject.next('disconnected');
              this.eventsSubject.next({ type: 'disconnected' });
            }
          });
        };

        socket.onmessage = (event) => {
          this.zone.run(() => {
            try {
              const data = JSON.parse(event.data) as ServerEvent;
              this.eventsSubject.next(data);
            } catch (error) {
              console.error('No se pudo interpretar el mensaje del servidor', error);
            }
          });
        };
      } catch (error) {
        settled = true;
        this.connectionStateSubject.next('error');
        reject(error);
      }
    });
  }

  sendHello(payload: HelloPayload): void {
    this.send({ type: 'hello', ...payload });
  }

  sendPosition(payload: PositionPayload): void {
    this.send({ type: 'position', ...payload });
  }

  sendGeneralMessage(content: string): void {
    this.send({ type: 'general-message', content });
  }

  sendPrivateMessage(to: string, content: string): void {
    this.send({ type: 'private-message', to, content });
  }

  sendMiniGameChallenge(challengeId: string, to: string): void {
    this.send({ type: 'mini-game-challenge', challengeId, to });
  }

  sendMiniGameResponse(challengeId: string, to: string, accepted: boolean): void {
    this.send({ type: 'mini-game-response', challengeId, to, accepted });
  }

  sendMiniGameReady(challengeId: string, to: string): void {
    this.send({ type: 'mini-game-ready', challengeId, to, ready: true });
  }

  sendMiniGameCancel(challengeId: string, to: string): void {
    this.send({ type: 'mini-game-cancel', challengeId, to });
  }

  sendMiniGameMove(challengeId: string, to: string, round: number, move: 'rock' | 'paper' | 'scissors'): void {
    this.send({ type: 'mini-game-move', challengeId, to, round, move });
  }

  disconnect(): void {
    if (this.socket) {
      try {
        this.socket.close();
      } catch (error) {
        console.warn('Error al cerrar la conexión del socket', error);
      }
      this.socket = undefined;
    }
    this.connectionStateSubject.next('disconnected');
  }

  private send(message: unknown): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }

    try {
      this.socket.send(JSON.stringify(message));
    } catch (error) {
      console.error('No se pudo enviar el mensaje al servidor', error);
    }
  }
}
