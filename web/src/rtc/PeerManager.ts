import type { IceCandidate, SessionDescription } from '@shared';
import {
  CODECS,
  DEFAULT_CODEC,
  DEFAULT_PROFILE,
  VIDEO_PROFILES,
  type CodecOption,
  type VideoProfile,
} from './videoProfiles';

export type PeerConnectionState = RTCPeerConnectionState;

/**
 * O que o navegador esta REALMENTE enviando, e por que reduziu.
 *
 * `qualityLimitationReason` e a resposta direta para "a qualidade caiu, por
 * que?": 'cpu' = o encoder nao da conta, 'bandwidth' = a estimativa de banda
 * nao permite, 'none' = nao ha limitacao (o que se ve e o maximo pedido).
 */
export interface OutboundVideoStats {
  frameWidth: number;
  frameHeight: number;
  framesPerSecond: number;
  qualityLimitationReason: string;
  peers: number;
}

/** Numeros minimos para distinguir "midia nao chegou" de "chegou e nao renderizou". */
export interface InboundVideoStats {
  bytesReceived: number;
  framesReceived: number;
  framesDecoded: number;
  frameWidth: number;
  frameHeight: number;
  codec: string;
}

export interface PeerManagerCallbacks {
  onOffer: (to: string, sdp: SessionDescription) => void;
  onAnswer: (to: string, sdp: SessionDescription) => void;
  onIceCandidate: (to: string, candidate: IceCandidate) => void;
  onRemoteStream: (peerId: string, stream: MediaStream) => void;
  onStateChange: (peerId: string, state: PeerConnectionState) => void;
}

/**
 * Midia local a publicar. As tracks vem separadas por papel (e nao apenas como
 * um MediaStream) para que cada uma tenha seu proprio sender fixo: assim ligar
 * o microfone no meio da sessao nao embaralha o sender do audio do sistema.
 */
export interface LocalMedia {
  /** Stream que agrupa as tracks do lado do receptor. */
  stream: MediaStream | null;
  video: MediaStreamTrack | null;
  screenAudio: MediaStreamTrack | null;
  mic: MediaStreamTrack | null;
}

export const EMPTY_MEDIA: LocalMedia = { stream: null, video: null, screenAudio: null, mic: null };

interface PeerEntry {
  pc: RTCPeerConnection;
  /** Perfect negotiation: o lado "polite" cede em caso de colisao de ofertas. */
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  /** Candidatos que chegaram antes da descricao remota. */
  pendingCandidates: IceCandidate[];
  /** Amostra anterior de envio, para calcular fps por diferenca. */
  lastFramesSent: number | null;
  lastSampleAt: number | null;
  /** Um sender por papel, para permitir replaceTrack sem renegociar. */
  videoSender: RTCRtpSender | null;
  screenAudioSender: RTCRtpSender | null;
  micSender: RTCRtpSender | null;
}

/**
 * Uma RTCPeerConnection por peer remoto, em malha completa.
 *
 * Com chat de voz todo mundo envia audio, entao qualquer par pode iniciar uma
 * oferta ao mesmo tempo. O papel "polite" do perfect negotiation nao pode mais
 * vir de host/espectador: e decidido comparando os ids, o que garante que os
 * dois lados cheguem a papeis opostos sem combinar nada.
 */
export class PeerManager {
  private readonly peers = new Map<string, PeerEntry>();

  private localMedia: LocalMedia = EMPTY_MEDIA;

  private videoProfile: VideoProfile = VIDEO_PROFILES[DEFAULT_PROFILE];

  private codec: CodecOption = CODECS[DEFAULT_CODEC];

  /** Rodizio da amostragem de estatisticas entre os peers. */
  private indiceAmostragem = -1;

  constructor(
    private readonly selfId: string,
    private iceServers: RTCIceServer[],
    private readonly callbacks: PeerManagerCallbacks,
  ) {}

