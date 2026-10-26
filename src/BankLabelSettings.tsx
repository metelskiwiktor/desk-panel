import { useState, type CSSProperties, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Pencil, Store, Trash2, User, X } from 'lucide-react';
import { BANK_LABEL_LIMITS, type BankLabelsData } from './bank-labels-contract';
import { COLOR_VALUES, ICONS } from './bank-look';
import { BankCategoryEditor } from './BankCategoryEditor';
import type { BankLabelsHook } from './useBankLabels';

const KIND_NAMES = { account: 'rachunek', phone: 'telefon', phoneTail: 'końcówka telefonu', name: 'nazwa', merchant: 'tekst w banku' } as const;

/**
 * The settings of marking: from which day an unmarked operation counts as "to be marked", the categories (name, colour, icon,
 * delete), tags, and the merchants and people with what the bank showed for them (an identifier can be forgotten when it was
 * taken by mistake).
 * Every change is saved at once; deleting asks twice.
 */
export function BankLabelSettings({ data, act, error, close }: { data: BankLabelsData; act: BankLabelsHook['act']; error: string; close: () => void }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const keys = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); close(); } };
  const rename = (id: string, current: string) => {
    const name = (names[id] ?? current).trim();
    if (!name || name === current) return;
    void act(id.startsWith('p-') ? { action: 'renamePerson', person: id, name } : id.startsWith('m-') ? { action: 'renameMerchant', merchant: id, name } : { action: 'renameTag', tag: id.slice(4), name });
  };
  const ids = (owner: string, list: BankLabelsData['people'][number]['identifiers'], empty: string) => <span className="bank-set-ids">
    {list.length ? list.map(i => <span key={i.id} className="bank-id-chip">{KIND_NAMES[i.kind]} {i.kind === 'name' || i.kind === 'merchant' ? `„${i.hint}”` : i.hint}
      <button type="button" aria-label={`Zapomnij: ${KIND_NAMES[i.kind]} ${i.hint}`} onClick={() => void act({ action: 'forgetIdentifier', owner, identifier: i.id })}><X size={12} aria-hidden="true" /></button></span>)
      : <span className="p2-note">{empty}</span>}
  </span>;
  const remove = (key: string, label: string, run: () => void) => removing === key
    ? <button type="button" className="danger" autoFocus onBlur={() => setRemoving(null)} onClick={() => { run(); setRemoving(null); }}>Usunąć?</button>
    : <button type="button" className="danger" aria-label={`Usuń ${label}`} onClick={() => setRemoving(key)}><Trash2 size={15} aria-hidden="true" /></button>;
  const nameInput = (key: string, current: string, label: string, max: number) => <input aria-label={label} value={names[key] ?? current} maxLength={max}
    onChange={e => setNames(n => ({ ...n, [key]: e.target.value }))} onBlur={() => rename(key, current)} onKeyDown={e => { if (e.key === 'Enter') rename(key, current); }} />;
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
              {removing === c.id
                ? <button type="button" className="danger" autoFocus onBlur={() => setRemoving(null)} onClick={() => { void act({ action: 'deleteCategory', category: c.id }); setRemoving(null); }}>Usunąć?</button>
                : <button type="button" className="danger" aria-label={`Usuń kategorię ${c.name}`} onClick={() => setRemoving(c.id)}><Trash2 size={15} aria-hidden="true" /></button>}
            </>}
          </li>; })}
        </ul> : <p className="p2-note">Kategorie dodajesz w oknie operacji przyciskiem „Nowa”.</p>}

        <span className="todo-dlg-label">Etykiety</span>
        {data.tags.length ? <ul className="bank-set-list">
          {data.tags.map(tag => <li key={tag}>
            <span className="bank-set-hash" aria-hidden="true">#</span>
            {nameInput(`tag:${tag}`, tag, `Etykieta ${tag}`, BANK_LABEL_LIMITS.tag)}
            {remove(`tag:${tag}`, `etykietę ${tag}`, () => void act({ action: 'deleteTag', tag }))}
          </li>)}
        </ul> : <p className="p2-note">Etykiety dopisujesz w oknie operacji.</p>}

        <span className="todo-dlg-label">Sprzedawcy</span>
        {data.merchants.length ? <ul className="bank-set-list">
          {data.merchants.map(m => <li key={m.id} className="person">
            <span className="bank-avatar small none" aria-hidden="true"><Store size={15} /></span>
            {nameInput(m.id, m.name, `Nazwa sprzedawcy ${m.name}`, BANK_LABEL_LIMITS.name)}
            {remove(m.id, `sprzedawcę ${m.name}`, () => void act({ action: 'deleteMerchant', merchant: m.id }))}
            {ids(m.id, m.identifiers, 'Jeszcze nierozpoznawany: zapamięta tekst z banku albo rachunek przy pierwszym oznaczeniu.')}
          </li>)}
        </ul> : <p className="p2-note">Sprzedawcy zapisują się z oznaczeniem operacji.</p>}

        <span className="todo-dlg-label">Osoby</span>
        {data.people.length ? <ul className="bank-set-list">
          {data.people.map(p => <li key={p.id} className="person">
            <span className="bank-avatar small none" aria-hidden="true"><User size={15} /></span>
            {nameInput(p.id, p.name, `Nazwa osoby ${p.name}`, BANK_LABEL_LIMITS.personName)}
            {remove(p.id, `osobę ${p.name}`, () => void act({ action: 'deletePerson', person: p.id }))}
            {ids(p.id, p.identifiers, 'Jeszcze nierozpoznawana: przypisz ją do przelewu, a panel zapamięta rachunek, telefon i nazwę z banku.')}
          </li>)}
        </ul> : <p className="p2-note">Osoby dodajesz w oknie operacji, wpisując imię w polu „Osoba”.</p>}
        {error && <p className="p2-note warn" role="status">{error}</p>}
      </div>
    </div>,
    document.body,
  );
}
