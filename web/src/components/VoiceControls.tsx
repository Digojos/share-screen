import { useEffect, useRef } from 'react';
import type { MicrophoneControls } from '../rtc/useMicrophone';

interface VoiceControlsProps {
  mic: MicrophoneControls;
  voiceStreams: Array<{ peerId: string; stream: MediaStream }>;
  speakerMuted: boolean;
  onToggleSpeaker: () => void;
  mutedPeers: ReadonlySet<string>;
  /** Volume por peer, 0 a 1. Ausente = 1. */
  peerVolumes: ReadonlyMap<string, number>;
}

/**
 * Microfone do participante (todos falam) e o audio dos demais. O audio do host
 * chega junto do video, entao estes elementos cobrem apenas as vozes.
 */
export function VoiceControls({
  mic,
  voiceStreams,
  speakerMuted,
  onToggleSpeaker,
  mutedPeers,
  peerVolumes,
}: VoiceControlsProps) {
  return (
    <section className="controls">
      <button
        type="button"
        className={mic.enabled ? 'toggle on' : 'toggle off'}
        onClick={() => void mic.toggle()}
      >
        {!mic.available ? 'Entrar no audio' : mic.enabled ? 'Microfone ligado' : 'Microfone mudo'}
      </button>

      <button
        type="button"
        className={speakerMuted ? 'toggle off' : 'toggle on'}
        onClick={onToggleSpeaker}
      >
        {speakerMuted ? 'Som desligado' : 'Som ligado'}
      </button>

      {mic.error && <span className="badge error">{mic.error}</span>}

      {voiceStreams.map(({ peerId, stream }) => (
        <RemoteAudio
          key={peerId}
          stream={stream}
          muted={speakerMuted || mutedPeers.has(peerId)}
          volume={peerVolumes.get(peerId) ?? 1}
        />
      ))}
    </section>
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
