import { useCallback, useEffect, useRef, useState } from 'react';
import type { ResolutionOption, VideoProfile } from './videoProfiles';

export interface ScreenShareState {
  stream: MediaStream | null;
  sharing: boolean;
  /** Mensagem pronta para a UI; `null` quando nao ha erro. */
  error: string | null;
  /** O navegador entregou audio da tela/aba? Nem sempre entrega — ver README. */
  hasSystemAudio: boolean;
}

export interface ScreenShareControls extends ScreenShareState {
  start: () => Promise<void>;
  /** Troca a fonte sem interromper a transmissao. */
  switchSource: () => Promise<void>;
  stop: () => void;
}

/**
 * `contentHint` diz ao codec o que priorizar: 'text' preserva nitidez e deixa o
 * movimento engasgar; 'motion' faz o contrario. O framerate e reconfigurado na
 * track ao vivo, sem nova captura.
 */
function applyProfileToTrack(
  track: MediaStreamTrack,
  profile: VideoProfile,
  resolution: ResolutionOption,
): void {
  track.contentHint = profile.contentHint;
  void track
    .applyConstraints(buildVideoConstraints(profile, resolution))
    .catch((error) => console.warn('[captura] restricoes nao aceitas', error));
}

function buildVideoConstraints(
  profile: VideoProfile,
  resolution: ResolutionOption,
): MediaTrackConstraints {
  const constraints: MediaTrackConstraints = { frameRate: { ideal: profile.frameRate } };
  if (resolution.maxWidth) constraints.width = { max: resolution.maxWidth };
  if (resolution.maxHeight) constraints.height = { max: resolution.maxHeight };
  return constraints;
}

function describeError(error: unknown): string {
  if (!(error instanceof DOMException)) {
    return 'Nao foi possivel iniciar o compartilhamento.';
  }
  switch (error.name) {
    case 'NotAllowedError':
      return 'Permissao negada. Clique em compartilhar e escolha uma tela ou janela.';
    case 'NotFoundError':
      return 'Nenhuma fonte de captura disponivel neste dispositivo.';
    case 'NotReadableError':
      return 'A fonte selecionada esta em uso por outro aplicativo.';
    default:
      return `Falha na captura (${error.name}).`;
  }
}

/**
 * Captura de tela, e o audio do sistema quando o navegador permite.
 *
 * O microfone NAO vive aqui: com chat de voz, quem so assiste tambem fala, e
 * amarrar o microfone a captura de tela deixaria espectadores sem voz. Ver
 * `useMicrophone`.
 */
export function useScreenShare(
  profile: VideoProfile,
  resolution: ResolutionOption,
): ScreenShareControls {
  const [state, setState] = useState<ScreenShareState>({
    stream: null,
    sharing: false,
    error: null,
    hasSystemAudio: false,
  });

  const streamRef = useRef<MediaStream | null>(null);
  // Ref para que start/switchSource sempre leiam o perfil atual sem virar
  // dependencia dos callbacks (o que recriaria as funcoes a cada troca).
  const profileRef = useRef(profile);
  profileRef.current = profile;
  const resolutionRef = useRef(resolution);
  resolutionRef.current = resolution;
  /** Tracks vindas do getDisplayMedia. */
  const displayTracksRef = useRef<MediaStreamTrack[]>([]);
  const endedHandlerRef = useRef<(() => void) | null>(null);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    displayTracksRef.current = [];
    endedHandlerRef.current = null;
    setState({
      stream: null,
      sharing: false,
      error: null,
      hasSystemAudio: false,
    });
  }, []);

  /**
   * Monta o stream publicado a partir das tracks de captura + microfone e
   * religa o listener de "parar" na track de video atual.
   */
  const applyDisplayTracks = useCallback(
    (displayTracks: MediaStreamTrack[]) => {
      displayTracksRef.current = displayTracks;

      const combined = new MediaStream();
      displayTracks.forEach((track) => combined.addTrack(track));
      streamRef.current = combined;

      // O Chrome mostra sua propria barra "Parar compartilhamento": quando o
      // usuario clica ali, a track termina sem passar pela nossa UI.
      const videoTrack = displayTracks.find((track) => track.kind === 'video');
      if (videoTrack) {
        applyProfileToTrack(videoTrack, profileRef.current, resolutionRef.current);
        const handler = () => stop();
        endedHandlerRef.current = handler;
        videoTrack.addEventListener('ended', handler, { once: true });
      }

      setState((prev) => ({
        ...prev,
        stream: combined,
        sharing: true,
        error: null,
        hasSystemAudio: displayTracks.some((track) => track.kind === 'audio'),
      }));
    },
    [stop],
  );

  const start = useCallback(async () => {
    let display: MediaStream;
    try {
      display = await navigator.mediaDevices.getDisplayMedia({
        video: buildVideoConstraints(profileRef.current, resolutionRef.current),
        audio: true,
      });
    } catch (error) {
      setState((prev) => ({ ...prev, error: describeError(error) }));
      return;
    }

    applyDisplayTracks(display.getTracks());
  }, [applyDisplayTracks]);

  /**
   * Troca a fonte compartilhada mantendo a transmissao no ar. Os espectadores
   * nem percebem: o PeerManager faz `replaceTrack`, sem renegociar.
   *
   * Cancelar o seletor NAO interrompe o compartilhamento atual — o usuario
   * pediu para trocar, nao para parar.
   */
  const switchSource = useCallback(async () => {
    let display: MediaStream;
    try {
      display = await navigator.mediaDevices.getDisplayMedia({
        video: buildVideoConstraints(profileRef.current, resolutionRef.current),
        audio: true,
      });
    } catch {
      return;
    }

    // Solta a captura anterior sem deixar o listener de "ended" derrubar tudo.
    const previous = displayTracksRef.current;
    const handler = endedHandlerRef.current;
    const previousVideo = previous.find((track) => track.kind === 'video');
    if (previousVideo && handler) previousVideo.removeEventListener('ended', handler);
    previous.forEach((track) => track.stop());

    applyDisplayTracks(display.getTracks());
  }, [applyDisplayTracks]);

  // Trocar de perfil no meio da transmissao reconfigura a track ao vivo, sem
  // precisar escolher a fonte de novo.
  useEffect(() => {
    const videoTrack = displayTracksRef.current.find((track) => track.kind === 'video');
    if (videoTrack) applyProfileToTrack(videoTrack, profile, resolution);
  }, [profile, resolution]);

  // Sair da sala ou fechar a aba nao pode deixar a camera/tela capturando.
  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  return { ...state, start, switchSource, stop };
}
