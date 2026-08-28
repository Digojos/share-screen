# Contexto de build e a RAIZ do repo, nao esta pasta: o npm workspaces precisa
# do package-lock.json da raiz para instalar de forma reproduzivel.
FROM node:22-alpine AS build
WORKDIR /app

# Manifests primeiro: enquanto as dependencias nao mudam, esta camada e cache.
COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY web/package.json ./web/
RUN npm ci

COPY server ./server
RUN npm run build --workspace server

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

# node_modules vem pronto do estagio anterior: reinstalar com --omit=dev em
# workspaces e mais fragil do que copiar o que ja funcionou.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server ./server

EXPOSE 3001
CMD ["node", "server/dist/index.js"]
