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
import type { VideoProfile } from './videoProfiles';

export type RoomStatus = 'connecting' | 'joined' | 'error' | 'closed' | 'disconnected';

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
  hasTurn: boolean;
  /** Diagnostico do video recebido; null enquanto nada chega. */
  videoStats: InboundVideoStats | null;
  /** Diagnostico do video enviado (apenas host); explica quedas de qualidade. */
  outboundStats: OutboundVideoStats | null;
  sendChat: (text: string) => void;
  publishMedia: (media: LocalMedia) => void;
  setVideoProfile: (profile: VideoProfile) => void;
}

/**
 * Orquestra a sessao de sala: socket de sinalizacao, conexoes WebRTC, lista de
 * participantes e chat. Toda a montagem/desmontagem acontece num unico efeito
 * para que sair da pagina feche socket e peer connections juntos.
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
  const [hasTurn, setHasTurn] = useState(true);
  const [videoStats, setVideoStats] = useState<InboundVideoStats | null>(null);
  const [outboundStats, setOutboundStats] = useState<OutboundVideoStats | null>(null);

  const socketRef = useRef<SignalingSocket | null>(null);
  const managerRef = useRef<PeerManager | null>(null);
  /** Guarda a midia caso ela seja publicada antes do join terminar. */
  const pendingMediaRef = useRef<LocalMedia>(EMPTY_MEDIA);

  useEffect(() => {
    let cancelled = false;
    const socket = connectSignaling();
    socketRef.current = socket;

    socket.on('connect_error', () => {
      if (!cancelled) {
        setStatus('error');
        setError('Nao foi possivel falar com o servidor de sinalizacao.');
      }
    });

    socket.on('disconnect', (reason) => {
      if (cancelled || reason === 'io client disconnect') return;
      setStatus('disconnected');
      setError('Conexao com o servidor perdida. Recarregue a pagina para voltar.');
    });

    void (async () => {
      const iceConfig = await fetchIceConfig(roomId);
      if (cancelled) return;
      setHasTurn(iceConfig.hasTurn);

      let joined;
      try {
        joined = await joinRoom(socket, roomId, displayName);
      } catch (joinError) {
        if (cancelled) return;
        setStatus('error');
        setError(joinError instanceof Error ? joinError.message : 'Falha ao entrar na sala.');
        return;
      }
      if (cancelled) return;

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

      setSelfId(joined.selfId);
      setRole(joined.role);
      setHostSharing(joined.sharing);
      setPeers(joined.peers.map((peer) => ({ ...peer, connection: 'new' })));
      // Historico vindo do servidor (vazio quando nao ha banco configurado).
      setMessages(joined.history);
      setStatus('joined');

      // A midia pode ter sido publicada antes do join concluir.
      manager.setLocalMedia(pendingMediaRef.current);

      // Malha completa: todos se conectam com todos, porque qualquer um pode
      // falar. Quem nao tem midia ainda cria a conexao sem negociar nada.
      for (const peer of joined.peers) manager.addPeer(peer.id);

      socket.on('peer:joined', (peer) => {
        setPeers((prev) => [...prev, { ...peer, connection: 'new' }]);
        manager.addPeer(peer.id);
      });

      socket.on('peer:left', ({ peerId }) => {
        manager.removePeer(peerId);
        setPeers((prev) => prev.filter((p) => p.id !== peerId));
        setRemoteStreams((prev) => {
          const next = new Map(prev);
          next.delete(peerId);
          return next;
        });
      });

      socket.on('room:closed', ({ reason }) => {
        manager.close();
        setStatus('closed');
        setError(reason);
        setRemoteStreams(new Map());
      });

      // O stream remoto NAO e descartado quando o host para de transmitir: ele
      // usa `replaceTrack`, entao `ontrack` nao dispara de novo num segundo
      // compartilhamento. Quem decide exibir ou nao e a UI, via `hostSharing`.
      socket.on('share:state', ({ sharing }) => setHostSharing(sharing));

      socket.on('signal:offer', ({ from, sdp }) => void manager.handleDescription(from, sdp));
      socket.on('signal:answer', ({ from, sdp }) => void manager.handleDescription(from, sdp));
      socket.on('signal:ice', ({ from, candidate }) => void manager.handleIceCandidate(from, candidate));
      socket.on('chat:message', (message) => setMessages((prev) => [...prev, message]));
    })();

    return () => {
      cancelled = true;
      managerRef.current?.close();
      managerRef.current = null;
      socket.emit('room:leave');
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [roomId, displayName]);

  // Amostra o fluxo de entrada a cada 2s. E o que separa "nada chegou" de
  // "chegou e nao renderizou" sem precisar abrir o chrome://webrtc-internals.
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

  /** Publica a midia local (tela e/ou microfone) para todos os peers. */
  const setVideoProfile = useCallback((profile: VideoProfile) => {
    managerRef.current?.setVideoProfile(profile);
  }, []);

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
      hasTurn,
      videoStats,
      outboundStats,
      sendChat,
      publishMedia,
      setVideoProfile,
    }),
    [status, error, role, selfId, peers, messages, remoteStream, voiceStreams, hostSharing, hasTurn, videoStats, outboundStats, sendChat, publishMedia, setVideoProfile],
  );
}
