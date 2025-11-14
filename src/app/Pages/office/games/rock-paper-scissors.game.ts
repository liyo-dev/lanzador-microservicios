/**
 * Rock Paper Scissors Game Logic
 * Gestiona toda la lógica del juego de Piedra, Papel o Tijera
 */

export type RpsMove = 'rock' | 'paper' | 'scissors';
export type RpsOutcome = 'win' | 'lose' | 'draw' | 'invalid';
export type RpsGameStatus =
  | 'idle'
  | 'challenge-sent'
  | 'challenge-received'
  | 'ready-check'
  | 'countdown'
  | 'reveal'
  | 'next-round'
  | 'finished';

export interface RpsRound {
  round: number;
  playerMove: RpsMove | null;
  opponentMove: RpsMove | null;
  outcome: RpsOutcome;
}

export interface RpsGameState {
  status: RpsGameStatus;
  round: number;
  playerScore: number;
  opponentScore: number;
  countdown: number;
  history: RpsRound[];
  playerMove: RpsMove | null;
  opponentMove: RpsMove | null;
  winner: 'self' | 'opponent' | 'draw' | null;
  challengeId: string | null;
  initiatorId: string | null;
  selfReady: boolean;
  opponentReady: boolean;
}

export interface RpsGameCallbacks {
  onStateChange: (state: RpsGameState) => void;
  onSendMove: (challengeId: string, opponentId: string, round: number, move: RpsMove) => void;
  onSendChallenge: (challengeId: string, targetId: string) => void;
  onSendResponse: (challengeId: string, opponentId: string, accepted: boolean) => void;
  onSendReady: (challengeId: string, opponentId: string) => void;
  onSendCancel: (challengeId: string, opponentId: string) => void;
}

export class RockPaperScissorsGame {
  private state: RpsGameState;
  private callbacks: RpsGameCallbacks;
  private countdownTimer: number | null = null;
  private timeoutTimer: number | null = null;
  private nextRoundTimer: number | null = null;

  readonly moves: Array<{ id: RpsMove; label: string; emoji: string }> = [
    { id: 'rock', label: 'Piedra', emoji: '🪨' },
    { id: 'paper', label: 'Papel', emoji: '📄' },
    { id: 'scissors', label: 'Tijeras', emoji: '✂️' },
  ];

  constructor(callbacks: RpsGameCallbacks) {
    this.callbacks = callbacks;
    this.state = this.createInitialState();
  }

  // ========================================
  // GETTERS - Estado del juego
  // ========================================

  getState(): RpsGameState {
    return { ...this.state };
  }

  isActive(): boolean {
    return this.state.status !== 'idle';
  }

  isCountdown(): boolean {
    return this.state.status === 'countdown';
  }

  getLastRound(): RpsRound | null {
    const { history } = this.state;
    return history.length ? history[history.length - 1] : null;
  }

  getCountdownLabel(opponentName: string): string {
    if (this.state.status === 'reveal') {
      return '¡YA!';
    }
    if (this.state.status === 'next-round') {
      return 'Preparando siguiente ronda...';
    }
    return this.state.countdown.toString();
  }

  getRoundLabel(opponentName: string): string {
    switch (this.state.status) {
      case 'challenge-sent':
        return `Esperando a ${opponentName}…`;
      case 'challenge-received':
        return `${opponentName} te ha retado`;
      case 'ready-check':
        return '¿Preparados? Pulsa listo para comenzar';
      case 'countdown':
      case 'reveal': {
        const roundNumber = this.state.round;
        return `Ronda ${roundNumber} · Mejor de 3`;
      }
      case 'next-round':
        return 'Siguiente turno';
      case 'finished':
        return 'Partida finalizada';
      default:
        return '';
    }
  }

  getResultMessage(opponentName: string): string {
    if (this.state.status !== 'finished' || !this.state.winner) {
      return '';
    }
    switch (this.state.winner) {
      case 'self':
        return '¡Ganaste la partida!';
      case 'opponent':
        return `${opponentName} ganó esta vez.`;
      default:
        return 'Empate. Nadie suma puntos.';
    }
  }

