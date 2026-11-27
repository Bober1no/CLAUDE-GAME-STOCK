import { useState } from 'react';
import { CONFIG, GAME_VERSION } from '@warmarket/shared';
import { createRoom, joinRoom } from '../net/socket';
import { setState, useStore } from '../state/store';

const TAPE = 'OIL 80.00 ▲2.1%   GOLD 1900 ▼0.4%   WHEAT 7.00 ▲0.8%   LITHIUM 24.00 ▲5.2%   DOGE2 1.0000 ▼31.0%   HOTA 62.00 ▲1.3%   VAPR 115.0 ▼1.9%   ';

export function Home() {
  const fatal = useStore((s) => s.fatal);
  const conn = useStore((s) => s.conn);
  const [name, setName] = useState(() => localStorage.getItem('warmarket.name') ?? '');
  const [code, setCode] = useState(() => new URLSearchParams(location.search).get('code')?.toUpperCase() ?? '');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function go(kind: 'create' | 'join') {
    setErr(null);
    const n = name.trim();
    if (!n) return setErr('Pick a name first.');
    try {
      localStorage.setItem('warmarket.name', n);
    } catch {
      /* ignore */
    }
    setBusy(true);
    const r = kind === 'create' ? await createRoom(n) : await joinRoom(code.trim(), n);
    setBusy(false);
    if (!r.ok) setErr(r.error ?? 'Failed');
    else setState({ fatal: null });
  }

  return (
    <div className="splash">
      <div className="splash-card">
        <div className="logo">
          WAR<b>/</b>MARKET<i>_</i> <span className="ver">{GAME_VERSION}</span>
        </div>
        <div className="tagline">Run a company. Plant stories. Short your friends. The stock market is the scoreboard.</div>
        <div className="tape">
          {TAPE}
          {TAPE}
        </div>
        {fatal && <div className="err" style={{ marginBottom: 14 }}>{fatal}</div>}
        <div className="form-row">
          <label className="label">Your name</label>
          <input
            className="input"
            maxLength={CONFIG.lobby.maxNameLength}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Baron von Short"
            autoFocus
          />
        </div>
        <button className="btn primary" style={{ width: '100%', padding: 11 }} disabled={busy || conn !== 'connected'} onClick={() => go('create')}>
          Create game
        </button>
        <div className="or">— OR JOIN WITH A CODE —</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8 }}>
          <input
            className="input code-input"
            maxLength={CONFIG.lobby.codeLength}
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
            onKeyDown={(e) => e.key === 'Enter' && go('join')}
            placeholder="CODE"
          />
          <button className="btn" disabled={busy || conn !== 'connected' || code.length !== CONFIG.lobby.codeLength} onClick={() => go('join')}>
            Join
          </button>
        </div>
        {err && <div className="err">{err}</div>}
        <div className="faint" style={{ marginTop: 26, fontSize: 11 }}>
          2–8 players · 30–45 minutes · no accounts. One person creates, everyone else types the code.
        </div>
      </div>
    </div>
  );
}
