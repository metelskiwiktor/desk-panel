import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Check, Plus, Repeat, X } from 'lucide-react';
import type { BankTransaction } from './bank-contract';
import { BANK_COLORS, BANK_LABEL_LIMITS, BANK_PARTY_KINDS, cleanTag, type BankLabel, type BankLabelsData, type BankPartyKind } from './bank-labels-contract';
import { describe } from './bank-merchants';
import { COLOR_VALUES, ICONS, KIND_ICONS, KIND_WORDS, howPaid, optionText, personHint } from './bank-look';
import { BankCategoryEditor } from './BankCategoryEditor';
import { withLabel, type BankLabelsHook } from './useBankLabels';

const money = (amount: number, currency: string) => `${amount > 0 ? '+' : amount < 0 ? '−' : ''}${Math.abs(amount).toLocaleString('pl-PL', { style: 'currency', currency })}`;
/** A card payment or an ATM names its merchant in the bank's text: that name is offered as the other side, a company. */
const namesMerchant = (t: BankTransaction) => t.note === 'Płatność kartą' || describe(t).category === 'atm';
/** A transfer names its other side (`creditor`/`debtor` in the bank's answer), but whether it is a person, a company or the user only the user knows. */
const namesSide = (t: BankTransaction) => t.note !== undefined && !namesMerchant(t) && !/^(Płatność|Przelew z karty)/.test(t.title) && !/^Płatność/.test(t.note);

/** Chips that take one word or several from the user's own list, with a field to add a new one (tags, purposes). */
function Words({ id, label, words, chosen, toggle, add, placeholder, hash }: {
  id: string; label: string; words: string[]; chosen: string[]; toggle: (word: string) => void; add: (word: string) => void; placeholder: string; hash?: boolean;
}) {
  const [text, setText] = useState('');
  const commit = () => { if (text.trim()) { add(text); setText(''); } };
  return <div className="bank-chips tags" role="group" aria-labelledby={id}>
    {[...new Set([...chosen, ...words])].map(word => <button key={word} type="button" aria-pressed={chosen.includes(word)} onClick={() => toggle(word)}>{hash ? '#' : ''}{word}</button>)}
    <input className="bank-tag-input" aria-label={label} value={text} maxLength={BANK_LABEL_LIMITS.tag + 1} placeholder={placeholder}
      onChange={e => setText(e.target.value)} onKeyDown={e => { if ((e.key === 'Enter' || e.key === ',') && text.trim()) { e.preventDefault(); commit(); } }} onBlur={commit} />
  </div>;
}

