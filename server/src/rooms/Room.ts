import { randomBytes } from 'node:crypto';
import { CONFIG, NATION_COLORS, type LobbySettings, type LobbyState, type RoomPhase } from '@warmarket/shared';
import { uid } from '../util/rng.js';
import type { Emitter } from '../net/emitter.js';
import { Game } from '../game/Game.js';

export interface RoomPlayer {
  id: string;
  name: string;
  /** Secret used to reclaim this seat after a disconnect. Never sent to other players. */
  token: string;
  color: string;
  sockets: Set<string>;
  lastSeen: number;
}

export class Room {
  phase: RoomPhase = 'lobby';
  players: RoomPlayer[] = [];
  hostId = '';
  settings: LobbySettings = {
    sessionMinutes: CONFIG.lobby.defaultSessionMinutes,
    mode: 'networth',
    rolesEnabled: false,
  };
  game: Game | null = null;
  createdAt = Date.now();
  endedAt = 0;
  emptySince = 0;

  constructor(
    public code: string,
    private emitter: Emitter,
  ) {}

  addPlayer(name: string): RoomPlayer | string {
    if (this.phase !== 'lobby') return 'Game already started';
    if (this.players.length >= CONFIG.lobby.maxPlayers) return 'Room is full';
    if (this.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) return 'Name already taken in this room';
    const used = new Set(this.players.map((p) => p.color));
    const color = NATION_COLORS.find((c) => !used.has(c)) ?? NATION_COLORS[0];
    const p: RoomPlayer = { id: uid('p'), name, token: randomBytes(18).toString('base64url'), color, sockets: new Set(), lastSeen: Date.now() };
    this.players.push(p);
    if (!this.hostId) this.hostId = p.id;
    return p;
  }

  removePlayer(playerId: string): void {
    this.players = this.players.filter((p) => p.id !== playerId);
    if (this.hostId === playerId) this.hostId = this.players[0]?.id ?? '';
  }

  byToken(token: string): RoomPlayer | undefined {
    return this.players.find((p) => p.token === token);
  }

  get(playerId: string): RoomPlayer | undefined {
    return this.players.find((p) => p.id === playerId);
  }

  connectedCount(): number {
    return this.players.filter((p) => p.sockets.size > 0).length;
  }

  lobbyState(): LobbyState {
    return {
      code: this.code,
      phase: this.phase,
      hostId: this.hostId,
      settings: this.settings,
      players: this.players.map((p) => ({ id: p.id, name: p.name, isHost: p.id === this.hostId, connected: p.sockets.size > 0, color: p.color })),
    };
  }

  broadcastLobby(): void {
    this.emitter.toAll('lobby:state', this.lobbyState());
  }

  start(): string | null {
    if (this.phase !== 'lobby') return 'Already started';
    if (this.players.length < CONFIG.lobby.minPlayers) return `Need at least ${CONFIG.lobby.minPlayers} players`;
    this.phase = 'running';
    this.game = new Game(
      this.code,
      this.players.map((p) => ({ id: p.id, name: p.name, color: p.color })),
      this.settings,
      this.emitter,
      () => {
        this.phase = 'ended';
        this.endedAt = Date.now();
        this.broadcastLobby();
      },
    );
    this.game.start();
    this.broadcastLobby();
    return null;
  }

  dispose(): void {
    this.game?.stop();
  }
}
