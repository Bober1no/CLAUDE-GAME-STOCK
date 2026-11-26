import { useStore } from '../state/store';

export function Toasts() {
  const notices = useStore((s) => s.notices);
  return (
    <div className="toasts">
      {notices.map((n) => (
        <div key={n.id} className={`toast ${n.kind}`}>
          {n.kind === 'tip' && <b style={{ color: '#b991ff' }}>INSIDER TIP · </b>}
          {n.text}
        </div>
      ))}
    </div>
  );
}
