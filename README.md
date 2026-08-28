# Share Screen

Compartilhamento de tela pelo navegador: o host transmite tela + audio e os
espectadores entram por um codigo de sala. Sem instalacao, sem plugin.

- **Front**: React + Vite + TypeScript (`web/`)
- **Sinalizacao**: Node + Express + Socket.IO (`server/`)
- **Midia**: WebRTC P2P (malha completa), STUN + TURN
- **Voz**: chat de audio entre todos os participantes
- **Persistencia**: MySQL (opcional) para salas e historico de chat

Os controles vivem no proprio player: **microfone** e **som** como icones
sempre visiveis (um clique, com o estado mudo em vermelho), e — para o host —
uma **engrenagem** com qualidade, codec, resolucao e o estado do audio do
sistema, alem do botao de **tela cheia**. Engrenagem e tela cheia so aparecem
ao passar o mouse; os de audio nao, porque saber se o proprio microfone esta
aberto nao pode depender de hover.

## Como funciona

O servidor **nao processa midia**. Ele so distribui SDP/ICE, mantem a lista de
salas em memoria e emite credenciais TURN temporarias. O video vai direto de um
navegador para o outro.

A topologia e uma **malha completa**: cada participante mantem uma
`RTCPeerConnection` com cada outro. Somente o host envia video (a tela), mas
qualquer um envia audio, entao qualquer par pode negociar. Por isso o papel
"polite" do perfect negotiation vem da comparacao de ids, e nao de host/
espectador — assim os dois lados chegam a papeis opostos sem combinar nada.

Isso limita a sala a poucos participantes (`MAX_PARTICIPANTS`, padrao 6) — o
gargalo e o upload do host, que envia uma copia do video para cada espectador.
Para audiencias maiores o caminho e trocar o `PeerManager` por um cliente SFU
(mediasoup/LiveKit); a sinalizacao de sala e a UI continuam iguais.

## Perfis de video

Tela de trabalho e jogo pedem coisas opostas, entao o host escolhe:

A escolha e **o que sacrificar quando a banda ou a CPU nao dao conta** — nao se
confunde com FPS, que e configuracao propria:

| Prioridade | contentHint | FPS sugerido | Teto por espectador | Sob pressao |
| --- | --- | --- | --- | --- |
| Nitidez | `text` | 30 | 2,5 Mbps | derruba quadros, mantem resolucao |
| Fluidez | `motion` | 60 | 12 Mbps | derruba resolucao, mantem quadros |

### Quadros por segundo

FPS e uma escolha propria (**Automatico / 15 / 30 / 60**), nao mais amarrada ao
perfil. "Automatico" segue a prioridade — 30 em Nitidez, 60 em Fluidez — e e o
padrao; escolher um valor explicito libera combinacoes que antes nao existiam,
como movimento fluido a 30 quando a CPU nao sustenta 60.

Nao ha 90 nem 120: a captura de tela do navegador nao entrega isso, e o botao
mentiria. O painel mostra o **teto real da fonte**, lido de
`getCapabilities()`, para a decisao nao depender de palpite.

O valor e um **pedido** (`frameRate: { ideal }`), nao garantia: a fonte pode
entregar menos e o encoder derruba sob pressao. O diagnostico do host mostra o
que esta saindo de fato.

### Codec

O navegador oferece VP8, H264, VP9, AV1 e H265, mas negocia **VP8** por padrao,
por ser o primeiro da lista — e VP8 e o mais antigo e o que pior comprime.
Trocar o codec e a maior melhoria de qualidade disponivel sem gastar mais banda,
entao o app prefere **VP9** e deixa a escolha visivel:

| Codec | Quando usar |
| --- | --- |
| VP9 (padrao) | melhor qualidade por bit; exige mais CPU |
| AV1 | melhor compressao; so vale com encoder de hardware recente |
| H264 | encoder de hardware quase sempre; sustenta 60fps com CPU baixa |
| Automatico | ordem do navegador — costuma cair em VP8 |

Nao ha vencedor universal, e o diagnostico do host diz qual escolher: `cpu`
pede H264, `bandwidth` pede VP9 ou AV1. A troca renegocia a conexao, entao o
video pode piscar por um instante.

