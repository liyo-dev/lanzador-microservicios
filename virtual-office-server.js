const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Configuración del servidor - Compatible con servicios cloud
const PORT = process.env.PORT || process.env.VIRTUAL_OFFICE_PORT || 8974;
const HOST = process.env.HOST || '0.0.0.0';
const OFFICE_WIDTH = Number(process.env.VIRTUAL_OFFICE_WIDTH || 960);
const OFFICE_HEIGHT = Number(process.env.VIRTUAL_OFFICE_HEIGHT || 560);
const EDGE_PADDING = Number(process.env.VIRTUAL_OFFICE_PADDING || 48);
const GENERAL_HISTORY_LIMIT = Number(process.env.VIRTUAL_OFFICE_HISTORY || 150);
const BUG_HUNT_RANKING_LIMIT = Number(process.env.VIRTUAL_OFFICE_BUG_RANKING || 50);
const BUG_HUNT_STORE = process.env.VIRTUAL_OFFICE_BUG_STORE ||
  path.join(__dirname, '.bug-hunt-ranking.json');

// Pizarra colaborativa de píxeles.
const PIXEL_BOARD_WIDTH = Number(process.env.VIRTUAL_OFFICE_PIXEL_W || 24);
const PIXEL_BOARD_HEIGHT = Number(process.env.VIRTUAL_OFFICE_PIXEL_H || 12);
const PIXEL_BOARD_STORE = process.env.VIRTUAL_OFFICE_PIXEL_STORE ||
  path.join(__dirname, '.pixel-board.json');

const clients = new Map(); // id -> Client
const players = new Map(); // id -> Player state
const generalMessages = [];
let bugHuntRanking = normalizeRanking(loadBugHuntRanking());
let pixelBoardPixels = loadPixelBoard(); // { "x,y": "#rrggbb" }
let pixelSaveTimer = null;

// ============================================================
// Estado del mini-juego multijugador "Caza al Dinosaurio"
// ============================================================
// Sólo hay una partida activa a la vez. Es una serie best-of-N rondas:
//   phase: 'lobby'        → esperando jugadores (temporizador o "Comenzar ya")
//   phase: 'round'        → dinosaurio visible, participantes compiten
//   phase: 'inter-round'  → pausa breve tras una ronda; luego arranca la siguiente
//   phase: 'done'         → serie finalizada, se muestra ganador global
//
// Estructura del objeto dinoGame:
//   { id, phase, creatorId, creatorStableId, creatorName, creatorAvatar,
//     participantIds: Set<clientId>,
//     endsAt: number,              // fase lobby: ms epoch fin cuenta atrás
//     totalRounds: number,
//     currentRound: number,        // 1-based
//     x, y, startedAt,             // fase round
//     lastRoundWinnerId, lastRoundWinnerName, lastRoundTimeMs,
//     nextRoundStartsAt,           // fase inter-round: ms epoch
//     scoreboard: Map<clientId, { name, avatar, wins }>,
//     roundHistory: Array<{ round, winnerId, winnerName, timeMs }>,
//     overallWinnerId, overallWinnerName,   // fase done
//     lobbyTimer, roundTimer, endTimer }
let dinoGame = null;
const DINO_LOBBY_MS = 30_000;
const DINO_INTER_ROUND_MS = 3_500;
const DINO_TOTAL_ROUNDS = Number(process.env.VIRTUAL_OFFICE_DINO_ROUNDS || 3);
const DINO_RESULT_LINGER_MS = 8_000;
const DINO_PADDING = 80;

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Servidor de oficina virtual activo. Usa WebSocket para conectarte.\n');
});