  setIceServers(iceServers: RTCIceServer[]): void {
    this.iceServers = iceServers;
  }

  /**
   * Define (ou troca) a midia local publicada. Com conexoes ja abertas as tracks
   * sao substituidas via `replaceTrack`, que nao exige renegociacao — trocar a
   * janela compartilhada fica instantaneo para quem assiste.
   */
  setLocalMedia(media: LocalMedia): void {
    this.localMedia = media;
    for (const entry of this.peers.values()) {
      this.syncTracks(entry, media);
      void this.applyVideoProfile(entry);
    }
  }

  /**
   * Troca o perfil de codificacao (teto de bitrate e o que sacrificar sob
   * pressao de banda). Vale para todas as conexoes ja abertas.
   */
  setVideoProfile(profile: VideoProfile): void {
    this.videoProfile = profile;
    for (const entry of this.peers.values()) void this.applyVideoProfile(entry);
  }

  /**
   * Troca o codec de video. Diferente do bitrate, isso muda o SDP: exige uma
   * nova negociacao, entao cada conexao aberta refaz a oferta.
   */
  setCodec(codec: CodecOption): void {
    this.codec = codec;
    for (const entry of this.peers.values()) {
      this.applyCodecPreference(entry);
      void this.renegotiate(entry);
    }
  }

  /**
   * Reordena os codecs oferecidos no SDP. Sem isso o navegador escolhe pela
   * ordem padrao, que comeca em VP8 — o mais antigo e o que pior comprime.
   */
  private applyCodecPreference(entry: PeerEntry): void {
    if (!entry.videoSender) return;

    // Preferir codec e um upgrade, nao um requisito: onde a API nao existe, o
    // certo e cair no padrao do navegador em silencio, e nunca derrubar a
    // publicacao de midia por causa disso.
    if (typeof entry.pc.getTransceivers !== 'function') return;
    const transceiver = entry.pc
      .getTransceivers()
      .find((t) => t.sender === entry.videoSender);
    if (!transceiver || typeof transceiver.setCodecPreferences !== 'function') return;

    // Lista vazia devolve a ordem padrao do navegador. Sem isto, escolher
    // "Automatico" depois de outro codec nao desfazia nada: a preferencia
    // anterior continuava valendo.
    if (!this.codec.mime) {
      transceiver.setCodecPreferences([]);
      return;
    }

    if (typeof RTCRtpSender?.getCapabilities !== 'function') return;
    const disponiveis = RTCRtpSender.getCapabilities('video')?.codecs ?? [];
    const preferidos = disponiveis.filter((c) => c.mimeType === this.codec.mime);
    if (preferidos.length === 0) return; // navegador nao oferece; mantem o padrao

    // Os demais continuam na lista: se o outro lado nao suportar o preferido, a
    // negociacao ainda encontra um denominador comum em vez de falhar.
    const resto = disponiveis.filter((c) => c.mimeType !== this.codec.mime);
    try {
      transceiver.setCodecPreferences([...preferidos, ...resto]);
    } catch (error) {
      console.warn('[rtc] codec nao aceito, mantendo o padrao', error);
    }
  }

  /** Dispara uma oferta nova pelo mesmo caminho do `negotiationneeded`. */
  private async renegotiate(entry: PeerEntry): Promise<void> {
    if (entry.makingOffer || entry.pc.signalingState !== 'stable') return;
    try {
      entry.makingOffer = true;
      await entry.pc.setLocalDescription();
      if (entry.pc.localDescription) {
        const peerId = [...this.peers.entries()].find(([, e]) => e === entry)?.[0];
        if (peerId) {
          this.callbacks.onOffer(peerId, entry.pc.localDescription.toJSON() as SessionDescription);
        }
      }
    } catch (error) {
      console.error('[rtc] falha ao renegociar apos troca de codec', error);
    } finally {
      entry.makingOffer = false;
    }
  }

