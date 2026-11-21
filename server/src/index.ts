import { existsSync, readdirSync } from 'node:fs';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server, matchMaker } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import express, { type RequestHandler, type Response } from 'express';
import { GAME_NAME, NET, ROOM_NAME } from '../../shared/src/config/game.ts';
import { setupEconomy } from './economy/index.ts';
import { initRapier } from './rapier.ts';
import { MatchRoom } from './rooms/MatchRoom.ts';
import { setupScores } from './scores.ts';

const here = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT ?? NET.defaultPort);
/** Built client (vite build). When present, this one process serves the game and the sockets. */
const clientDist = process.env.CLIENT_DIST ?? resolve(here, '../../client/dist');
const startedAt = Date.now();

/**
 * Browser caching for the built client: the page itself is always revalidated (so a new deploy
 * is picked up at once), files with a content hash in their name never change and are cached
 * for good, everything else (models, credits) for an hour.
 */
function cacheHeaders(res: Response, file: string): void {
  if (file.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
  else if (/[\\/]assets[\\/][^\\/]+-[A-Za-z0-9_-]{8}\.(js|css)$/.test(file)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  else res.setHeader('Cache-Control', 'public, max-age=3600');
}

/**
 * Serves the `.br` / `.gz` copies that `npm run build` writes next to each file (the physics
 * engine alone is 4 MB of JavaScript, 1.2 MB compressed), so the game loads fast even on
 * hosts that do not compress responses themselves.
 */
function precompressed(root: string): RequestHandler {
  const available = new Set<string>();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.br') || entry.name.endsWith('.gz')) available.add(full);
    }
  };
  walk(root);
  return (req, res, next) => {
    if (available.size === 0 || (req.method !== 'GET' && req.method !== 'HEAD')) return next();
    let path: string;
    try {
      path = decodeURIComponent(req.path);
    } catch {
      return next();
    }
    if (path.endsWith('/')) path += 'index.html';
    const file = resolve(root, `.${path}`);
    if (!file.startsWith(root + sep)) return next();
    const accept = String(req.headers['accept-encoding'] ?? '');
    for (const [encoding, ext] of [['br', '.br'], ['gzip', '.gz']] as const) {
      if (!accept.includes(encoding) || !available.has(file + ext)) continue;
      res.setHeader('Content-Encoding', encoding);
      res.setHeader('Vary', 'Accept-Encoding');
      res.type(extname(file));
      cacheHeaders(res, file);
      res.sendFile(file + ext, { cacheControl: false }, (err) => {
        if (err && !res.headersSent) next();
      });
      return;
    }
    next();
  };
}

export async function startServer(listenPort = port): Promise<Server> {
  await initRapier();

  const server = new Server({
    greet: false,
    transport: new WebSocketTransport({ pingInterval: 6000, pingMaxRetries: 4 }),
    express: (app) => {
      app.disable('x-powered-by');
      // GRAMS, AJ's and TRAP: accounts, purchases, inventory (see docs/ECONOMY.md)
      const dev = process.env.NODE_ENV !== 'production';
      setupEconomy(app, {
        dbPath: process.env.ECONOMY_DB ?? resolve(here, '../data/economy.json'),
        publicUrl: process.env.PUBLIC_URL ?? `http://localhost:${listenPort}`,
        allowedOrigins: [
          ...(process.env.ALLOWED_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean),
          ...(dev ? ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:4173', 'http://127.0.0.1:5173'] : []),
        ],
      });
      // live scores for the billboards (the server asks ESPN, at most once a minute)
      setupScores(app);
      app.get('/healthz', async (_req, res) => {
        const rooms = await matchMaker.query({ name: ROOM_NAME });
        res.json({
          ok: true,
          game: GAME_NAME,
          uptime: Math.round((Date.now() - startedAt) / 1000),
          rooms: rooms.length,
          players: rooms.reduce((n, r) => n + r.clients, 0),
        });
      });
      if (existsSync(clientDist)) {
        app.use(precompressed(clientDist));
        app.use(express.static(clientDist, { index: 'index.html', cacheControl: false, setHeaders: cacheHeaders }));
      } else {
        app.get('/', (_req, res) => {
          res.type('text/plain').send(`${GAME_NAME} game server is running. Build the client (npm run build) to serve it from here.`);
        });
      }
    },
  });

  // Quick Play matches players into public lobbies of the mode they picked.
  server.define(ROOM_NAME, MatchRoom).filterBy(['mode', 'squads']);

  if (process.env.SIMULATE_LATENCY) server.simulateLatency(Number(process.env.SIMULATE_LATENCY));

  await server.listen(listenPort);
  console.log(`[${GAME_NAME}] server listening on http://localhost:${listenPort}  (ws://localhost:${listenPort})`);
  if (existsSync(clientDist)) console.log(`[${GAME_NAME}] serving client from ${clientDist}`);
  return server;
}

// Run when executed directly (not when imported by tests).
const entry = process.argv[1] ? resolve(process.argv[1]) : '';
if (entry === fileURLToPath(import.meta.url) || entry.endsWith('/dist/index.js')) {
  startServer().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