server.on('upgrade', (req, socket, head) => {
  if (req.headers['upgrade']?.toLowerCase() !== 'websocket') {
    socket.end('HTTP/1.1 400 Bad Request');
    return;
  }

  const key = req.headers['sec-websocket-key'];
  if (!key) {
    socket.end('HTTP/1.1 400 Bad Request');
    return;
  }

  const acceptKey = createWebSocketAccept(key);
  const responseHeaders = [
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${acceptKey}`,
  ];

  socket.write(responseHeaders.concat('\r\n').join('\r\n'));

  const id = crypto.randomUUID();
  const client = new Client(id, socket);
  clients.set(id, client);

  socket.setNoDelay(true);
  socket.setKeepAlive(true, 15_000);

  send(client, {
    type: 'welcome',
    id,
    players: Array.from(players.values()),
    generalMessages,
    space: { width: OFFICE_WIDTH, height: OFFICE_HEIGHT },
    bugHuntRanking,
    pixelBoard: {
      width: PIXEL_BOARD_WIDTH,
      height: PIXEL_BOARD_HEIGHT,
      pixels: pixelBoardPixels,
    },
    dinoGame: serializeDinoGame(),
  });

  if (head && head.length) {
    client.handleData(head);
  }

  socket.on('close', () => disconnectClient(client));
  socket.on('end', () => disconnectClient(client));
  socket.on('error', () => disconnectClient(client));
});

server.listen(PORT, HOST, () => {
  console.log(`🚀 Servidor de oficina virtual escuchando en ${HOST}:${PORT}`);
  console.log(`🌐 Entorno: ${process.env.NODE_ENV || 'development'}`);
  console.log(`📍 URL para conectar: ws://${HOST}:${PORT}`);
});

class Client {
  constructor(id, socket) {
    this.id = id;
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    this.player = null;

    socket.on('data', (chunk) => this.handleData(chunk));
  }

  handleData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);

    while (true) {
      const result = readFrame(this.buffer);
      if (!result) {
        break;
      }

      const { frame, remaining } = result;
      this.buffer = remaining;

      if (frame.opcode === 0x8) {
        // Close
        this.socket.end();
        disconnectClient(this);
        return;
      }

      if (frame.opcode === 0x9) {
        // Ping -> Pong
        this.socket.write(createFrame(frame.payload, 0xA));
        continue;
      }

      if (frame.opcode !== 0x1) {
        continue; // Only text frames supported
      }

      const payload = frame.payload.toString('utf8');
      handleClientMessage(this, payload);
    }
  }
}

function handleClientMessage(client, raw) {
  let data;
  try {
    data = JSON.parse(raw);
  } catch (error) {
    return;
  }

  switch (data.type) {
    case 'hello':
      handleHello(client, data);
      break;
    case 'position':
      handlePosition(client, data);
      break;
    case 'general-message':
      handleGeneralMessage(client, data);
      break;
    case 'private-message':
      handlePrivateMessage(client, data);
      break;
    case 'mini-game-challenge':
      handleMiniGameChallenge(client, data);
      break;
    case 'mini-game-response':
      handleMiniGameResponse(client, data);
      break;
    case 'mini-game-ready':
      handleMiniGameReady(client, data);
      break;
    case 'mini-game-cancel':
      handleMiniGameCancel(client, data);
      break;
    case 'bug-hunt-result':
      handleBugHuntResult(client, data);
      break;
    case 'pixel-paint':
      handlePixelPaint(client, data);
      break;
    case 'dino-create':
      handleDinoCreate(client, data);
      break;
    case 'dino-join':
      handleDinoJoin(client, data);
      break;
    case 'dino-start':
      handleDinoStart(client, data);
      break;
    case 'dino-catch':
      handleDinoCatch(client, data);
      break;
    case 'dino-cancel':
      handleDinoCancel(client, data);
      break;
    default:
      send(client, { type: 'error', message: 'Acción no soportada.' });
  }
}

