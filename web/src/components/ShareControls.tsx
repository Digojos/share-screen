import type { ScreenShareControls } from '../rtc/useScreenShare';

interface ShareControlsProps {
  share: ScreenShareControls;
  onStart: () => void;
  onStop: () => void;
}

export function ShareControls({ share, onStart, onStop }: ShareControlsProps) {
  return (
    <section className="controls">
      {share.sharing ? (
        <button type="button" className="danger" onClick={onStop}>
          Parar compartilhamento
        </button>
      ) : (
        <button type="button" className="primary" onClick={onStart}>
          Compartilhar tela
        </button>
      )}

      {share.sharing && (
        <button type="button" onClick={() => void share.switchSource()}>
          Trocar de tela
        </button>
      )}

      {share.sharing && !share.hasSystemAudio && (
        <span className="badge">
          Sem audio do sistema — marque &quot;compartilhar audio&quot; ao escolher a aba
        </span>
      )}

      {share.error && <span className="badge error">{share.error}</span>}
    </section>
  );
}
