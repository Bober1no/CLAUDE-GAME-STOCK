import { randomInt } from 'node:crypto';
import { CONFIG } from '@warmarket/shared';
import { Room } from './Room.js';
import type { Emitter } from '../net/emitter.js';

/** All rooms live in memory. A restart (e.g. Render waking up) wipes them — by design. */
export class RoomManager {
  private rooms = new Map<string, Room>();
  private sweeper: NodeJS.Timeout;

  constructor(private makeEmitter: (code: string) => Emitter) {
    this.sweeper = setInterval(() => this.sweep(), 30_000);
    this.sweeper.unref();
  }

  create(): Room {
    let code = '';
    do {
      code = '';
      for (let i = 0; i < CONFIG.lobby.codeLength; i++) code += CONFIG.lobby.codeAlphabet[randomInt(CONFIG.lobby.codeAlphabet.length)];
    } while (this.rooms.has(code));
    const room = new Room(code, this.makeEmitter(code));
    this.rooms.set(code, room);
    return room;
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code.toUpperCase());
  }

  count(): number {
    return this.rooms.size;
  }

  /** Drop rooms nobody is connected to, and finished games after the recap TTL. */
  private sweep(): void {
    const now = Date.now();
    for (const [code, room] of this.rooms) {
      const connected = room.connectedCount();
      if (connected === 0) {
        if (!room.emptySince) room.emptySince = now;
      } else room.emptySince = 0;
      const emptyTooLong = room.emptySince && now - room.emptySince > CONFIG.lobby.emptyRoomTtlMs;
      const finishedTooLong = room.phase === 'ended' && now - room.endedAt > CONFIG.lobby.finishedRoomTtlMs;
      if (emptyTooLong || finishedTooLong) {
        room.dispose();
        this.rooms.delete(code);
      }
    }
  }
}
