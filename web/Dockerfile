# Contexto de build e a RAIZ do repo (ver server/Dockerfile).
FROM node:22-alpine AS build
WORKDIR /app

# A URL do servidor de sinalizacao e embutida no bundle em tempo de BUILD, nao
# lida em runtime. Trocar de ambiente exige rebuild da imagem — por isso ela e
# um ARG, e nao uma variavel do container.
ARG VITE_SIGNALING_URL=http://localhost:3001
ENV VITE_SIGNALING_URL=$VITE_SIGNALING_URL

COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY web/package.json ./web/
RUN npm ci

# O contrato de eventos vive no servidor e e importado pelo web como `@shared`.
COPY server/src/types.ts ./server/src/types.ts
COPY web ./web
RUN npm run build --workspace web

FROM nginx:alpine
COPY --from=build /app/web/dist /usr/share/nginx/html
COPY web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
