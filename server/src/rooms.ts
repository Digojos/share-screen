import { randomInt, randomUUID } from 'node:crypto';
import { persistRoom, roomExists } from './store.js';
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, type PeerInfo, type Role } from './types.js';

export interface Participant extends PeerInfo {
  joinedAt: number;
  /** Identidade que sobrevive a troca de socket numa reconexao. */
  sessionToken: string;
}

export interface Room {
  id: string;
  hostId: string | null;
  sharing: boolean;
  createdAt: number;
  participants: Map<string, Participant>;
  /** Timer de carencia ativo enquanto a sala espera o host voltar. */
  closeTimer: NodeJS.Timeout | null;
}

/** Host + espectadores. Acima disso o upload do host satura numa topologia mesh. */
const MAX_PARTICIPANTS = Number(process.env.MAX_PARTICIPANTS ?? 6);
/** Salas criadas mas nunca ocupadas sao varridas depois disso. */
const EMPTY_ROOM_TTL_MS = 5 * 60 * 1000;
/** Quanto tempo a sala aguarda o host voltar antes de encerrar. */
export const HOST_GRACE_SECONDS = Number(process.env.HOST_GRACE_SECONDS ?? 60);

const rooms = new Map<string, Room>();
/** socketId -> roomId, para resolver o `disconnect` sem varrer todas as salas. */
const socketToRoom = new Map<string, string>();
/**
 * token -> sala e papel. Sobrevive a saida do participante de proposito: e o
 * que permite reconhecer quem volta durante a carencia, ja que o socket id
 * muda a cada reconexao.
 */
const tokenIndex = new Map<string, { roomId: string; role: Role }>();

function generateCode(): string {
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i += 1) {
    code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
  }
  return code;
}

function blankRoom(id: string): Room {
  return {
    id,
    hostId: null,
    sharing: false,
    createdAt: Date.now(),
    participants: new Map(),
    closeTimer: null,
  };
}

export async function createRoom(): Promise<Room> {
  // O codigo precisa ser inedito tambem contra salas persistidas que nao estao
  // ativas no momento, senao um codigo novo herdaria o historico de outra sala.
  let id = generateCode();
  while (rooms.has(id) || (await roomExists(id))) id = generateCode();

  const room = blankRoom(id);
  rooms.set(id, room);
  await persistRoom(id);
  return room;
}

export function getRoom(roomId: string): Room | undefined {
  return rooms.get(roomId.toUpperCase());
}

export function getRoomOfSocket(socketId: string): Room | undefined {
  const roomId = socketToRoom.get(socketId);
  return roomId ? rooms.get(roomId) : undefined;
}

export type JoinError = 'room_not_found' | 'room_full' | 'already_joined';

export async function joinRoom(
  roomId: string,
  socketId: string,
  displayName: string,
  token?: string,
): Promise<{ room: Room; participant: Participant; reclaimed: boolean } | { error: JoinError }> {
  const code = roomId.toUpperCase();
  let room = rooms.get(code);

  // A sala pode estar apenas dormindo: o host saiu e a sessao ao vivo acabou,
  // mas o registro (e o historico) continuam no banco. Quem entra agora a
  // reativa e assume como host.
  if (!room && (await roomExists(code))) {
    room = blankRoom(code);
    rooms.set(code, room);
  }

  if (!room) return { error: 'room_not_found' };
  if (socketToRoom.has(socketId)) return { error: 'already_joined' };

  // Quem volta com token valido retoma seu papel. So vale se o papel ainda
  // estiver disponivel: se outra pessoa ja virou host nesse meio tempo, o
  // retorno entra como espectador em vez de disputar a posse.
  const anterior = token ? tokenIndex.get(token) : undefined;
  const podeRetomar = anterior?.roomId === room.id && (anterior.role === 'viewer' || room.hostId === null);
  const reclaimed = Boolean(podeRetomar);

  if (!reclaimed && room.participants.size >= MAX_PARTICIPANTS) {
    return { error: 'room_full' };
  }

  // O primeiro a entrar vira host; os demais entram como espectadores.
  const role: Role = reclaimed && anterior ? anterior.role : room.hostId === null ? 'host' : 'viewer';
  const sessionToken = reclaimed && token ? token : randomUUID();

  const participant: Participant = {
    id: socketId,
    displayName: displayName.slice(0, 40) || 'Anonimo',
    role,
    joinedAt: Date.now(),
    sessionToken,
  };

  room.participants.set(socketId, participant);
  if (role === 'host') {
    room.hostId = socketId;
    cancelCloseTimer(room);
  }
  socketToRoom.set(socketId, room.id);
  tokenIndex.set(sessionToken, { roomId: room.id, role });

  return { room, participant, reclaimed };
}

export function cancelCloseTimer(room: Room): void {
  if (!room.closeTimer) return;
  clearTimeout(room.closeTimer);
  room.closeTimer = null;
}

/** Encerra a sala de vez: participantes, indices e registro em memoria. */
export function destroyRoom(room: Room): void {
  cancelCloseTimer(room);
  for (const participant of room.participants.values()) {
    socketToRoom.delete(participant.id);
    tokenIndex.delete(participant.sessionToken);
  }
  room.participants.clear();
  rooms.delete(room.id);
}

export interface LeaveOutcome {
  room: Room;
  participant: Participant;
  /** true quando quem saiu era o host: a sala entra em carencia. */
  wasHost: boolean;
}

/**
 * Tira o participante da sala. A sala NAO e destruida aqui quando o host sai —
 * quem decide isso e o `signaling`, que controla o timer de carencia. O token
 * tambem sobrevive, para permitir a retomada.
 */
export function leaveRoom(socketId: string): LeaveOutcome | undefined {
  const room = getRoomOfSocket(socketId);
  if (!room) return undefined;

  const participant = room.participants.get(socketId);
  socketToRoom.delete(socketId);
  if (!participant) return undefined;

  room.participants.delete(socketId);
  const wasHost = room.hostId === socketId;
  if (wasHost) {
    room.hostId = null;
    room.sharing = false;
  }

  return { room, participant, wasHost };
}

export function setSharing(socketId: string, sharing: boolean): Room | undefined {
  const room = getRoomOfSocket(socketId);
  if (!room || room.hostId !== socketId) return undefined;
  room.sharing = sharing;
  return room;
}

/** Os dois lados de um sinal precisam estar na mesma sala. */
export function canSignal(fromSocketId: string, toSocketId: string): boolean {
  const room = getRoomOfSocket(fromSocketId);
  return room !== undefined && room.participants.has(toSocketId);
}

export function listPeers(room: Room, exceptSocketId: string): PeerInfo[] {
  return [...room.participants.values()]
    .filter((p) => p.id !== exceptSocketId)
    .map(({ id, displayName, role }) => ({ id, displayName, role }));
}

export function newMessageId(): string {
  return randomUUID();
}

/** Remove salas criadas por engano (ou por bots) que nunca receberam ninguem. */
export function sweepEmptyRooms(now = Date.now()): number {
  let removed = 0;
  for (const room of [...rooms.values()]) {
    // Salas em carencia tem timer proprio e nao devem ser varridas aqui.
    if (room.closeTimer) continue;
    if (room.participants.size === 0 && now - room.createdAt > EMPTY_ROOM_TTL_MS) {
      destroyRoom(room);
      removed += 1;
    }
  }
  return removed;
}

export function stats(): { rooms: number; participants: number } {
  let participants = 0;
  for (const room of rooms.values()) participants += room.participants.size;
  return { rooms: rooms.size, participants };
}

export { MAX_PARTICIPANTS };