  formatMove(move: RpsMove): string {
    return this.moves.find((item) => item.id === move)?.label ?? move;
  }

  formatOutcome(outcome: RpsOutcome, opponentName: string): string {
    const lastRound = this.getLastRound();
    if (!lastRound) {
      switch (outcome) {
        case 'win':
          return 'Ganaste la ronda';
        case 'lose':
          return 'Perdiste la ronda';
        case 'draw':
          return 'Empate';
        default:
          return 'Turno no válido';
      }
    }

    const playerMoved = !!lastRound.playerMove;
    const opponentMoved = !!lastRound.opponentMove;

    switch (outcome) {
      case 'win':
        if (playerMoved && !opponentMoved) {
          return `Ganaste - ${opponentName} no eligió a tiempo`;
        }
        return 'Ganaste la ronda';
      case 'lose':
        if (!playerMoved && opponentMoved) {
          return 'Perdiste - No elegiste a tiempo';
        }
        return 'Perdiste la ronda';
      case 'draw':
        return 'Empate - Misma elección';
      case 'invalid':
        return 'Turno no válido - Ninguno eligió';
      default:
        return 'Turno no válido';
    }
  }

  // ========================================
  // ACCIONES DEL JUGADOR
  // ========================================

  initiateChallenge(targetId: string, selfId: string): void {
    if (this.state.status !== 'idle') {
      this.stop(true);
    }

    const challengeId = this.generateChallengeId();

    this.state = this.createInitialState();
    this.state.status = 'challenge-sent';
    this.state.challengeId = challengeId;
    this.state.initiatorId = selfId;
    this.state.round = 1;

    this.callbacks.onSendChallenge(challengeId, targetId);
    this.notifyStateChange();
  }

  selectMove(move: RpsMove, opponentId: string): void {
    if (!this.isCountdown()) {
      return;
    }

    this.state.playerMove = move;

    const challengeId = this.state.challengeId;
    if (challengeId && opponentId) {
      this.callbacks.onSendMove(challengeId, opponentId, this.state.round, move);
    }

    this.notifyStateChange();
    this.checkIfBothPlayersReady();
  }

  acceptChallenge(challengeId: string, opponentId: string): void {
    if (this.state.status !== 'challenge-received') {
      return;
    }

    this.callbacks.onSendResponse(challengeId, opponentId, true);
    
    this.state.status = 'ready-check';
    this.state.round = 1;
    this.state.playerScore = 0;
    this.state.opponentScore = 0;
    this.state.countdown = 0;
    this.state.history = [];
    this.state.playerMove = null;
    this.state.opponentMove = null;
    this.state.winner = null;
    this.state.selfReady = false;
    this.state.opponentReady = false;

    this.notifyStateChange();
  }

  declineChallenge(challengeId: string, opponentId: string): void {
    if (this.state.status !== 'challenge-received') {
      return;
    }

    this.callbacks.onSendResponse(challengeId, opponentId, false);
    this.stop();
  }

  confirmReady(challengeId: string, opponentId: string): void {
    if (this.state.status !== 'ready-check' || this.state.selfReady) {
      return;
    }

    this.state.selfReady = true;
    this.callbacks.onSendReady(challengeId, opponentId);
    this.notifyStateChange();
    this.maybeStartCountdown();
  }

  cancel(): void {
    this.stop(true);
  }

  rematch(targetId: string, selfId: string): void {
    this.stop();
    this.initiateChallenge(targetId, selfId);
  }

  // ========================================
  // EVENTOS RECIBIDOS DEL OPONENTE
  // ========================================

  handleChallengeReceived(challengeId: string, fromId: string): void {
    if (this.state.status && !['idle', 'finished'].includes(this.state.status)) {
      // Ya hay un juego activo, rechazar automáticamente
      this.callbacks.onSendResponse(challengeId, fromId, false);
      return;
    }

    if (this.state.status === 'finished') {
      this.stop();
    }

    this.state = this.createInitialState();
    this.state.status = 'challenge-received';
    this.state.challengeId = challengeId;
    this.state.initiatorId = fromId;
    this.state.round = 1;

    this.notifyStateChange();
  }

