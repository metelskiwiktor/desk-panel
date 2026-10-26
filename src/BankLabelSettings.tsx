import { useState, type CSSProperties, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Pencil, Trash2, X } from 'lucide-react';
import { BANK_LABEL_LIMITS, BANK_PARTY_KINDS, type BankLabelsData } from './bank-labels-contract';
import { COLOR_VALUES, ICONS, KIND_ICONS, KIND_WORDS } from './bank-look';
import { BankCategoryEditor } from './BankCategoryEditor';
import type { BankLabelsHook } from './useBankLabels';

const KIND_NAMES = { account: 'rachunek', phone: 'telefon', phoneTail: 'końcówka telefonu', name: 'nazwa', merchant: 'tekst w banku' } as const;

/**
 * The settings of marking: from which day an unmarked operation counts as "to be marked", the categories (name, colour, icon,
 * delete), tags and purposes, and the other sides (people, companies and the user's own accounts) with what the bank showed for
 * them: a side's kind can be changed, and an identifier forgotten when it was taken by mistake. Every change is saved at once;
 * deleting asks twice.
 */
export function BankLabelSettings({ data, act, error, close }: { data: BankLabelsData; act: BankLabelsHook['act']; error: string; close: () => void }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const keys = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); close(); } };
  const rename = (key: string, current: string) => {
    const name = (names[key] ?? current).trim();
    if (!name || name === current) return;
    void act(key.startsWith('tag:') ? { action: 'renameTag', tag: current, name } : key.startsWith('purpose:') ? { action: 'renamePurpose', purpose: current, name } : { action: 'updateParty', party: key, name });
  };
  const remove = (key: string, label: string, run: () => void) => removing === key
    ? <button type="button" className="danger" autoFocus onBlur={() => setRemoving(null)} onClick={() => { run(); setRemoving(null); }}>Usunąć?</button>
    : <button type="button" className="danger" aria-label={`Usuń ${label}`} onClick={() => setRemoving(key)}><Trash2 size={15} aria-hidden="true" /></button>;
  const nameInput = (key: string, current: string, label: string, max: number) => <input aria-label={label} value={names[key] ?? current} maxLength={max}
    onChange={e => setNames(n => ({ ...n, [key]: e.target.value }))} onBlur={() => rename(key, current)} onKeyDown={e => { if (e.key === 'Enter') rename(key, current); }} />;
  const words = (list: string[], kind: 'tag' | 'purpose', empty: string) => list.length ? <ul className="bank-set-list">
    {list.map(word => <li key={word}>
      <span className="bank-set-hash" aria-hidden="true">{kind === 'tag' ? '#' : '·'}</span>
      {nameInput(`${kind}:${word}`, word, `${kind === 'tag' ? 'Etykieta' : 'Cel'} ${word}`, BANK_LABEL_LIMITS.tag)}
      {remove(`${kind}:${word}`, `${kind === 'tag' ? 'etykietę' : 'cel'} ${word}`, () => void act(kind === 'tag' ? { action: 'deleteTag', tag: word } : { action: 'deletePurpose', purpose: word }))}
    </li>)}
  </ul> : <p className="p2-note">{empty}</p>;

  return createPortal(
    <div className="todo-dlg-scrim" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
      <div className="todo-dlg bank-dlg" role="dialog" aria-modal="true" aria-label="Ustawienia oznaczeń" onKeyDown={keys}>
        <div className="todo-dlg-head">
          <h2>Oznaczenia operacji</h2>
          <button type="button" aria-label="Zamknij" onClick={close}><X size={18} aria-hidden="true" /></button>
        </div>
        <label className="bank-since">
          <span>Do przypisania licz od</span>
          <input type="date" value={data.since} max="2100-12-31" onChange={e => { if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) void act({ action: 'setSince', since: e.target.value }); }} />
        </label>
        <p className="p2-note">Starsze operacje bez kategorii zostają „Bez kategorii” i nie są liczone.</p>

        <span className="todo-dlg-label">Kategorie</span>
        {data.categories.length ? <ul className="bank-set-list">
          {data.categories.map(c => { const Icon = ICONS[c.icon]; return <li key={c.id} style={{ '--c': COLOR_VALUES[c.color] } as CSSProperties}>
            {editing === c.id ? <BankCategoryEditor label="Zapisz" initial={c} cancel={() => setEditing(null)}
              submit={value => { void act({ action: 'updateCategory', category: c.id, ...value }); setEditing(null); }} /> : <>
              <span className="bank-avatar small" aria-hidden="true"><Icon size={15} /></span>
              <span className="bank-set-name">{c.name}</span>
              <button type="button" aria-label={`Zmień kategorię ${c.name}`} onClick={() => setEditing(c.id)}><Pencil size={15} aria-hidden="true" /></button>
              {remove(c.id, `kategorię ${c.name}`, () => void act({ action: 'deleteCategory', category: c.id }))}
            </>}
          </li>; })}
        </ul> : <p className="p2-note">Kategorie dodajesz w oknie operacji przyciskiem „Nowa”.</p>}

        <span className="todo-dlg-label">Cele (przy osobach)</span>
        {words(data.purposes, 'purpose', 'Cele, np. pożyczka, zwrot, dokładka, dopisujesz w oknie operacji z osobą.')}

        <span className="todo-dlg-label">Etykiety</span>
        {words(data.tags, 'tag', 'Etykiety dopisujesz w oknie operacji.')}

        <span className="todo-dlg-label">Druga strona</span>
        {data.parties.length ? <ul className="bank-set-list">
          {data.parties.map(p => { const Icon = KIND_ICONS[p.kind]; return <li key={p.id} className="person">
            <span className="bank-avatar small none" aria-hidden="true"><Icon size={15} /></span>
            {nameInput(p.id, p.name, `Nazwa: ${p.name}`, BANK_LABEL_LIMITS.partyName)}
            {remove(p.id, p.name, () => void act({ action: 'deleteParty', party: p.id }))}
            <span className="bank-set-ids">
              <span className="bank-kinds-switch" role="group" aria-label={`Rodzaj: ${p.name}`}>
                {BANK_PARTY_KINDS.map(k => <button key={k} type="button" aria-pressed={p.kind === k} onClick={() => void act({ action: 'updateParty', party: p.id, kind: k })}>{KIND_WORDS[k]}</button>)}
              </span>
              {p.identifiers.length ? p.identifiers.map(i => <span key={i.id} className="bank-id-chip">{KIND_NAMES[i.kind]} {i.kind === 'name' || i.kind === 'merchant' ? `„${i.hint}”` : i.hint}
                <button type="button" aria-label={`Zapomnij: ${KIND_NAMES[i.kind]} ${i.hint}`} onClick={() => void act({ action: 'forgetIdentifier', party: p.id, identifier: i.id })}><X size={12} aria-hidden="true" /></button></span>)
                : <span className="p2-note">Jeszcze nierozpoznawana: zapamięta, co bank pokazał, przy pierwszym oznaczeniu.</span>}
            </span>
          </li>; })}
        </ul> : <p className="p2-note">Drugą stronę (osobę, firmę albo siebie) dodajesz w oknie operacji.</p>}
        {error && <p className="p2-note warn" role="status">{error}</p>}
      </div>
    </div>,
    document.body,
  );
}