/**
 * Marking one operation: a dialog over the whole panel, so it reads the same in a tile of any size and on a phone. First who the
 * other side is (a person, a company or the user themself, recognised by what the bank shows), then what follows from it: a
 * category for what the money went on (not for money between the user's own pockets), a purpose for money to or from a person
 * (pożyczka, zwrot, dokładka: the user's own list), tags, recurring and a description. A sure suggestion fills the form and
 * Przyjmij saves it; several possibilities are a choice, one tap saves the chosen one. Esc and Anuluj drop the edit.
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
    category: sure?.category ?? null, tags: sure?.tags ?? [], party: sure?.party ?? known ?? null, purpose: sure?.purpose ?? null, recurring: !!sure?.recurring, comment: '',
  };
  const [category, setCategory] = useState(start.category);
  const [tags, setTags] = useState(start.tags);
  const [party, setParty] = useState(start.party);
  // A side not made yet: the bank's clean name for a card payment, made (as a company) when the mark is saved.
  const [partyText, setPartyText] = useState(!start.party && !existing && namesMerchant(t) ? d.name : '');
  const [newKind, setNewKind] = useState<BankPartyKind>(namesSide(t) ? 'person' : 'company');
  const [purpose, setPurpose] = useState(start.purpose);
  const [recurring, setRecurring] = useState(start.recurring);
  const [comment, setComment] = useState(start.comment);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const id = useId();
  const parties = new Map(data.parties.map(p => [p.id, p]));
  const chosen = party ? parties.get(party) : undefined;
  const typed = partyText.trim();
  const exact = data.parties.find(p => p.kind !== 'person' && p.name.toLowerCase() === typed.toLowerCase());
  const q = typed.toLowerCase();
  const matches = data.parties.filter(p => !q || p.name.toLowerCase().includes(q)).slice(0, 8);
  const kind: BankPartyKind | null = chosen?.kind ?? (typed ? newKind : null);
  const dirty = category !== start.category || tags.join() !== start.tags.join() || party !== start.party || purpose !== start.purpose
    || recurring !== start.recurring || comment !== start.comment || (!!typed && !party);
  // Nobody known by the bank's name yet: one tap makes the side of the right kind, and its identifiers are learnt on Zapisz.
  const unknownSide = namesSide(t) && !known && !party && !typed && !existing;

  useEffect(() => { root.current?.querySelector<HTMLElement>('.bank-dlg-sug button, .bank-dlg-who button, .bank-chips button, button.save')?.focus(); }, []);

  const addWord = (list: string[], value: string) => {
    const word = cleanTag(value);
    if (!word || word.length > BANK_LABEL_LIMITS.tag) return null;
    return list.find(k => k.toLowerCase() === word.toLowerCase()) ?? word;
  };
  const makeParty = async (name: string, of: BankPartyKind) => {
    const result = await act({ action: 'createParty', name, kind: of });
    if (result?.party) { setParty(result.party.id); setPartyText(''); }
    return result?.party?.id ?? null;
  };
  const save = async () => {
    setBusy(true);
    let partyId = party;
    if (!partyId && typed) {
      partyId = exact?.id ?? await makeParty(typed, newKind);
      if (!partyId) { setBusy(false); return; }
    }
    // Money between the user's own pockets has no category; a purpose belongs to money to or from a person.
    const mark: BankLabel = { category: kind === 'self' ? null : category, tags, party: partyId, purpose: kind === 'person' ? purpose : null, recurring, comment: comment.trim() };
    const empty = !mark.category && !tags.length && !partyId && !mark.purpose && !recurring && !mark.comment;
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
    const mark: BankLabel = { category: o.category ?? null, tags: o.tags ?? [], party: o.party ?? null, purpose: o.purpose ?? null, recurring: !!o.recurring, comment: comment.trim() };
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
    // What the sure suggestion filled in goes with it; what the user chose and whom the bank names stays.
    if (sure) {
      if (category === sure.category) setCategory(null);
      if (tags.join() === (sure.tags ?? []).join()) setTags([]);
      if (purpose === sure.purpose) setPurpose(null);
      if (sure.recurring && recurring) setRecurring(false);
    }
    setSuggestion(undefined);
  };
  const clear = async () => { setBusy(true); const result = await act({ action: 'clear', tx: t.id }, value => withLabel(value, t.id, null)); setBusy(false); if (result) close(); };
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
  const shownName = chosen?.name ?? (typed || d.name);
  const KindIcon = chosen ? KIND_ICONS[chosen.kind] : null;

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
          <span className="bank-dlg-meta">{new Date(t.at).toLocaleDateString('pl-PL', { weekday: 'short', day: 'numeric', month: 'long', timeZone: 'UTC' })} · {howPaid(t, !!(chosen || typed))}{shownName !== d.name ? ` · w banku: ${d.name}` : ''}</span>
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

        {unknownSide && <div className="bank-dlg-who">
          <p>Z banku: <b>{d.name}</b>. Kto to?</p>
          <div className="bank-dlg-sug-actions">
            {BANK_PARTY_KINDS.map(k => { const Icon = KIND_ICONS[k]; return <button key={k} type="button" disabled={busy} onClick={() => void makeParty(d.name, k)}><Icon size={16} aria-hidden="true" /> {KIND_WORDS[k]}</button>; })}
          </div>
          <small>„Ja” to Twoja firma albo inne Twoje konto. Panel zapamięta rachunek, telefon i nazwę z banku i następnym razem rozpozna sam.</small>
        </div>}

        <label className="todo-dlg-label" htmlFor={`${id}-party`}>Druga strona · kto</label>
        {chosen ? <div className="bank-person">
          <div className="bank-party-row">
            <span className="bank-person-chip">{KindIcon && <KindIcon size={15} aria-hidden="true" />}{chosen.name}
              <button type="button" aria-label={`Bez drugiej strony (usuń ${chosen.name})`} onClick={() => { setParty(null); setPartyText(''); }}><X size={14} aria-hidden="true" /></button></span>
            <span className="bank-kinds-switch" role="group" aria-label="Rodzaj drugiej strony">
              {BANK_PARTY_KINDS.map(k => <button key={k} type="button" aria-pressed={chosen.kind === k} onClick={() => void act({ action: 'updateParty', party: chosen.id, kind: k })}>{KIND_WORDS[k]}</button>)}
            </span>
          </div>
          <span className="bank-person-ids">{personHint(chosen) ? `rozpoznawana po: ${personHint(chosen)}` : 'jeszcze nierozpoznawana: zapamięta, co bank pokazał przy tej operacji'}</span>
        </div> : <div className="bank-person">
          <input id={`${id}-party`} className="todo-dlg-title" value={partyText} maxLength={BANK_LABEL_LIMITS.partyName} placeholder="Kto? (Alicja, Inea, pyszne.pl, moja firma)" autoComplete="off"
            onChange={e => setPartyText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (exact) { setParty(exact.id); setPartyText(''); } } }} />
          {matches.length > 0 && <ul className="bank-person-list column" aria-label="Druga strona">
            {matches.map(p => { const Icon = KIND_ICONS[p.kind]; return <li key={p.id}><button type="button" onClick={() => { setParty(p.id); setPartyText(''); }}>
              <Icon size={14} aria-hidden="true" /><span>{p.name}</span><small>{personHint(p) || KIND_WORDS[p.kind].toLowerCase()}</small>
            </button></li>; })}
          </ul>}
          {typed && !exact && <div className="bank-new-kind">
            <span>Nowa: „{typed}” jako</span>
            <span className="bank-kinds-switch" role="group" aria-label="Rodzaj nowej drugiej strony">
              {BANK_PARTY_KINDS.map(k => <button key={k} type="button" aria-pressed={newKind === k} onClick={() => setNewKind(k)}>{KIND_WORDS[k]}</button>)}
            </span>
          </div>}
        </div>}

        {kind === 'person' && <>
          <span className="todo-dlg-label" id={`${id}-purpose`}>Cel · po co</span>
          <Words id={`${id}-purpose`} label="Nowy cel" words={data.purposes} chosen={purpose ? [purpose] : []} placeholder="+ cel, np. pożyczka"
            toggle={word => setPurpose(p => p === word ? null : word)} add={value => setPurpose(addWord(data.purposes, value))} />
        </>}

        {kind === 'self' ? <p className="p2-note">Przelew własny: kategoria niepotrzebna i nie wisi jako „do przypisania”; liczy się do wpływów i wydatków.</p> : <>
          <span className="todo-dlg-label" id={`${id}-cat`}>Kategoria · na co</span>
          <div className="bank-chips" role="group" aria-labelledby={`${id}-cat`}>
            {data.categories.map(c => { const Icon = ICONS[c.icon]; return <button key={c.id} type="button" aria-pressed={c.id === category} style={{ '--c': COLOR_VALUES[c.color] } as CSSProperties}
              onClick={() => setCategory(c.id === category ? null : c.id)}><Icon size={15} aria-hidden="true" />{c.name}</button>; })}
            {!creating && <button type="button" className="new" onClick={() => setCreating(true)}><Plus size={15} aria-hidden="true" />Nowa</button>}
          </div>
          {creating && <BankCategoryEditor label="Dodaj" initial={{ name: '', color: BANK_COLORS.find(c => !used.has(c)) ?? 'slate', icon: 'tag' }} cancel={() => setCreating(false)}
            submit={async value => { const result = await act({ action: 'createCategory', ...value }); if (result?.category) { setCategory(result.category.id); setCreating(false); } }} />}
        </>}


        <span className="todo-dlg-label" id={`${id}-tags`}>Etykiety · szczegóły</span>
        <Words id={`${id}-tags`} label="Nowa etykieta" words={data.tags} chosen={tags} placeholder="+ etykieta" hash
          toggle={tag => setTags(list => list.includes(tag) ? list.filter(k => k !== tag) : list.length >= BANK_LABEL_LIMITS.tagsPerMark ? list : [...list, tag])}
          add={value => { const tag = addWord(data.tags, value); if (tag) setTags(list => list.some(k => k.toLowerCase() === tag.toLowerCase()) || list.length >= BANK_LABEL_LIMITS.tagsPerMark ? list : [...list, tag]); }} />

        <label className="bank-switch">
          <input type="checkbox" role="switch" checked={recurring} onChange={e => setRecurring(e.target.checked)} />
          <span className="track" aria-hidden="true" /><Repeat size={15} aria-hidden="true" /> Cykliczne
        </label>

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
