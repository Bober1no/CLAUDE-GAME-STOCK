import { useEffect, useRef, useState } from 'react';
import { CONFIG } from '@warmarket/shared';
import { act } from '../net/socket';
import { useStore } from '../state/store';

export function ChatPanel() {
  const chat = useStore((s) => s.chat);
  const st = useStore((s) => s.static);
  const lb = useStore((s) => s.view?.leaderboard);
  const [to, setTo] = useState<string>('');
  const [text, setText] = useState('');
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    box.current?.scrollTo(0, box.current.scrollHeight);
  }, [chat.length]);
  if (!st || !lb) return null;
  const me = st.playerId;
  const colorOf = (pid: string) => lb.find((r) => r.playerId === pid)?.color ?? '#aaa';
  const nameOf = (pid: string) => lb.find((r) => r.playerId === pid)?.name ?? '?';

  async function send() {
    const t = text.trim();
    if (!t) return;
    const r = await act({ type: 'chat', text: t, toId: to || null });
    if (r.ok) setText('');
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div className="panel-b chat" ref={box}>
        {chat.length === 0 && <div className="empty">Say something threatening. Or coordinate a pump. Whatever.</div>}
        {chat.map((c) => (
          <div key={c.id} className={`chat-line ${c.toId ? 'dm' : ''}`}>
            <span style={{ color: colorOf(c.fromId), fontWeight: 600 }}>{c.fromName}</span>
            {c.toId && <span className="faint"> → {c.toId === me ? 'you' : nameOf(c.toId)}</span>}
            <span className="faint">: </span>
            <span>{c.text}</span>
          </div>
        ))}
      </div>
      <div className="chat-in">
        <select className="input" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 92 }}>
          <option value="">All</option>
          {lb
            .filter((r) => r.playerId !== me)
            .map((r) => (
              <option key={r.playerId} value={r.playerId}>
                @{r.name}
              </option>
            ))}
        </select>
        <input className="input" maxLength={CONFIG.chat.maxLength} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} placeholder={to ? 'Private message…' : 'Message everyone…'} />
      </div>
    </div>
  );
}
