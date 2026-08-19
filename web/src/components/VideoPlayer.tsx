import { useEffect, useRef, useState } from 'react';

interface VideoPlayerProps {
  stream: MediaStream | null;
  /** O proprio host precisa ficar mudo, caso contrario o audio realimenta. */
  muted: boolean;
  /** 0 a 1 — o audio do host trafega junto do video, entao o volume dele mora aqui. */
  volume: number;
  placeholder: string;
}

export function VideoPlayer({ stream, muted, volume, placeholder }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = stream;
    setAutoplayBlocked(false);
    if (!stream) return;

    // Autoplay bloqueado deixa o elemento pausado exibindo preto — sintoma
    // identico ao de "midia nao chegou". Sem sinalizar na tela, os dois casos
    // ficam indistinguiveis para quem esta assistindo.
    video.play().catch((error) => {
      console.warn('[video] autoplay bloqueado', error);
      setAutoplayBlocked(true);
    });
  }, [stream]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.volume = volume;
  }, [volume]);

  // O estado nao vem so do nosso botao: Esc e F11 tambem saem da tela cheia.
  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === frameRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await frameRef.current?.requestFullscreen();
    } catch (error) {
      console.warn('[video] tela cheia recusada', error);
    }
  }

  async function handleManualPlay() {
    try {
      await videoRef.current?.play();
      setAutoplayBlocked(false);
    } catch (error) {
      console.warn('[video] play manual falhou', error);
    }
  }

  return (
    <div className="video-frame" ref={frameRef}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={muted}
        className={stream ? '' : 'hidden'}
        onDoubleClick={() => void toggleFullscreen()}
      />
      {!stream && <p className="video-placeholder">{placeholder}</p>}
      {stream && (
        <button
          type="button"
          className="video-fullscreen"
          onClick={() => void toggleFullscreen()}
          title="Tambem funciona com duplo clique no video"
        >
          {fullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
        </button>
      )}

      {stream && autoplayBlocked && (
        <button type="button" className="video-overlay" onClick={handleManualPlay}>
          Clique para exibir o video
        </button>
      )}
    </div>
  );
}

