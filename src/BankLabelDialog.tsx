import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, Plus, Repeat, X } from 'lucide-react';
import type { BankTransaction } from './bank-contract';
import { BANK_COLORS, BANK_LABEL_LIMITS, BANK_MOVES, cleanTag, isDone, type BankLabel, type BankLabelsData, type BankMove } from './bank-labels-contract';
import { describe } from './bank-merchants';
import { COLOR_VALUES, ICONS, MOVE_COLORS, MOVE_HINTS, MOVE_ICONS, MOVE_WORDS, balanceText, howPaid, likelyMove, optionText, personHint } from './bank-look';
import { BankCategoryEditor } from './BankCategoryEditor';
import { withLabel, type BankLabelsHook } from './useBankLabels';

const money = (amount: number, currency: string) => `${amount > 0 ? '+' : amount < 0 ? '−' : ''}${Math.abs(amount).toLocaleString('pl-PL', { style: 'currency', currency })}`;
const plain = (amount: number, currency: string) => Math.abs(amount).toLocaleString('pl-PL', { style: 'currency', currency });
/** A transfer or a card payment names its other side in the bank's text: that name is offered as a new side. */
const namesSide = (t: BankTransaction) => t.note !== undefined && !/^(Płatność|Przelew z karty)/.test(t.title) && !/^Płatność (telefonem|BLIK)/.test(t.note);
/** How many of the user's own words show before typing narrows them; the rest are found by typing. */
const SHOWN_TAGS = 8;
const SHOWN_SIDES = 5;
/** The list of a move that has one, in the words the dialog uses for it. */
const AXIS: Partial<Record<BankMove, { label: string; add: string; placeholder: string; icon: 'tag' | 'banknote' | 'piggyBank' }>> = {
  spend: { label: 'Kategoria · na co', add: 'Nowa', placeholder: 'Nazwa, np. Psycholog', icon: 'tag' },
  income: { label: 'Źródło · skąd', add: 'Nowe', placeholder: 'Nazwa, np. Pensja', icon: 'banknote' },
  move: { label: 'Kieszeń · gdzie leży (opcjonalnie)', add: 'Nowa', placeholder: 'Nazwa, np. Oszczędności', icon: 'piggyBank' },
};

