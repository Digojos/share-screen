import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Chat } from '../components/Chat';
import { PlayerSettings } from '../components/PlayerSettings';
import { ShareControls } from '../components/ShareControls';
import { VideoPlayer } from '../components/VideoPlayer';
import { VoiceControls } from '../components/VoiceControls';
import type { InboundVideoStats, LocalMedia, OutboundVideoStats } from '../rtc/PeerManager';
import { useMicrophone } from '../rtc/useMicrophone';
import { useRoom } from '../rtc/useRoom';
import { useScreenShare } from '../rtc/useScreenShare';
import {
  CODECS,
  DEFAULT_CODEC,
  DEFAULT_PROFILE,
  DEFAULT_RESOLUTION,
  RESOLUTIONS,
  VIDEO_PROFILES,
  type CodecId,
  type ResolutionId,
  type VideoProfileId,
} from '../rtc/videoProfiles';
import { loadDisplayName, saveDisplayName } from '../session';

const CONNECTION_LABEL: Record<RTCPeerConnectionState, string> = {
  new: 'aguardando',
  connecting: 'conectando',
  connected: 'conectado',
  disconnected: 'instavel',
  failed: 'falhou',
  closed: 'encerrado',
};

export function Room() {
  const { roomId = '' } = useParams();
  const [displayName, setDisplayName] = useState(loadDisplayName);

  // Quem chega por um link compartilhado nunca passou pela home e nao tem nome
  // salvo. Perguntar aqui evita uma sala cheia de "Anonimo".
  if (!displayName) {
    return <NameGate roomId={roomId} onConfirm={setDisplayName} />;
  }

  // A sessao so monta com o nome definido, e a chave garante que trocar de sala
  // recria todo o estado de socket e peer connections.
  return <RoomSession key={roomId} roomId={roomId} displayName={displayName} />;
}

function NameGate({ roomId, onConfirm }: { roomId: string; onConfirm: (name: string) => void }) {
  const [name, setName] = useState('');

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    saveDisplayName(trimmed);
    onConfirm(trimmed);
  }

  return (
    <main className="home">
      <h1>Entrar na sala {roomId}</h1>
      <p className="muted">Escolha como voce vai aparecer para os outros.</p>
      <form className="field" onSubmit={handleSubmit}>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Seu nome"
          maxLength={40}
          autoFocus
        />
        <button type="submit" className="primary" disabled={name.trim().length === 0}>
          Entrar
        </button>
      </form>
    </main>
  );
}

