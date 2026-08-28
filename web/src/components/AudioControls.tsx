import type { MicrophoneControls } from '../rtc/useMicrophone';

interface AudioControlsProps {
  mic: MicrophoneControls;
  speakerMuted: boolean;
  onToggleSpeaker: () => void;
}

/**
 * Microfone e som como icones no proprio player.
 *
 * Sao os unicos controles alternados o tempo todo numa conversa, entao nao
 * podem morar atras da engrenagem — mutar precisa custar um clique. Como icone
 * eles ficam sempre visiveis sem devolver a barra o amontoado de botoes de
 * texto que existia antes.
 */
export function AudioControls({ mic, speakerMuted, onToggleSpeaker }: AudioControlsProps) {
  const micAtivo = mic.available && mic.enabled;
  const micTitulo = !mic.available
    ? 'Entrar no audio'
    : mic.enabled
      ? 'Microfone ligado — clique para mutar'
      : 'Microfone mudo — clique para falar';

  return (
    <>
      <button
        type="button"
        className={micAtivo ? 'player-icone ativo' : 'player-icone mudo'}
        onClick={() => void mic.toggle()}
        aria-pressed={micAtivo}
        aria-label={micTitulo}
        title={mic.error ?? micTitulo}
      >
        {micAtivo ? <MicrofoneIcone /> : <MicrofoneCortadoIcone />}
      </button>

      <button
        type="button"
        className={speakerMuted ? 'player-icone mudo' : 'player-icone ativo'}
        onClick={onToggleSpeaker}
        aria-pressed={!speakerMuted}
        aria-label={speakerMuted ? 'Som desligado — clique para ouvir' : 'Som ligado — clique para silenciar'}
        title={speakerMuted ? 'Som desligado' : 'Som ligado'}
      >
        {speakerMuted ? <SomCortadoIcone /> : <SomIcone />}
      </button>
    </>
  );
}

const tamanho = { width: 18, height: 18, viewBox: '0 0 24 24' } as const;

function MicrofoneIcone() {
  return (
    <svg {...tamanho} aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3m5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11Z"
      />
    </svg>
  );
}

function MicrofoneCortadoIcone() {
  return (
    <svg {...tamanho} aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M17 11a5 5 0 0 1-7.5 4.33l1.5-1.5A3 3 0 0 0 15 11V8.83l2-2Zm-2-6v1.17L9 12.17V5a3 3 0 0 1 6 0M4.27 3 3 4.27l4 4V11a5 5 0 0 0 7.5 4.33l1.43 1.43A7 7 0 0 1 5 11H3a7 7 0 0 0 6 6.92V21h2v-3.08a6.9 6.9 0 0 0 2.4-.77L19.73 21 21 19.73Z"
      />
    </svg>
  );
}

function SomIcone() {
  return (
    <svg {...tamanho} aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M3 9v6h4l5 5V4L7 9Zm13.5 3A4.5 4.5 0 0 0 14 7.97v8.05A4.47 4.47 0 0 0 16.5 12M14 3.23v2.06a6.99 6.99 0 0 1 0 13.42v2.06a9 9 0 0 0 0-17.54"
      />
    </svg>
  );
}

function SomCortadoIcone() {
  return (
    <svg {...tamanho} aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M12 4 9.91 6.09 12 8.18Zm7.73 17L4.27 5.54 3 6.81 7.19 11H3v6h4l5 5v-6.73l4.25 4.25a6.9 6.9 0 0 1-2.25 1.15v2.06a8.9 8.9 0 0 0 3.69-1.81L18.73 22ZM19 12a6.99 6.99 0 0 0-5-6.71v2.06A4.99 4.99 0 0 1 17 12a4.9 4.9 0 0 1-.31 1.69l1.51 1.51A6.9 6.9 0 0 0 19 12"
      />
    </svg>
  );
}
