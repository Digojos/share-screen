---
name: testar-webrtc
description: Roteiro de teste end-to-end do fluxo de midia deste app de compartilhamento de tela — sobe a pilha em portas alternativas, cria sala com duas abas, injeta tela e microfone sinteticos e mede o que realmente chegou do outro lado. Use sempre que precisar verificar compartilhamento de tela, chat de voz, troca de fonte, perfis de qualidade ou qualquer mudanca em PeerManager/useRoom/useScreenShare/useMicrophone — e obrigatoriamente ao investigar tela preta, audio mudo, "conectado mas sem imagem" ou queda de qualidade. Typecheck e build NAO pegam esses bugs; so rodar o app pega.
---

# Testar o fluxo WebRTC

Os bugs que importam neste projeto sao invisiveis para o compilador. Os dois
ultimos — o stream remoto descartado ao parar de compartilhar e o `fps` sempre
zerado — passaram por `typecheck` e `build` sem reclamar, e so apareceram com
duas abas conversando de verdade.

Este roteiro existe porque ele foi reconstruido do zero seis vezes num unico dia.

## 1. Suba a pilha em portas alternativas

Nunca use 3001/5173: sao as portas do `npm run dev` da pessoa, e ocupa-las
derruba o ambiente dela.

```bash
PORT=3002 npm run dev:server > /dev/null 2>&1 &
cd web && VITE_SIGNALING_URL=http://localhost:3002 npx vite --port 5175 --strictPort > /dev/null 2>&1 &
```

O `npx vite` direto e proposital: `npm run dev:web -- --port 5175` perde a flag
na dupla indirecao do npm e o Vite sobe na porta errada.

Espere ficarem prontos antes de navegar:

```bash
until curl -s http://localhost:3002/healthz >/dev/null 2>&1 && curl -s -o /dev/null -w "%{http_code}" http://localhost:5175 2>/dev/null | grep -q 200; do sleep 1; done
```

## 2. Instale as fontes sintéticas

O seletor nativo de tela nao e automatizavel, entao substitua `getDisplayMedia`
e `getUserMedia`. O arquivo `assets/harness.js` faz isso e expoe helpers —
injete o conteudo dele na aba com `javascript_tool` antes de qualquer interacao.

Duas armadilhas que ele ja resolve:

- **Cliques do `computer` nao chegam** quando o painel do navegador nao esta
  compositando (o mesmo motivo pelo qual `screenshot` falha). Use `T.clicar()`,
  que dispara `.click()` no elemento.
- **Inputs controlados do React ignoram** atribuicao direta de `value`. Use
  `T.digitar()`, que usa o setter nativo e emite o evento `input`.

## 3. Monte a sala

```js
T.tela({ largura: 1280, altura: 720 });  // aba do host
T.mic(440);                               // host fala em 440 Hz
T.clicar('Criar sala');
```

Pegue o codigo com `location.pathname`, navegue a segunda aba para
`/room/<codigo>`, instale `T.mic(880)` nela e siga.

Frequencias diferentes por participante sao o truque central: elas provam **de
quem** e o audio que chegou, nao apenas que existe audio.

## 4. Meça o que chegou

Verificar "aparece na tela" nao basta — um quadro preto e um quadro congelado
sao indistinguiveis a olho nu. Meça:

```js
T.video()        // resolucao, tracks, pausado, muted, volume
T.diagnostico()  // a linha que o proprio app mostra
await T.frequencia('audio')  // frequencia dominante — prova a origem do audio
```

Leituras que importam:

| Sintoma | Significado |
| --- | --- |
| `0 KB` recebidos | a midia nao sai do host — problema de negociacao |
| bytes subindo, `framesDecoded` parado | chega e nao decodifica — suspeite do codec |
| `resolucao: "0x0"` com stream presente | nenhum quadro decodificado ainda |
| `pausado: true` | autoplay bloqueado, nao falta de midia |

Espere ~2s antes da primeira leitura do painel de diagnostico: ele amostra em
intervalo, e ler cedo demais mostra "Aguardando dados" e induz a erro.

## 5. Cubra os caminhos que ja quebraram

Cada um destes ja foi um bug real:

- **Parar e recompartilhar** — o host usa `replaceTrack`, entao `ontrack` nao
  dispara de novo; o espectador precisa voltar a ver imagem.
- **Trocar de tela sem parar** — o contador de quadros deve continuar subindo,
  provando que a conexao nao caiu.
- **Cancelar o seletor ao trocar** — a transmissao atual deve continuar no ar.
- **Voz nos dois sentidos** — meça a frequencia de cada lado.
- **Host sai** — a sala encerra para os espectadores.
- **Reentrar com o mesmo codigo** — a sala revive com o historico (se ha banco).

## 6. Libere as portas por PID

Parar a task de background nao mata o filho do npm. Sobra um processo segurando
a porta, e o proximo `npm run dev` morre com `EADDRINUSE` — o que ja aconteceu.

```bash
powershell -NoProfile -File .claude/skills/testar-webrtc/scripts/liberar-portas.ps1 3002 5175
```

Confirme que 3001 e 5173 seguem livres (ou ocupadas pelo processo da pessoa, o
que e esperado — nao mate essas).

## Relatando

Diga o que foi medido, nao a impressao. "Espectador recebeu 1280x720, 26 quadros,
VP8, e 879 Hz vindos do oscilador de 880 Hz do outro lado" e verificavel;
"funcionou" nao e. E deixe explicito o que **nao** deu para testar aqui — o
seletor nativo de tela, o audio real do sistema e a tela cheia (bloqueada por
permissao de iframe no painel) precisam de uma pessoa numa aba comum.