/** Tags: the chosen ones and the most used, the rest found by typing; Enter adds a new one. */
function Tags({ id, words, chosen, toggle, add }: { id: string; words: string[]; chosen: string[]; toggle: (word: string) => void; add: (word: string) => void }) {
  const [text, setText] = useState('');
  const q = cleanTag(text).toLowerCase();
  const offered = words.filter(w => !chosen.includes(w) && (!q || w.toLowerCase().includes(q))).slice(0, SHOWN_TAGS);
  const commit = () => { if (text.trim()) { add(text); setText(''); } };
  return <div className="bank-chips tags" role="group" aria-labelledby={id}>
    {[...chosen, ...offered].map(word => <button key={word} type="button" aria-pressed={chosen.includes(word)} onClick={() => toggle(word)}>#{word}</button>)}
    <input className="bank-tag-input" aria-label="Nowa etykieta" value={text} maxLength={BANK_LABEL_LIMITS.tag + 1} placeholder={words.length > SHOWN_TAGS ? '+ etykieta albo szukaj' : '+ etykieta'}
      onChange={e => setText(e.target.value)} onKeyDown={e => { if ((e.key === 'Enter' || e.key === ',') && text.trim()) { e.preventDefault(); commit(); } }} onBlur={commit} />
  </div>;
}

/** One part of the sentence: what is said, or what is still to say in faint words. */
const Slot = ({ children, empty }: { children: ReactNode; empty?: boolean }) => <span className={`bank-slot${empty ? ' faint' : ''}`}>{children}</span>;

/**
 * Marking one operation: a dialog over the whole panel, so it reads the same in a tile of any size and on a phone. First the
 * move, what the money did (a payment in a shop starts as a spend, a transfer is left to the user), each with how many times
 * the other side's earlier operations were it. A sentence then says what will be saved ("Wydane 54,20 zł · u Biedronka · na
 * Spożywcze"), and below it the one list the move has: a spend's categories, an income's sources, a move's pockets; for a
 * settlement the balance with the side it leads to. The other side, tags, recurring and a description add the context; the
 * side and tags show only what is chosen and what typing finds, never the whole list. A sure suggestion fills the form and
 * Przyjmij saves it; several possibilities are a choice, one tap saves the chosen one. Esc and Anuluj drop the edit.
 */
export function BankLabelDialog({ t, data, act, error, close, done, position }: {
  t: BankTransaction; data: BankLabelsData; act: BankLabelsHook['act']; error: string; close: () => void; done: () => void; position?: { index: number; of: number };
}) {
  const existing = data.labels[t.id];
  const known = data.known[t.id];
  const habit = data.habits[t.id] ?? {};
  const [suggestion, setSuggestion] = useState(isDone(existing) ? undefined : data.suggestions[t.id]);
  const sure = suggestion?.sure ? suggestion.options[0] : undefined;
  const d = describe(t);
  const start: BankLabel = existing ?? {
    move: sure?.move ?? likelyMove(t), category: sure?.category ?? null, tags: sure?.tags ?? [], party: sure?.party ?? known ?? null, recurring: !!sure?.recurring, comment: '',
  };
  const [move, setMove] = useState(start.move);
  const [category, setCategory] = useState(start.category);
  const [tags, setTags] = useState(start.tags);
  const [party, setParty] = useState(start.party);
  // A side not made yet: the bank's clean name, made when the mark is saved.
  const [partyText, setPartyText] = useState(!start.party && !existing && namesSide(t) ? d.name : '');
  // The list of sides shows only once the user types, never for the name the bank gave.
  const [searching, setSearching] = useState(false);
  // The typed name is someone else than the side of the same name already kept (two people may share a name).
  const [another, setAnother] = useState(false);
  const [recurring, setRecurring] = useState(start.recurring);
  const [comment, setComment] = useState(start.comment);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const id = useId();
  const parties = new Map(data.parties.map(p => [p.id, p]));
  const chosen = party ? parties.get(party) : undefined;
  const typed = partyText.trim();
  const exact = another ? undefined : data.parties.find(p => p.name.toLowerCase() === typed.toLowerCase());
  const q = typed.toLowerCase();
  const matches = searching && q ? data.parties.filter(p => p.name.toLowerCase().includes(q)).slice(0, SHOWN_SIDES) : [];
  // The list of this move (categories, sources or pockets); one of another move does not count here.
  const axisOf = move ? AXIS[move] : undefined;
  const own = axisOf ? data.categories.filter(c => c.move === move) : [];
  const axis = own.some(c => c.id === category) ? category : null;
  const dirty = move !== start.move || axis !== start.category || tags.join() !== start.tags.join() || party !== start.party
    || recurring !== start.recurring || comment !== start.comment || (!!typed && !party);
  const needsSide = move === 'settle' && !chosen && !typed;

  useEffect(() => { root.current?.querySelector<HTMLElement>('.bank-dlg-sug button, .bank-moves button[aria-pressed="true"], .bank-moves button, button.save')?.focus(); }, []);

  const addTag = (value: string) => {
    const word = cleanTag(value);
    if (!word || word.length > BANK_LABEL_LIMITS.tag) return;
    const tag = data.tags.find(k => k.toLowerCase() === word.toLowerCase()) ?? word;
    setTags(list => list.some(k => k.toLowerCase() === tag.toLowerCase()) || list.length >= BANK_LABEL_LIMITS.tagsPerMark ? list : [...list, tag]);
  };
  const pick = (partyId: string) => { setParty(partyId); setPartyText(''); setSearching(false); };
  const save = async () => {
    if (needsSide) return;
    setBusy(true);
    let partyId = party;
    if (!partyId && typed) {
      partyId = exact?.id ?? (await act({ action: 'createParty', name: typed }))?.party?.id ?? null;
      if (!partyId) { setBusy(false); return; }
      pick(partyId);
    }
    const mark: BankLabel = { move, category: axis, tags, party: partyId, recurring, comment: comment.trim() };
    const empty = !move && !tags.length && !partyId && !recurring && !mark.comment;
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
    const mark: BankLabel = { move: o.move ?? null, category: o.category ?? null, tags: o.tags ?? [], party: o.party ?? null, recurring: !!o.recurring, comment: comment.trim() };
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
      if (sure.move && move === sure.move) setMove(likelyMove(t));
      if (category === sure.category) setCategory(null);
      if (tags.join() === (sure.tags ?? []).join()) setTags([]);
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
  const sideName = chosen?.name ?? typed;
  const shownName = sideName || d.name;
  // The balance with the side this settlement is with: as it stands without this operation, and after it.
  const settled = chosen ? data.balances.find(b => b.party === chosen.id && b.currency === t.currency)?.amount ?? 0 : 0;
  const before = existing?.move === 'settle' && existing.party === chosen?.id ? settled + t.amount : settled;
  const axisName = own.find(c => c.id === axis)?.name;
  const out = t.amount < 0;
  const sum = <Slot>{plain(t.amount, t.currency)}</Slot>;
  const side = (word: string) => <> · {word} <Slot empty={!sideName}>{sideName || 'kto?'}</Slot></>;
  const sentence = !move ? <span className="bank-slot faint">Co zrobiły te pieniądze?</span>
    : move === 'spend' ? <>{out ? 'Wydane' : 'Zwrot'} {sum}{side(out ? 'u' : 'od')} · {out ? 'na' : 'zmniejsza'} <Slot empty={!axisName}>{axisName ?? 'wybierz kategorię'}</Slot></>
    : move === 'income' ? <>{out ? 'Korekta' : 'Przyszło'} {sum}{out ? '' : side('od')} · {out ? 'zmniejsza' : 'jako'} <Slot empty={!axisName}>{axisName ?? 'wybierz źródło'}</Slot></>
    : move === 'settle' ? <>{out ? 'Wysłane' : 'Otrzymane'} {sum}{side(out ? 'do' : 'od')}</>
    : <>Przełożone {sum} · {out ? 'do' : 'z'} <Slot empty={!axisName}>{axisName ?? 'kieszeń'}</Slot></>;

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
          <span className="bank-dlg-meta">{new Date(t.at).toLocaleDateString('pl-PL', { weekday: 'short', day: 'numeric', month: 'long', timeZone: 'UTC' })} · {howPaid(t, !!sideName)}{shownName !== d.name ? ` · w banku: ${d.name}` : ''}</span>
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

        <div className="bank-moves" role="group" aria-label="Co zrobiły pieniądze">
          {BANK_MOVES.map(m => { const Icon = MOVE_ICONS[m]; return <button key={m} type="button" aria-pressed={move === m} style={{ '--c': MOVE_COLORS[m] } as CSSProperties}
            aria-label={`${MOVE_WORDS[m]}${habit[m] ? `, wcześniej ${habit[m]}×` : ''}`} onClick={() => { setMove(m); setCreating(false); }}>
            {habit[m] ? <span className="hab" aria-hidden="true">{habit[m]}×</span> : null}
            <span className="name"><Icon size={15} aria-hidden="true" />{MOVE_WORDS[m]}</span><small>{MOVE_HINTS[m]}</small>
          </button>; })}
        </div>
        <p className="bank-sentence" aria-live="polite" style={move ? { '--c': MOVE_COLORS[move] } as CSSProperties : undefined}>{sentence}</p>

        {axisOf && move && <>
          <span className="todo-dlg-label" id={`${id}-cat`}>{axisOf.label}</span>
          <div className="bank-chips" role="group" aria-labelledby={`${id}-cat`}>
            {own.map(c => { const Icon = ICONS[c.icon]; return <button key={c.id} type="button" aria-pressed={c.id === axis} style={{ '--c': COLOR_VALUES[c.color] } as CSSProperties}
              onClick={() => setCategory(c.id === axis ? null : c.id)}><Icon size={15} aria-hidden="true" />{c.name}</button>; })}
            {!creating && <button type="button" className="new" onClick={() => setCreating(true)}><Plus size={15} aria-hidden="true" />{axisOf.add}</button>}
          </div>
          {creating && <BankCategoryEditor label="Dodaj" placeholder={axisOf.placeholder}
            initial={{ name: '', color: BANK_COLORS.find(c => !used.has(c)) ?? 'slate', icon: axisOf.icon }} cancel={() => setCreating(false)}
            submit={async value => { const result = await act({ action: 'createCategory', move: move as 'spend' | 'income' | 'move', ...value }); if (result?.category) { setCategory(result.category.id); setCreating(false); } }} />}
        </>}
        {move === 'settle' && <p className="bank-dlg-says">{chosen
          ? <>Saldo: {balanceText(chosen.name, before, t.currency)} → <b>{balanceText(chosen.name, before - t.amount, t.currency)}</b>. Nie liczy się do wydatków ani przychodów.</>
          : typed ? <>Saldo z „{typed}” zacznie się od tej operacji. Nie liczy się do wydatków ani przychodów.</> : 'Wybierz niżej, z kim jest to rozliczenie.'}</p>}
        {move === 'move' && <p className="bank-dlg-says">Między Twoimi kontami: nie liczy się do wydatków ani przychodów.</p>}

        <label className="todo-dlg-label" htmlFor={`${id}-party`}>Druga strona</label>
        {chosen ? <div className="bank-person">
          <span className="bank-person-chip">{chosen.name}
            <button type="button" aria-label={`Bez drugiej strony (usuń ${chosen.name})`} onClick={() => { setParty(null); setPartyText(''); }}><X size={14} aria-hidden="true" /></button></span>
          <span className="bank-person-ids">{personHint(chosen) ? `rozpoznawana po: ${personHint(chosen)}` : 'jeszcze nierozpoznawana: zapamięta, co bank pokazał przy tej operacji'}</span>
        </div> : <div className="bank-person">
          <input id={`${id}-party`} className="todo-dlg-title" value={partyText} maxLength={BANK_LABEL_LIMITS.partyName} placeholder="Wpisz, kto to: Alicja, Inea, pyszne.pl" autoComplete="off"
            onChange={e => { setPartyText(e.target.value); setSearching(true); setAnother(false); }} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (exact) pick(exact.id); } }} />
          {matches.length > 0 && <ul className="bank-person-list column" aria-label="Pasujące strony">
            {matches.map(p => <li key={p.id}><button type="button" onClick={() => pick(p.id)}><span>{p.name}</span><small>{personHint(p)}</small></button></li>)}
          </ul>}
          {typed && (exact
            ? <button type="button" className="bank-another" onClick={() => setAnother(true)}>„{typed}” to ktoś inny niż zapisana strona</button>
            : <small className="bank-person-ids">Nowa: „{typed}”. Po zapisie panel rozpozna ją po tym, co pokazał bank.</small>)}
        </div>}

        <span className="todo-dlg-label" id={`${id}-tags`}>Etykiety · szczegóły</span>
        <Tags id={`${id}-tags`} words={data.tags} chosen={tags} add={addTag}
          toggle={tag => setTags(list => list.includes(tag) ? list.filter(k => k !== tag) : list.length >= BANK_LABEL_LIMITS.tagsPerMark ? list : [...list, tag])} />

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
          <button type="button" className="save" disabled={busy || needsSide} onClick={() => void save()}>{position && position.of > 1 ? 'Zapisz i dalej' : 'Zapisz'}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
