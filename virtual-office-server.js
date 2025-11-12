const http = require('http');
const crypto = require('crypto');

// Configuración del servidor - Compatible con servicios cloud
const PORT = process.env.PORT || process.env.VIRTUAL_OFFICE_PORT || 8974;
const HOST = process.env.HOST || '0.0.0.0';
const OFFICE_WIDTH = Number(process.env.VIRTUAL_OFFICE_WIDTH || 960);
const OFFICE_HEIGHT = Number(process.env.VIRTUAL_OFFICE_HEIGHT || 560);
const EDGE_PADDING = Number(process.env.VIRTUAL_OFFICE_PADDING || 48);
const GENERAL_HISTORY_LIMIT = Number(process.env.VIRTUAL_OFFICE_HISTORY || 150);

const clients = new Map(); // id -> Client
const players = new Map(); // id -> Player state
const generalMessages = [];

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
    default:
      send(client, { type: 'error', message: 'Acción no soportada.' });
  }
}

function handleHello(client, data) {
  const name = sanitizeName(data.name);
  const avatar = sanitizeAvatar(data.avatar);
  const position = sanitizePosition(data.position);

  const player = {
    id: client.id,
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

function disconnectClient(client) {
  if (clients.get(client.id) !== client) {
    return;
  }
  clients.delete(client.id);

  const player = players.get(client.id);
  players.delete(client.id);

  if (player) {
    broadcast({ type: 'player-left', id: player.id });
    pushSystemMessage(`${player.name} ha abandonado la oficina.`);
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