  /** Cria a conexao com um peer. O host inicia a oferta; o espectador espera. */
  addPeer(peerId: string): PeerEntry {
    const existing = this.peers.get(peerId);
    if (existing) return existing;

    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    const entry: PeerEntry = {
      pc,
      // Comparacao de ids: deterministica e simetrica, os dois lados concordam.
      polite: this.selfId < peerId,
      makingOffer: false,
      ignoreOffer: false,
      pendingCandidates: [],
      lastFramesSent: null,
      lastSampleAt: null,
      videoSender: null,
      screenAudioSender: null,
      micSender: null,
    };
    this.peers.set(peerId, entry);

    pc.onnegotiationneeded = async () => {
      try {
        entry.makingOffer = true;
        await pc.setLocalDescription();
        if (pc.localDescription) {
          this.callbacks.onOffer(peerId, pc.localDescription.toJSON() as SessionDescription);
        }
      } catch (error) {
        console.error('[rtc] falha ao criar oferta', error);
      } finally {
        entry.makingOffer = false;
      }
    };

    pc.onicecandidate = ({ candidate }) => {
      if (!candidate) return;
      this.callbacks.onIceCandidate(peerId, {
        candidate: candidate.candidate,
        sdpMid: candidate.sdpMid,
        sdpMLineIndex: candidate.sdpMLineIndex,
        usernameFragment: candidate.usernameFragment,
      });
    };

    pc.ontrack = ({ streams }) => {
      const [stream] = streams;
      if (stream) this.callbacks.onRemoteStream(peerId, stream);
    };

    pc.onconnectionstatechange = () => {
      this.callbacks.onStateChange(peerId, pc.connectionState);
      // `encodings` so existe depois da negociacao; reaplicar aqui garante que
      // o teto valha mesmo quando o perfil foi definido antes de conectar.
      if (pc.connectionState === 'connected') void this.applyVideoProfile(entry);
      // `failed` = o par de candidatos morreu (troca de rede, TURN expirado).
      // Um ICE restart costuma recuperar sem derrubar a sessao.
      if (pc.connectionState === 'failed') pc.restartIce();
    };

    // Adicionar tracks aqui dispara `negotiationneeded`, que envia a oferta.
    // Sem midia local nada e negociado — dois espectadores calados nao abrem
    // conexao ate um dos dois ligar o microfone.
    this.syncTracks(entry, this.localMedia);

    return entry;
  }

  removePeer(peerId: string): void {
    const entry = this.peers.get(peerId);
    if (!entry) return;
    entry.pc.onnegotiationneeded = null;
    entry.pc.onicecandidate = null;
    entry.pc.ontrack = null;
    entry.pc.onconnectionstatechange = null;
    entry.pc.close();
    this.peers.delete(peerId);
  }

  async handleDescription(peerId: string, description: SessionDescription): Promise<void> {
    const entry = this.peers.get(peerId) ?? this.addPeer(peerId);
    const { pc } = entry;

    const isOffer = description.type === 'offer';
    const readyForOffer = !entry.makingOffer && pc.signalingState === 'stable';
    const offerCollision = isOffer && !readyForOffer;

    entry.ignoreOffer = !entry.polite && offerCollision;
    if (entry.ignoreOffer) return;

    try {
      // Em colisao, o lado polite faz rollback implicito no setRemoteDescription.
      await pc.setRemoteDescription(description as RTCSessionDescriptionInit);
      await this.flushPendingCandidates(entry);

      if (isOffer) {
        await pc.setLocalDescription();
        if (pc.localDescription) {
          this.callbacks.onAnswer(peerId, pc.localDescription.toJSON() as SessionDescription);
        }
      }
    } catch (error) {
      console.error('[rtc] falha ao aplicar descricao remota', error);
    }
  }

