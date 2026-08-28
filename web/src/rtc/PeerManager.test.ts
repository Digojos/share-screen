import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_MEDIA, PeerManager, type LocalMedia } from './PeerManager';
import { VIDEO_PROFILES } from './videoProfiles';
import { CODECS } from './videoProfiles';
import {
  fakeStream,
  fakeTrack,
  FakeRTCPeerConnection,
  installFakeRtc,
} from './testing/fakeRtc';

/**
 * Estes casos cobrem exatamente onde ja houve bug real: perfect negotiation,
 * fila de candidatos ICE e reaproveitamento de senders. Sao invisiveis para o
 * typecheck — o compilador aceita feliz um `replaceTrack` que perde o sender.
 */

function novoManager(selfId: string, media: LocalMedia = EMPTY_MEDIA) {
  const enviados = {
    ofertas: [] as Array<{ to: string }>,
    respostas: [] as Array<{ to: string }>,
    candidatos: [] as Array<{ to: string }>,
  };
  const manager = new PeerManager(selfId, [], {
    onOffer: (to) => enviados.ofertas.push({ to }),
    onAnswer: (to) => enviados.respostas.push({ to }),
    onIceCandidate: (to) => enviados.candidatos.push({ to }),
    onRemoteStream: () => {},
    onStateChange: () => {},
  });
  manager.setLocalMedia(media);
  return { manager, enviados };
}

function midiaComVideo(): LocalMedia {
  return { stream: fakeStream(), video: fakeTrack('video'), screenAudio: null, mic: null };
}

let restaurar: () => void;

beforeEach(() => {
  restaurar = installFakeRtc();
});

afterEach(() => {
  restaurar();
  vi.restoreAllMocks();
});

describe('papel polite', () => {
  it('sai da comparacao de ids, e os dois lados chegam a valores opostos', async () => {
    // A malha nao tem "quem sempre inicia": os dois lados precisam decidir
    // sozinhos, sem combinar, ou uma colisao de ofertas trava a conexao.
    const a = novoManager('aaa', midiaComVideo());
    const b = novoManager('zzz', midiaComVideo());

    a.manager.addPeer('zzz');
    b.manager.addPeer('aaa');

    // Colisao: os dois recebem uma oferta enquanto tem uma propria em curso.
    const pcA = FakeRTCPeerConnection.instances[0]!;
    const pcB = FakeRTCPeerConnection.instances[1]!;
    pcA.signalingState = 'have-local-offer';
    pcB.signalingState = 'have-local-offer';

    await a.manager.handleDescription('zzz', { type: 'offer', sdp: 'x' });
    await b.manager.handleDescription('aaa', { type: 'offer', sdp: 'x' });

    // Exatamente um dos dois deve ceder — se ambos cedessem ou ambos
    // ignorassem, a negociacao nao terminaria.
    const aCedeu = pcA.remoteDescription !== null;
    const bCedeu = pcB.remoteDescription !== null;
    expect(aCedeu).not.toBe(bCedeu);
  });
});

describe('fila de candidatos ICE', () => {
  it('guarda candidatos que chegam antes da descricao remota e aplica depois', async () => {
    const { manager } = novoManager('aaa');
    manager.addPeer('bbb');
    const pc = FakeRTCPeerConnection.instances[0]!;

    // Trickle ICE: o candidato pode chegar antes da descricao. Aplicar agora
    // lancaria InvalidStateError e o candidato seria perdido em silencio.
    await manager.handleIceCandidate('bbb', {
      candidate: 'cand-1',
      sdpMid: '0',
      sdpMLineIndex: 0,
    });
    expect(pc.appliedCandidates).toHaveLength(0);

    await manager.handleDescription('bbb', { type: 'offer', sdp: 'x' });

    expect(pc.appliedCandidates).toHaveLength(1);
    expect(pc.appliedCandidates[0]?.candidate).toBe('cand-1');
  });

  it('aplica direto quando a descricao remota ja existe', async () => {
    const { manager } = novoManager('aaa');
    manager.addPeer('bbb');
    const pc = FakeRTCPeerConnection.instances[0]!;

    await manager.handleDescription('bbb', { type: 'offer', sdp: 'x' });
    await manager.handleIceCandidate('bbb', {
      candidate: 'cand-2',
      sdpMid: '0',
      sdpMLineIndex: 0,
    });

    expect(pc.appliedCandidates.map((c) => c.candidate)).toEqual(['cand-2']);
  });
});

