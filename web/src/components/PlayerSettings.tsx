import { useEffect, useRef, useState } from 'react';
import type { ScreenShareControls } from '../rtc/useScreenShare';
import {
  CODECS,
  FRAME_RATES,
  RESOLUTIONS,
  VIDEO_PROFILES,
  type CodecId,
  type FrameRateId,
  type ResolutionId,
  type VideoProfileId,
} from '../rtc/videoProfiles';

interface PlayerSettingsProps {
  profileId: VideoProfileId;
  onProfile: (id: VideoProfileId) => void;
  codecId: CodecId;
  onCodec: (id: CodecId) => void;
  resolutionId: ResolutionId;
  onResolution: (id: ResolutionId) => void;
  frameRateId: FrameRateId;
  onFrameRate: (id: FrameRateId) => void;
  share: ScreenShareControls;
}

/**
 * Configuracoes de transmissao, atras de uma engrenagem no proprio player.
 *
 * Ficavam soltas embaixo do video como tres fileiras de botoes — nove ao todo,
 * competindo com as acoes de fato frequentes (compartilhar, microfone). Sao
 * escolhas que se faz uma vez e raramente se revisita, entao pertencem a um
 * painel; microfone e som seguem na barra, a um clique, porque sao usados o
 * tempo todo.
 */
export function PlayerSettings({
  profileId,
  onProfile,
  codecId,
  onCodec,
  resolutionId,
  onResolution,
  frameRateId,
  onFrameRate,
  share,
}: PlayerSettingsProps) {
  const [aberto, setAberto] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Fechar por clique fora e por Esc: o painel cobre parte do video, e ficar
  // preso nele em tela cheia seria irritante.
  useEffect(() => {
    if (!aberto) return undefined;

    function onPointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setAberto(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setAberto(false);
    }

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [aberto]);

  return (
    <div className="player-settings" ref={containerRef}>
      <button
        type="button"
        className="player-settings-toggle"
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        aria-label="Configuracoes de transmissao"
        title="Configuracoes"
      >
        <EngrenagemIcone />
      </button>

      {aberto && (
        <div className="player-settings-panel" role="dialog" aria-label="Configuracoes">
          <Grupo
            titulo="Sob pressao, priorizar"
            opcoes={Object.values(VIDEO_PROFILES)}
            selecionado={profileId}
            onEscolher={(id) => onProfile(id as VideoProfileId)}
          />
          <Grupo
            titulo="Codec"
            opcoes={Object.values(CODECS)}
            selecionado={codecId}
            onEscolher={(id) => onCodec(id as CodecId)}
          />
          <Grupo
            titulo="Resolucao"
            opcoes={Object.values(RESOLUTIONS)}
            selecionado={resolutionId}
            onEscolher={(id) => onResolution(id as ResolutionId)}
          />
          <Grupo
            titulo="Quadros por segundo"
            opcoes={Object.values(FRAME_RATES)}
            selecionado={frameRateId}
            onEscolher={(id) => onFrameRate(id as FrameRateId)}
            rodape={
              share.maxFrameRate
                ? `Esta fonte aceita ate ${share.maxFrameRate} fps.`
                : undefined
            }
          />

          <section className="player-settings-grupo">
            <h3>Audio do sistema</h3>
            <p className="player-settings-dica">
              {share.hasSystemAudio
                ? 'Capturando o som da tela compartilhada.'
                : dicaDeAudio(share.displaySurface)}
            </p>
          </section>
        </div>
      )}
    </div>
  );
}

interface Opcao {
  id: string;
  label: string;
  hint?: string;
}

function Grupo({
  titulo,
  opcoes,
  selecionado,
  onEscolher,
  rodape,
}: {
  titulo: string;
  opcoes: Opcao[];
  selecionado: string;
  onEscolher: (id: string) => void;
  /** Informacao medida do ambiente, exibida abaixo da dica da opcao. */
  rodape?: string;
}) {
  const atual = opcoes.find((o) => o.id === selecionado);
  return (
    <section className="player-settings-grupo">
      <h3>{titulo}</h3>
      <div className="player-settings-opcoes">
        {opcoes.map((opcao) => (
          <button
            key={opcao.id}
            type="button"
            className={opcao.id === selecionado ? 'toggle on' : 'toggle off'}
            onClick={() => onEscolher(opcao.id)}
            title={opcao.hint}
          >
            {opcao.label}
          </button>
        ))}
      </div>
      {/* A dica acompanha o que esta selecionado: sem ela o nome do codec nao
          diz nada sobre o que se ganha ou perde ao trocar. */}
      {atual?.hint && <p className="player-settings-dica">{atual.hint}</p>}
      {rodape && <p className="player-settings-dica">{rodape}</p>}
    </section>
  );
}

function dicaDeAudio(surface: string | null): string {
  switch (surface) {
    case 'monitor':
      return 'Marque "Compartilhar audio do sistema" no canto inferior esquerdo do seletor, antes de confirmar.';
    case 'window':
      return 'Compartilhar uma janela nunca leva audio. Use "Tela inteira" ou uma aba.';
    case 'browser':
      return 'Marque "Compartilhar audio da guia" no seletor.';
    default:
      return 'Escolha "Tela inteira" e marque a opcao de audio no seletor.';
  }
}

function EngrenagemIcone() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M12 15.5A3.5 3.5 0 1 1 15.5 12 3.5 3.5 0 0 1 12 15.5m7.43-2.53a7.7 7.7 0 0 0 0-1.94l2.03-1.58a.5.5 0 0 0 .12-.62l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.3 7.3 0 0 0-1.68-.97l-.36-2.54a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.5.42l-.36 2.54c-.6.24-1.16.57-1.68.97l-2.39-.96a.5.5 0 0 0-.6.22L2.42 8.83a.5.5 0 0 0 .12.62l2.03 1.58a7.7 7.7 0 0 0 0 1.94l-2.03 1.58a.5.5 0 0 0-.12.62l1.92 3.32c.12.22.38.3.6.22l2.39-.96c.52.4 1.08.73 1.68.97l.36 2.54c.04.24.25.42.5.42h3.84c.25 0 .46-.18.5-.42l.36-2.54c.6-.24 1.16-.57 1.68-.97l2.39.96c.22.08.48 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.62Z"
      />
    </svg>
  );
}
