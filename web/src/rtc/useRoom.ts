import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChatMessage, PeerInfo, Role } from '@shared';
import {
  EMPTY_MEDIA,
  PeerManager,
  type InboundVideoStats,
  type LocalMedia,
  type OutboundVideoStats,
  type PeerConnectionState,
} from './PeerManager';
import { connectSignaling, fetchIceConfig, joinRoom, type SignalingSocket } from './signaling';
import { loadSessionToken, saveSessionToken } from '../session';
import type { CodecOption, VideoProfile } from './videoProfiles';

export type RoomStatus = 'connecting' | 'joined' | 'reconnecting' | 'error' | 'closed';

export interface RemotePeer extends PeerInfo {
  connection: PeerConnectionState;
}

export interface RoomSession {
  status: RoomStatus;
  error: string | null;
  role: Role | null;
  selfId: string | null;
  peers: RemotePeer[];
  messages: ChatMessage[];
  /** Stream de video recebido do host (null para o proprio host). */
  remoteStream: MediaStream | null;
  /** Audio dos demais participantes, por peer, para o chat de voz. */
  voiceStreams: Array<{ peerId: string; stream: MediaStream }>;
  /** O host esta transmitindo neste momento? */
  hostSharing: boolean;
  /** Segundos de carencia enquanto o host esta fora; null quando ele esta presente. */
  hostAwaySeconds: number | null;
  hasTurn: boolean;
  /** Diagnostico do video recebido; null enquanto nada chega. */
  videoStats: InboundVideoStats | null;
  /** Diagnostico do video enviado (apenas host); explica quedas de qualidade. */
  outboundStats: OutboundVideoStats | null;
  sendChat: (text: string) => void;
  publishMedia: (media: LocalMedia) => void;
  setVideoProfile: (profile: VideoProfile) => void;
  setCodec: (codec: CodecOption) => void;
}

/**
 * Teto de mensagens em memoria.
 *
 * A lista nao e virtualizada: cada mensagem nova re-renderiza todas. Numa
 * sessao longa isso cresce sem limite e passa a competir com o codificador —
 * que e o recurso escasso aqui. Duzentas cobrem qualquer conversa util na tela.
 */
const LIMITE_DE_MENSAGENS = 200;

function limitarMensagens(mensagens: ChatMessage[]): ChatMessage[] {
  return mensagens.length > LIMITE_DE_MENSAGENS
    ? mensagens.slice(mensagens.length - LIMITE_DE_MENSAGENS)
    : mensagens;
}

/** Une historico e mensagens ja em tela, sem repetir nem perder nada. */
function mesclarMensagens(anteriores: ChatMessage[], historico: ChatMessage[]): ChatMessage[] {
  if (historico.length === 0) return anteriores;
  const porId = new Map(historico.map((m) => [m.id, m]));
  for (const mensagem of anteriores) porId.set(mensagem.id, mensagem);
  return [...porId.values()].sort((a, b) => a.ts - b.ts);
}

/**
 * Orquestra a sessao de sala: socket de sinalizacao, conexoes WebRTC, lista de
 * participantes e chat.
 *
 * A montagem da sessao roda a cada `connect`, e nao uma unica vez, porque o
 * socket reconecta sozinho apos uma queda de rede — e com um id novo, o que
 * invalida todas as RTCPeerConnection anteriores. Os listeners de sala, por
 * outro lado, sao registrados uma vez so: registra-los junto da montagem
 * empilharia duplicatas a cada reconexao, e o sintoma (mensagem de chat
 * aparecendo duas vezes) e facil de nao perceber.
 */
