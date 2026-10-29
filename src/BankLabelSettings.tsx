import { useState, type CSSProperties, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Merge, Pencil, Trash2, X } from 'lucide-react';
import { BANK_LABEL_LIMITS, type BankCategoryMove, type BankLabelsData } from './bank-labels-contract';
import { COLOR_VALUES, ICONS } from './bank-look';
import { BankCategoryEditor } from './BankCategoryEditor';
import type { BankLabelsHook } from './useBankLabels';

const KIND_NAMES = { account: 'rachunek', phone: 'telefon', phoneTail: 'końcówka telefonu', name: 'nazwa', merchant: 'tekst w banku' } as const;

/**
 * The settings of marking: from which day an operation not done counts as "to be marked", the spending categories, the
 * income sources and the pockets (name, colour, icon, delete), tags, and the other sides with what the bank showed for them: an identifier can
 * be forgotten when it was taken by mistake. Every change is saved at once; deleting asks twice.
 */
export function BankLabelSettings({ data, act, error, close }: { data: BankLabelsData; act: BankLabelsHook['act']; error: string; close: () => void }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [merging, setMerging] = useState<{ id: string; into: string; keepName: boolean } | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const keys = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); close(); } };
  const rename = (key: string, current: string) => {
    const name = (names[key] ?? current).trim();
    if (!name || name === current) return;
    void act(key.startsWith('tag:') ? { action: 'renameTag', tag: current, name } : { action: 'updateParty', party: key, name });
  };
  const remove = (key: string, label: string, run: () => void) => removing === key
    ? <button type="button" className="danger" autoFocus onBlur={() => setRemoving(null)} onClick={() => { run(); setRemoving(null); }}>Usunąć?</button>
    : <button type="button" className="danger" aria-label={`Usuń ${label}`} onClick={() => setRemoving(key)}><Trash2 size={15} aria-hidden="true" /></button>;
  const nameInput = (key: string, current: string, label: string, max: number) => <input aria-label={label} value={names[key] ?? current} maxLength={max}
    onChange={e => setNames(n => ({ ...n, [key]: e.target.value }))} onBlur={() => rename(key, current)} onKeyDown={e => { if (e.key === 'Enter') rename(key, current); }} />;
  const list = (move: BankCategoryMove, word: string, empty: string) => {
    const own = data.categories.filter(c => c.move === move);
    return own.length ? <ul className="bank-set-list">
      {own.map(c => { const Icon = ICONS[c.icon]; return <li key={c.id} style={{ '--c': COLOR_VALUES[c.color] } as CSSProperties}>
        {editing === c.id ? <BankCategoryEditor label="Zapisz" initial={c} cancel={() => setEditing(null)}
          submit={value => { void act({ action: 'updateCategory', category: c.id, ...value }); setEditing(null); }} /> : <>
          <span className="bank-avatar small" aria-hidden="true"><Icon size={15} /></span>
          <span className="bank-set-name">{c.name}</span>
          <button type="button" aria-label={`Zmień ${word} ${c.name}`} onClick={() => setEditing(c.id)}><Pencil size={15} aria-hidden="true" /></button>
          {own.length > 1 && <button type="button" aria-label={`Scal ${word} ${c.name} z inną`} onClick={() => setMerging({ id: c.id, into: own.find(o => o.id !== c.id)!.id, keepName: true })}><Merge size={15} aria-hidden="true" /></button>}
          {remove(c.id, `${word} ${c.name}`, () => void act({ action: 'deleteCategory', category: c.id }))}
        </>}
        {merging?.id === c.id && <span className="bank-merge">
          <select aria-label={`Scal ${c.name} z`} value={merging.into} onChange={e => setMerging({ ...merging, into: e.target.value })}>
            {own.filter(o => o.id !== c.id).map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          <label><input type="checkbox" checked={merging.keepName} onChange={e => setMerging({ ...merging, keepName: e.target.checked })} /> zostaw „{c.name}” jako etykietę</label>
          <button type="button" className="danger" onClick={() => { void act({ action: 'mergeCategory', category: c.id, into: merging.into, ...(merging.keepName ? { tag: c.name.toLowerCase() } : {}) }); setMerging(null); }}>Scal</button>
          <button type="button" onClick={() => setMerging(null)}>Anuluj</button>
        </span>}
      </li>; })}
    </ul> : <p className="p2-note">{empty}</p>;
  };

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
        <p className="p2-note">Starsze nieoznaczone operacje nie są liczone jako do przypisania.</p>

        <span className="todo-dlg-label">Kategorie wydatków</span>
        {list('spend', 'kategorię', 'Kategorie dodajesz w oknie operacji przy ruchu Wydatek, przyciskiem „Nowa”.')}

        <span className="todo-dlg-label">Źródła przychodu</span>
        {list('income', 'źródło', 'Źródła, np. Pensja, dodajesz w oknie operacji przy ruchu Przychód, przyciskiem „Nowe”.')}

        <span className="todo-dlg-label">Kieszenie (przełożenia)</span>
        {list('move', 'kieszeń', 'Kieszenie, np. Oszczędności, Revolut, dodajesz w oknie operacji przy ruchu Przełożenie, przyciskiem „Nowa”.')}

        <span className="todo-dlg-label">Etykiety</span>
        {data.tags.length ? <ul className="bank-set-list">
          {data.tags.map(tag => <li key={tag}>
            <span className="bank-set-hash" aria-hidden="true">#</span>
            {nameInput(`tag:${tag}`, tag, `Etykieta ${tag}`, BANK_LABEL_LIMITS.tag)}
            {remove(`tag:${tag}`, `etykietę ${tag}`, () => void act({ action: 'deleteTag', tag }))}
          </li>)}
        </ul> : <p className="p2-note">Etykiety dopisujesz w oknie operacji.</p>}

        <span className="todo-dlg-label">Druga strona</span>
        {data.parties.length ? <ul className="bank-set-list">
          {data.parties.map(p => <li key={p.id} className="person">
            {nameInput(p.id, p.name, `Nazwa: ${p.name}`, BANK_LABEL_LIMITS.partyName)}
            {remove(p.id, p.name, () => void act({ action: 'deleteParty', party: p.id }))}
            <span className="bank-set-ids">
              {p.identifiers.length ? p.identifiers.map(i => <span key={i.id} className="bank-id-chip">{KIND_NAMES[i.kind]} {i.kind === 'name' || i.kind === 'merchant' ? `„${i.hint}”` : i.hint}
                <button type="button" aria-label={`Zapomnij: ${KIND_NAMES[i.kind]} ${i.hint}`} onClick={() => void act({ action: 'forgetIdentifier', party: p.id, identifier: i.id })}><X size={12} aria-hidden="true" /></button></span>)
                : <span className="p2-note">Jeszcze nierozpoznawana: zapamięta, co bank pokazał, przy pierwszym oznaczeniu.</span>}
            </span>
          </li>)}
        </ul> : <p className="p2-note">Drugą stronę (sklep, osobę albo własne konto) dodajesz w oknie operacji.</p>}
        {error && <p className="p2-note warn" role="status">{error}</p>}
      </div>
    </div>,
    document.body,
  );
}
