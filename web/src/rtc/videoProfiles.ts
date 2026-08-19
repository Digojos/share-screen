/**
 * Perfis de codificacao do video compartilhado.
 *
 * Tela de trabalho e jogo pedem coisas opostas: texto quer resolucao intacta
 * mesmo que o movimento engasgue; jogo quer fluidez mesmo perdendo nitidez.
 * Nao da para escolher um so, entao o host alterna.
 */
export type VideoProfileId = 'apresentacao' | 'jogo';

export interface VideoProfile {
  id: VideoProfileId;
  label: string;
  hint: string;
  contentHint: 'text' | 'motion';
  frameRate: number;
  /**
   * Teto POR espectador. Numa malha o host envia uma copia para cada um, entao
   * o consumo real e este valor multiplicado pelo numero de espectadores.
   */
  maxBitrate: number;
  degradationPreference: RTCDegradationPreference;
}

export const VIDEO_PROFILES: Record<VideoProfileId, VideoProfile> = {
  apresentacao: {
    id: 'apresentacao',
    label: 'Apresentacao',
    hint: 'Texto nitido — codigo, slides, documentos',
    contentHint: 'text',
    frameRate: 30,
    maxBitrate: 2_500_000,
    degradationPreference: 'maintain-resolution',
  },
  jogo: {
    id: 'jogo',
    label: 'Jogo',
    hint: 'Movimento fluido — jogos e video',
    contentHint: 'motion',
    frameRate: 60,
    maxBitrate: 6_000_000,
    degradationPreference: 'maintain-framerate',
  },
};

export const DEFAULT_PROFILE: VideoProfileId = 'apresentacao';

/**
 * Limite de resolucao da captura.
 *
 * E um TETO, nao um alvo: compartilhar uma janela de 800x600 em "Full HD" nao
 * inventa pixels. Limitar na captura (e nao no encoder) tambem poupa CPU, que
 * costuma ser o gargalo antes da banda.
 */
export type ResolutionId = 'auto' | 'fhd' | 'hd';

export interface ResolutionOption {
  id: ResolutionId;
  label: string;
  /** null = sem limite, usa a resolucao nativa da fonte. */
  maxWidth: number | null;
  maxHeight: number | null;
}

export const RESOLUTIONS: Record<ResolutionId, ResolutionOption> = {
  auto: { id: 'auto', label: 'Nativa', maxWidth: null, maxHeight: null },
  fhd: { id: 'fhd', label: 'Full HD', maxWidth: 1920, maxHeight: 1080 },
  hd: { id: 'hd', label: 'HD', maxWidth: 1280, maxHeight: 720 },
};

export const DEFAULT_RESOLUTION: ResolutionId = 'auto';
