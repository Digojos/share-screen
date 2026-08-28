# CLAUDE.md

Compartilhamento de tela pelo navegador: host transmite tela + audio, espectadores
entram por codigo de sala. WebRTC P2P, sem SFU.

## Comandos

```bash
npm run dev          # servidor (3001) + web (5173) juntos
npm run dev:server   # so a sinalizacao
npm run dev:web      # so o front
npm run typecheck    # tsc nos dois workspaces
npm run lint         # eslint (pega dependencia de useEffect errada)
npm test             # vitest no PeerManager
npm run build        # server/dist + web/dist

MYSQL_PORT=3307 docker compose up -d mysql   # banco (ver armadilha abaixo)
docker compose up -d coturn                   # TURN, so para testar entre redes
```

## Arquitetura

Tres decisoes explicam quase todo o codigo:

**O servidor nunca toca em midia.** Ele so distribui SDP/ICE, gerencia salas e
emite credencial TURN. Por isso qualquer cliente (web, Electron, nativo) fala o
mesmo protocolo sem mudanca no backend.

**Malha completa, nao estrela.** Todos se conectam com todos, porque qualquer um
pode falar no chat de voz. Consequencia direta: o papel "polite" do perfect
negotiation vem da **comparacao de ids** (`selfId < peerId`), nao de
host/espectador — os dois lados precisam chegar a papeis opostos sozinhos.

**Chat pelo Socket.IO, nao por DataChannel.** Numa malha o host teria de repassar
mensagens entre espectadores, e o chat pararia enquanto o P2P nao subisse.

### Mapa

| Arquivo | Papel |
| --- | --- |
| `server/src/types.ts` | contrato de eventos — **fonte unica**, o web importa como `@shared` |
| `server/src/rooms.ts` | salas em memoria; revive sala persistida no banco |
| `server/src/signaling.ts` | handlers de join/sinal/chat |
| `web/src/rtc/PeerManager.ts` | perfect negotiation, fila de ICE, senders por papel |
| `web/src/rtc/useRoom.ts` | orquestra socket + peers + chat |
| `web/src/rtc/useScreenShare.ts` | captura de tela (unico arquivo que nao serve a um app desktop) |
| `web/src/rtc/useMicrophone.ts` | microfone sob demanda, separado da tela |

## Armadilhas (todas custaram tempo)

**Escreva arquivos do `web/` de forma atomica.** O Vite cacheia o arquivo no
instante em que `cat > arquivo` o trunca, e passa a servir um modulo **vazio** —
o sintoma e `does not provide an export named X` e so sai reiniciando o Vite.
Escreva num `.tmp` e use `os.replace`.

**MySQL do container fica na 3307.** Esta maquina ja tem um MySQL nativo na 3306.
`MYSQL_PORT` controla isso no compose.

**`DATABASE_URL` definida mas inacessivel derruba o processo** (de proposito:
persistencia configurada e ignorada e pior que falhar alto). Sem a variavel, roda
em memoria normalmente.

**`CORS_ORIGIN` precisa conter a porta real do Vite.** Se a 5173 estiver ocupada
ele pula para 5174, o `fetch` de `/api/ice` leva CORS, o app cai no fallback e
mente dizendo "TURN nao configurado". O socket continua funcionando, o que
disfarca o problema.

**Ao terminar de testar, libere as portas por PID.** Parar a task nao mata o filho
do npm; sobra um processo segurando a 3001 e o `npm run dev` do usuario morre com
`EADDRINUSE`.

**Sem `StrictMode`, de proposito.** O duplo mount pediria captura de tela duas
vezes e derrubaria a sala do host antes do segundo mount entrar.

**`framesPerSecond` nao existe no `outbound-rtp` deste Chrome.** Calcule por delta
de `framesSent`.

## Convencoes

- Comentarios em portugues **sem acentos**, explicando o *porque* — nunca o que o
  codigo ja diz.
- TypeScript `strict`; nada de `any` solto.
- Mudanca de midia sempre por `replaceTrack`, nunca refazendo a conexao.
- Toda falha silenciosa de midia precisa virar algo visivel na UI: tela preta e
  autoplay bloqueado sao indistinguiveis para quem assiste.

## Verificacao

`npm test` cobre a logica do `PeerManager` — perfect negotiation, fila de ICE e
reaproveitamento de senders — que e onde os bugs reais apareceram. O CI
(`.github/workflows/ci.yml`) roda typecheck, lint, testes e build a cada push.

Nada disso substitui rodar o app: bug de midia passa por typecheck e build sem
reclamar, e ja passou duas vezes. Ha uma skill com o roteiro de teste manual:
`.claude/skills/testar-webrtc/`.
