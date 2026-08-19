import { useCallback, useEffect, useRef, useState } from 'react';

export interface MicrophoneControls {
  track: MediaStreamTrack | null;
  /** Ha permissao e uma track viva (mesmo que mutada). */
  available: boolean;
  enabled: boolean;
  error: string | null;
  toggle: () => Promise<void>;
}

/**
 * Microfone de cada participante, para o chat de voz.
 *
 * A captura so acontece quando a pessoa clica para falar — nao ao entrar na
 * sala. Depois de adquirida, ligar/desligar apenas alterna `track.enabled`,
 * que nao exige renegociacao WebRTC e mantem o sender no lugar.
 */
export function useMicrophone(): MicrophoneControls {
  const [track, setTrack] = useState<MediaStreamTrack | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);

  const toggle = useCallback(async () => {
    const current = trackRef.current;
    if (current && current.readyState === 'live') {
      current.enabled = !current.enabled;
      setEnabled(current.enabled);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      const micTrack = stream.getAudioTracks()[0] ?? null;
      if (!micTrack) {
        setError('Nenhum microfone encontrado.');
        return;
      }
      micTrack.enabled = true;
      trackRef.current = micTrack;
      setTrack(micTrack);
      setEnabled(true);
      setError(null);
    } catch (cause) {
      const name = cause instanceof DOMException ? cause.name : '';
      setError(
        name === 'NotAllowedError'
          ? 'Permissao de microfone negada.'
          : 'Nao foi possivel acessar o microfone.',
      );
    }
  }, []);

  // Fechar a aba ou sair da sala nao pode deixar o microfone aberto.
  useEffect(
    () => () => {
      trackRef.current?.stop();
      trackRef.current = null;
    },
    [],
  );

  return { track, available: track !== null, enabled, error, toggle };
}