  handleChallengeAck(challengeId: string, fromId: string): void {
    if (this.state.status !== 'challenge-sent') {
      return;
    }

    this.state.challengeId = challengeId;
    this.state.initiatorId = fromId;
    this.notifyStateChange();
  }

  handleResponse(challengeId: string, accepted: boolean): void {
    if (this.state.challengeId && this.state.challengeId !== challengeId) {
      return;
    }

    if (!accepted) {
      this.stop();
      return;
    }

    this.state.status = 'ready-check';
    this.state.round = 1;
    this.state.playerScore = 0;
    this.state.opponentScore = 0;
    this.state.countdown = 0;
    this.state.history = [];
    this.state.playerMove = null;
    this.state.opponentMove = null;
    this.state.winner = null;
    this.state.selfReady = false;
    this.state.opponentReady = false;

    this.notifyStateChange();
  }

  handleResponseAck(challengeId: string, accepted: boolean): void {
    if (this.state.challengeId && this.state.challengeId !== challengeId) {
      return;
    }

    if (!accepted) {
      this.stop();
      return;
    }

    if (this.state.status !== 'ready-check') {
      this.state.status = 'ready-check';
      this.state.round = 1;
      this.state.playerScore = 0;
      this.state.opponentScore = 0;
      this.state.countdown = 0;
      this.state.history = [];
      this.state.playerMove = null;
      this.state.opponentMove = null;
      this.state.winner = null;
      this.state.selfReady = false;
      this.state.opponentReady = false;
      this.notifyStateChange();
    }
  }

  handleReady(): void {
    if (this.state.status !== 'ready-check') {
      return;
    }

    this.state.opponentReady = true;
    this.notifyStateChange();
    this.maybeStartCountdown();
  }

  handleMove(move: RpsMove, round: number): void {
    if (this.state.round !== round || this.state.status !== 'countdown') {
      return;
    }

    this.state.opponentMove = move;
    this.notifyStateChange();
    this.checkIfBothPlayersReady();
  }

  handleCancel(): void {
    this.stop();
  }

  // ========================================
  // LÓGICA INTERNA DEL JUEGO
  // ========================================

  private maybeStartCountdown(): void {
    if (this.state.status !== 'ready-check') {
      return;
    }

    if (!this.state.selfReady || !this.state.opponentReady) {
      return;
    }

    this.startCountdown();
  }

  private startCountdown(): void {
    this.clearTimers();
    this.state.status = 'countdown';
    this.state.countdown = 5;
    this.state.playerMove = null;
    this.state.opponentMove = null;
    this.notifyStateChange();
    this.runCountdown();
  }

  private runCountdown(): void {
    this.clearCountdownTimer();
    this.countdownTimer = window.setInterval(() => {
      if (this.state.status !== 'countdown') {
        this.clearCountdownTimer();
        return;
      }

      if (this.state.countdown <= 1) {
        this.clearCountdownTimer();
        this.state.countdown = 0;
        this.notifyStateChange();
        // Resolver inmediatamente cuando el countdown llega a 0
        this.resolveRound();
        return;
      }

      this.state.countdown -= 1;
      this.notifyStateChange();
    }, 1000);
  }

  private checkIfBothPlayersReady(): void {
    // Si ambos jugadores han elegido durante el countdown, resolver inmediatamente
    if (this.state.playerMove && this.state.opponentMove) {
      this.clearCountdownTimer();
      this.clearTimeoutTimer();
      this.resolveRound();
    }
  }

