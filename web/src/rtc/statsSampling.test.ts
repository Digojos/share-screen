import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { PeerManager, EMPTY_MEDIA } from './PeerManager';
import { FakeRTCPeerConnection, installFakeRtc, fakeStream, fakeTrack } from './testing/fakeRtc';

let restaurar: () => void;
beforeEach(() => { restaurar = installFakeRtc(); });
afterEach(() => restaurar());

describe('amostragem de estatisticas', () => {
  it('consulta um peer por ciclo, e nao todos', async () => {
    const manager = new PeerManager('aaa', [], {
      onOffer: () => {}, onAnswer: () => {}, onIceCandidate: () => {},
      onRemoteStream: () => {}, onStateChange: () => {},
    });
    manager.setLocalMedia({ stream: fakeStream(), video: fakeTrack('video'), screenAudio: null, mic: null });
    manager.addPeer('b'); manager.addPeer('c'); manager.addPeer('d');

    let chamadas = 0;
    for (const pc of FakeRTCPeerConnection.instances) {
      pc.getStats = async () => { chamadas += 1; return new Map(); };
    }

    await manager.getOutboundVideoStats();
    expect(chamadas).toBe(1);

    await manager.getOutboundVideoStats();
    await manager.getOutboundVideoStats();
    expect(chamadas).toBe(3);
  });
});
