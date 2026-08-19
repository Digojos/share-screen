import 'dotenv/config';
import { createServer } from 'node:http';
import cors from 'cors';
import express from 'express';
import { Server } from 'socket.io';
import { initDatabase, isDatabaseEnabled } from './db.js';
import { buildIceConfig } from './ice.js';
import { sweepEmptyRooms, stats } from './rooms.js';
import { registerSignaling, type IoServer } from './signaling.js';
import type { ClientToServerEvents, ServerToClientEvents } from './types.js';

const PORT = Number(process.env.PORT ?? 3001);
const CORS_ORIGIN = (process.env.CORS_ORIGIN ?? 'http://localhost:5173')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const app = express();
app.use(cors({ origin: CORS_ORIGIN }));

app.get('/healthz', (_req, res) => {
  res.json({ ok: true, database: isDatabaseEnabled(), ...stats() });
});

app.get('/api/ice', (req, res) => {
  // A identidade so entra no username TURN para rastreio; nao concede acesso a nada.
  const identity = String(req.query.room ?? 'anon').slice(0, 32);
  res.json(buildIceConfig(identity));
});

const httpServer = createServer(app);
const io: IoServer = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: { origin: CORS_ORIGIN },
});

io.on('connection', (socket) => {
  registerSignaling(io, socket);
});

const sweepTimer = setInterval(() => {
  sweepEmptyRooms();
}, 60_000);
sweepTimer.unref();

// O schema precisa existir antes da primeira sala: so aceitamos conexoes
// depois que o banco (quando configurado) esta pronto.
await initDatabase();

httpServer.listen(PORT, () => {
  const turn = process.env.TURN_URLS ? 'configurado' : 'AUSENTE (so funciona em LAN)';
  console.log(`[signaling] escutando em http://localhost:${PORT}`);
  console.log(`[signaling] CORS: ${CORS_ORIGIN.join(', ')}`);
  console.log(`[signaling] TURN: ${turn}`);
  console.log(`[signaling] historico: ${isDatabaseEnabled() ? 'MySQL' : 'desligado (memoria)'}`);
});