  private resolveRound(): void {
    if (this.state.status !== 'countdown') {
      return;
    }

    const playerMove = this.state.playerMove;
    const opponentMove = this.state.opponentMove;

    let outcome: RpsOutcome;
    let playerScore = this.state.playerScore;
    let opponentScore = this.state.opponentScore;

    // Determinar el resultado
    if (!playerMove && !opponentMove) {
      outcome = 'invalid';
    } else if (!playerMove) {
      outcome = 'lose';
      opponentScore += 1;
    } else if (!opponentMove) {
      outcome = 'win';
      playerScore += 1;
    } else {
      outcome = this.calculateOutcome(playerMove, opponentMove);
      if (outcome === 'win') {
        playerScore += 1;
      } else if (outcome === 'lose') {
        opponentScore += 1;
      }
    }

    const history: RpsRound[] = [
      ...this.state.history,
      {
        round: this.state.round,
        playerMove: playerMove ?? null,
        opponentMove: opponentMove ?? null,
        outcome,
      },
    ];

    const finished = playerScore >= 2 || opponentScore >= 2;
    const winner: RpsGameState['winner'] = finished
      ? playerScore === opponentScore
        ? 'draw'
        : playerScore > opponentScore
        ? 'self'
        : 'opponent'
      : null;

    this.state.status = finished ? 'finished' : 'reveal';
    this.state.playerScore = playerScore;
    this.state.opponentScore = opponentScore;
    this.state.countdown = 0;
    this.state.history = history;
    this.state.playerMove = playerMove ?? null;
    this.state.opponentMove = opponentMove ?? null;
    this.state.winner = winner;

    this.notifyStateChange();

    if (!finished) {
      this.scheduleNextRound();
    }
  }

  private scheduleNextRound(): void {
    this.clearTimeoutTimer();
    this.timeoutTimer = window.setTimeout(() => {
      if (this.state.status !== 'reveal') {
        return;
      }

      // Mostrar mensaje "Siguiente turno"
      this.state.status = 'next-round';
      this.notifyStateChange();

      // Después de 2 segundos, iniciar nueva ronda
      this.nextRoundTimer = window.setTimeout(() => {
        if (this.state.status !== 'next-round') {
          return;
        }

        this.state.status = 'countdown';
        this.state.round = this.state.history.length + 1;
        this.state.countdown = 5;
        this.state.playerMove = null;
        this.state.opponentMove = null;
        this.state.selfReady = false;
        this.state.opponentReady = false;

        this.notifyStateChange();
        this.runCountdown();
      }, 2000);
    }, 2000);
  }

  private calculateOutcome(player: RpsMove, opponent: RpsMove): Exclude<RpsOutcome, 'invalid'> {
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

  private stop(notifyOpponent = false): void {
    if (notifyOpponent && this.shouldNotifyCancel()) {
      const challengeId = this.state.challengeId;
      if (challengeId) {
        // El opponentId debe ser pasado desde fuera
        // Por ahora, la lógica de notificación se maneja en el componente
      }
    }

    this.clearTimers();
    this.state = this.createInitialState();
    this.notifyStateChange();
  }

  private shouldNotifyCancel(): boolean {
    if (!this.state.challengeId) {
      return false;
    }
    return ['challenge-sent', 'challenge-received', 'ready-check', 'countdown', 'reveal', 'next-round'].includes(
      this.state.status,
    );
  }

  private clearTimers(): void {
    this.clearCountdownTimer();
    this.clearTimeoutTimer();
    this.clearNextRoundTimer();
  }

  private clearCountdownTimer(): void {
    if (this.countdownTimer !== null) {
      window.clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
  }

  private clearTimeoutTimer(): void {
    if (this.timeoutTimer !== null) {
      window.clearTimeout(this.timeoutTimer);
      this.timeoutTimer = null;
    }
  }

  private clearNextRoundTimer(): void {
    if (this.nextRoundTimer !== null) {
      window.clearTimeout(this.nextRoundTimer);
      this.nextRoundTimer = null;
    }
  }

  private generateChallengeId(): string {
    try {
      if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
      }
    } catch (error) {
      // noop fallback
    }
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  private createInitialState(): RpsGameState {
    return {
      status: 'idle',
      round: 0,
      playerScore: 0,
      opponentScore: 0,
      countdown: 0,
      history: [],
      playerMove: null,
      opponentMove: null,
      winner: null,
      challengeId: null,
      initiatorId: null,
      selfReady: false,
      opponentReady: false,
    };
  }

  private notifyStateChange(): void {
    this.callbacks.onStateChange(this.getState());
  }

  // ========================================
  // CLEANUP
  // ========================================

  destroy(): void {
    this.clearTimers();
  }
}