Separado disso ha um teto de **resolucao** (Nativa / Full HD / HD). E teto, nao
alvo: compartilhar uma janela de 800x600 em Full HD nao inventa pixels. O limite
e aplicado na captura, e nao no encoder, porque assim poupa CPU — que costuma
saturar antes da banda.

A troca vale na hora, sem reescolher a fonte: `contentHint`, framerate e
resolucao sao reconfigurados na track ao vivo e o bitrate entra via
`setParameters`.

### Por que a qualidade cai

Enquanto transmite, o host ve uma linha com o que esta realmente saindo e, se
houver, o motivo da reducao — vindo do `qualityLimitationReason` do WebRTC:

- **cpu** — o encoder nao da conta. Baixar para HD ou usar o perfil Apresentacao
  resolve.
- **bandwidth** — o upload nao comporta. Menos espectadores ou HD.
- **none** — nao ha limitacao; o que se ve e o maximo pedido.

Vale lembrar que uma queda logo no inicio e normal: o WebRTC comeca conservador
e sobe a qualidade ao longo dos primeiros segundos. E o perfil escolhido decide
o que e sacrificado primeiro — Apresentacao derruba o framerate, Jogo derruba a
resolucao.

O teto e **por espectador**: numa malha o host envia uma copia para cada um.
Ele nao forca o envio a subir — o controle de congestionamento continua
mandando — mas um teto baixo impede uma conexao boa de usar a folga que tem.

## Voz

Todos os participantes podem falar, inclusive quem so assiste. O microfone e
capturado **sob demanda**, no primeiro clique em "Entrar no audio" — nunca ao
entrar na sala. Depois disso, ligar e desligar apenas alterna `track.enabled`,
sem renegociar.

Duas conexoes nunca chegam a existir se nenhum dos dois lados tem midia: dois
espectadores calados nao abrem RTCPeerConnection ate um deles ligar o microfone.

Cada participante controla o que **ouve**: um botao silencia tudo que chega, e a
lista de participantes tem mudo e volume (0 a 100%) individuais. O volume usa a
propriedade `volume` do elemento de midia; passar de 100% exigiria rotear o
audio por Web Audio com um `GainNode`, o que nao esta implementado. Nao existe silenciar o microfone dos
outros — numa malha P2P a midia vai direto de um navegador ao outro, entao o
servidor nao teria como impor nada; so um SFU permitiria isso de verdade.

O **chat passa pelo servidor** (Socket.IO), nao por DataChannel: numa mesh o
host teria de repassar mensagens entre espectadores, e o chat pararia de
funcionar enquanto o P2P nao subisse.

## Reconexao

Uma oscilacao de rede nao encerra a sessao. O socket reconecta sozinho e o
cliente **reentra na sala automaticamente**, apresentando um token de sessao que
o servidor usa para reconhecer quem voltou — o socket id muda a cada reconexao,
entao ele nao serve como identidade.

Quando quem cai e o **host**, a sala fica viva por `HOST_GRACE_SECONDS`
(padrao 60) aguardando o retorno. Se ele volta a tempo, retoma a posse e a
malha se refaz; se nao volta, a sala encerra para todos.

Numa queda curta a pagina do host nao recarrega, entao a captura de tela
continua viva: **a transmissao volta sozinha, sem novo seletor**.

O token fica no `sessionStorage` (nao no `localStorage`) porque a identidade e
por aba — duas abas do mesmo navegador sao dois participantes.

## Persistencia (opcional)

Sem `DATABASE_URL` o servidor roda inteiramente em memoria: a sala morre quando
o host sai e o chat e efemero. Com o MySQL configurado:

- O **codigo da sala continua valido** depois que o host sai. Quem entrar com
  ele reativa a sala e assume como host.
- Quem entra recebe as ultimas mensagens (`CHAT_HISTORY_LIMIT`, padrao 100) no
  proprio ack do join, antes do primeiro render do chat.
- Nada e apagado automaticamente — nao ha rotina de retencao.

O que **nao** e persistido: participantes, estado de transmissao e qualquer
midia. Sao dados de sessao ao vivo e nao fazem sentido fora dela.

```bash
docker compose up -d mysql
```

O schema (`rooms`, `messages`) e aplicado no boot do servidor via
`CREATE TABLE IF NOT EXISTS` — nao ha ferramenta de migration. Se `DATABASE_URL`
estiver definida e o banco nao responder, o servidor **encerra** em vez de
degradar em silencio para memoria.

