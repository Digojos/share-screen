/**
 * Contrato de eventos entre cliente e servidor.
 *
 * Este arquivo e a unica fonte da verdade: o pacote `web` o importa via o alias
 * `@shared` (ver web/vite.config.ts e web/tsconfig.json). Por isso ele NAO pode
 * depender da lib "dom" nem de nada especifico de Node — apenas tipos puros.
 */

export type Role = 'host' | 'viewer';

export interface PeerInfo {
  id: string;
  displayName: string;
  role: Role;
}

export interface ChatMessage {
  id: string;
  from: string;
  displayName: string;
  text: string;
  ts: number;
}

/** Espelha RTCSessionDescriptionInit sem exigir a lib "dom" no servidor. */
export interface SessionDescription {
  type: 'offer' | 'answer' | 'pranswer' | 'rollback';
  sdp?: string;
}

/** Espelha RTCIceCandidateInit sem exigir a lib "dom" no servidor. */
export interface IceCandidate {
  candidate: string;
  sdpMid: string | null;
  sdpMLineIndex: number | null;
  usernameFragment?: string | null;
}

export type AckResult<T> = { ok: true; data: T } | { ok: false; error: string };
export type Ack<T> = (result: AckResult<T>) => void;

export interface JoinResult {
  selfId: string;
  role: Role;
  roomId: string;
  peers: PeerInfo[];
  sharing: boolean;
  /**
   * Identidade que sobrevive a troca de socket. Guardada pelo cliente e
   * reenviada no join seguinte para retomar o papel apos uma reconexao.
   */
  sessionToken: string;
  /** true quando este join retomou uma sessao anterior em vez de criar uma nova. */
  reclaimed: boolean;
  /** Mensagens anteriores da sala. Vazio quando nao ha banco configurado. */
  history: ChatMessage[];
}

export interface ServerToClientEvents {
  'peer:joined': (peer: PeerInfo) => void;
  'peer:left': (payload: { peerId: string }) => void;
  'room:closed': (payload: { reason: string }) => void;
  /** O host caiu; a sala aguarda o retorno dele por `graceSeconds`. */
  'host:left': (payload: { graceSeconds: number }) => void;
  'share:state': (payload: { sharing: boolean }) => void;
  'signal:offer': (payload: { from: string; sdp: SessionDescription }) => void;
  'signal:answer': (payload: { from: string; sdp: SessionDescription }) => void;
  'signal:ice': (payload: { from: string; candidate: IceCandidate }) => void;
  'chat:message': (message: ChatMessage) => void;
}

export interface ClientToServerEvents {
  'room:create': (ack: Ack<{ roomId: string }>) => void;
  'room:join': (
    payload: { roomId: string; displayName: string; token?: string },
    ack: Ack<JoinResult>,
  ) => void;
  'room:leave': () => void;
  'share:state': (payload: { sharing: boolean }) => void;
  'signal:offer': (payload: { to: string; sdp: SessionDescription }) => void;
  'signal:answer': (payload: { to: string; sdp: SessionDescription }) => void;
  'signal:ice': (payload: { to: string; candidate: IceCandidate }) => void;
  'chat:message': (payload: { text: string }) => void;
}

export interface IceConfigResponse {
  iceServers: Array<{ urls: string | string[]; username?: string; credential?: string }>;
  /** false quando nao ha TURN configurado — conexoes entre NATs restritivos vao falhar. */
  hasTurn: boolean;
}

/** Alfabeto sem caracteres ambiguos (0/O, 1/I/L) para codigos ditados por voz. */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 6;
export const MAX_CHAT_LENGTH = 1000;
