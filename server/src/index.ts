import express from 'express';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { GAME_VERSION, type ClientToServer, type ServerToClient } from '@warmarket/shared';
import { attachSockets } from './net/socketServer.js';

const PORT = Number(process.env.PORT) || 3000;
const HOST = '0.0.0.0';
const here = path.dirname(fileURLToPath(import.meta.url));
// server/dist/index.js -> ../../client/dist  (also works from server/src via tsx)
const clientDist = path.resolve(here, '../../client/dist');

const app = express();
app.disable('x-powered-by');

const httpServer = createServer(app);
const io = new Server<ClientToServer, ServerToClient>(httpServer, {
  // Same origin in production; in dev Vite proxies /socket.io so no CORS is needed either.
  maxHttpBufferSize: 64 * 1024,
  pingInterval: 10_000,
  pingTimeout: 15_000,
});
const rooms = attachSockets(io);

app.get('/health', (_req, res) => {
  res.status(200).json({ ok: true, version: GAME_VERSION, rooms: rooms.count(), uptime: Math.round(process.uptime()) });
});

if (existsSync(clientDist)) {
  app.use(express.static(clientDist, { index: false, maxAge: '1h' }));
  // SPA fallback: any non-API GET serves index.html.
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/socket.io')) return next();
    res.sendFile(path.join(clientDist, 'index.html'));
  });
} else {
  app.get('/', (_req, res) => {
    res.type('text').send('WARMARKET server running. Client not built — use `npm run dev` and open http://localhost:5173');
  });
}

httpServer.listen(PORT, HOST, () => {
  console.log(`[warmarket] listening on http://${HOST}:${PORT} (${process.env.NODE_ENV ?? 'development'})`);
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    io.close();
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
}
