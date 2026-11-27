import { useState } from 'react';
import { CONFIG } from '@warmarket/shared';
import { renameMe } from '../net/socket';
import { localNotice, useStore } from '../state/store';

/** Inline "change my name" control. Works in the lobby and mid-game. */
export function RenameBox() {
  const me = useStore((s) => s.lobby?.players.find((p) => p.id === s.session?.playerId));
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  if (!me) return null;

  async function save() {
    const n = name.trim();
    if (!n || n === me!.name) return setEditing(false);
    const r = await renameMe(n);
    if (r.ok) {
      setEditing(false);
      localNotice('good', `You are now ${n}`);
    } else localNotice('warn', r.error ?? 'Could not rename');
  }

  if (!editing)
    return (
      <button
        className="btn sm ghost"
        onClick={() => {
          setName(me.name);
          setEditing(true);
        }}
      >
        Rename
      </button>
    );
  return (
    <span style={{ display: 'inline-flex', gap: 4 }}>
      <input
        className="input"
        style={{ padding: '3px 6px', width: 130 }}
        autoFocus
        maxLength={CONFIG.lobby.maxNameLength}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') save();
          if (e.key === 'Escape') setEditing(false);
        }}
      />
      <button className="btn sm primary" onClick={save}>
        Save
      </button>
    </span>
  );
}