Escritas de chat sao feitas depois do `emit`: a latencia da conversa nao depende
do banco, e uma falha de gravacao e registrada no log sem derrubar a sala.

## Rodando com Docker

Sobe tudo — banco, servidor e front — sem precisar de Node instalado:

```bash
MYSQL_PORT=3307 docker compose up -d mysql server web
```

Abra http://localhost:8080. O `MYSQL_PORT` so remapeia a porta no host para nao
colidir com um MySQL ja instalado; entre containers a conexao e sempre
`mysql:3306`.

O front e servido por nginx com fallback para `index.html`, senao recarregar
dentro de uma sala (`/room/CODIGO`) devolveria 404.

**A `VITE_SIGNALING_URL` e embutida no bundle em tempo de build**, nao lida em
runtime. Para apontar para outro host, reconstrua:

```bash
VITE_SIGNALING_URL=https://sinalizacao.exemplo.com docker compose build web
```

Para desenvolver, prefira o `npm run dev` abaixo: o Docker exige rebuild a cada
alteracao.

**Os dois modos disputam as mesmas portas.** O container `server` publica a 3001,
que e a mesma do `npm run dev` — deixar a pilha em pe e rodar `npm run dev` da
`EADDRINUSE`. Antes de voltar a desenvolver, derrube os servicos da aplicacao e
deixe so o banco:

```bash
docker compose down && MYSQL_PORT=3307 docker compose up -d mysql
```

O segundo comando importa: com `DATABASE_URL` definida e o MySQL fora do ar, o
servidor encerra no boot de proposito.

## Rodando localmente

```bash
npm install
cp server/.env.example server/.env
cp web/.env.example web/.env
npm run dev
```

Abra http://localhost:5173, clique em **Criar sala** e abra o link gerado numa
segunda aba para entrar como espectador.

Para testar com TURN de verdade (necessario entre redes diferentes):

```bash
TURN_SECRET=troque-este-segredo docker compose up -d coturn
```

O `TURN_SECRET` do compose e o do `server/.env` precisam ser **o mesmo valor**.

## Variaveis de ambiente

| Variavel | Onde | Para que |
| --- | --- | --- |
| `PORT` | server | Porta do servidor de sinalizacao (3001) |
| `CORS_ORIGIN` | server | Origens do front, separadas por virgula |
| `STUN_URLS` | server | Servidores STUN, separados por virgula |
| `TURN_URLS` | server | Servidores TURN; sem isso so funciona em LAN |
| `TURN_SECRET` | server | Deve casar com o `static-auth-secret` do coturn |
| `TURN_TTL_SECONDS` | server | Validade da credencial TURN (padrao 6h) |
| `MAX_PARTICIPANTS` | server | Host + espectadores por sala (padrao 6) |
| `HOST_GRACE_SECONDS` | server | Espera pelo retorno do host antes de encerrar (padrao 60) |
| `DATABASE_URL` | server | MySQL para salas + historico; ausente = memoria |
| `CHAT_HISTORY_LIMIT` | server | Mensagens antigas enviadas no join (padrao 100) |
| `VITE_SIGNALING_URL` | web | URL do servidor de sinalizacao |

## Limitacoes conhecidas

- **Audio do sistema depende do navegador e do que foi escolhido.** No Windows,
  Chrome/Edge oferecem audio para "Tela inteira" e para aba do navegador, mas a
  caixinha fica no **canto inferior esquerdo do seletor** e passa despercebida.
  Para "Janela" o audio nao existe em nenhum navegador — nao ha API para isolar
  o som de uma janela. Firefox e Safari nao entregam audio de tela.

  O app le `displaySurface` da track e orienta conforme o caso, em vez de dar
  uma dica generica que manda procurar onde nao tem.
- **O microfone so e capturado quando voce pede.** O botao "Entrar no audio"
  aciona a permissao; antes disso nenhuma track de microfone existe.
- **Sessoes ao vivo sao em memoria.** Reiniciar o servidor derruba as salas
  ativas (o historico sobrevive, se houver banco). Para mais de uma instancia,
  use o adapter Redis do Socket.IO.
- **Mensagens do historico nao tem dono.** A identidade e um apelido no
  `localStorage`, entao mensagens antigas nao aparecem destacadas como suas ao
  reentrar numa sala.
