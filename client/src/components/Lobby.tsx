import { useState } from 'react';
import { CONFIG, type GameMode } from '@warmarket/shared';
import { leaveRoom, startGame, updateSettings } from '../net/socket';
import { useStore } from '../state/store';
import { RenameBox } from './RenameBox';

const MODES: { id: GameMode; label: string; desc: string }[] = [
  { id: 'networth', label: 'Net worth', desc: 'Richest nation when the clock runs out wins.' },
  { id: 'domination', label: 'Domination', desc: `First to control ${Math.round(CONFIG.modes.dominationShare * 100)}% of world production wins.` },
  { id: 'hegemony', label: 'Hegemony', desc: `Hold a majority of capitals for ${CONFIG.modes.hegemonyHoldSec}s.` },
  { id: 'lastStanding', label: 'Last one standing', desc: 'Lose all your provinces and you are out.' },
];

export function Lobby() {
  const lobby = useStore((s) => s.lobby);
  const session = useStore((s) => s.session);
  const [err, setErr] = useState<string | null>(null);
  if (!lobby || !session) {
    return (
      <div className="splash">
        <div className="dim">Joining…</div>
      </div>
    );
  }
  const isHost = lobby.hostId === session.playerId;
  const s = lobby.settings;
  const shareUrl = `${location.origin}/?code=${lobby.code}`;

  async function set(p: Parameters<typeof updateSettings>[0]) {
    const r = await updateSettings(p);
    if (!r.ok) setErr(r.error ?? 'Failed');
  }

  return (
    <div className="splash">
      <div className="splash-card" style={{ maxWidth: 520 }}>
        <div className="label">Game code — tell everyone</div>
        <div className="lobby-code">{lobby.code}</div>
        <div className="faint mono" style={{ fontSize: 11, textAlign: 'center', marginTop: -10, marginBottom: 18 }}>
          or share {shareUrl}
        </div>

        <div className="label">
          Players {lobby.players.length}/{CONFIG.lobby.maxPlayers}
        </div>
        <div className="player-list">
          {lobby.players.map((p) => (
            <div className="player-row" key={p.id}>
              <span className="swatch" style={{ background: p.color }} />
              <span style={{ flex: 1, fontWeight: p.id === session.playerId ? 700 : 400 }}>
                {p.name}
                {p.id === session.playerId && <span className="faint"> (you)</span>}
              </span>
              {p.id === session.playerId && <RenameBox />}
              {p.isHost && <span className="tag host">host</span>}
              {!p.connected && <span className="tag red">offline</span>}
            </div>
          ))}
        </div>

        <div className="settings-grid">
          <div>
            <label className="label">Session length</label>
            <select className="input" disabled={!isHost} value={s.sessionMinutes} onChange={(e) => set({ sessionMinutes: Number(e.target.value) })}>
              {CONFIG.lobby.sessionMinutesOptions.map((m) => (
                <option key={m} value={m}>
                  {m} minutes
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Mode</label>
            <select className="input" disabled={!isHost} value={s.mode} onChange={(e) => set({ mode: e.target.value as GameMode })}>
              {MODES.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
          <div style={{ gridColumn: '1 / -1' }} className="dim">
            {MODES.find((m) => m.id === s.mode)?.desc}
          </div>
          <label style={{ gridColumn: '1 / -1', display: 'flex', gap: 8, alignItems: 'center', cursor: isHost ? 'pointer' : 'default' }}>
            <input type="checkbox" disabled={!isHost} checked={s.rolesEnabled} onChange={(e) => set({ rolesEnabled: e.target.checked })} />
            <span>
              Secret roles <span className="faint">(analyst / whale / journalist, randomly assigned)</span>
            </span>
          </label>
        </div>

        {isHost ? (
          <button
            className="btn primary"
            style={{ width: '100%', padding: 11 }}
            disabled={lobby.players.length < CONFIG.lobby.minPlayers}
            onClick={async () => {
              const r = await startGame();
              if (!r.ok) setErr(r.error ?? 'Failed');
            }}
          >
            Start game
          </button>
        ) : (
          <div className="dim" style={{ textAlign: 'center', padding: 10 }}>
            Waiting for the host to start…
          </div>
        )}
        {err && <div className="err">{err}</div>}
        <button className="btn ghost sm" style={{ marginTop: 14 }} onClick={() => leaveRoom()}>
          Leave
        </button>
      </div>
    </div>
  );
}