export function useRoom(roomId: string, displayName: string): RoomSession {
  const [status, setStatus] = useState<RoomStatus>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [selfId, setSelfId] = useState<string | null>(null);
  const [peers, setPeers] = useState<RemotePeer[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map());
  const [hostSharing, setHostSharing] = useState(false);
  const [hostAwaySeconds, setHostAwaySeconds] = useState<number | null>(null);
  const [hasTurn, setHasTurn] = useState(true);
  const [videoStats, setVideoStats] = useState<InboundVideoStats | null>(null);
  const [outboundStats, setOutboundStats] = useState<OutboundVideoStats | null>(null);

  const socketRef = useRef<SignalingSocket | null>(null);
  const managerRef = useRef<PeerManager | null>(null);
  /** Guarda a midia caso ela seja publicada antes do join terminar. */
  const pendingMediaRef = useRef<LocalMedia>(EMPTY_MEDIA);
  /** O perfil escolhido precisa sobreviver a troca de PeerManager na reconexao. */
  const profileRef = useRef<VideoProfile | null>(null);
  /** Como o perfil, o codec precisa sobreviver a troca de PeerManager. */
  const codecRef = useRef<CodecOption | null>(null);
  /** Distingue "nunca conectou" (erro) de "caiu e esta voltando" (reconexao). */
  const joinedOnceRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const socket = connectSignaling();
    socketRef.current = socket;

    /**
     * Entra na sala e reconstroi a malha. Roda na primeira conexao e em cada
     * reconexao — os peers antigos morreram junto com o socket id anterior.
     */
    async function setupSession(): Promise<void> {
      managerRef.current?.close();
      managerRef.current = null;
      setRemoteStreams(new Map());

      const iceConfig = await fetchIceConfig(roomId);
      if (cancelled) return;
      setHasTurn(iceConfig.hasTurn);

      let joined;
      try {
        joined = await joinRoom(socket, roomId, displayName, loadSessionToken(roomId));
      } catch (joinError) {
        if (cancelled) return;
        setStatus('error');
        setError(joinError instanceof Error ? joinError.message : 'Falha ao entrar na sala.');
        return;
      }
      if (cancelled) return;

      saveSessionToken(roomId, joined.sessionToken);

      const manager = new PeerManager(joined.selfId, iceConfig.iceServers, {
        onOffer: (to, sdp) => socket.emit('signal:offer', { to, sdp }),
        onAnswer: (to, sdp) => socket.emit('signal:answer', { to, sdp }),
        onIceCandidate: (to, candidate) => socket.emit('signal:ice', { to, candidate }),
        onRemoteStream: (peerId, stream) =>
          setRemoteStreams((prev) => new Map(prev).set(peerId, stream)),
        onStateChange: (peerId, connection) => {
          setPeers((prev) => prev.map((p) => (p.id === peerId ? { ...p, connection } : p)));
        },
      });
      managerRef.current = manager;
      joinedOnceRef.current = true;

      setSelfId(joined.selfId);
      setRole(joined.role);
      setHostSharing(joined.sharing);
      setHostAwaySeconds(null);
      setPeers(joined.peers.map((peer) => ({ ...peer, connection: 'new' })));
      // O historico e MESCLADO, nunca substituido: numa reconexao ele vem vazio
      // (sem banco) ou truncado no limite do servidor, e trocar a lista apagaria
      // a conversa que a pessoa esta lendo.
      setMessages((anteriores) => limitarMensagens(mesclarMensagens(anteriores, joined.history)));
      setError(null);
      setStatus('joined');

      // Perfil e midia sobrevivem a reconexao: numa oscilacao curta a pagina
      // nao recarregou, entao a captura de tela continua viva e a transmissao
      // volta sozinha, sem novo seletor.
      if (profileRef.current) manager.setVideoProfile(profileRef.current);
      if (codecRef.current) manager.setCodec(codecRef.current);
      manager.setLocalMedia(pendingMediaRef.current);
      if (pendingMediaRef.current.video) {
        socket.emit('share:state', { sharing: true });
      }

      // Malha completa: todos se conectam com todos, porque qualquer um pode
      // falar. Quem nao tem midia ainda cria a conexao sem negociar nada.
      for (const peer of joined.peers) manager.addPeer(peer.id);
    }

    socket.on('connect', () => {
      if (!cancelled) void setupSession();
    });

    socket.on('connect_error', () => {
      if (cancelled) return;
      // Falhar antes do primeiro join e erro; depois disso o socket.io segue
      // tentando sozinho, e mostrar "erro" seria mentira.
      if (joinedOnceRef.current) {
        setStatus('reconnecting');
      } else {
        setStatus('error');
        setError('Nao foi possivel falar com o servidor de sinalizacao.');
      }
    });

    socket.on('disconnect', (reason) => {
      if (cancelled || reason === 'io client disconnect') return;
      managerRef.current?.close();
      managerRef.current = null;
      setStatus('reconnecting');
      setError(null);
    });

    // --- Listeners de sala: registrados UMA vez, leem o manager por ref ---

    socket.on('peer:joined', (peer) => {
      setPeers((prev) => [...prev.filter((p) => p.id !== peer.id), { ...peer, connection: 'new' }]);
      // O host voltando encerra o aviso de carencia.
      if (peer.role === 'host') setHostAwaySeconds(null);
      managerRef.current?.addPeer(peer.id);
    });

    socket.on('peer:left', ({ peerId }) => {
      managerRef.current?.removePeer(peerId);
      setPeers((prev) => prev.filter((p) => p.id !== peerId));
      setRemoteStreams((prev) => {
        const next = new Map(prev);
        next.delete(peerId);
        return next;
      });
    });

    socket.on('host:left', ({ graceSeconds }) => {
      setHostAwaySeconds(graceSeconds);
      setHostSharing(false);
    });

    socket.on('room:closed', ({ reason }) => {
      managerRef.current?.close();
      managerRef.current = null;
      setStatus('closed');
      setError(reason);
      setRemoteStreams(new Map());
    });

    // O stream remoto NAO e descartado quando o host para de transmitir: ele
    // usa `replaceTrack`, entao `ontrack` nao dispara de novo num segundo
    // compartilhamento. Quem decide exibir ou nao e a UI, via `hostSharing`.
    socket.on('share:state', ({ sharing }) => setHostSharing(sharing));

    socket.on('signal:offer', ({ from, sdp }) => {
      void managerRef.current?.handleDescription(from, sdp);
    });
    socket.on('signal:answer', ({ from, sdp }) => {
      void managerRef.current?.handleDescription(from, sdp);
    });
    socket.on('signal:ice', ({ from, candidate }) => {
      void managerRef.current?.handleIceCandidate(from, candidate);
    });
    socket.on('chat:message', (message) =>
      setMessages((prev) => limitarMensagens([...prev, message])),
    );

    return () => {
      cancelled = true;
      managerRef.current?.close();
      managerRef.current = null;
      joinedOnceRef.current = false;
      socket.emit('room:leave');
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [roomId, displayName]);

  // Amostra o fluxo a cada 2s. E o que separa "nada chegou" de "chegou e nao
  // renderizou" sem precisar abrir o chrome://webrtc-internals.
  useEffect(() => {
    if (status !== 'joined') return undefined;
    // Quem assiste mede o que chega; quem transmite mede o que sai (e por que
    // o navegador reduziu).
    const sample = () => {
      const manager = managerRef.current;
      if (!manager) return;
      if (role === 'viewer') void manager.getInboundVideoStats().then(setVideoStats);
      else void manager.getOutboundVideoStats().then(setOutboundStats);
    };
    sample(); // sem isto o painel fica 2s em branco justamente quando mais importa
    const timer = setInterval(sample, 2000);
    return () => clearInterval(timer);
  }, [status, role]);

  // O video vem do host; todo o resto e voz. Derivar aqui evita espalhar essa
  // regra pela UI.
  const hostPeerId = peers.find((peer) => peer.role === 'host')?.id ?? null;
  const remoteStream = hostPeerId ? (remoteStreams.get(hostPeerId) ?? null) : null;
  const voiceStreams = useMemo(
    () =>
      [...remoteStreams.entries()]
        .filter(([peerId]) => peerId !== hostPeerId)
        .map(([peerId, stream]) => ({ peerId, stream })),
    [remoteStreams, hostPeerId],
  );

  const sendChat = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    socketRef.current?.emit('chat:message', { text: trimmed });
  }, []);

  const setVideoProfile = useCallback((profile: VideoProfile) => {
    profileRef.current = profile;
    managerRef.current?.setVideoProfile(profile);
  }, []);

  const setCodec = useCallback((codec: CodecOption) => {
    codecRef.current = codec;
    managerRef.current?.setCodec(codec);
  }, []);

  /** Publica a midia local (tela e/ou microfone) para todos os peers. */
  const publishMedia = useCallback((media: LocalMedia) => {
    pendingMediaRef.current = media;
    managerRef.current?.setLocalMedia(media);
    // `share:state` fala apenas da tela — o servidor ignora quem nao e host.
    socketRef.current?.emit('share:state', { sharing: media.video !== null });
  }, []);

  return useMemo(
    () => ({
      status,
      error,
      role,
      selfId,
      peers,
      messages,
      remoteStream,
      voiceStreams,
      hostSharing,
      hostAwaySeconds,
      hasTurn,
      videoStats,
      outboundStats,
      sendChat,
      publishMedia,
      setVideoProfile,
      setCodec,
    }),
    [status, error, role, selfId, peers, messages, remoteStream, voiceStreams, hostSharing, hostAwaySeconds, hasTurn, videoStats, outboundStats, sendChat, publishMedia, setVideoProfile, setCodec],
  );
}
