import { useCallback, useEffect, useRef, useState } from 'react';
import type { FrameRateOption, ResolutionOption, VideoProfile } from './videoProfiles';

export interface ScreenShareState {
  stream: MediaStream | null;
  sharing: boolean;
  /** Mensagem pronta para a UI; `null` quando nao ha erro. */
  error: string | null;
  /** O navegador entregou audio da tela/aba? Nem sempre entrega — ver README. */
  hasSystemAudio: boolean;
  /**
   * O que o usuario escolheu no seletor: 'monitor', 'window' ou 'browser'.
   * Sem isso nao da para orientar sobre o audio — a caixinha fica em lugares
   * diferentes, e para janela ela simplesmente nao existe.
   */
  displaySurface: string | null;
  /**
   * Maior taxa de quadros que a FONTE aceita, reportada pelo navegador. E o
   * unico jeito honesto de saber se pedir 90 ou 120 faria diferenca nesta
   * maquina — em vez de oferecer botoes que mentem.
   */
  maxFrameRate: number | null;
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
  frameRate: FrameRateOption,
): void {
  track.contentHint = profile.contentHint;
  void track
    .applyConstraints(buildVideoConstraints(profile, resolution, frameRate))
    .catch((error) => console.warn('[captura] restricoes nao aceitas', error));
}

function buildVideoConstraints(
  profile: VideoProfile,
  resolution: ResolutionOption,
  frameRate: FrameRateOption,
): MediaTrackConstraints {
  // `null` no seletor significa "segue o perfil" — e o padrao, e preserva o
  // comportamento de quando o FPS vivia dentro da qualidade.
  const fps = frameRate.value ?? profile.frameRate;
  const constraints: MediaTrackConstraints = { frameRate: { ideal: fps } };
  if (resolution.maxWidth) constraints.width = { max: resolution.maxWidth };
  if (resolution.maxHeight) constraints.height = { max: resolution.maxHeight };
  return constraints;
}

/**
 * Fora de um contexto seguro o Chrome nem define `navigator.mediaDevices`, e a
 * chamada estoura um TypeError generico. E o erro mais provavel ao testar num
 * servidor por `http://ip:porta`, entao vale dizer o nome dele.
 */
export function capturaDisponivel(): boolean {
  return window.isSecureContext && navigator.mediaDevices !== undefined;
}

function describeError(error: unknown): string {
  if (!capturaDisponivel()) {
    return 'Compartilhar tela exige HTTPS. Em http://ip:porta o navegador bloqueia a captura — use um dominio com certificado, ou localhost.';
  }
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
  frameRate: FrameRateOption,
): ScreenShareControls {
  const [state, setState] = useState<ScreenShareState>({
    stream: null,
    sharing: false,
    error: null,
    hasSystemAudio: false,
    displaySurface: null,
    maxFrameRate: null,
  });

  const streamRef = useRef<MediaStream | null>(null);
  // Ref para que start/switchSource sempre leiam o perfil atual sem virar
  // dependencia dos callbacks (o que recriaria as funcoes a cada troca).
  const profileRef = useRef(profile);
  profileRef.current = profile;
  const resolutionRef = useRef(resolution);
  resolutionRef.current = resolution;
  const frameRateRef = useRef(frameRate);
  frameRateRef.current = frameRate;
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
      displaySurface: null,
      maxFrameRate: null,
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
        applyProfileToTrack(
          videoTrack,
          profileRef.current,
          resolutionRef.current,
          frameRateRef.current,
        );
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
        displaySurface: videoTrack?.getSettings().displaySurface ?? null,
        // getCapabilities nao existe em todos os navegadores para captura de
        // tela; ausente significa "nao sei", nao "sem limite".
        maxFrameRate: videoTrack?.getCapabilities?.().frameRate?.max ?? null,
      }));
    },
    [stop],
  );

  const start = useCallback(async () => {
    let display: MediaStream;
    try {
      display = await navigator.mediaDevices.getDisplayMedia({
        video: buildVideoConstraints(
          profileRef.current,
          resolutionRef.current,
          frameRateRef.current,
        ),
        audio: true,
        // Padrao do navegador, explicito para documentar a intencao: queremos o
        // audio do sistema sempre que ele for oferecido.
        systemAudio: 'include',
      } as DisplayMediaStreamOptions);
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
        video: buildVideoConstraints(
          profileRef.current,
          resolutionRef.current,
          frameRateRef.current,
        ),
        audio: true,
        // Padrao do navegador, explicito para documentar a intencao: queremos o
        // audio do sistema sempre que ele for oferecido.
        systemAudio: 'include',
      } as DisplayMediaStreamOptions);
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
    if (videoTrack) applyProfileToTrack(videoTrack, profile, resolution, frameRate);
  }, [profile, resolution, frameRate]);

  // Sair da sala ou fechar a aba nao pode deixar a camera/tela capturando.
  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  return { ...state, start, switchSource, stop };
}
