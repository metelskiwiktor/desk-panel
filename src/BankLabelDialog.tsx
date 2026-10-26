import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Check, Plus, Repeat, Store, User, X } from 'lucide-react';
import type { BankTransaction } from './bank-contract';
import { BANK_COLORS, BANK_LABEL_LIMITS, cleanTag, type BankLabel, type BankLabelsData } from './bank-labels-contract';
import { describe } from './bank-merchants';
import { COLOR_VALUES, ICONS, howPaid, optionText, personHint } from './bank-look';
import { BankCategoryEditor } from './BankCategoryEditor';
import { withLabel, type BankLabelsHook } from './useBankLabels';

const money = (amount: number, currency: string) => `${amount > 0 ? '+' : amount < 0 ? '−' : ''}${Math.abs(amount).toLocaleString('pl-PL', { style: 'currency', currency })}`;
/** A card payment, an ATM or a card transfer names its merchant in the bank's text: that name is offered as the merchant. */
const namesMerchant = (t: BankTransaction) => t.note === 'Płatność kartą' || describe(t).category === 'atm';

/**
 * Marking one operation: a dialog over the whole panel, so it reads the same in a tile of any size and on a phone. Each field
 * answers one question: the merchant where, the category what the money went on (one), tags the details (any), the person to
 * or from whom, recurring and a comment. A sure suggestion fills the form and Przyjmij saves it; several possibilities are a
 * choice, one tap saves the chosen one. Nothing is saved without Zapisz, Przyjmij or a chosen option. Esc and Anuluj drop the edit.
 */
