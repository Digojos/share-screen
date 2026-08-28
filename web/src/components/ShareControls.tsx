import { capturaDisponivel, type ScreenShareControls } from '../rtc/useScreenShare';

interface ShareControlsProps {
  share: ScreenShareControls;
  onStart: () => void;
  onStop: () => void;
}

/**
 * A caixinha de audio do sistema fica em lugares diferentes conforme o que foi
 * escolhido, e para "Janela" ela nao existe. Uma dica generica ("marque
 * compartilhar audio") manda a pessoa procurar onde nao tem.
 */
function dicaDeAudio(surface: string | null): string {
  switch (surface) {
    case 'monitor':
      return 'Sem audio do sistema — a caixinha "Compartilhar audio do sistema" fica no canto inferior esquerdo do seletor, antes de confirmar.';
    case 'window':
      return 'Compartilhar uma janela nunca leva audio. Use "Tela inteira" ou uma aba do navegador.';
    case 'browser':
      return 'Sem audio da guia — marque "Compartilhar audio da guia" no seletor.';
    default:
      return 'Sem audio do sistema. Escolha "Tela inteira" e marque a opcao de audio no seletor.';
  }
}

export function ShareControls({ share, onStart, onStop }: ShareControlsProps) {
  // Avisar ANTES do clique: descobrir que nao da para compartilhar so depois de
  // tentar, num servidor de teste, custa muito mais tempo do que parece.
  const bloqueadoPorHttp = !capturaDisponivel();

  return (
    <section className="controls">
      {share.sharing ? (
        <button type="button" className="danger" onClick={onStop}>
          Parar compartilhamento
        </button>
      ) : (
        <button type="button" className="primary" onClick={onStart} disabled={bloqueadoPorHttp}>
          Compartilhar tela
        </button>
      )}

      {bloqueadoPorHttp && (
        <span className="badge error">
          Sem HTTPS o navegador bloqueia a captura de tela e o microfone. Use um dominio com
          certificado, ou acesse por localhost.
        </span>
      )}

      {share.sharing && (
        <button type="button" onClick={() => void share.switchSource()}>
          Trocar de tela
        </button>
      )}

      {share.sharing && !share.hasSystemAudio && (
        <span className="badge warn">{dicaDeAudio(share.displaySurface)}</span>
      )}

      {share.error && <span className="badge error">{share.error}</span>}
    </section>
  );
}