describe('sincronizacao de senders', () => {
  it('usa addTrack na primeira vez e replaceTrack depois', () => {
    const { manager } = novoManager('aaa', midiaComVideo());
    manager.addPeer('bbb');
    const pc = FakeRTCPeerConnection.instances[0]!;

    expect(pc.addedTracks).toHaveLength(1);

    // Trocar de tela nao pode refazer a conexao: e o que mantem a troca
    // instantanea para quem assiste.
    const outra = midiaComVideo();
    manager.setLocalMedia(outra);

    expect(pc.addedTracks).toHaveLength(1);
    expect(pc.senders[0]?.replaced).toEqual([outra.video]);
  });

  it('mantem o sender apos replaceTrack(null)', () => {
    // Este foi um bug real: identificar o sender por `track.kind` o perdia
    // depois de um replaceTrack(null), e o segundo compartilhamento nao
    // chegava a quem assistia.
    const { manager } = novoManager('aaa', midiaComVideo());
    manager.addPeer('bbb');
    const pc = FakeRTCPeerConnection.instances[0]!;

    manager.setLocalMedia(EMPTY_MEDIA);
    expect(pc.senders[0]?.track).toBeNull();

    const retomada = midiaComVideo();
    manager.setLocalMedia(retomada);

    expect(pc.addedTracks).toHaveLength(1);
    expect(pc.senders).toHaveLength(1);
    expect(pc.senders[0]?.track).toBe(retomada.video);
  });

  it('mantem senders separados por papel, sem embaralhar microfone e tela', () => {
    const { manager } = novoManager('aaa');
    manager.addPeer('bbb');
    const pc = FakeRTCPeerConnection.instances[0]!;

    const video = fakeTrack('video');
    const mic = fakeTrack('audio');
    const stream = fakeStream();

    manager.setLocalMedia({ stream, video, screenAudio: null, mic: null });
    manager.setLocalMedia({ stream, video, screenAudio: null, mic });

    // O microfone entrou depois: precisa de sender proprio, sem sobrescrever o
    // do video.
    expect(pc.addedTracks.map((t) => t.track.kind)).toEqual(['video', 'audio']);
    expect(pc.senders[0]?.track).toBe(video);
    expect(pc.senders[1]?.track).toBe(mic);
  });
});

describe('ciclo de vida do peer', () => {
  it('removePeer fecha a conexao e limpa os handlers', () => {
    const { manager } = novoManager('aaa', midiaComVideo());
    manager.addPeer('bbb');
    const pc = FakeRTCPeerConnection.instances[0]!;

    manager.removePeer('bbb');

    // Sem limpar os handlers, uma conexao morta continua chamando de volta
    // para dentro do manager depois de uma reconexao.
    expect(pc.closed).toBe(true);
    expect(pc.onnegotiationneeded).toBeNull();
    expect(pc.ontrack).toBeNull();
    expect(pc.onicecandidate).toBeNull();
    expect(pc.onconnectionstatechange).toBeNull();
  });

  it('addPeer e idempotente para o mesmo peer', () => {
    const { manager } = novoManager('aaa', midiaComVideo());
    manager.addPeer('bbb');
    manager.addPeer('bbb');

    // Numa malha, os dois lados chamam addPeer; criar duas conexoes para o
    // mesmo peer duplicaria a midia.
    expect(FakeRTCPeerConnection.instances).toHaveLength(1);
  });

  it('close derruba todas as conexoes', () => {
    const { manager } = novoManager('aaa', midiaComVideo());
    manager.addPeer('bbb');
    manager.addPeer('ccc');

    manager.close();

    expect(FakeRTCPeerConnection.instances.every((pc) => pc.closed)).toBe(true);
  });
});

