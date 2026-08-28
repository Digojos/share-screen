import { io, type Socket } from 'socket.io-client';
import type {
  AckResult,
  ClientToServerEvents,
  IceConfigResponse,
  JoinResult,
  ServerToClientEvents,
} from '@shared';

export type SignalingSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const SIGNALING_URL = import.meta.env.VITE_SIGNALING_URL ?? 'http://localhost:3001';

export function connectSignaling(): SignalingSocket {
  return io(SIGNALING_URL, {
    transports: ['websocket'],
    autoConnect: true,
  });
}

/** Envolve o ack do socket.io numa Promise que rejeita com a mensagem do servidor. */
function ackToPromise<T>(resolve: (value: T) => void, reject: (reason: Error) => void) {
  return (result: AckResult<T>) => {
    if (result.ok) resolve(result.data);
    else reject(new Error(result.error));
  };
}

export function createRoom(socket: SignalingSocket): Promise<{ roomId: string }> {
  return new Promise((resolve, reject) => {
    socket.emit('room:create', ackToPromise(resolve, reject));
  });
}

export function joinRoom(
  socket: SignalingSocket,
  roomId: string,
  displayName: string,
  token?: string,
): Promise<JoinResult> {
  return new Promise((resolve, reject) => {
    socket.emit('room:join', { roomId, displayName, token }, ackToPromise(resolve, reject));
  });
}

/**
 * Busca a configuracao de ICE (STUN + credencial TURN efemera). Se falhar,
 * cai num STUN publico: ainda funciona na mesma rede, o que ajuda a diagnosticar.
 */
export async function fetchIceConfig(roomId: string): Promise<IceConfigResponse> {
  try {
    const response = await fetch(`${SIGNALING_URL}/api/ice?room=${encodeURIComponent(roomId)}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return (await response.json()) as IceConfigResponse;
  } catch (error) {
    console.warn('[ice] falha ao buscar configuracao, usando STUN publico', error);
    return { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }], hasTurn: false };
  }
}