function handleHello(client, data) {
  const name = sanitizeName(data.name);
  const avatar = sanitizeAvatar(data.avatar);
  const position = sanitizePosition(data.position);
  const stableId = sanitizeStableId(data.playerId) || client.stableId || client.id;

  client.stableId = stableId;

  const player = {
    id: client.id,
    stableId,
    name,
    avatar,
    x: position.x,
    y: position.y,
    direction: position.direction,
    connectedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  client.player = player;
  players.set(client.id, player);

  send(client, { type: 'player-updated', player });
  broadcast({ type: 'player-joined', player }, client.id);
  pushSystemMessage(`${name} se ha unido a la oficina.`);
}

function handlePosition(client, data) {
  if (!client.player) {
    return;
  }

  const position = sanitizePosition(data);
  const updated = {
    ...client.player,
    x: position.x,
    y: position.y,
    direction: position.direction,
    updatedAt: new Date().toISOString(),
  };

  client.player = updated;
  players.set(client.id, updated);

  broadcast({ type: 'player-updated', player: updated }, client.id);
}

function handleGeneralMessage(client, data) {
  if (!client.player) {
    return;
  }

  const content = sanitizeMessage(data.content);
  if (!content) {
    return;
  }

  const message = {
    id: crypto.randomUUID(),
    authorId: client.id,
    authorName: client.player.name,
    avatar: client.player.avatar,
    content,
    createdAt: new Date().toISOString(),
  };

  generalMessages.push(message);
  if (generalMessages.length > GENERAL_HISTORY_LIMIT) {
    generalMessages.shift();
  }

  broadcast({ type: 'general-message', message });
}

function handlePrivateMessage(client, data) {
  if (!client.player) {
    return;
  }

  const toId = typeof data.to === 'string' ? data.to : null;
  const content = sanitizeMessage(data.content);
  if (!toId || !content) {
    return;
  }

  const target = clients.get(toId);
  if (!target || !target.player) {
    send(client, { type: 'error', message: 'La persona ya no está disponible.' });
    return;
  }

  const message = {
    id: crypto.randomUUID(),
    fromId: client.id,
    toId,
    fromName: client.player.name,
    toName: target.player.name,
    avatar: client.player.avatar,
    content,
    createdAt: new Date().toISOString(),
  };

  send(target, { type: 'private-message', message });
  send(client, { type: 'private-message', message });
}

function handleMiniGameChallenge(client, data) {
  if (!client.player) {
    return;
  }

  const toId = sanitizeId(data.to);
  if (!toId) {
    return;
  }

  const target = clients.get(toId);
  if (!target || !target.player) {
    send(client, { type: 'error', message: 'La persona ya no está disponible.' });
    return;
  }

  const challengeId = sanitizeId(data.challengeId) || crypto.randomUUID();
  const challenge = {
    id: challengeId,
    fromId: client.id,
    fromName: client.player.name,
    toId,
    avatar: client.player.avatar,
    createdAt: new Date().toISOString(),
  };

  send(target, { type: 'mini-game-challenge', challenge });
  send(client, { type: 'mini-game-challenge-ack', challenge });
}

function handleMiniGameResponse(client, data) {
  if (!client.player) {
    return;
  }

  const toId = sanitizeId(data.to);
  const challengeId = sanitizeId(data.challengeId);
  if (!toId || !challengeId) {
    return;
  }

  const target = clients.get(toId);
  if (!target || !target.player) {
    send(client, { type: 'error', message: 'La persona ya no está disponible.' });
    return;
  }

  const accepted = Boolean(data.accepted);
  const response = {
    id: challengeId,
    fromId: client.id,
    toId,
    accepted,
    createdAt: new Date().toISOString(),
  };

  send(target, { type: 'mini-game-response', response });
  send(client, { type: 'mini-game-response-ack', response });
}

function handleMiniGameReady(client, data) {
  if (!client.player) {
    return;
  }

  const toId = sanitizeId(data.to);
  const challengeId = sanitizeId(data.challengeId);
  if (!toId || !challengeId) {
    return;
  }

  const target = clients.get(toId);
  if (!target || !target.player) {
    return;
  }

  const payload = {
    id: challengeId,
    fromId: client.id,
    toId,
    ready: Boolean(data.ready),
    createdAt: new Date().toISOString(),
  };

  send(target, { type: 'mini-game-ready', payload });
}

function handleMiniGameCancel(client, data) {
  if (!client.player) {
    return;
  }

  const toId = sanitizeId(data.to);
  const challengeId = sanitizeId(data.challengeId);
  if (!toId || !challengeId) {
    return;
  }

  const target = clients.get(toId);
  if (!target || !target.player) {
    return;
  }

  const payload = {
    id: challengeId,
    fromId: client.id,
    toId,
    createdAt: new Date().toISOString(),
  };

  send(target, { type: 'mini-game-cancel', payload });
}

function handleBugHuntResult(client, data) {
  if (!client.player) {
    return;
  }

  const timeMs = Number(data?.timeMs);
  if (!Number.isFinite(timeMs) || timeMs <= 0 || timeMs > 10 * 60 * 1000) {
    send(client, { type: 'error', message: 'Tiempo de bug hunt inválido.' });
    return;
  }

  const stableId = client.stableId || client.id;
  const legacyKey = bugHuntKey({ name: client.player.name, avatarId: client.player.avatar?.id });
  const today = todayIsoDate();
  const roundedTime = Math.round(timeMs);

  // Busca la entrada de este jugador (por identidad estable, o por nombre+avatar
  // como fallback para entradas antiguas).
  const existing = bugHuntRanking.find(e => entryStableId(e) === stableId)
    || bugHuntRanking.find(e => entryStableId(e) === legacyKey);

  // Bloqueo: sólo un intento por día por jugador.
  if (existing && existing.date === today) {
    send(client, { type: 'error', message: 'Ya has registrado tu marca de hoy.' });
    return;
  }

  if (existing) {
    // Otro día: marcamos participación de hoy y sólo actualizamos el tiempo
    // si mejora la mejor marca histórica del jugador.
    const improved = roundedTime < existing.timeMs;
    existing.stableId = stableId;
    existing.playerId = client.id;
    existing.name = client.player.name;
    existing.avatarId = client.player.avatar?.id || 'pilot';
    existing.avatarEmoji = client.player.avatar?.emoji || '🐞';
    existing.avatarTone = client.player.avatar?.tone || 'sky';
    existing.date = today;
    existing.playedAt = new Date().toISOString();
    if (improved) {
      existing.timeMs = roundedTime;
    }

    bugHuntRanking = [...bugHuntRanking]
      .sort((a, b) => a.timeMs - b.timeMs)
      .slice(0, BUG_HUNT_RANKING_LIMIT);
    saveBugHuntRanking();

    broadcast({ type: 'bug-hunt-ranking', entries: bugHuntRanking });
    const msg = improved
      ? `🐞 ${client.player.name} ha mejorado su marca a ${(roundedTime / 1000).toFixed(2)} s.`
      : `🐞 ${client.player.name} ha cazado el bug en ${(roundedTime / 1000).toFixed(2)} s (mejor: ${(existing.timeMs / 1000).toFixed(2)} s).`;
    pushSystemMessage(msg);
    return;
  }

  const entry = {
    id: crypto.randomUUID(),
    stableId,
    playerId: client.id,
    name: client.player.name,
    avatarId: client.player.avatar?.id || 'pilot',
    avatarEmoji: client.player.avatar?.emoji || '🐞',
    avatarTone: client.player.avatar?.tone || 'sky',
    timeMs: roundedTime,
    date: today,
    playedAt: new Date().toISOString(),
  };

  bugHuntRanking = [...bugHuntRanking, entry]
    .sort((a, b) => a.timeMs - b.timeMs)
    .slice(0, BUG_HUNT_RANKING_LIMIT);
  saveBugHuntRanking();

  broadcast({ type: 'bug-hunt-ranking', entries: bugHuntRanking });
  pushSystemMessage(`🐞 ${client.player.name} ha cazado el bug en ${(entry.timeMs / 1000).toFixed(2)} s.`);
}

// ============================================================
// Pizarra colaborativa de píxeles
// ============================================================

function handlePixelPaint(client, data) {
  if (!client.player) return;

  const x = Number(data?.x);
  const y = Number(data?.y);
  if (!Number.isInteger(x) || x < 0 || x >= PIXEL_BOARD_WIDTH) return;
  if (!Number.isInteger(y) || y < 0 || y >= PIXEL_BOARD_HEIGHT) return;

  const color = sanitizeHexColor(data?.color);
  const key = `${x},${y}`;

  if (color) {
    pixelBoardPixels[key] = color;
  } else {
    // color null/inválido -> goma de borrar.
    delete pixelBoardPixels[key];
  }

  schedulePixelSave();

  broadcast({
    type: 'pixel-board-paint',
    x,
    y,
    color: color || null,
    by: client.player.name,
  });
}

function sanitizeHexColor(value) {
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(v) ? v : null;
}

function loadPixelBoard() {
  try {
    if (!fs.existsSync(PIXEL_BOARD_STORE)) return {};
    const raw = fs.readFileSync(PIXEL_BOARD_STORE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const out = {};
    for (const [key, val] of Object.entries(parsed)) {
      if (!/^\d+,\d+$/.test(key)) continue;
      const [x, y] = key.split(',').map(Number);
      if (x < 0 || x >= PIXEL_BOARD_WIDTH) continue;
      if (y < 0 || y >= PIXEL_BOARD_HEIGHT) continue;
      const color = sanitizeHexColor(val);
      if (color) out[key] = color;
    }
    return out;
  } catch (err) {
    console.warn('No se pudo cargar la pizarra de píxeles:', err?.message || err);
    return {};
  }
}

function schedulePixelSave() {
  if (pixelSaveTimer) return;
  pixelSaveTimer = setTimeout(() => {
    pixelSaveTimer = null;
    try {
      fs.writeFileSync(PIXEL_BOARD_STORE, JSON.stringify(pixelBoardPixels), 'utf8');
    } catch (err) {
      console.warn('No se pudo guardar la pizarra de píxeles:', err?.message || err);
    }
  }, 500);
}

/** Identidad estable de una entrada del ranking (con fallback para entradas antiguas). */
function entryStableId(entry) {
  if (entry?.stableId) return entry.stableId;
  return bugHuntKey({ name: entry?.name, avatarId: entry?.avatarId });
}

/** Normaliza el ranking al cargar: dedupe por identidad estable dejando el mejor tiempo. */
function normalizeRanking(list) {
  if (!Array.isArray(list)) return [];
  const bestByKey = new Map();
  for (const entry of list) {
    if (!entry || !Number.isFinite(entry.timeMs)) continue;
    const key = entryStableId(entry);
    const prev = bestByKey.get(key);
    if (!prev || entry.timeMs < prev.timeMs) {
      bestByKey.set(key, { ...entry, stableId: key });
    }
  }
  return Array.from(bestByKey.values())
    .sort((a, b) => a.timeMs - b.timeMs)
    .slice(0, BUG_HUNT_RANKING_LIMIT);
}

/** Sanea un id estable (uuid, hex, alfanumérico razonable) enviado por el cliente. */
function sanitizeStableId(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  // Acepta uuid, hex o alfanumérico + guiones, máx 64 chars.
  if (!/^[A-Za-z0-9_\-:.]{1,64}$/.test(trimmed)) return null;
  return trimmed;
}

function bugHuntKey(entry) {
  const name = (entry?.name || '').trim().toLowerCase();
  const avatar = (entry?.avatarId || '').trim().toLowerCase();
  return `${name}::${avatar}`;
}

function todayIsoDate() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function loadBugHuntRanking() {
  try {
    if (!fs.existsSync(BUG_HUNT_STORE)) return [];
    const raw = fs.readFileSync(BUG_HUNT_STORE, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn('No se pudo cargar el ranking del bug hunt:', err?.message || err);
    return [];
  }
}

function saveBugHuntRanking() {
  try {
    fs.writeFileSync(BUG_HUNT_STORE, JSON.stringify(bugHuntRanking, null, 2), 'utf8');
  } catch (err) {
    console.warn('No se pudo guardar el ranking del bug hunt:', err?.message || err);
  }
}

function disconnectClient(client) {
  if (clients.get(client.id) !== client) {
    return;
  }
  clients.delete(client.id);

  const player = players.get(client.id);
  players.delete(client.id);

  // Limpieza del mini-juego del dino si el cliente estaba implicado.
  handleDinoClientGone(client.id);

  if (player) {
    broadcast({ type: 'player-left', id: player.id });
    pushSystemMessage(`${player.name} ha abandonado la oficina.`);
  }
}

// ============================================================
// Mini-juego multijugador "Caza al Dinosaurio"
// ============================================================

function serializeDinoGame() {
  if (!dinoGame) return null;
  const base = {
    id: dinoGame.id,
    phase: dinoGame.phase,
    creatorId: dinoGame.creatorId,
    creatorName: dinoGame.creatorName,
    creatorAvatar: dinoGame.creatorAvatar,
    participantIds: Array.from(dinoGame.participantIds),
    totalRounds: dinoGame.totalRounds,
    currentRound: dinoGame.currentRound,
    scoreboard: serializeScoreboard(dinoGame.scoreboard),
    roundHistory: dinoGame.roundHistory.slice(),
  };
  if (dinoGame.phase === 'lobby') {
    base.endsAt = dinoGame.endsAt;
  }
  if (dinoGame.phase === 'round') {
    base.x = dinoGame.x;
    base.y = dinoGame.y;
    base.startedAt = dinoGame.startedAt;
  }
  if (dinoGame.phase === 'inter-round') {
    base.x = dinoGame.x;
    base.y = dinoGame.y;
    base.lastRoundWinnerId = dinoGame.lastRoundWinnerId;
    base.lastRoundWinnerName = dinoGame.lastRoundWinnerName;
    base.lastRoundTimeMs = dinoGame.lastRoundTimeMs;
    base.nextRoundStartsAt = dinoGame.nextRoundStartsAt;
  }
  if (dinoGame.phase === 'done') {
    base.x = dinoGame.x;
    base.y = dinoGame.y;
    base.overallWinnerId = dinoGame.overallWinnerId;
    base.overallWinnerName = dinoGame.overallWinnerName;
    base.lastRoundWinnerId = dinoGame.lastRoundWinnerId;
    base.lastRoundWinnerName = dinoGame.lastRoundWinnerName;
    base.lastRoundTimeMs = dinoGame.lastRoundTimeMs;
  }
  return base;
}

function serializeScoreboard(scoreboardMap) {
  if (!scoreboardMap) return [];
  return Array.from(scoreboardMap.entries())
    .map(([id, info]) => ({
      id,
      name: info.name,
      avatar: info.avatar,
      wins: info.wins,
    }))
    .sort((a, b) => b.wins - a.wins || a.name.localeCompare(b.name));
}

function ensureScoreboardEntry(clientId) {
  if (!dinoGame) return null;
  const existing = dinoGame.scoreboard.get(clientId);
  if (existing) return existing;
  const player = players.get(clientId) || (clients.get(clientId) || {}).player;
  const entry = {
    name: player?.name || 'Jugador',
    avatar: player?.avatar || sanitizeAvatar(null),
    wins: 0,
  };
  dinoGame.scoreboard.set(clientId, entry);
  return entry;
}

function clearDinoTimers() {
  if (!dinoGame) return;
  if (dinoGame.lobbyTimer) {
    clearTimeout(dinoGame.lobbyTimer);
    dinoGame.lobbyTimer = null;
  }
  if (dinoGame.roundTimer) {
    clearTimeout(dinoGame.roundTimer);
    dinoGame.roundTimer = null;
  }
  if (dinoGame.endTimer) {
    clearTimeout(dinoGame.endTimer);
    dinoGame.endTimer = null;
  }
}

function resetDinoGame() {
  clearDinoTimers();
  dinoGame = null;
}

function handleDinoCreate(client, data) {
  if (!client.player) {
    send(client, { type: 'error', message: 'Necesitas un perfil para crear la partida.' });
    return;
  }
  if (dinoGame && dinoGame.phase !== 'done') {
    send(client, { type: 'error', message: 'Ya hay una partida activa. Únete o espera al resultado.' });
    return;
  }

  // Permite al creador elegir número de rondas (impar entre 1 y 9). Si no
  // se envía, usamos el valor por defecto de configuración.
  const requested = Number(data?.rounds);
  const totalRounds = Number.isInteger(requested) && requested >= 1 && requested <= 9
    ? requested
    : DINO_TOTAL_ROUNDS;

  const id = crypto.randomUUID();
  const participantIds = new Set([client.id]);
  const endsAt = Date.now() + DINO_LOBBY_MS;

  dinoGame = {
    id,
    phase: 'lobby',
    creatorId: client.id,
    creatorStableId: client.stableId || client.id,
    creatorName: client.player.name,
    creatorAvatar: client.player.avatar,
    participantIds,
    endsAt,
    totalRounds,
    currentRound: 0,
    x: 0,
    y: 0,
    startedAt: 0,
    lastRoundWinnerId: null,
    lastRoundWinnerName: null,
    lastRoundTimeMs: 0,
    nextRoundStartsAt: 0,
    scoreboard: new Map(),
    roundHistory: [],
    overallWinnerId: null,
    overallWinnerName: null,
    lobbyTimer: setTimeout(() => startDinoRound(id), DINO_LOBBY_MS),
    roundTimer: null,
    endTimer: null,
  };

  ensureScoreboardEntry(client.id);

  broadcast({
    type: 'dino-lobby-open',
    game: serializeDinoGame(),
  });
  pushSystemMessage(
    `🦕 ${client.player.name} ha creado una partida a ${totalRounds} rondas de Caza al Dinosaurio.`,
  );
}

function handleDinoJoin(client) {
  if (!client.player) return;
  if (!dinoGame || dinoGame.phase !== 'lobby') {
    send(client, { type: 'error', message: 'No hay ninguna partida abierta para unirse.' });
    return;
  }
  if (dinoGame.participantIds.has(client.id)) return;

  dinoGame.participantIds.add(client.id);
  ensureScoreboardEntry(client.id);
  broadcast({
    type: 'dino-lobby-update',
    game: serializeDinoGame(),
  });
}

function handleDinoStart(client) {
  if (!dinoGame || dinoGame.phase !== 'lobby') return;
  if (dinoGame.creatorId !== client.id) {
    send(client, { type: 'error', message: 'Sólo el creador puede empezar la partida.' });
    return;
  }
  startDinoRound(dinoGame.id);
}

function handleDinoCancel(client) {
  if (!dinoGame || dinoGame.phase === 'done') return;
  if (dinoGame.creatorId !== client.id) return;
  cancelDinoGame('El creador ha cancelado la partida.');
}

function handleDinoCatch(client, data) {
  if (!dinoGame || dinoGame.phase !== 'round') return;
  if (!dinoGame.participantIds.has(client.id)) {
    send(client, { type: 'error', message: 'Eres espectador en esta partida.' });
    return;
  }
  if (dinoGame.lastRoundWinnerId && dinoGame.phase !== 'round') return;

  const rawId = typeof data?.gameId === 'string' ? data.gameId : null;
  if (rawId && rawId !== dinoGame.id) return;

  const now = Date.now();
  const timeMs = Math.max(0, now - dinoGame.startedAt);
  const winnerName = client.player?.name || 'Jugador';

  // Guarda el ganador de esta ronda y actualiza el marcador.
  dinoGame.lastRoundWinnerId = client.id;
  dinoGame.lastRoundWinnerName = winnerName;
  dinoGame.lastRoundTimeMs = timeMs;
  dinoGame.roundHistory.push({
    round: dinoGame.currentRound,
    winnerId: client.id,
    winnerName,
    timeMs,
  });
  const scoreEntry = ensureScoreboardEntry(client.id);
  if (scoreEntry) scoreEntry.wins += 1;

  clearDinoTimers();

  const isLastRound = dinoGame.currentRound >= dinoGame.totalRounds;
  if (isLastRound) {
    finishDinoGame();
  } else {
    // Fase intermedia: se muestra el ganador de la ronda y arranca la siguiente.
    dinoGame.phase = 'inter-round';
    dinoGame.nextRoundStartsAt = now + DINO_INTER_ROUND_MS;

    broadcast({
      type: 'dino-round-end',
      game: serializeDinoGame(),
    });
    pushSystemMessage(
      `🎯 Ronda ${dinoGame.currentRound}/${dinoGame.totalRounds}: ` +
      `${winnerName} atrapó al dinosaurio en ${(timeMs / 1000).toFixed(2)} s.`,
    );

    const gameId = dinoGame.id;
    dinoGame.roundTimer = setTimeout(() => startDinoRound(gameId), DINO_INTER_ROUND_MS);
  }
}

function startDinoRound(gameId) {
  if (!dinoGame || dinoGame.id !== gameId) return;
  if (dinoGame.phase !== 'lobby' && dinoGame.phase !== 'inter-round') return;

  // Si el creador se quedó solo antes de empezar, cancelamos.
  if (dinoGame.phase === 'lobby' && dinoGame.participantIds.size === 0) {
    cancelDinoGame('Nadie se unió a la partida.');
    return;
  }
  if (dinoGame.participantIds.size === 0) {
    cancelDinoGame('Todos los participantes se han desconectado.');
    return;
  }

  clearDinoTimers();

  // Asegura que el marcador tiene entrada para cada participante actual
  // (por si alguno se unió tras el lobby-open).
  for (const pid of dinoGame.participantIds) ensureScoreboardEntry(pid);

  const minX = DINO_PADDING;
  const maxX = OFFICE_WIDTH - DINO_PADDING;
  const minY = DINO_PADDING;
  const maxY = OFFICE_HEIGHT - DINO_PADDING;
  dinoGame.x = Math.round(minX + Math.random() * (maxX - minX));
  dinoGame.y = Math.round(minY + Math.random() * (maxY - minY));
  dinoGame.startedAt = Date.now();
  dinoGame.phase = 'round';
  dinoGame.currentRound += 1;
  dinoGame.lastRoundWinnerId = null;
  dinoGame.lastRoundWinnerName = null;
  dinoGame.lastRoundTimeMs = 0;
  dinoGame.nextRoundStartsAt = 0;

  broadcast({
    type: 'dino-round-start',
    game: serializeDinoGame(),
  });
}

function finishDinoGame() {
  if (!dinoGame) return;
  clearDinoTimers();
  dinoGame.phase = 'done';

  // Ganador global: mayor número de victorias. Empate → primer alfabético.
  const board = serializeScoreboard(dinoGame.scoreboard);
  const overall = board[0];
  dinoGame.overallWinnerId = overall?.id || null;
  dinoGame.overallWinnerName = overall?.name || null;

  broadcast({
    type: 'dino-round-end',
    game: serializeDinoGame(),
  });

  const summary = board.length
    ? board.slice(0, 3).map(e => `${e.name} (${e.wins})`).join(', ')
    : 'sin ganadores';
  pushSystemMessage(
    `🏆 Fin de la partida. Ganador: ${dinoGame.overallWinnerName || '—'}. Marcador: ${summary}.`,
  );

  const finishedGameId = dinoGame.id;
  dinoGame.endTimer = setTimeout(() => {
    if (dinoGame && dinoGame.id === finishedGameId) {
      resetDinoGame();
      broadcast({ type: 'dino-cleared' });
    }
  }, DINO_RESULT_LINGER_MS);
}

function cancelDinoGame(reason) {
  if (!dinoGame) return;
  clearDinoTimers();
  const message = reason || 'La partida ha sido cancelada.';
  dinoGame = null;
  broadcast({ type: 'dino-cancelled', reason: message });
  pushSystemMessage(`🦕 ${message}`);
}

function handleDinoClientGone(clientId) {
  if (!dinoGame) return;
  const wasParticipant = dinoGame.participantIds.delete(clientId);
  if (dinoGame.creatorId === clientId) {
    cancelDinoGame('El creador se ha desconectado.');
    return;
  }
  if (wasParticipant && dinoGame.phase === 'lobby') {
    broadcast({ type: 'dino-lobby-update', game: serializeDinoGame() });
  }
  if (wasParticipant && dinoGame.phase !== 'lobby' && dinoGame.participantIds.size === 0) {
    cancelDinoGame('Todos los participantes se han desconectado.');
  }
}

function broadcast(message, excludeId) {
  const payload = JSON.stringify(message);
  for (const [id, client] of clients.entries()) {
    if (excludeId && id === excludeId) {
      continue;
    }
    sendRaw(client, payload);
  }
}

function send(client, message) {
  sendRaw(client, JSON.stringify(message));
}

function sendRaw(client, payload) {
  if (!client?.socket || client.socket.destroyed) {
    return;
  }

  try {
    client.socket.write(createFrame(Buffer.from(payload)));
  } catch (error) {
    console.error('No se pudo enviar mensaje al cliente', error);
  }
}

function pushSystemMessage(content) {
  const message = {
    id: crypto.randomUUID(),
    authorId: 'system',
    authorName: 'Sistema',
    avatar: { id: 'system', emoji: '✨', tone: 'amethyst', label: 'Sistema' },
    content,
    createdAt: new Date().toISOString(),
    system: true,
  };

  generalMessages.push(message);
  if (generalMessages.length > GENERAL_HISTORY_LIMIT) {
    generalMessages.shift();
  }

  broadcast({ type: 'general-message', message });
}

function sanitizeName(value) {
  if (typeof value !== 'string') {
    return 'Invitado';
  }
  const trimmed = value.trim().slice(0, 48);
  return trimmed || 'Invitado';
}

function sanitizeAvatar(value) {
  if (!value || typeof value !== 'object') {
    return { id: 'pilot', emoji: '🧑‍🚀', tone: 'sky', label: 'Piloto' };
  }
  const tone = sanitizeTone(value.tone);
  return {
    id: typeof value.id === 'string' ? value.id.slice(0, 32) : 'pilot',
    emoji: typeof value.emoji === 'string' ? value.emoji.slice(0, 4) : '🧑‍🚀',
    tone,
    label: typeof value.label === 'string' ? value.label.slice(0, 48) : 'Compañero virtual',
  };
}

function sanitizeTone(value) {
  const tones = new Set(['sky', 'sunset', 'forest', 'amethyst', 'ocean', 'ember']);
  return tones.has(value) ? value : 'sky';
}

function sanitizeMessage(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim().slice(0, 500);
}

function sanitizePosition(value) {
  const direction = sanitizeDirection(value?.direction);
  const minX = EDGE_PADDING;
  const maxX = OFFICE_WIDTH - EDGE_PADDING;
  const minY = EDGE_PADDING;
  const maxY = OFFICE_HEIGHT - EDGE_PADDING;
  const x = clampNumber(value?.x, OFFICE_WIDTH / 2, minX, maxX);
  const y = clampNumber(value?.y, OFFICE_HEIGHT / 2, minY, maxY);
  return { x, y, direction };
}

function sanitizeId(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 64) : null;
}

function sanitizeDirection(value) {
  const valid = new Set(['up', 'down', 'left', 'right']);
  return valid.has(value) ? value : 'down';
}

function clampNumber(value, fallback, min, max) {
  const num = typeof value === 'number' ? value : fallback;
  if (Number.isNaN(num)) {
    return fallback;
  }
  const minBound = Math.min(min, max);
  const maxBound = Math.max(min, max);
  if (!Number.isFinite(minBound) || !Number.isFinite(maxBound)) {
    return fallback;
  }
  return Math.max(minBound, Math.min(maxBound, num));
}

function createWebSocketAccept(key) {
  return crypto
    .createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11', 'binary')
    .digest('base64');
}

function readFrame(buffer) {
  if (buffer.length < 2) {
    return null;
  }

  const byte1 = buffer[0];
  const byte2 = buffer[1];
  const opcode = byte1 & 0x0f;
  let offset = 2;
  let payloadLength = byte2 & 0x7f;

  if (payloadLength === 126) {
    if (buffer.length < offset + 2) {
      return null;
    }
    payloadLength = buffer.readUInt16BE(offset);
    offset += 2;
  } else if (payloadLength === 127) {
    if (buffer.length < offset + 8) {
      return null;
    }
    const high = buffer.readUInt32BE(offset);
    const low = buffer.readUInt32BE(offset + 4);
    payloadLength = high * 2 ** 32 + low;
    offset += 8;
  }

  const isMasked = (byte2 & 0x80) === 0x80;
  let maskingKey;
  if (isMasked) {
    if (buffer.length < offset + 4) {
      return null;
    }
    maskingKey = buffer.subarray(offset, offset + 4);
    offset += 4;
  }

  if (buffer.length < offset + payloadLength) {
    return null;
  }

  let payload = buffer.subarray(offset, offset + payloadLength);

  if (isMasked && maskingKey) {
    payload = unmask(payload, maskingKey);
  }

  const remaining = buffer.subarray(offset + payloadLength);
  return { frame: { opcode, payload }, remaining };
}

function unmask(payload, mask) {
  const result = Buffer.alloc(payload.length);
  for (let i = 0; i < payload.length; i += 1) {
    result[i] = payload[i] ^ mask[i % 4];
  }
  return result;
}

function createFrame(payload, opcode = 0x1) {
  const length = payload.length;
  let header;

  if (length < 126) {
    header = Buffer.from([0x80 | opcode, length]);
  } else if (length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    const high = Math.floor(length / 2 ** 32);
    const low = length >>> 0;
    header.writeUInt32BE(high, 2);
    header.writeUInt32BE(low, 6);
  }

  return Buffer.concat([header, payload]);
}

module.exports = { server };