  async handleIceCandidate(peerId: string, candidate: IceCandidate): Promise<void> {
    const entry = this.peers.get(peerId);
    if (!entry) return;

    // Trickle ICE: candidatos podem chegar antes da descricao remota, e nesse
    // caso addIceCandidate lanca InvalidStateError. Ficam na fila ate la.
    if (!entry.pc.remoteDescription) {
      entry.pendingCandidates.push(candidate);
      return;
    }

    try {
      await entry.pc.addIceCandidate(candidate);
    } catch (error) {
      if (!entry.ignoreOffer) console.error('[rtc] candidato ICE rejeitado', error);
    }
  }

  close(): void {
    for (const peerId of [...this.peers.keys()]) this.removePeer(peerId);
  }

  /**
   * Um peer por amostragem, em rodizio.
   *
   * `getStats()` coleta o relatorio inteiro do motor WebRTC e roda na thread
   * principal — a mesma do codificador. Percorrer todos os peers a cada ciclo
   * multiplica esse custo pelo numero de espectadores, justamente quando o host
   * ja esta mais carregado. Em rodizio a informacao continua chegando (so leva
   * alguns ciclos para cobrir todos), a um N-esimo do custo.
   */
  private proximoPeerAmostrado(): PeerEntry[] {
    const entries = [...this.peers.values()];
    if (entries.length === 0) return [];
    this.indiceAmostragem = (this.indiceAmostragem + 1) % entries.length;
    const entry = entries[this.indiceAmostragem];
    return entry ? [entry] : [];
  }

  /**
   * Estatisticas do video que esta CHEGANDO (lado do espectador). Uma tela
   * preta com `bytesReceived` zerado significa problema de transporte; com
   * bytes subindo e `framesDecoded` parado, o problema e de decodificacao.
   */
  async getInboundVideoStats(): Promise<InboundVideoStats | null> {
    const alvo = this.proximoPeerAmostrado();
    for (const entry of alvo) {
      const report = await entry.pc.getStats();
      const codecs = new Map<string, string>();
      let inbound: InboundVideoStats | null = null;

      report.forEach((stat) => {
        if (stat.type === 'codec') {
          const codec = stat as RTCStats & { mimeType?: string };
          codecs.set(stat.id, codec.mimeType ?? '');
        }
      });

      report.forEach((stat) => {
        if (stat.type !== 'inbound-rtp') return;
        const video = stat as RTCStats & {
          kind?: string;
          bytesReceived?: number;
          framesReceived?: number;
          framesDecoded?: number;
          frameWidth?: number;
          frameHeight?: number;
          codecId?: string;
        };
        if (video.kind !== 'video') return;
        inbound = {
          bytesReceived: video.bytesReceived ?? 0,
          framesReceived: video.framesReceived ?? 0,
          framesDecoded: video.framesDecoded ?? 0,
          frameWidth: video.frameWidth ?? 0,
          frameHeight: video.frameHeight ?? 0,
          codec: (video.codecId ? codecs.get(video.codecId) : '') ?? '',
        };
      });

      if (inbound) return inbound;
    }
    return null;
  }

  private async flushPendingCandidates(entry: PeerEntry): Promise<void> {
    const queued = entry.pendingCandidates.splice(0);
    for (const candidate of queued) {
      try {
        await entry.pc.addIceCandidate(candidate);
      } catch (error) {
        console.error('[rtc] candidato ICE em fila rejeitado', error);
      }
    }
  }

  /**
   * Alinha os senders da conexao com a midia local. Os senders sao guardados por
   * papel (e nao redescobertos por `track.kind`) porque apos um
   * `replaceTrack(null)` o sender fica sem track e deixaria de ser encontrado.
   */
  private syncTracks(entry: PeerEntry, media: LocalMedia): void {
    const tinhaVideo = entry.videoSender !== null;
    entry.videoSender = this.syncSender(entry.pc, entry.videoSender, media.video, media.stream);
    // O transceiver so existe depois do addTrack; preferir o codec aqui pega a
    // oferta que o `negotiationneeded` vai montar em seguida.
    if (!tinhaVideo && entry.videoSender) this.applyCodecPreference(entry);
    entry.screenAudioSender = this.syncSender(
      entry.pc,
      entry.screenAudioSender,
      media.screenAudio,
      media.stream,
    );
    entry.micSender = this.syncSender(entry.pc, entry.micSender, media.mic, media.stream);
  }

