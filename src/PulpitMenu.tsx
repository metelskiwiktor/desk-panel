import { useRef, useState } from 'react';
import { Check, LayoutDashboard, Pencil, Plus, Trash2 } from 'lucide-react';
import { useDismiss } from './popover';
import { MAX_NAME, MAX_PULPITS, type Pulpits } from './pulpits';

/** The top-bar button that switches between the virtual desktops and manages them. */
export function PulpitMenu({ pulpits }: { pulpits: Pulpits }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [removing, setRemoving] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const settled = useRef(false); // Enter and Escape already decided; the blur that follows must not decide again
  const close = () => { setOpen(false); setEditing(null); setRemoving(null); };
  useDismiss(open, close, root);
  const current = pulpits.items.find(p => p.id === pulpits.active) ?? pulpits.items[0];
  const several = pulpits.items.length > 1;
  const finishRename = (save: boolean) => {
    if (settled.current) return;
    settled.current = true;
    if (save && editing) pulpits.rename(editing, draft);
    setEditing(null);
  };
  return (
    <div className="pulpit-menu" ref={root} data-pick-through="">
      <button className={`top-button pulpit-button${several ? ' named' : ''}`} aria-label={`Pulpity: ${current.name}`} aria-haspopup="dialog" aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}>
        <LayoutDashboard size={20} />
        {several && <span className="pulpit-name">{current.name}</span>}
      </button>
      {open && (
        <div className="pulpit-pop" role="dialog" aria-label="Pulpity">
          <ul className="pulpit-list">
            {pulpits.items.map(p => (
              <li key={p.id} className={p.id === pulpits.active ? 'is-current' : undefined}>
                {editing === p.id ? (
                  <input className="pulpit-input" aria-label="Nazwa pulpitu" value={draft} maxLength={MAX_NAME} autoFocus
                    onChange={e => setDraft(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') { e.preventDefault(); finishRename(true); }
                      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finishRename(false); }
                    }}
                    onBlur={() => finishRename(true)} />
                ) : (
                  <>
                    <button className="pulpit-pick" aria-current={p.id === pulpits.active ? 'true' : undefined}
                      onClick={() => { pulpits.select(p.id); close(); }}>
                      <span className="pulpit-check">{p.id === pulpits.active && <Check size={15} />}</span>
                      <span className="pulpit-label">{p.name}</span>
                    </button>
                    <button className="pulpit-act" aria-label={`Zmień nazwę: ${p.name}`} onClick={() => { setRemoving(null); setDraft(p.name); settled.current = false; setEditing(p.id); }}><Pencil size={14} /></button>
                    {several && (removing === p.id
                      ? <button className="pulpit-act danger" onClick={() => { pulpits.remove(p.id); close(); }}>Usunąć?</button>
                      : <button className="pulpit-act" aria-label={`Usuń: ${p.name}`} onClick={() => setRemoving(p.id)}><Trash2 size={14} /></button>)}
                  </>
                )}
              </li>
            ))}
          </ul>
          <button className="pulpit-new" disabled={pulpits.items.length >= MAX_PULPITS} onClick={() => { pulpits.add(); close(); }}>
            <Plus size={15} /> Nowy pulpit
          </button>
        </div>
      )}
    </div>
  );
}
