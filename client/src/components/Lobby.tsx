import { useEffect, useState } from 'react';
import { CONFIG, SECTORS, SECTOR_LABEL, type Sector } from '@warmarket/shared';
import { leaveRoom, setCompany, startGame, updateSettings } from '../net/socket';
import { useStore } from '../state/store';
import { RenameBox } from './RenameBox';

export function Lobby() {
  const lobby = useStore((s) => s.lobby);
  const session = useStore((s) => s.session);
  const [err, setErr] = useState<string | null>(null);
  const me = lobby?.players.find((p) => p.id === session?.playerId);
  const [coName, setCoName] = useState(me?.companyName ?? '');
  // Keep the input in sync if the server changes it (e.g. first load).
  useEffect(() => {
    if (me && !coName) setCoName(me.companyName);
  }, [me, coName]);

  if (!lobby || !session || !me) {
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
    setErr(r.ok ? null : r.error ?? 'Failed');
  }
  async function saveCompany(p: { companyName?: string; sector?: Sector }) {
    const r = await setCompany(p);
    setErr(r.ok ? null : r.error ?? 'Failed');
  }

  return (
    <div className="splash">
      <div className="splash-card" style={{ maxWidth: 560 }}>
        <div className="label">Game code — tell everyone</div>
        <div className="lobby-code">{lobby.code}</div>
        <div className="faint mono" style={{ fontSize: 11, textAlign: 'center', marginTop: -10, marginBottom: 18 }}>
          or share {shareUrl}
        </div>

        <div className="label">Your company (goes public when the game starts)</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 130px', gap: 8, marginBottom: 6 }}>
          <input
            className="input"
            maxLength={CONFIG.lobby.maxCompanyNameLength}
            value={coName}
            onChange={(e) => setCoName(e.target.value)}
            onBlur={() => coName.trim() && coName.trim() !== me.companyName && saveCompany({ companyName: coName.trim() })}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            placeholder="e.g. Totally Legit Holdings"
          />
          <select className="input" value={me.sector} onChange={(e) => saveCompany({ sector: e.target.value as Sector })}>
            {SECTORS.map((x) => (
              <option key={x} value={x}>
                {SECTOR_LABEL[x]}
              </option>
            ))}
          </select>
        </div>
        <div className="faint" style={{ fontSize: 11, marginBottom: 16 }}>
          You start with ${CONFIG.start.cash.toLocaleString('en-US')} cash and {CONFIG.start.founderShares} founder shares at ${CONFIG.start.ipoPrice}. Your sector links your stock to commodities (energy ↔ oil, tech ↔ lithium…).
        </div>

        <div className="label">
          Players {lobby.players.length}/{CONFIG.lobby.maxPlayers}
        </div>
        <div className="player-list">
          {lobby.players.map((p) => (
            <div className="player-row" key={p.id}>
              <span className="swatch" style={{ background: p.color }} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontWeight: p.id === session.playerId ? 700 : 400 }}>
                  {p.name}
                  {p.id === session.playerId && <span className="faint"> (you)</span>}
                </span>
                <div className="faint" style={{ fontSize: 11 }}>
                  {p.companyName} · {SECTOR_LABEL[p.sector]}
                </div>
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
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: isHost ? 'pointer' : 'default', alignSelf: 'end', paddingBottom: 8 }}>
            <input type="checkbox" disabled={!isHost} checked={s.rolesEnabled} onChange={(e) => set({ rolesEnabled: e.target.checked })} />
            <span>
              Secret roles <span className="faint">(analyst / whale / journalist)</span>
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
            Ring the opening bell
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
