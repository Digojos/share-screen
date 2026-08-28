# Deploy numa VPS com nginx

Roteiro completo. Substitua `share.SEU-IP-COM-TRACOS.sslip.io` pelo seu
endereco em todos os comandos.

**Sem dominio proprio?** Use `sslip.io`: para o IP `203.0.113.10`, o nome
`share.203-0-113-10.sslip.io` ja resolve para ele, sem cadastro. Basta trocar
os pontos por tracos.

---

## Ja existe um proxy no servidor?

Se as portas 80 e 443 ja estao ocupadas — por exemplo por um nginx em container
de outro projeto — **nao instale nginx no host**. Siga
`deploy/nginx.nades.conf.example` e o override `docker-compose.proxy.yml`, que
coloca a aplicacao na rede do proxy existente. Os passos 0, 4 e 5 abaixo nao se
aplicam nesse caso.

Descubra o que ocupa as portas com:

```bash
sudo ss -tlnp | grep -E ':80 |:443 ' ; docker ps --format '{{.Names}} | {{.Ports}}'
```

---

## 0. Pre-requisitos

```bash
docker --version && docker compose version && nginx -v && certbot --version
```

Faltando algo:

```bash
sudo apt update && sudo apt install -y docker.io docker-compose-plugin nginx certbot python3-certbot-nginx
```

As portas **80 e 443** precisam estar abertas. Em VPS isso costuma ser em dois
lugares: o firewall da maquina e o painel do provedor.

```bash
sudo ufw allow 80,443/tcp
```

---

## 1. Clonar

```bash
git clone https://github.com/Digojos/share-screen.git
cd share-screen
```

## 2. Configurar

```bash
cp .env.example .env
```

Preencha o endereco (os dois com o **mesmo** valor, e ja com `https://`, mesmo
que o certificado ainda nao exista):

```bash
sed -i 's|^VITE_SIGNALING_URL=.*|VITE_SIGNALING_URL=https://share.SEU-IP-COM-TRACOS.sslip.io|; s|^CORS_ORIGIN=.*|CORS_ORIGIN=https://share.SEU-IP-COM-TRACOS.sslip.io|' .env
```

Agora troque as duas senhas do banco. Deixe isto para o editor, e nao para a
linha de comando, para as senhas nao ficarem no historico do shell:

```bash
nano .env
```

(`Ctrl+O`, `Enter`, `Ctrl+X` para salvar e sair.)

## 3. Subir os containers

```bash
docker compose build && docker compose up -d mysql server web
```

Confira antes de seguir:

```bash
docker compose ps && curl -s http://127.0.0.1:3001/healthz
```

Esperado: `mysql` como *healthy*, os tres em *Up*, e um JSON com
`"database":true`. As portas ficam so em `127.0.0.1` — nada esta exposto ainda,
e e assim que deve ser.

## 4. Configurar o nginx (ainda em HTTP)

```bash
sudo cp deploy/nginx.example.conf /etc/nginx/sites-available/share-screen.conf
sudo sed -i 's/share\.SEU-IP-COM-TRACOS\.sslip\.io/share.SEU-IP-COM-TRACOS.sslip.io/g' /etc/nginx/sites-available/share-screen.conf
sudo ln -s /etc/nginx/sites-available/share-screen.conf /etc/nginx/sites-enabled/
```

**Teste antes de recarregar.** Se falhar, nada foi aplicado e as outras
aplicacoes continuam intactas:

```bash
sudo nginx -t
```

So depois de `syntax is ok`:

```bash
sudo systemctl reload nginx
```

Confirme que o proxy esta roteando:

```bash
curl -s -o /dev/null -w "front %{http_code}\n" http://share.SEU-IP-COM-TRACOS.sslip.io
curl -s http://share.SEU-IP-COM-TRACOS.sslip.io/api/ice | head -c 120
```

Esperado: `front 200` e um JSON de `iceServers`. A aplicacao **ainda nao
funciona** neste ponto — o front foi construido apontando para `https://`, e
compartilhar tela exige HTTPS de qualquer forma. Aqui so se verifica o
roteamento.

## 5. Certificado

O certbot encontra o bloco pelo `server_name` e o converte para HTTPS sozinho,
adicionando o redirecionamento da 80:

```bash
sudo certbot --nginx -d share.SEU-IP-COM-TRACOS.sslip.io
```

## 6. Verificar

```bash
curl -I https://share.SEU-IP-COM-TRACOS.sslip.io
```

Abra `https://share.SEU-IP-COM-TRACOS.sslip.io`, crie uma sala e abra o link
numa segunda aba.

---

## Atualizar depois

```bash
cd share-screen && git pull && docker compose build && docker compose up -d
```

O `build` nao e opcional: a URL da sinalizacao e embutida no bundle, e o codigo
novo so entra na imagem por ali.

## Quando algo falha

| Sintoma | Causa provavel |
| --- | --- |
| `nginx -t` reclama de `http2` | nginx < 1.25.1; remova `http2 on;`, o certbot cuida disso |
| `nginx -t` reclama de `default_server` | outro bloco ja usa; remova a diretiva daqui |
| certbot nao acha o dominio | a 80 esta fechada, ou o `server_name` nao bate |
| Pagina nao abre | 443 fechada no painel do provedor (separado do `ufw`) |
| **Carrega mas a sala nao e criada** | falta o upgrade para WebSocket no bloco `/socket.io/` |
| "TURN nao configurado" | esperado sem coturn; so importa entre redes diferentes |
| Botao de compartilhar desabilitado | acessando por HTTP; a captura exige contexto seguro |

O penultimo e o mais enganoso: a pagina carrega inteira e parece bug da
aplicacao, mas e o proxy.

Diagnostico:

```bash
docker compose logs server --tail 30 && docker compose ps
```

## TURN (so se precisar)

Necessario quando a conexao direta falha entre redes diferentes — NAT
simetrico, firewall corporativo. Descomente `TURN_URLS` e `TURN_SECRET` no
`.env` apontando para o proprio endereco, e:

```bash
docker compose up -d coturn
```

As portas 3478 (UDP e TCP) e a faixa de relay precisam estar abertas no
firewall. O coturn **nao** passa pelo nginx: usa UDP em portas proprias.