describe('perfil de video', () => {
  it('nao quebra quando encodings ainda nao existe', async () => {
    // Antes da negociacao terminar `getParameters().encodings` vem vazio e
    // `setParameters` rejeita. Desistir silenciosamente e proposital: o
    // onconnectionstatechange reaplica quando a conexao fica pronta.
    const { manager } = novoManager('aaa', midiaComVideo());
    manager.addPeer('bbb');
    const pc = FakeRTCPeerConnection.instances[0]!;
    const sender = pc.senders[0]! as unknown as Record<string, unknown>;

    sender.getParameters = () => ({ encodings: [] });
    sender.setParameters = () => {
      throw new Error('nao deveria ser chamado com encodings vazio');
    };

    expect(() => manager.setVideoProfile(VIDEO_PROFILES.fluidez)).not.toThrow();
  });

  it('aplica teto de bitrate e preferencia de degradacao quando ha encodings', async () => {
    const { manager } = novoManager('aaa', midiaComVideo());
    manager.addPeer('bbb');
    const pc = FakeRTCPeerConnection.instances[0]!;
    const sender = pc.senders[0]! as unknown as Record<string, unknown>;

    const aplicados: Array<Record<string, unknown>> = [];
    sender.getParameters = () => ({ encodings: [{}] });
    sender.setParameters = async (p: Record<string, unknown>) => {
      aplicados.push(p);
    };

    manager.setVideoProfile(VIDEO_PROFILES.fluidez);
    await vi.waitFor(() => expect(aplicados).toHaveLength(1));

    const parametros = aplicados[0]!;
    expect(parametros.degradationPreference).toBe('maintain-framerate');
    expect((parametros.encodings as Array<{ maxBitrate: number }>)[0]?.maxBitrate).toBe(
      VIDEO_PROFILES.fluidez.maxBitrate,
    );
  });
});

describe('preferencia de codec', () => {
  it('poe o codec escolhido na frente, sem descartar os demais', () => {
    // O navegador negocia VP8 por padrao — o pior deles — so por ser o
    // primeiro da lista. Reordenar e a maior melhoria de qualidade sem gastar
    // banda; manter o resto da lista evita falhar com um par que nao suporte.
    const { manager } = novoManager('aaa', midiaComVideo());
    manager.addPeer('bbb');
    const pc = FakeRTCPeerConnection.instances[0]!;

    manager.setCodec(CODECS.vp9);

    const ordem = (pc.codecPreferences as Array<{ mimeType: string }>).map((c) => c.mimeType);
    expect(ordem[0]).toBe('video/VP9');
    expect(ordem).toContain('video/VP8');
    expect(ordem).toHaveLength(4);
  });

  it('nao mexe na ordem quando o codec e "automatico"', () => {
    const { manager } = novoManager('aaa', midiaComVideo());
    manager.addPeer('bbb');
    const pc = FakeRTCPeerConnection.instances[0]!;

    manager.setCodec(CODECS.auto);

    expect(pc.codecPreferences).toHaveLength(0);
  });

  it('sobrevive a um navegador sem a API de codecs', () => {
    // Preferir codec e upgrade, nao requisito: quebrar aqui derrubaria a
    // publicacao de midia inteira em navegadores mais antigos.
    const global = globalThis as Record<string, unknown>;
    const anterior = global.RTCRtpSender;
    global.RTCRtpSender = undefined;

    const { manager } = novoManager('aaa', midiaComVideo());
    expect(() => manager.addPeer('bbb')).not.toThrow();
    expect(() => manager.setCodec(CODECS.vp9)).not.toThrow();

    global.RTCRtpSender = anterior;
  });
});