- **Se o host sai, a sala encerra** — nao ha transferencia de host.
- **O nome fica no localStorage** por origem: duas abas do mesmo navegador
  compartilham a mesma identidade.
- **HTTPS obrigatorio em producao.** `getDisplayMedia` so funciona em contexto
  seguro; `localhost` e a unica excecao.

## Servindo atras de nginx

`deploy/nginx.example.conf` tem a configuracao pronta. Duas decisoes explicam
o formato:

**Mesma origem.** O nginx serve o front em `/` e repassa `/socket.io/` e
`/api/` para o servidor. Assim nao ha origem cruzada, o CORS deixa de existir e
basta um certificado.

**HTTPS nao e opcional.** `getDisplayMedia` e o microfone exigem contexto
seguro: em `http://ip:porta` o navegador nem expoe `navigator.mediaDevices`.
Assistir e conversar por chat funcionam, mas ninguem consegue transmitir — o
app detecta isso e desabilita o botao com o motivo, em vez de falhar no clique.

Sem dominio proprio, `sslip.io` resolve: `203-0-113-10.sslip.io` ja aponta para
203.0.113.10 sem cadastro, e o Let's Encrypt emite certificado para esse nome.

**A ordem importa:** adicione o bloco em HTTP puro primeiro e recarregue; so
entao rode `certbot --nginx`, que encontra o `server_name` e converte o bloco
para HTTPS sozinho. Comecar com um bloco que ja aponta para o certificado trava
os dois lados — o arquivo nao existe, `nginx -t` falha, e o certbot nao roda
porque o nginx nao recarrega.

Nao ha conflito com as outras aplicacoes desde que `nginx -t` passe — e se nao
passar, nada e aplicado. Os pontos de atencao estao comentados no exemplo:
`server_name` unico, nada de `default_server` duplicado, e `http2 on;` que so
existe no nginx 1.25.1+.

**A armadilha:** o Socket.IO precisa de upgrade para WebSocket. Sem isso a
pagina carrega inteira e nada funciona — parece bug da aplicacao, nao do proxy.

## Deploy num servidor

Roteiro completo, passo a passo, em **`deploy/DEPLOY.md`** — incluindo nginx,
certificado e a tabela de sintomas quando algo falha. O resumo:

Requisitos: `git`, `docker` e o plugin `docker compose`.

```bash
git clone https://github.com/Digojos/share-screen.git
cd share-screen
cp .env.example .env
```

Edite o `.env`: `VITE_SIGNALING_URL` e `CORS_ORIGIN` recebem o **mesmo**
endereco publico (com `https://`), e as senhas do banco devem ser trocadas.

```bash
docker compose build
docker compose up -d mysql server web
```

Nada fica exposto ainda: as portas sao publicadas so em `127.0.0.1`. Quem
entrega para fora e o nginx — ver `deploy/nginx.example.conf` e a secao acima.

Sem dominio, use `sslip.io`: para o IP `203.0.113.10` o nome
`share.203-0-113-10.sslip.io` ja resolve, e o certbot emite certificado normal.

Para atualizar depois:

```bash
git pull && docker compose build && docker compose up -d
```

O `build` e obrigatorio: `VITE_SIGNALING_URL` e embutida no bundle, e o codigo
novo so entra na imagem por ali.

### TURN (opcional)

Necessario quando a conexao direta falha entre redes diferentes. Descomente
`TURN_URLS` e `TURN_SECRET` no `.env`, aponte para o proprio endereco do
servidor, e suba `docker compose up -d coturn`. As portas 3478 (UDP e TCP) e a
faixa de relay precisam estar abertas no firewall — inclusive no painel do
provedor, que costuma ser separado do `ufw`.

## Testes

```bash
npm test          # Vitest no PeerManager
npm run typecheck
npm run build
```

Os testes cobrem perfect negotiation, fila de candidatos ICE e reaproveitamento
de senders — a logica onde os bugs reais apareceram. Vale saber que `typecheck`
e `build` passam felizes com bug de midia; foi o que aconteceu duas vezes.

## Verificacao

`chrome://webrtc-internals` mostra o par de candidatos selecionado. Se aparecer
`relay`, o trafego esta passando pelo TURN — esperado entre redes diferentes.
