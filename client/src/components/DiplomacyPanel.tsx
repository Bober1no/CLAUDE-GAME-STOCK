import { act } from '../net/socket';
import { useStore } from '../state/store';

export function DiplomacyPanel() {
  const view = useStore((s) => s.view);
  const st = useStore((s) => s.static);
  if (!view || !st) return null;
  const name = (id: string) => st.nations.find((n) => n.id === id)?.name ?? id;
  const incoming = view.proposals.filter((p) => p.to === view.me.id);
  return (
    <div className="panel-b" style={{ padding: 10 }}>
      <div className="label">Proposals</div>
      {incoming.length === 0 && <div className="faint">None.</div>}
      {incoming.map((p) => (
        <div key={p.id} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
          <span style={{ flex: 1 }}>
            {name(p.from)} offers <b>{p.kind}</b>
          </span>
          <button className="btn sm buy" onClick={() => act({ type: 'respondProposal', proposalId: p.id, accept: true })}>
            Accept
          </button>
          <button className="btn sm sell" onClick={() => act({ type: 'respondProposal', proposalId: p.id, accept: false })}>
            Reject
          </button>
        </div>
      ))}
      <div className="label" style={{ marginTop: 12 }}>
        Wars
      </div>
      {view.wars.length === 0 && <div className="faint">The world is at peace. For now.</div>}
      {view.wars.map((w) => (
        <div key={`${w.a}${w.b}`} className="down">
          {name(w.a)} ⚔ {name(w.b)} <span className="faint">· {w.casualties} casualties</span>
        </div>
      ))}
    </div>
  );
}
