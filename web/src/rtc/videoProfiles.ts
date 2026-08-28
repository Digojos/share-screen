/**
 * O que priorizar quando a banda ou a CPU nao dao conta de tudo.
 *
 * Nao se confunde com FPS, que e escolha propria: aqui se decide **o que
 * sacrificar primeiro**. Texto quer resolucao intacta mesmo que o movimento
 * engasgue; jogo quer o contrario. Um valor so nao serve para os dois.
 */
export type VideoProfileId = 'nitidez' | 'fluidez';

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
  nitidez: {
    id: 'nitidez',
    label: 'Nitidez',
    hint: 'Preserva resolucao e deixa o movimento engasgar — codigo, slides',
    contentHint: 'text',
    frameRate: 30,
    maxBitrate: 2_500_000,
    degradationPreference: 'maintain-resolution',
  },
  fluidez: {
    id: 'fluidez',
    label: 'Fluidez',
    hint: 'Preserva os quadros e deixa a imagem perder nitidez — jogos e video',
    contentHint: 'motion',
    frameRate: 60,
    // Teto alto de proposito: `maxBitrate` NAO force o envio a subir — o
    // controle de congestionamento continua mandando. Um teto baixo, sim,
    // impede uma conexao boa de usar a folga que tem.
    maxBitrate: 12_000_000,
    degradationPreference: 'maintain-framerate',
  },
};

export const DEFAULT_PROFILE: VideoProfileId = 'nitidez';

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

/**
 * Codec de video.
 *
 * O navegador oferece VP8, H264, VP9, AV1 e H265, mas negocia **VP8** por ser o
 * primeiro da lista padrao — e VP8 e o mais antigo e o que pior comprime. Trocar
 * o codec e a maior melhoria de qualidade disponivel sem tocar em banda.
 *
 * Nao ha um vencedor universal: VP9 e AV1 entregam mais qualidade por bit, mas
 * costumam codificar por software e podem estourar a CPU em 1080p60; H264 quase
 * sempre tem encoder de hardware (NVENC, QuickSync) e sustenta o framerate com
 * folga, mesmo comprimindo pior. O painel de diagnostico do host diz qual dos
 * dois problemas voce tem: `cpu` pede H264, `bandwidth` pede VP9 ou AV1.
 */
export type CodecId = 'auto' | 'vp9' | 'av1' | 'h264';

export interface CodecOption {
  id: CodecId;
  label: string;
  hint: string;
  /** Trecho do mimeType a preferir; `null` mantem a ordem do navegador. */
  mime: string | null;
}

export const CODECS: Record<CodecId, CodecOption> = {
  vp9: {
    id: 'vp9',
    label: 'VP9',
    hint: 'Melhor qualidade por bit; exige mais CPU que H264',
    mime: 'video/VP9',
  },
  av1: {
    id: 'av1',
    label: 'AV1',
    hint: 'A melhor compressao; so vale com encoder de hardware recente',
    mime: 'video/AV1',
  },
  h264: {
    id: 'h264',
    label: 'H264',
    hint: 'Encoder de hardware quase sempre; sustenta 60fps com CPU baixa',
    mime: 'video/H264',
  },
  auto: {
    id: 'auto',
    label: 'Automatico',
    hint: 'Ordem do navegador — costuma cair em VP8, o pior deles',
    mime: null,
  },
};

/** VP9 e o melhor equilibrio na maioria das maquinas; VP8 nunca deveria ser o padrao. */
export const DEFAULT_CODEC: CodecId = 'vp9';

/**
 * Taxa de quadros.
 *
 * Vinha embutida no perfil (Apresentacao 30, Jogo 60), o que impedia
 * combinacoes validas — "movimento fluido a 30" quando a CPU nao sustenta 60,
 * por exemplo. Agora e uma escolha propria, com "Automatico" preservando o
 * comportamento de antes.
 *
 * O valor e um PEDIDO (`frameRate: { ideal }`), nao uma garantia: a fonte pode
 * entregar menos, e o encoder derruba quando falta CPU ou banda. O diagnostico
 * do host mostra o que esta saindo de fato.
 */
export type FrameRateId = 'auto' | 'fps15' | 'fps30' | 'fps60';

export interface FrameRateOption {
  id: FrameRateId;
  label: string;
  hint: string;
  /** null = segue o perfil de qualidade. */
  value: number | null;
}

export const FRAME_RATES: Record<FrameRateId, FrameRateOption> = {
  auto: {
    id: 'auto',
    label: 'Automatico',
    hint: 'Segue a prioridade: 30 em Nitidez, 60 em Fluidez',
    value: null,
  },
  fps15: {
    id: 'fps15',
    label: '15',
    hint: 'Economiza banda e CPU; bom para slides e texto parado',
    value: 15,
  },
  fps30: {
    id: 'fps30',
    label: '30',
    hint: 'Suficiente para quase tudo, inclusive video',
    value: 30,
  },
  fps60: {
    id: 'fps60',
    label: '60',
    hint: 'Movimento fluido para jogos; dobra o custo de CPU e banda',
    value: 60,
  },
};

export const DEFAULT_FRAME_RATE: FrameRateId = 'auto';
