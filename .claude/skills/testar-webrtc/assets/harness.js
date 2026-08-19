/**
 * Bancada de teste do fluxo WebRTC.
 *
 * Injete o conteudo deste arquivo numa aba (via javascript_tool) ANTES de
 * qualquer interacao — os stubs precisam estar no lugar quando o app chamar
 * getDisplayMedia/getUserMedia.
 *
 * Expoe `window.T` com os helpers usados no roteiro da skill.
 */
window.T = (() => {
  const timers = [];

  /** Tela sintetica: canvas animado no lugar do seletor nativo. */
  function tela({ largura = 1280, altura = 720, fps = 30, cor = '#4c8dff' } = {}) {
    navigator.mediaDevices.getDisplayMedia = async () => {
      const canvas = document.createElement('canvas');
      canvas.width = largura;
      canvas.height = altura;
      const ctx = canvas.getContext('2d');
      let n = 0;
      // O quadrado em movimento importa: uma imagem estatica comprime tao bem
      // que mascara problemas de bitrate e de framerate.
      const id = setInterval(() => {
        n += 1;
        ctx.fillStyle = '#111';
        ctx.fillRect(0, 0, largura, altura);
        ctx.fillStyle = cor;
        ctx.fillRect((n * 12) % (largura - 80), altura / 2 - 40, 80, 80);
      }, 1000 / fps);
      timers.push(id);
      const stream = canvas.captureStream(fps);
      stream.getVideoTracks()[0].addEventListener('ended', () => clearInterval(id));
      return stream;
    };
    return `tela sintetica ${largura}x${altura} @${fps}fps`;
  }

  /**
   * Microfone sintetico. Use frequencias DIFERENTES por participante: e o que
   * prova de quem e o audio que chegou, e nao apenas que chegou algum audio.
   */
  function mic(hz = 440) {
    navigator.mediaDevices.getUserMedia = async () => {
      const ac = new AudioContext();
      const osc = ac.createOscillator();
      osc.frequency.value = hz;
      const destino = ac.createMediaStreamDestination();
      osc.connect(destino);
      osc.start();
      return destino.stream;
    };
    return `microfone sintetico em ${hz} Hz`;
  }

  /** Simula o usuario cancelando o seletor de tela. */
  function cancelarSeletor() {
    navigator.mediaDevices.getDisplayMedia = async () => {
      throw new DOMException('cancelado', 'NotAllowedError');
    };
    return 'proxima captura sera cancelada';
  }

  /**
   * Cliques do `computer` nao chegam quando o painel nao esta compositando.
   * `.click()` no elemento funciona sempre.
   */
  function clicar(textoDoBotao) {
    const alvo = [...document.querySelectorAll('button, a')].find((el) =>
      el.textContent.trim().includes(textoDoBotao),
    );
    if (!alvo) {
      const disponiveis = [...document.querySelectorAll('button, a')]
        .map((el) => el.textContent.trim())
        .join(' | ');
      return `NAO ENCONTRADO "${textoDoBotao}". Disponiveis: ${disponiveis}`;
    }
    alvo.click();
    return `clicado: ${alvo.textContent.trim()}`;
  }

  /** Inputs controlados do React ignoram atribuicao direta de value. */
  function digitar(seletor, valor) {
    const campo = document.querySelector(seletor);
    if (!campo) return `campo nao encontrado: ${seletor}`;
    const proto = campo instanceof HTMLTextAreaElement
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(campo, String(valor));
    campo.dispatchEvent(new Event('input', { bubbles: true }));
    return `preenchido: ${valor}`;
  }

  function enviarChat(texto) {
    digitar('.chat-form input', texto);
    document.querySelector('.chat-form')?.requestSubmit();
    return `enviado: ${texto}`;
  }

  /** Estado real do elemento de video — nao confie em "parece que apareceu". */
  function video() {
    const el = document.querySelector('video');
    if (!el) return { erro: 'sem elemento de video' };
    return {
      temStream: Boolean(el.srcObject),
      resolucao: `${el.videoWidth}x${el.videoHeight}`,
      pausado: el.paused,
      muted: el.muted,
      volume: el.volume,
      tracks: el.srcObject
        ? el.srcObject.getTracks().map((t) => `${t.kind}:${t.readyState}`)
        : [],
      overlayDeAutoplay: Boolean(document.querySelector('.video-overlay')),
    };
  }

  /** As linhas de diagnostico que o proprio app calcula. */
  function diagnostico() {
    return [...document.querySelectorAll('.badge')].map((b) => b.textContent.trim());
  }

  /**
   * Frequencia dominante do audio de um elemento. Compare com o Hz do oscilador
   * da outra aba para provar a origem. Sem sinal, retorna null (mudo).
   */
  async function frequencia(seletor = 'audio', ms = 600) {
    const el = document.querySelector(seletor);
    if (!el?.srcObject) return { erro: `sem stream em ${seletor}` };
    const ac = new AudioContext();
    const fonte = ac.createMediaStreamSource(el.srcObject);
    const analisador = ac.createAnalyser();
    analisador.fftSize = 4096;
    fonte.connect(analisador);
    await new Promise((r) => setTimeout(r, ms));
    const dados = new Float32Array(analisador.frequencyBinCount);
    analisador.getFloatFrequencyData(dados);
    let melhor = 0;
    let pico = -Infinity;
    for (let i = 0; i < dados.length; i += 1) {
      if (dados[i] > pico) {
        pico = dados[i];
        melhor = i;
      }
    }
    if (!Number.isFinite(pico)) return { hz: null, nota: 'silencio absoluto' };
    return { hz: Math.round((melhor * ac.sampleRate) / analisador.fftSize), picoDb: Math.round(pico) };
  }

  function limpar() {
    timers.forEach(clearInterval);
    timers.length = 0;
    return 'timers do canvas encerrados';
  }

  return { tela, mic, cancelarSeletor, clicar, digitar, enviarChat, video, diagnostico, frequencia, limpar };
})();
