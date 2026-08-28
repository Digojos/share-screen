import { useEffect, useRef } from 'react';

interface RemoteVoicesProps {
  voiceStreams: Array<{ peerId: string; stream: MediaStream }>;
  speakerMuted: boolean;
  mutedPeers: ReadonlySet<string>;
  /** Volume por peer, 0 a 1. Ausente = 1. */
  peerVolumes: ReadonlyMap<string, number>;
}

/**
 * Elementos de audio dos demais participantes. Nao desenha nada — os controles
 * ficam no player e na lista de participantes — mas precisa estar montado:
 * remover estes elementos silencia o chat de voz inteiro.
 *
 * A voz do host nao passa por aqui: ela chega junto do video, no mesmo stream.
 */
export function RemoteVoices({
  voiceStreams,
  speakerMuted,
  mutedPeers,
  peerVolumes,
}: RemoteVoicesProps) {
  return (
    <>
      {voiceStreams.map(({ peerId, stream }) => (
        <RemoteAudio
          key={peerId}
          stream={stream}
          muted={speakerMuted || mutedPeers.has(peerId)}
          volume={peerVolumes.get(peerId) ?? 1}
        />
      ))}
    </>
  );
}

function RemoteAudio({
  stream,
  muted,
  volume,
}: {
  stream: MediaStream;
  muted: boolean;
  volume: number;
}) {
  const ref = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.srcObject = stream;
    element.play().catch((error) => console.warn('[voz] autoplay bloqueado', error));
  }, [stream]);

  // `volume` e propriedade do elemento, nao atributo — precisa ser aplicada
  // por codigo, ao contrario de `muted`.
  useEffect(() => {
    if (ref.current) ref.current.volume = volume;
  }, [volume]);

  return <audio ref={ref} autoPlay muted={muted} />;
}
