import type { ServerToClient } from '@warmarket/shared';

/** What game logic is allowed to do to the outside world: emit to one player or to everyone. */
export interface Emitter {
  toPlayer<E extends keyof ServerToClient>(playerId: string, event: E, ...args: Parameters<ServerToClient[E]>): void;
  toAll<E extends keyof ServerToClient>(event: E, ...args: Parameters<ServerToClient[E]>): void;
}

/** Emitter that discards everything (tests, simulations). */
export const nullEmitter: Emitter = {
  toPlayer() {},
  toAll() {},
};
