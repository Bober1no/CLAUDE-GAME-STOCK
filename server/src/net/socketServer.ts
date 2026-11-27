/**
 * Socket.io wiring. Sockets join two rooms: `r:<code>` (everyone in the game) and
 * `p:<playerId>` (just that player, across tabs). Game logic only ever sees an Emitter.
 */
import type { Server, Socket } from 'socket.io';
import type { Ack, ClientToServer, ServerToClient, SessionInfo } from '@warmarket/shared';
import { CONFIG } from '@warmarket/shared';
import { RoomManager } from '../rooms/RoomManager.js';
import type { Room, RoomPlayer } from '../rooms/Room.js';
import type { Emitter } from './emitter.js';
import { actionSchema, companySchema, createSchema, joinSchema, rejoinSchema, settingsSchema } from './schemas.js';
import { TokenBucket } from './rateLimit.js';

type IO = Server<ClientToServer, ServerToClient>;
type Sock = Socket<ClientToServer, ServerToClient>;

interface SocketData {
  room?: Room;
  player?: RoomPlayer;
  bucket: TokenBucket;
}

export function attachSockets(io: IO): RoomManager {
  const makeEmitter = (code: string): Emitter => ({
    toPlayer: (playerId, event, ...args) => io.to(`p:${playerId}`).emit(event, ...args),
    toAll: (event, ...args) => io.to(`r:${code}`).emit(event, ...args),
  });
  const rooms = new RoomManager(makeEmitter);
  /** playerId → last rename time (stops rename spam). */
  const renameAt = new Map<string, number>();

  io.on('connection', (socket: Sock) => {
    const data: SocketData = { bucket: new TokenBucket(CONFIG.net.rateLimitPerSec, CONFIG.net.rateLimitBurst) };

    /** Wrap a handler: rate limit, catch everything, always ack exactly once. */
    function guard<P>(handler: (payload: unknown) => Ack & { session?: SessionInfo }) {
      return (payload: P, ack: unknown) => {
        const reply = typeof ack === 'function' ? (ack as (r: Ack) => void) : () => {};
        if (!data.bucket.take()) return reply({ ok: false, error: 'Slow down' });
        try {
          reply(handler(payload));
        } catch (err) {
          console.error('[socket] handler error', err);
          reply({ ok: false, error: 'Server error' });
        }
      };
    }

    function attach(room: Room, player: RoomPlayer): SessionInfo {
      detach();
      data.room = room;
      data.player = player;
      player.sockets.add(socket.id);
      player.lastSeen = Date.now();
      socket.join(`r:${room.code}`);
      socket.join(`p:${player.id}`);
      const session = { code: room.code, playerId: player.id, token: player.token };
      socket.emit('session', session);
      room.broadcastLobby();
      if (room.game) {
        room.game.isConnected = (pid) => (room.get(pid)?.sockets.size ?? 0) > 0;
        room.game.sendInitial(player.id);
        room.game.onReconnect?.(player.id);
      }
      return session;
    }

    function detach(): void {
      const { room, player } = data;
      if (!room || !player) return;
      player.sockets.delete(socket.id);
      player.lastSeen = Date.now();
      socket.leave(`r:${room.code}`);
      socket.leave(`p:${player.id}`);
      data.room = undefined;
      data.player = undefined;
      room.broadcastLobby();
    }

    socket.on(
      'lobby:create',
      guard((raw) => {
        const p = createSchema.safeParse(raw);
        if (!p.success) return { ok: false, error: 'Enter a name (1–16 characters)' };
        const room = rooms.create();
        const player = room.addPlayer(p.data.name);
        if (typeof player === 'string') return { ok: false, error: player };
        return { ok: true, session: attach(room, player) };
      }),
    );

    socket.on(
      'lobby:join',
      guard((raw) => {
        const p = joinSchema.safeParse(raw);
        if (!p.success) return { ok: false, error: 'Enter a name and the 5-character code' };
        const room = rooms.get(p.data.code);
        if (!room) return { ok: false, error: 'No game with that code' };
        const player = room.addPlayer(p.data.name);
        if (typeof player === 'string') return { ok: false, error: player };
        return { ok: true, session: attach(room, player) };
      }),
    );

    socket.on(
      'lobby:rejoin',
      guard((raw) => {
        const p = rejoinSchema.safeParse(raw);
        if (!p.success) return { ok: false, error: 'Bad session' };
        const room = rooms.get(p.data.code);
        if (!room) return { ok: false, error: 'That game no longer exists (the server may have restarted)' };
        const player = room.byToken(p.data.token);
        if (!player) return { ok: false, error: 'Your seat in that game was not found' };
        return { ok: true, session: attach(room, player) };
      }),
    );

    socket.on(
      'lobby:settings',
      guard((raw) => {
        const { room, player } = data;
        if (!room || !player) return { ok: false, error: 'Not in a room' };
        if (room.hostId !== player.id) return { ok: false, error: 'Only the host can change settings' };
        if (room.phase !== 'lobby') return { ok: false, error: 'Game already started' };
        const p = settingsSchema.safeParse(raw);
        if (!p.success) return { ok: false, error: 'Invalid settings' };
        Object.assign(room.settings, p.data);
        room.broadcastLobby();
        return { ok: true };
      }),
    );

    socket.on(
      'lobby:start',
      guard(() => {
        const { room, player } = data;
        if (!room || !player) return { ok: false, error: 'Not in a room' };
        if (room.hostId !== player.id) return { ok: false, error: 'Only the host can start' };
        const err = room.start();
        if (err) return { ok: false, error: err };
        room.game!.isConnected = (pid) => (room.get(pid)?.sockets.size ?? 0) > 0;
        return { ok: true };
      }),
    );

    socket.on(
      'lobby:rename',
      guard((raw) => {
        const { room, player } = data;
        if (!room || !player) return { ok: false, error: 'Not in a room' };
        const p = createSchema.safeParse(raw);
        if (!p.success) return { ok: false, error: 'Names must be 1–16 characters' };
        const now = Date.now();
        if (now - (renameAt.get(player.id) ?? 0) < 3000) return { ok: false, error: 'Wait a few seconds before renaming again' };
        const err = room.rename(player.id, p.data.name);
        if (err) return { ok: false, error: err };
        renameAt.set(player.id, now);
        return { ok: true };
      }),
    );

    socket.on(
      'lobby:company',
      guard((raw) => {
        const { room, player } = data;
        if (!room || !player) return { ok: false, error: 'Not in a room' };
        const p = companySchema.safeParse(raw);
        if (!p.success) return { ok: false, error: `Company names must be 2–${CONFIG.lobby.maxCompanyNameLength} characters with some letters` };
        const err = room.setCompany(player.id, p.data.companyName, p.data.sector);
        return err ? { ok: false, error: err } : { ok: true };
      }),
    );

    socket.on(
      'lobby:leave',
      guard(() => {
        const { room, player } = data;
        if (!room || !player) return { ok: true };
        detach();
        // In the lobby, leaving frees the seat. Mid-game the seat stays (they can rejoin).
        if (room.phase === 'lobby') {
          room.removePlayer(player.id);
          room.broadcastLobby();
        }
        return { ok: true };
      }),
    );

    socket.on(
      'act',
      guard((raw) => {
        const { room, player } = data;
        if (!room || !player || !room.game) return { ok: false, error: 'Not in a running game' };
        const p = actionSchema.safeParse(raw);
        if (!p.success) return { ok: false, error: 'Invalid action' };
        return room.game.handle(player.id, p.data);
      }),
    );

    socket.on('disconnect', () => detach());
  });

  return rooms;
}
