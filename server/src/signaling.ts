import type { Server, Socket } from 'socket.io';
import {
  canSignal,
  createRoom,
  getRoomOfSocket,
  joinRoom,
  leaveRoom,
  listPeers,
  newMessageId,
  setSharing,
  type JoinError,
} from './rooms.js';
import { loadRecentMessages, persistMessage, touchRoom } from './store.js';
import {
  MAX_CHAT_LENGTH,
  type ChatMessage,
  type ClientToServerEvents,
  type ServerToClientEvents,
} from './types.js';

export type IoServer = Server<ClientToServerEvents, ServerToClientEvents>;
export type IoSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

const JOIN_ERROR_MESSAGES: Record<JoinError, string> = {
  room_not_found: 'Sala nao encontrada ou ja encerrada.',
  room_full: 'Esta sala atingiu o limite de participantes.',
  already_joined: 'Esta conexao ja esta em uma sala.',
};

/** Balde de tokens por socket: ate 5 mensagens, recarregando 1 a cada 600ms. */
const CHAT_BURST = 5;
const CHAT_REFILL_MS = 600;
const chatBuckets = new Map<string, { tokens: number; lastRefill: number }>();

function consumeChatToken(socketId: string): boolean {
  const now = Date.now();
  const bucket = chatBuckets.get(socketId) ?? { tokens: CHAT_BURST, lastRefill: now };
  const refilled = Math.floor((now - bucket.lastRefill) / CHAT_REFILL_MS);
  if (refilled > 0) {
    bucket.tokens = Math.min(CHAT_BURST, bucket.tokens + refilled);
    bucket.lastRefill = now;
  }
  if (bucket.tokens <= 0) {
    chatBuckets.set(socketId, bucket);
    return false;
  }
  bucket.tokens -= 1;
  chatBuckets.set(socketId, bucket);
  return true;
}

export function registerSignaling(io: IoServer, socket: IoSocket): void {
  socket.on('room:create', (ack) => {
    if (typeof ack !== 'function') return;
    void createRoom().then((room) => ack({ ok: true, data: { roomId: room.id } }));
  });

  socket.on('room:join', async (payload, ack) => {
    if (typeof ack !== 'function') return;
    const roomId = String(payload?.roomId ?? '').trim().toUpperCase();
    const displayName = String(payload?.displayName ?? '').trim();

    const result = await joinRoom(roomId, socket.id, displayName);
    if ('error' in result) {
      ack({ ok: false, error: JOIN_ERROR_MESSAGES[result.error] });
      return;
    }

    const { room, participant } = result;
    void socket.join(room.id);
    socket.to(room.id).emit('peer:joined', {
      id: participant.id,
      displayName: participant.displayName,
      role: participant.role,
    });

    // O historico chega junto do ack: quem entra atrasado (ou reabre uma sala
    // antiga) ja recebe a conversa antes do primeiro render do chat.
    const history = await loadRecentMessages(room.id);
    void touchRoom(room.id);

    ack({
      ok: true,
      data: {
        selfId: socket.id,
        roomId: room.id,
        role: participant.role,
        peers: listPeers(room, socket.id),
        sharing: room.sharing,
        history,
      },
    });
  });

  socket.on('share:state', ({ sharing }) => {
    const room = setSharing(socket.id, Boolean(sharing));
    if (!room) return; // apenas o host anuncia estado de transmissao
    socket.to(room.id).emit('share:state', { sharing: room.sharing });
  });

  socket.on('signal:offer', ({ to, sdp }) => {
    if (!canSignal(socket.id, to)) return;
    io.to(to).emit('signal:offer', { from: socket.id, sdp });
  });

  socket.on('signal:answer', ({ to, sdp }) => {
    if (!canSignal(socket.id, to)) return;
    io.to(to).emit('signal:answer', { from: socket.id, sdp });
  });

  socket.on('signal:ice', ({ to, candidate }) => {
    if (!canSignal(socket.id, to)) return;
    io.to(to).emit('signal:ice', { from: socket.id, candidate });
  });

  socket.on('chat:message', ({ text }) => {
    const room = getRoomOfSocket(socket.id);
    if (!room) return;
    const participant = room.participants.get(socket.id);
    if (!participant) return;

    const trimmed = String(text ?? '').trim().slice(0, MAX_CHAT_LENGTH);
    if (!trimmed) return;
    if (!consumeChatToken(socket.id)) return;

    const message: ChatMessage = {
      id: newMessageId(),
      from: socket.id,
      displayName: participant.displayName,
      text: trimmed,
      ts: Date.now(),
    };

    // Entrega primeiro, grava depois: a latencia do chat nao deve depender do
    // banco, e uma escrita perdida custa menos que uma mensagem atrasada.
    io.to(room.id).emit('chat:message', message);
    void persistMessage(room.id, message);
  });

  socket.on('room:leave', () => {
    handleDeparture(io, socket);
  });

  socket.on('disconnect', () => {
    handleDeparture(io, socket);
    chatBuckets.delete(socket.id);
  });
}

function handleDeparture(io: IoServer, socket: IoSocket): void {
  const outcome = leaveRoom(socket.id);
  if (!outcome) return;

  const { room, roomClosed } = outcome;
  if (roomClosed) {
    // O host saiu: sem fonte de midia a sala nao faz sentido, entao encerra.
    io.to(room.id).emit('room:closed', { reason: 'O host encerrou a transmissao.' });
    io.socketsLeave(room.id);
  } else {
    socket.to(room.id).emit('peer:left', { peerId: socket.id });
  }
  void socket.leave(room.id);
}
