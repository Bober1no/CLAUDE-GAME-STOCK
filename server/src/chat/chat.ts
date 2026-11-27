/** Global and private chat. Private messages only ever reach sender and recipient. */
import { CONFIG, type ChatMessage } from '@warmarket/shared';
import { uid } from '../util/rng.js';
import type { Game } from '../game/Game.js';

export class Chat {
  messages: ChatMessage[] = [];
  private lastAt = new Map<string, number>();

  constructor(private g: Game) {}

  send(playerId: string, text: string, toId: string | null, now: number): string | null {
    if (now - (this.lastAt.get(playerId) ?? 0) < CONFIG.chat.rateMs) return 'Slow down';
    const clean = text.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, CONFIG.chat.maxLength);
    if (!clean) return 'Empty message';
    const from = this.g.players.find((p) => p.id === playerId)!;
    if (toId !== null && (!this.g.players.some((p) => p.id === toId) || toId === playerId)) return 'Unknown recipient';
    this.lastAt.set(playerId, now);
    const msg: ChatMessage = { id: uid('c'), t: now, fromId: playerId, fromName: from.name, toId, text: clean };
    this.messages.push(msg);
    if (this.messages.length > CONFIG.chat.history * 3) this.messages.shift();
    if (toId === null) this.g.emit.toAll('chat', msg);
    else {
      this.g.emit.toPlayer(playerId, 'chat', msg);
      this.g.emit.toPlayer(toId, 'chat', msg);
    }
    return null;
  }

  /** Only global messages plus private ones you sent or received. */
  for(playerId: string): ChatMessage[] {
    return this.messages.filter((c) => c.toId === null || c.toId === playerId || c.fromId === playerId).slice(-CONFIG.chat.history);
  }
}
