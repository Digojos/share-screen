interface PreviewToggleProps {
  visivel: boolean;
  onToggle: () => void;
  /** O que esta sendo capturado; muda o quanto o preview custa. */
  displaySurface: string | null;
}

/**
 * Liga e desliga o preview local do host.
 *
 * Nao e so economia de renderizacao. Compartilhando a TELA INTEIRA com a janela
 * do app visivel, o preview mostra a tela que contem o preview — o espelho
 * infinito. O conteudo passa a mudar a cada quadro, e o codificador perde as
 * regioes estaticas que normalmente pularia: gasta-se CPU e bitrate para
 * transmitir o proprio reflexo.
 *
 * Por isso o aviso e mais enfatico quando a captura e de monitor.
 */
export function PreviewToggle({ visivel, onToggle, displaySurface }: PreviewToggleProps) {
  const capturandoMonitor = displaySurface === 'monitor';
  const titulo = visivel
    ? capturandoMonitor
      ? 'Ocultar meu video — capturando a tela inteira, o preview vira espelho infinito e custa caro'
      : 'Ocultar meu video (economiza CPU)'
    : 'Mostrar meu video';

  return (
    <button
      type="button"
      className={visivel ? 'player-icone ativo' : 'player-icone mudo'}
      onClick={onToggle}
      aria-pressed={visivel}
      aria-label={titulo}
      title={titulo}
    >
      {visivel ? <OlhoIcone /> : <OlhoCortadoIcone />}
    </button>
  );
}

const tamanho = { width: 18, height: 18, viewBox: '0 0 24 24' } as const;

function OlhoIcone() {
  return (
    <svg {...tamanho} aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6m0-4.5c5 0 9.27 3.11 11 7.5-1.73 4.39-6 7.5-11 7.5S2.73 16.39 1 12c1.73-4.39 6-7.5 11-7.5M3.18 12a9.82 9.82 0 0 0 17.64 0 9.82 9.82 0 0 0-17.64 0"
      />
    </svg>
  );
}

function OlhoCortadoIcone() {
  return (
    <svg {...tamanho} aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M2 4.27 3.28 3 21 20.72 19.73 22l-3.13-3.13A11.7 11.7 0 0 1 12 19.5c-5 0-9.27-3.11-11-7.5a11.8 11.8 0 0 1 4.06-5.17Zm10.72 10.72-1.7-1.7a2 2 0 0 0 1.7 1.7M12 4.5c5 0 9.27 3.11 11 7.5a11.8 11.8 0 0 1-4.06 5.17l-2.14-2.14A5 5 0 0 0 9.97 8.1L7.8 5.93A11.7 11.7 0 0 1 12 4.5"
      />
    </svg>
  );
}