  /**
   * Aplica teto de bitrate e preferencia de degradacao no sender de video.
   *
   * Sem teto, o WebRTC sobe o bitrate ate onde a estimativa de banda permitir —
   * por conexao. Com varios espectadores, o host satura o proprio upload e a
   * qualidade cai para todos ao mesmo tempo.
   */
  /**
   * Estatisticas do video que esta SAINDO. Com varios espectadores, cada
   * conexao pode estar limitada por um motivo diferente; reportamos a pior
   * (qualquer limitacao real ganha de 'none') porque e ela que explica a queda.
   */
  async getOutboundVideoStats(): Promise<OutboundVideoStats | null> {
    let worst: OutboundVideoStats | null = null;

    for (const entry of this.proximoPeerAmostrado()) {
      const report = await entry.pc.getStats();
      report.forEach((stat) => {
        if (stat.type !== 'outbound-rtp') return;
        const video = stat as RTCStats & {
          kind?: string;
          frameWidth?: number;
          frameHeight?: number;
          framesPerSecond?: number;
          framesSent?: number;
          qualityLimitationReason?: string;
        };
        if (video.kind !== 'video') return;

        // `framesPerSecond` nao existe em todas as versoes do Chrome. Quando
        // falta, o fps sai da diferenca de `framesSent` entre duas amostras.
        const framesSent = video.framesSent ?? 0;
        let fps = video.framesPerSecond ?? 0;
        if (!fps && entry.lastFramesSent !== null && entry.lastSampleAt !== null) {
          const segundos = (stat.timestamp - entry.lastSampleAt) / 1000;
          if (segundos > 0) fps = (framesSent - entry.lastFramesSent) / segundos;
        }
        entry.lastFramesSent = framesSent;
        entry.lastSampleAt = stat.timestamp;

        const candidate: OutboundVideoStats = {
          frameWidth: video.frameWidth ?? 0,
          frameHeight: video.frameHeight ?? 0,
          framesPerSecond: Math.max(0, Math.round(fps)),
          qualityLimitationReason: video.qualityLimitationReason ?? 'none',
          peers: this.peers.size,
        };

        const piorQueOAtual =
          worst === null ||
          (worst.qualityLimitationReason === 'none' &&
            candidate.qualityLimitationReason !== 'none');
        if (piorQueOAtual) worst = candidate;
      });
    }

    return worst;
  }

  private async applyVideoProfile(entry: PeerEntry): Promise<void> {
    const sender = entry.videoSender;
    if (!sender) return;

    const parameters = sender.getParameters();
    // Antes da negociacao concluir, `encodings` vem vazio e setParameters
    // rejeita. Nesse caso desistimos: o onconnectionstatechange reaplica.
    if (!parameters.encodings || parameters.encodings.length === 0) return;

    parameters.degradationPreference = this.videoProfile.degradationPreference;
    for (const encoding of parameters.encodings) {
      encoding.maxBitrate = this.videoProfile.maxBitrate;
    }

    try {
      await sender.setParameters(parameters);
    } catch (error) {
      console.warn('[rtc] nao foi possivel aplicar o perfil de video', error);
    }
  }

  private syncSender(
    pc: RTCPeerConnection,
    sender: RTCRtpSender | null,
    track: MediaStreamTrack | null,
    stream: MediaStream | null,
  ): RTCRtpSender | null {
    if (sender) {
      void sender.replaceTrack(track);
      return sender;
    }
    if (track && stream) return pc.addTrack(track, stream);
    return null;
  }
}
