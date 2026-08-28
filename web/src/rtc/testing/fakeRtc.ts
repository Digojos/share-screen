/**
 * RTCPeerConnection falsa para testar o PeerManager sem navegador.
 *
 * O PeerManager nao fala com a rede: ele decide QUANDO chamar cada coisa. Entao
 * o dublê so precisa registrar as chamadas e simular os poucos estados que a
 * logica consulta (`signalingState`, `remoteDescription`).
 */

export interface FakeSender {
  track: MediaStreamTrack | null;
  replaceTrack: (track: MediaStreamTrack | null) => Promise<void>;
  /** Historico de replaceTrack, para verificar que o sender foi reaproveitado. */
  replaced: Array<MediaStreamTrack | null>;
  /**
   * Por padrao devolve `encodings` vazio — que e o estado real antes da
   * negociacao terminar, e o caminho em que o PeerManager desiste de aplicar o
   * perfil. Os testes de perfil substituem estes dois metodos.
   */
  getParameters: () => { encodings: unknown[] };
  setParameters: (parameters: unknown) => Promise<void>;
}

export class FakeRTCPeerConnection {
  static instances: FakeRTCPeerConnection[] = [];

  onnegotiationneeded: (() => void) | null = null;
  onicecandidate: ((event: { candidate: RTCIceCandidate | null }) => void) | null = null;
  ontrack: ((event: { streams: MediaStream[] }) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;

  signalingState: RTCSignalingState = 'stable';
  connectionState: RTCPeerConnectionState = 'new';
  remoteDescription: RTCSessionDescriptionInit | null = null;
  localDescription: { toJSON: () => unknown } | null = null;

  closed = false;
  readonly senders: FakeSender[] = [];
  readonly addedTracks: Array<{ track: MediaStreamTrack; stream: MediaStream }> = [];
  readonly appliedCandidates: RTCIceCandidateInit[] = [];
  /** Erros que `addIceCandidate` deve lancar, na ordem. */
  candidateErrors: Error[] = [];

  constructor(public readonly config?: RTCConfiguration) {
    FakeRTCPeerConnection.instances.push(this);
  }

  addTrack(track: MediaStreamTrack, stream: MediaStream): FakeSender {
    this.addedTracks.push({ track, stream });
    const sender: FakeSender = {
      track,
      replaced: [],
      replaceTrack: async (next) => {
        sender.replaced.push(next);
        sender.track = next;
      },
      getParameters: () => ({ encodings: [] }),
      setParameters: async () => {},
    };
    this.senders.push(sender);
    // addTrack dispara renegociacao no navegador real; o PeerManager depende
    // disso para enviar a oferta.
    this.onnegotiationneeded?.();
    return sender;
  }

  getSenders(): FakeSender[] {
    return this.senders;
  }

  async setLocalDescription(): Promise<void> {
    this.localDescription = { toJSON: () => ({ type: 'offer', sdp: 'fake-sdp' }) };
  }

  async setRemoteDescription(description: RTCSessionDescriptionInit): Promise<void> {
    this.remoteDescription = description;
    this.signalingState = description.type === 'offer' ? 'have-remote-offer' : 'stable';
  }

  async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    const erro = this.candidateErrors.shift();
    if (erro) throw erro;
    this.appliedCandidates.push(candidate);
  }

  restartIce(): void {}

  close(): void {
    this.closed = true;
  }

  async getStats(): Promise<Map<string, unknown>> {
    return new Map();
  }
}

/** Track falsa; o PeerManager so lê `kind`. */
export function fakeTrack(kind: 'video' | 'audio'): MediaStreamTrack {
  return { kind, id: `${kind}-${Math.random()}` } as unknown as MediaStreamTrack;
}

export function fakeStream(): MediaStream {
  return { id: 'stream' } as unknown as MediaStream;
}

/** Instala o dublê no escopo global e devolve a limpeza. */
export function installFakeRtc(): () => void {
  const anterior = (globalThis as Record<string, unknown>).RTCPeerConnection;
  FakeRTCPeerConnection.instances = [];
  (globalThis as Record<string, unknown>).RTCPeerConnection = FakeRTCPeerConnection;
  return () => {
    (globalThis as Record<string, unknown>).RTCPeerConnection = anterior;
  };
}
