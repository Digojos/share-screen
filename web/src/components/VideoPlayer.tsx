import { useEffect, useRef, useState, type ReactNode } from 'react';

interface VideoPlayerProps {
  stream: MediaStream | null;
  /** O proprio host precisa ficar mudo, caso contrario o audio realimenta. */
  muted: boolean;
  /** 0 a 1 — o audio do host trafega junto do video, entao o volume dele mora aqui. */
  volume: number;
  placeholder: string;
  /**
   * Controles extras no canto do quadro (engrenagem de configuracoes). Entra
   * como slot para o player continuar sem saber nada sobre perfis e codecs —
   * e tambem para as configuracoes ficarem acessiveis em tela cheia, quando o
   * resto da pagina some.
   */
  overlay?: ReactNode;
}

/** Safari/iOS expoem a tela cheia so no proprio elemento de video, com prefixo. */
interface VideoComTelaCheiaDaApple extends HTMLVideoElement {
  webkitEnterFullscreen?: () => void;
  webkitSupportsFullscreen?: boolean;
}

export function VideoPlayer({
  stream,
  muted,
  volume,
  placeholder,
  overlay,
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenError, setFullscreenError] = useState<string | null>(null);

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

  /**
   * Tenta o quadro inteiro e, se for recusado, o proprio video.
   *
   * Sao caminhos com permissoes diferentes: dentro de um iframe sem
   * `allow="fullscreen"` o container e barrado, enquanto o elemento de video
   * costuma ter saida propria. E se os dois falharem, a pessoa precisa saber —
   * um botao que nao faz nada e pior que um botao que explica.
   */
  async function toggleFullscreen() {
    setFullscreenError(null);

    if (document.fullscreenElement) {
      try {
        await document.exitFullscreen();
      } catch (error) {
        console.warn('[video] falha ao sair da tela cheia', error);
      }
      return;
    }

    const video = videoRef.current as VideoComTelaCheiaDaApple | null;

    try {
      await frameRef.current?.requestFullscreen();
      return;
    } catch (error) {
      console.warn('[video] tela cheia no quadro recusada, tentando o video', error);
    }

    try {
      await video?.requestFullscreen();
      return;
    } catch (error) {
      console.warn('[video] tela cheia no video recusada', error);
    }

    if (typeof video?.webkitEnterFullscreen === 'function') {
      video.webkitEnterFullscreen();
      return;
    }

    setFullscreenError('O navegador recusou a tela cheia. Tente F11.');
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

      <div className="video-controles">
        {overlay}
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
      </div>

      {fullscreenError && <p className="video-aviso">{fullscreenError}</p>}

      {stream && autoplayBlocked && (
        <button type="button" className="video-overlay" onClick={handleManualPlay}>
          Clique para exibir o video
        </button>
      )}
    </div>
  );
}