export function BankLabelDialog({ t, data, act, error, close, done, position }: {
  t: BankTransaction; data: BankLabelsData; act: BankLabelsHook['act']; error: string; close: () => void; done: () => void; position?: { index: number; of: number };
}) {
  const existing = data.labels[t.id];
  const known = data.known[t.id];
  const [suggestion, setSuggestion] = useState(existing ? undefined : data.suggestions[t.id]);
  const sure = suggestion?.sure ? suggestion.options[0] : undefined;
  const d = describe(t);
  const start: BankLabel = existing ?? {
    category: sure?.category ?? null, tags: sure?.tags ?? [], merchant: sure?.merchant ?? known?.merchant ?? null,
    person: sure?.person ?? known?.person ?? null, recurring: !!sure?.recurring, comment: '',
  };
  const [category, setCategory] = useState(start.category);
  const [tags, setTags] = useState(start.tags);
  const [merchant, setMerchant] = useState(start.merchant);
  // A merchant not made yet: the bank's clean name for a card payment, made when the mark is saved.
  const [merchantText, setMerchantText] = useState(!start.merchant && !existing && namesMerchant(t) ? d.name : '');
  const [person, setPerson] = useState(start.person);
  const [recurring, setRecurring] = useState(start.recurring);
  const [comment, setComment] = useState(start.comment);
  const [query, setQuery] = useState('');
  const [tagText, setTagText] = useState('');
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const id = useId();
  const dirty = category !== start.category || tags.join() !== start.tags.join() || merchant !== start.merchant || person !== start.person
    || recurring !== start.recurring || comment !== start.comment || (!!merchantText.trim() && !merchant);
  const merchants = new Map(data.merchants.map(m => [m.id, m]));
  const people = new Map(data.people.map(p => [p.id, p]));
  const chosenMerchant = merchant ? merchants.get(merchant) : undefined;
  const chosen = person ? people.get(person) : undefined;
  const q = query.trim().toLowerCase();
  const matches = data.people.filter(p => !q || p.name.toLowerCase().includes(q)).sort((a, b) => Number(b.id === known?.person) - Number(a.id === known?.person)).slice(0, 6);
  const mq = merchantText.trim().toLowerCase();
  const merchantMatches = data.merchants.filter(m => !mq || m.name.toLowerCase().includes(mq)).slice(0, 6);
  const exactMerchant = data.merchants.find(m => m.name.toLowerCase() === mq);
  const allTags = [...new Set([...tags, ...data.tags])];

  useEffect(() => { root.current?.querySelector<HTMLElement>('.bank-dlg-sug button, .bank-chips button, button.save')?.focus(); }, []);

  const addTag = (value: string) => {
    const tag = cleanTag(value);
    if (!tag || tag.length > BANK_LABEL_LIMITS.tag) return;
    const kept = data.tags.find(k => k.toLowerCase() === tag.toLowerCase()) ?? tag;
    setTags(list => list.some(k => k.toLowerCase() === kept.toLowerCase()) || list.length >= BANK_LABEL_LIMITS.tagsPerMark ? list : [...list, kept]);
    setTagText('');
  };
  const toggleTag = (tag: string) => setTags(list => list.includes(tag) ? list.filter(k => k !== tag) : list.length >= BANK_LABEL_LIMITS.tagsPerMark ? list : [...list, tag]);

  const save = async () => {
    setBusy(true);
    let merchantId = merchant;
    const typed = merchantText.trim();
    if (!merchantId && typed) {
      const made = exactMerchant ? { merchant: { id: exactMerchant.id } } : await act({ action: 'createMerchant', name: typed });
      if (!made?.merchant) { setBusy(false); return; }
      merchantId = made.merchant.id;
    }
    const pendingTag = cleanTag(tagText);
    const finalTags = pendingTag && !tags.some(k => k.toLowerCase() === pendingTag.toLowerCase()) ? [...tags, pendingTag] : tags;
    const mark: BankLabel = { category, tags: finalTags, merchant: merchantId, person, recurring, comment: comment.trim() };
    const empty = !category && !finalTags.length && !merchantId && !person && !recurring && !mark.comment;
    const result = await act({ action: 'label', tx: t.id, ...mark }, value => withLabel(value, t.id, empty ? null : mark));
    setBusy(false);
    if (result) done();
  };
  /** One tap on an option saves it; a sure suggestion the user changed by hand is saved as the form says. */
  const accept = async (option: number) => {
    if (!suggestion) return;
    if (suggestion.sure && dirty) { await save(); return; }
    const o = suggestion.options[option];
    setBusy(true);
    const mark: BankLabel = { category: o.category ?? null, tags: o.tags ?? [], merchant: o.merchant ?? null, person: o.person ?? null, recurring: !!o.recurring, comment: comment.trim() };
    const result = await act({ action: 'accept', tx: t.id, option }, value => withLabel(value, t.id, mark));
    if (result && mark.comment) await act({ action: 'label', tx: t.id, ...mark });
    setBusy(false);
    if (result) done();
  };
  const reject = async () => {
    setBusy(true);
    const result = await act({ action: 'reject', tx: t.id });
    setBusy(false);
    if (!result) return;
    // What the sure suggestion filled in goes with it; what the user chose and what the bank says stays.
    if (sure) {
      if (category === sure.category) setCategory(null);
      if (tags.join() === (sure.tags ?? []).join()) setTags([]);
      if (sure.recurring && recurring) setRecurring(false);
    }
    setSuggestion(undefined);
  };
  const clear = async () => { setBusy(true); const result = await act({ action: 'clear', tx: t.id }, value => withLabel(value, t.id, null)); setBusy(false); if (result) close(); };
  const addPerson = async () => {
    const name = query.trim();
    if (!name) return;
    const result = await act({ action: 'createPerson', name });
    if (result?.person) { setPerson(result.person.id); setQuery(''); }
  };
  const keys = (event: KeyboardEvent) => {
    if (event.key === 'Escape') { event.stopPropagation(); close(); return; }
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void save(); return; }
    if (event.key !== 'Tab' || !root.current) return;
    const controls = [...root.current.querySelectorAll<HTMLElement>('input, textarea, button:not(:disabled), summary')];
    const [first, last] = [controls[0], controls.at(-1)];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  };
  const used = new Set(data.categories.map(c => c.color));
  const shownName = chosenMerchant?.name ?? (merchantText.trim() || d.name);

  return createPortal(
    <div className="todo-dlg-scrim" onMouseDown={event => { if (event.target === event.currentTarget && !dirty) close(); }}>
      <div className="todo-dlg bank-dlg" role="dialog" aria-modal="true" aria-label={`Oznacz operację: ${d.name}`} ref={root} onKeyDown={keys}>
        <div className="todo-dlg-head">
          <h2>Oznacz operację{position ? ` · ${position.index} z ${position.of}` : ''}</h2>
          <button type="button" aria-label="Zamknij" onClick={close}><X size={18} aria-hidden="true" /></button>
        </div>
        <div className="bank-dlg-op">
          <span className="bank-dlg-name">{shownName}</span>
          <b className={`num${t.amount > 0 ? ' in' : ''}`}>{money(t.amount, t.currency)}</b>
          <span className="bank-dlg-meta">{new Date(t.at).toLocaleDateString('pl-PL', { weekday: 'short', day: 'numeric', month: 'long', timeZone: 'UTC' })} · {howPaid(t, !!(chosenMerchant || merchantText.trim()))}{shownName !== d.name ? ` · w banku: ${d.name}` : ''}</span>
        </div>

        {suggestion && (suggestion.sure ? <div className="bank-dlg-sug">
          <p><span className="bank-dlg-sug-tag">Podpowiedź</span> <b>{optionText(suggestion.options[0], data)}</b></p>
          <ul>{suggestion.options[0].reasons.map(r => <li key={r}>{r}</li>)}</ul>
          <div className="bank-dlg-sug-actions">
            <button type="button" className="ok" disabled={busy} onClick={() => void accept(0)}><Check size={16} aria-hidden="true" /> Przyjmij</button>
            <button type="button" className="no" disabled={busy} onClick={() => void reject()}><X size={16} aria-hidden="true" /> Odrzuć</button>
          </div>
        </div> : <div className="bank-dlg-sug weak">
          <p><span className="bank-dlg-sug-tag">Do wyboru</span> {suggestion.options.length > 1 ? 'wcześniej było różnie' : 'możliwe, ale niepewne'}</p>
          <div className="bank-dlg-options">
            {suggestion.options.map((o, i) => <button key={i} type="button" disabled={busy} onClick={() => void accept(i)}>
              <b>{optionText(o, data) || 'bez kategorii'}</b><small>{o.reasons[0]}{o.reasons.length > 1 ? ` · ${o.reasons.at(-1)!.split(': ').at(-1)}` : ''}</small>
            </button>)}
            <button type="button" className="no" disabled={busy} onClick={() => void reject()}><X size={16} aria-hidden="true" /> Żadne</button>
          </div>
        </div>)}

        <label className="todo-dlg-label" htmlFor={`${id}-merchant`}>Sprzedawca</label>
        {chosenMerchant ? <div className="bank-person">
          <span className="bank-person-chip"><Store size={15} aria-hidden="true" />{chosenMerchant.name}
            <button type="button" aria-label={`Bez sprzedawcy (usuń ${chosenMerchant.name})`} onClick={() => { setMerchant(null); setMerchantText(''); }}><X size={14} aria-hidden="true" /></button></span>
        </div> : <div className="bank-person">
          <input id={`${id}-merchant`} className="todo-dlg-title" value={merchantText} maxLength={BANK_LABEL_LIMITS.name} placeholder="Gdzie? (np. pyszne.pl, Inea)" autoComplete="off"
            onChange={e => setMerchantText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (exactMerchant) { setMerchant(exactMerchant.id); setMerchantText(''); } } }} />
          {merchantMatches.length > 0 && <ul className="bank-person-list" aria-label="Sprzedawcy">
            {merchantMatches.map(m => <li key={m.id}><button type="button" onClick={() => { setMerchant(m.id); setMerchantText(''); }}><Store size={14} aria-hidden="true" />{m.name}</button></li>)}
          </ul>}
          {merchantText.trim() && !exactMerchant && <span className="bank-person-ids">Nowy sprzedawca „{merchantText.trim()}” zapisze się z oznaczeniem i będzie rozpoznawany po tekście z banku.</span>}
        </div>}

        <span className="todo-dlg-label" id={`${id}-cat`}>Kategoria · na co</span>
        <div className="bank-chips" role="group" aria-labelledby={`${id}-cat`}>
          {data.categories.map(c => { const Icon = ICONS[c.icon]; return <button key={c.id} type="button" aria-pressed={c.id === category} style={{ '--c': COLOR_VALUES[c.color] } as CSSProperties}
            onClick={() => setCategory(c.id === category ? null : c.id)}><Icon size={15} aria-hidden="true" />{c.name}</button>; })}
          {!creating && <button type="button" className="new" onClick={() => setCreating(true)}><Plus size={15} aria-hidden="true" />Nowa</button>}
        </div>
        {creating && <BankCategoryEditor label="Dodaj" initial={{ name: '', color: BANK_COLORS.find(c => !used.has(c)) ?? 'slate', icon: 'tag' }} cancel={() => setCreating(false)}
          submit={async value => { const result = await act({ action: 'createCategory', ...value }); if (result?.category) { setCategory(result.category.id); setCreating(false); } }} />}

        <span className="todo-dlg-label" id={`${id}-tags`}>Etykiety · szczegóły</span>
        <div className="bank-chips tags" role="group" aria-labelledby={`${id}-tags`}>
          {allTags.map(tag => <button key={tag} type="button" aria-pressed={tags.includes(tag)} onClick={() => toggleTag(tag)}>#{tag}</button>)}
          <input className="bank-tag-input" aria-label="Nowa etykieta" value={tagText} maxLength={BANK_LABEL_LIMITS.tag + 1} placeholder="+ etykieta"
            onChange={e => setTagText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ',' || e.key === ' ') { if (tagText.trim()) { e.preventDefault(); addTag(tagText); } } }} onBlur={() => { if (tagText.trim()) addTag(tagText); }} />
        </div>

        <label className="bank-switch">
          <input type="checkbox" role="switch" checked={recurring} onChange={e => setRecurring(e.target.checked)} />
          <span className="track" aria-hidden="true" /><Repeat size={15} aria-hidden="true" /> Cykliczne
        </label>

        <label className="todo-dlg-label" htmlFor={`${id}-person`}>Osoba · komu, od kogo</label>
        {chosen ? <div className="bank-person">
          <span className="bank-person-chip"><User size={15} aria-hidden="true" />{chosen.name}
            <button type="button" aria-label={`Bez osoby (usuń ${chosen.name})`} onClick={() => setPerson(null)}><X size={14} aria-hidden="true" /></button></span>
          <span className="bank-person-ids">{personHint(chosen) ? `rozpoznawana po: ${personHint(chosen)}` : 'jeszcze nierozpoznawana: zapamięta rachunek, telefon i nazwę z tego przelewu'}</span>
        </div> : <div className="bank-person">
          <input id={`${id}-person`} className="todo-dlg-title" value={query} maxLength={BANK_LABEL_LIMITS.personName} placeholder="Kto? (przelewy: pożyczka, zwrot, dokładka)" autoComplete="off"
            onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (q) void addPerson(); } }} />
          {(matches.length > 0 || q) && <ul className="bank-person-list column" aria-label="Osoby">
            {matches.map(p => <li key={p.id}><button type="button" onClick={() => { setPerson(p.id); setQuery(''); }}>
              <User size={14} aria-hidden="true" /><span>{p.name}</span><small>{personHint(p) || 'bez identyfikatorów'}</small>
            </button></li>)}
            {q && <li><button type="button" className="new" onClick={() => void addPerson()}><Plus size={14} aria-hidden="true" />{data.people.some(p => p.name.toLowerCase() === q) ? `Dodaj kolejną osobę „${query.trim()}”` : `Dodaj osobę „${query.trim()}”`}</button></li>}
          </ul>}
        </div>}

        <label className="todo-dlg-label" htmlFor={`${id}-comment`}>Opis</label>
        <textarea id={`${id}-comment`} className="todo-dlg-note bank-dlg-comment" value={comment} maxLength={BANK_LABEL_LIMITS.comment} placeholder="Opcjonalnie, np. domena tabnote na 2 lata" onChange={e => setComment(e.target.value)} />

        <details className="bank-dlg-raw">
          <summary>Odpowiedź banku</summary>
          <pre>{t.raw ? JSON.stringify(t.raw, null, 2) : 'Brak surowych danych: pojawią się przy następnym odczycie banku.'}</pre>
        </details>
        {error && <p className="p2-note warn" role="status">{error}</p>}
        <div className="todo-dlg-actions">
          {existing && <button type="button" className="danger" disabled={busy} onClick={() => void clear()}>Wyczyść</button>}
          <span />
          <button type="button" onClick={close}>Anuluj</button>
          <button type="button" className="save" disabled={busy} onClick={() => void save()}>{position && position.of > 1 ? 'Zapisz i dalej' : 'Zapisz'}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