function RoomSession({ roomId, displayName }: { roomId: string; displayName: string }) {
  const [copied, setCopied] = useState(false);
  const [profileId, setProfileId] = useState<VideoProfileId>(DEFAULT_PROFILE);
  const [resolutionId, setResolutionId] = useState<ResolutionId>(DEFAULT_RESOLUTION);
  const [codecId, setCodecId] = useState<CodecId>(DEFAULT_CODEC);
  const [speakerMuted, setSpeakerMuted] = useState(false);
  const [mutedPeers, setMutedPeers] = useState<ReadonlySet<string>>(new Set());
  const [peerVolumes, setPeerVolumes] = useState<ReadonlyMap<string, number>>(new Map());

  const profile = VIDEO_PROFILES[profileId];
  const resolution = RESOLUTIONS[resolutionId];
  const room = useRoom(roomId, displayName);
  // Extraidas do objeto para que a dependencia do efeito seja a FUNCAO (estavel)
  // e nao o `room` inteiro, que muda a cada mensagem de chat — depender dele
  // republicaria a midia sem parar.
  const { publishMedia, setVideoProfile, setCodec } = room;
  const share = useScreenShare(profile, resolution);
  const mic = useMicrophone();
  const isHost = room.role === 'host';

  // O perfil muda o teto de bitrate e o que sacrificar sob pressao de banda;
  // a track em si e reconfigurada dentro do useScreenShare.
  useEffect(() => {
    setVideoProfile(profile);
  }, [profile, setVideoProfile]);

  // Trocar de codec muda o SDP, entao renegocia — o video pode piscar.
  useEffect(() => {
    setCodec(CODECS[codecId]);
  }, [codecId, setCodec]);

  function setPeerVolume(peerId: string, volume: number) {
    setPeerVolumes((prev) => new Map(prev).set(peerId, volume));
  }

  function togglePeerMute(peerId: string) {
    setMutedPeers((prev) => {
      const next = new Set(prev);
      if (next.has(peerId)) next.delete(peerId);
      else next.add(peerId);
      return next;
    });
  }

  // Tela e microfone sao capturados por caminhos independentes; aqui viram uma
  // unica midia publicada. O `useMemo` importa: recriar o objeto a cada render
  // dispararia replaceTrack sem parar.
  const localMedia = useMemo<LocalMedia>(() => {
    const screenVideo = share.stream?.getVideoTracks()[0] ?? null;
    const screenAudio = share.stream?.getAudioTracks()[0] ?? null;
    const micTrack = mic.track;

    if (!screenVideo && !screenAudio && !micTrack) {
      return { stream: null, video: null, screenAudio: null, mic: null };
    }

    // Um stream unico agrupa as tracks do lado de quem recebe.
    const stream = new MediaStream();
    if (screenVideo) stream.addTrack(screenVideo);
    if (screenAudio) stream.addTrack(screenAudio);
    if (micTrack) stream.addTrack(micTrack);

    return { stream, video: screenVideo, screenAudio, mic: micTrack };
  }, [share.stream, mic.track]);

  // Ponto unico de sincronizacao: qualquer mudanca de tela ou microfone e
  // publicada para todos os peers a partir daqui.
  useEffect(() => {
    publishMedia(localMedia);
  }, [localMedia, publishMedia]);

  async function handleCopyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  // `reconnecting` NAO cai aqui: a sessao pode voltar sozinha, e trocar a tela
  // por uma pagina de erro descartaria a captura ainda viva do host.
  if (room.status === 'error' || room.status === 'closed') {
    return (
      <main className="room-message">
        <h1>{room.status === 'closed' ? 'Sala encerrada' : 'Nao foi possivel continuar'}</h1>
        <p>{room.error}</p>
        <Link to="/" className="primary button-link">
          Voltar ao inicio
        </Link>
      </main>
    );
  }

  // O stream remoto persiste entre compartilhamentos (o host troca a track sem
  // renegociar), entao quem diz se ha imagem no ar agora e `hostSharing`.
  const viewerStream = room.hostSharing ? room.remoteStream : null;
  const hostPeerId = room.peers.find((peer) => peer.role === 'host')?.id ?? null;
  // O proprio host sempre se silencia (evita realimentacao); para quem assiste,
  // o audio do host vem pelo elemento de video, entao o mudo dele mora aqui.
  const videoMuted =
    isHost || speakerMuted || (hostPeerId !== null && mutedPeers.has(hostPeerId));
  const videoVolume = hostPeerId !== null ? (peerVolumes.get(hostPeerId) ?? 1) : 1;
  const viewerPlaceholder = room.hostSharing
    ? 'Conectando ao host...'
    : 'O host ainda nao iniciou o compartilhamento.';

  return (
    <main className="room">
      <header className="room-header">
        <div>
          <h1>Sala {roomId}</h1>
          <p className="muted">
            {isHost ? 'Voce e o host' : 'Voce esta assistindo'} · {room.peers.length + 1}{' '}
            participante(s)
          </p>
        </div>
        <div className="room-header-actions">
          <button type="button" onClick={handleCopyLink}>
            {copied ? 'Link copiado' : 'Copiar link'}
          </button>
          <Link to="/" className="button-link">
            Sair
          </Link>
        </div>
      </header>

      {room.status === 'reconnecting' && (
        <p className="badge warn">
          Conexao perdida. Reconectando... A transmissao volta sozinha.
        </p>
      )}

      {room.hostAwaySeconds !== null && (
        <p className="badge warn">
          O host caiu. A sala fica aberta por ate {room.hostAwaySeconds}s aguardando o retorno.
        </p>
      )}

      {!room.hasTurn && (
        <p className="badge warn">
          TURN nao configurado: a conexao pode falhar entre redes diferentes.
        </p>
      )}

      <div className="room-body">
        <div className="room-stage">
          <VideoPlayer
            stream={isHost ? share.stream : viewerStream}
            muted={videoMuted}
            volume={videoVolume}
            overlay={
              isHost ? (
                <PlayerSettings
                  profileId={profileId}
                  onProfile={setProfileId}
                  codecId={codecId}
                  onCodec={setCodecId}
                  resolutionId={resolutionId}
                  onResolution={setResolutionId}
                  share={share}
                />
              ) : undefined
            }
            placeholder={isHost ? 'Sua tela aparece aqui depois de compartilhar.' : viewerPlaceholder}
          />

          {isHost && (
            <>
              <ShareControls share={share} onStart={() => void share.start()} onStop={share.stop} />
              {share.sharing && <HostDiagnostics stats={room.outboundStats} />}
            </>
          )}

          <VoiceControls
            mic={mic}
            voiceStreams={room.voiceStreams}
            speakerMuted={speakerMuted}
            onToggleSpeaker={() => setSpeakerMuted((value) => !value)}
            mutedPeers={mutedPeers}
            peerVolumes={peerVolumes}
          />

          {!isHost && room.hostSharing && <ViewerDiagnostics stats={room.videoStats} />}
        </div>

        <aside className="room-side">
          <section className="participants">
            <h2>Participantes</h2>
            <ul>
              <li>
                <span>{displayName} (voce)</span>
                <span className="muted">{isHost ? 'host' : 'espectador'}</span>
              </li>
              {room.peers.map((peer) => {
                const muted = mutedPeers.has(peer.id);
                const volume = peerVolumes.get(peer.id) ?? 1;
                return (
                  <li key={peer.id} className="peer">
                    <div className="peer-row">
                      <span className="peer-name">{peer.displayName}</span>
                      <span className="muted">
                        {/* So faz sentido mostrar estado de conexao de quem
                            temos conexao: o host fala com todos, mas um
                            espectador so fala com o host — outro espectador
                            ficaria eternamente "aguardando". */}
                        {isHost || peer.role === 'host'
                          ? CONNECTION_LABEL[peer.connection]
                          : 'espectador'}
                      </span>
                    </div>
                    <div className="peer-row">
                      <button
                        type="button"
                        className="peer-mute"
                        onClick={() => togglePeerMute(peer.id)}
                        title={muted ? 'Reativar audio' : 'Silenciar'}
                      >
                        {muted ? 'Mudo' : 'Ouvindo'}
                      </button>
                      <input
                        type="range"
                        className="peer-volume"
                        min={0}
                        max={100}
                        value={Math.round(volume * 100)}
                        disabled={muted}
                        aria-label={`Volume de ${peer.displayName}`}
                        onChange={(event) =>
                          setPeerVolume(peer.id, Number(event.target.value) / 100)
                        }
                      />
                      <span className="peer-volume-value">{Math.round(volume * 100)}%</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>

          <Chat
            messages={room.messages}
            selfId={room.selfId}
            onSend={room.sendChat}
            disabled={room.status !== 'joined'}
          />
        </aside>
      </div>
    </main>
  );
}

/**
 * Linha de diagnostico para o espectador. Uma tela preta tem tres causas com o
 * mesmo sintoma — nada chegando, chegando sem decodificar, ou decodificando e
 * nao renderizando — e sao estes numeros que separam as tres.
 */
function ViewerDiagnostics({ stats }: { stats: InboundVideoStats | null }) {
  if (!stats) return <p className="badge">Aguardando dados do video...</p>;

  const kb = Math.round(stats.bytesReceived / 1024);
  if (stats.bytesReceived === 0) {
    return <p className="badge error">Nada chegou do host (0 KB). Problema de transporte.</p>;
  }
  if (stats.framesDecoded === 0) {
    return (
      <p className="badge warn">
        {kb} KB recebidos, mas nenhum quadro decodificado — codec {stats.codec || 'desconhecido'}.
      </p>
    );
  }
  return (
    <p className="badge">
      {stats.frameWidth}x{stats.frameHeight} · {stats.framesDecoded} quadros · {kb} KB ·{' '}
      {stats.codec.replace('video/', '')}
    </p>
  );
}

const LIMITACAO: Record<string, string> = {
  cpu: 'CPU no limite — o encoder nao da conta. Tente HD ou o perfil Apresentacao.',
  bandwidth: 'Banda no limite — o upload nao comporta. Tente HD ou menos espectadores.',
  other: 'Reduzido por limitacao do navegador.',
};

/**
 * Por que a qualidade caiu, na visao de quem transmite. O navegador ja sabe a
 * resposta (`qualityLimitationReason`); aqui ela so deixa de ser invisivel.
 */
function HostDiagnostics({ stats }: { stats: OutboundVideoStats | null }) {
  if (!stats) return <p className="badge">Medindo o envio...</p>;

  const resumo = `Enviando ${stats.frameWidth}x${stats.frameHeight} a ${stats.framesPerSecond} fps para ${stats.peers} conexao(oes)`;
  const motivo = LIMITACAO[stats.qualityLimitationReason];

  return (
    <section className="controls">
      <span className="badge">{resumo}</span>
      {motivo && <span className="badge warn">{motivo}</span>}
    </section>
  );
}
