import { useContext, useEffect, useState } from 'react';
import type { ToolCallMessagePartProps } from '@assistant-ui/react';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';
import { bankAssignSchema, type BankAssignCategory, type BankAssignChoice, type BankAssignPick, type BankAssignMark, type BankAssignOutcome, type BankAssignPool, type BankAssignPreview, type BankAssignRecipient, type BankAssignTemplate } from '../bank-assign-contract';
import { CardActions, refusedNote } from './cards';
import { ConsentShell } from './consent-card';
import type { BankAssignArgs } from './types';

const pln = (amount: number) => `${amount.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} zł`;
const signed = (amount: number) => `${amount > 0 ? '+' : ''}${pln(amount)}`;
const MOVE_WORDS = { spend: 'Wydatek', income: 'Przychód', settle: 'Rozliczenie', move: 'Przełożenie' } as const;
const chip = 'tw:inline-flex tw:items-center tw:gap-1 tw:rounded-md tw:px-2 tw:py-0.5 tw:text-xs';
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const times = (n: number) => n === 1 ? 'raz' : 'razy';

const markLabel = (m: BankAssignMark) => `${m.category ? `${MOVE_WORDS[m.move]} · ${m.category.name}` : MOVE_WORDS[m.move]}${m.tags.map(t => ` #${t}`).join('')}`;
/** A mark without its kind when it is a spend (the common case): „Paliwo”, but „Przychód · Pensja”. */
const shortLabel = (m: BankAssignMark) => m.category ? (m.move === 'spend' ? m.category.name : `${MOVE_WORDS[m.move]} · ${m.category.name}`) : MOVE_WORDS[m.move];
const categoryLabel = (c: BankAssignCategory) => `${c.move === 'spend' ? 'Wydatek' : c.move === 'income' ? 'Przychód' : 'Przełożenie'} · ${c.name}`;

/** What the user chose on the card, as the request will carry it (and as the answer keeps it). */
export interface AssignSelection {
  skip: ReadonlySet<string>;
  skipOps: ReadonlySet<string>;
  groupPicks: Readonly<Record<string, BankAssignPick>>;
  picks: Readonly<Record<string, BankAssignPick>>;
  /** Spending categories made on this card; they are created by „Wykonaj”, together with the marks that use them. */
  newCategories: readonly string[];
}
const EMPTY: AssignSelection = { skip: new Set(), skipOps: new Set(), groupPicks: {}, picks: {}, newCategories: [] };
const pickOf = (p: { template?: string; category?: string; newCategory?: string }): BankAssignPick => Object.fromEntries(Object.entries({ template: p.template, category: p.category, newCategory: p.newCategory }).filter(([, v]) => v !== undefined));
const fromChoice = (c: BankAssignChoice): AssignSelection => ({
  skip: new Set(c.skip), skipOps: new Set(c.skipOps), groupPicks: Object.fromEntries((c.groupPicks ?? []).map(g => [g.group, pickOf(g)])),
  picks: Object.fromEntries((c.picks ?? []).map(p => [p.tx, pickOf(p)])), newCategories: c.newCategories ?? [],
});
const sameName = (a: string, b: string) => a.localeCompare(b, 'pl', { sensitivity: 'accent' }) === 0;

/** A pick in words, or null when it points at something that is not there. */
function pickLabel(pick: BankAssignPick | undefined, templates: BankAssignTemplate[], categories: BankAssignCategory[], sel: AssignSelection): string | null {
  if (!pick) return null;
  if (pick.category) { const c = categories.find(x => x.id === pick.category); return c ? categoryLabel(c) : null; }
  if (pick.newCategory) return sel.newCategories.some(n => sameName(n, pick.newCategory!)) ? `Wydatek · ${pick.newCategory} (nowa)` : null;
  const t = templates.find(x => x.key === pick.template);
  return t ? markLabel(t.mark) : null;
}
/** What a recipient's operations follow: the pick for the whole recipient, else (when its earlier operations all agree) its only template. */
const groupPick = (r: BankAssignRecipient, sel: AssignSelection): BankAssignPick | undefined => sel.groupPicks[r.key] ?? (r.certain ? { template: r.templates[0].key } : undefined);
/** What one operation would be marked with now: its own pick, else its recipient's; none when nothing is chosen. */
function markOf(r: BankAssignRecipient, tx: string, sel: AssignSelection, categories: BankAssignCategory[]): string | null {
  return pickLabel(sel.picks[tx] ?? groupPick(r, sel), r.templates, categories, sel);
}
/** How many of a recipient's operations get a mark and what they sum to; the ones beyond those listed follow the recipient's pick. */
function counted(r: BankAssignRecipient, sel: AssignSelection, categories: BankAssignCategory[]) {
  if (sel.skip.has(r.key)) return { count: 0, total: 0 };
  const listed = r.items.filter(i => !sel.skipOps.has(i.tx) && markOf(r, i.tx, sel, categories));
  const rest = pickLabel(groupPick(r, sel), r.templates, categories, sel) ? r.hidden : 0;
  const total = rest ? r.total - r.items.filter(i => !listed.includes(i)).reduce((s, i) => s + i.amount, 0) : listed.reduce((s, i) => s + i.amount, 0);
  return { count: listed.length + rest, total: Math.round(total * 100) / 100 };
}
const historyText = (r: BankAssignRecipient) => `wcześniej: ${r.templates.map(t => `${markLabel(t.mark)} ${t.count} ${times(t.count)}`).join(', ')}`;

/** The list of a field opens on a plain light background unless every entry is painted (a translucent field colour is not enough); and a field is kept small. */
const opt = 'tw:bg-ck-surface-2 tw:text-ck-text';
const selectStyle = { height: 26, minHeight: 0, paddingTop: 0, paddingBottom: 0 } as const;
const checkbox = 'tw:size-4 tw:accent-[#7ca9ff]';

/** The categories of a field's list: the user's own, the ones made on this card, and the way to make one. */
function CategoryOptions({ categories, sel }: { categories: BankAssignCategory[]; sel: AssignSelection }) {
  return <optgroup className={opt} label="Wszystkie kategorie">
    {categories.map(c => <option className={opt} key={c.id} value={`c:${c.id}`}>{categoryLabel(c)}</option>)}
    {sel.newCategories.map(n => <option className={opt} key={`n:${n}`} value={`n:${n}`}>{`Wydatek · ${n} (nowa)`}</option>)}
    <option className={opt} value="__new">+ Nowa kategoria…</option>
  </optgroup>;
}
/** A field's value as a pick: a template, a category, or a category made on the card. */
const pickFromValue = (value: string): BankAssignPick => value.startsWith('t:') ? { template: value.slice(2) } : value.startsWith('n:') ? { newCategory: value.slice(2) } : { category: value.slice(2) };
const valueOfPick = (p: BankAssignPick | undefined) => p?.category ? `c:${p.category}` : p?.newCategory ? `n:${p.newCategory}` : p?.template ? `t:${p.template}` : '';

/**
 * The name of a new spending category, asked right under the row it is for. An existing spending category of that name is taken as it is,
 * never a second one; a new one only exists on the card until „Wykonaj”.
 */
function NewCategoryForm({ onSubmit, onCancel }: { onSubmit: (name: string) => void; onCancel: () => void }) {
  const [name, setName] = useState('');
  const submit = () => { const clean = name.trim().replace(/\s+/g, ' ').slice(0, 40); if (clean) onSubmit(clean); };
  return <div className="tw:flex tw:items-center tw:gap-1.5 tw:py-1 tw:text-xs">
    <input autoFocus value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') onCancel(); }}
      placeholder="Nazwa nowej kategorii wydatków" aria-label="Nazwa nowej kategorii" maxLength={40}
      className="tw:h-6 tw:w-56 tw:rounded-md tw:border tw:border-ck-line tw:bg-ck-surface-2 tw:px-2 tw:text-xs tw:text-ck-text" />
    <button type="button" onClick={submit} disabled={!name.trim()} className={`${chip} tw:border tw:border-ck-cal tw:text-ck-text tw:disabled:opacity-50`}>Dodaj</button>
    <button type="button" onClick={onCancel} className={`${chip} tw:border tw:border-ck-line tw:text-ck-muted`}>Anuluj</button>
  </div>;
}
/** The selection after choosing a category by name: an existing spending category is used, otherwise it is added as new. */
function withNamed(sel: AssignSelection, categories: BankAssignCategory[], name: string): { pick: BankAssignPick; newCategories: readonly string[] } {
  const existing = categories.find(c => c.move === 'spend' && sameName(c.name, name));
  if (existing) return { pick: { category: existing.id }, newCategories: sel.newCategories };
  const known = sel.newCategories.find(n => sameName(n, name)) ?? name;
  return { pick: { newCategory: known }, newCategories: sel.newCategories.includes(known) ? sel.newCategories : [...sel.newCategories, known] };
}
const selectOn = 'tw:[color-scheme:dark] tw:h-6 tw:max-w-[170px] tw:rounded-full tw:border tw:border-ck-cal tw:bg-ck-cal/25 tw:px-2 tw:py-0.5 tw:text-xs tw:text-ck-text';
const selectOff = 'tw:[color-scheme:dark] tw:h-6 tw:max-w-[170px] tw:rounded-full tw:border tw:border-ck-line tw:bg-ck-surface-2 tw:px-2 tw:py-0.5 tw:text-xs tw:text-ck-muted';

/** One recipient: a tick, who and how many, what it was marked with before, templates for the whole group; opens to its operations. */
function RecipientRow({ r, sel, categories, onChange, locked, expanded, onFlip }: {
  r: BankAssignRecipient; sel: AssignSelection; categories: BankAssignCategory[]; onChange: (next: AssignSelection) => void; locked: boolean; expanded: boolean; onFlip: () => void;
}) {
  const t = counted(r, sel, categories), partial = t.count > 0 && t.count < r.count;
  const group = groupPick(r, sel);
  const groupText = pickLabel(group, r.templates, categories, sel);
  const [adding, setAdding] = useState<{ tx: string } | 'group' | null>(null);
  const set = (patch: Partial<AssignSelection>) => onChange({ ...sel, ...patch });
  // A choice for the whole recipient replaces what was picked for its single operations (otherwise the earlier pick of an operation
  // would win and the card would say one thing and save another).
  const withoutOwn = () => Object.fromEntries(Object.entries(sel.picks).filter(([tx]) => !r.items.some(i => i.tx === tx)));
  const toggleGroup = () => {
    if (t.count > 0) { set({ skip: new Set(sel.skip).add(r.key) }); return; }
    const skip = new Set(sel.skip); skip.delete(r.key);
    const skipOps = new Set([...sel.skipOps].filter(tx => !r.items.some(i => i.tx === tx)));
    set({ skip, skipOps, ...(groupText ? {} : { groupPicks: { ...sel.groupPicks, [r.key]: { template: r.templates[0].key } }, picks: withoutOwn() }) });
  };
  const pickGroup = (tpl: BankAssignTemplate) => {
    const groupPicks = { ...sel.groupPicks };
    if (groupPicks[r.key]?.template === tpl.key && !r.certain) delete groupPicks[r.key]; else groupPicks[r.key] = { template: tpl.key };
    const skip = new Set(sel.skip); skip.delete(r.key);
    set({ groupPicks, skip, picks: withoutOwn() });
  };
  const setOp = (tx: string, value: string) => {
    if (value === '__new') { setAdding({ tx }); return; }
    const picks = { ...sel.picks };
    if (!value) delete picks[tx]; else picks[tx] = pickFromValue(value);
    const skipOps = new Set(sel.skipOps); skipOps.delete(tx);
    set({ picks, skipOps });
  };
  const setGroup = (value: string) => {
    if (value === '__new') { setAdding('group'); return; }
    if (!value) return;
    set({ groupPicks: { ...sel.groupPicks, [r.key]: pickFromValue(value) }, skip: new Set([...sel.skip].filter(k => k !== r.key)), picks: withoutOwn() });
  };
  const named = (name: string) => {
    const { pick, newCategories } = withNamed(sel, categories, name);
    const skip = new Set([...sel.skip].filter(k => k !== r.key));
    if (adding === 'group') onChange({ ...sel, newCategories, groupPicks: { ...sel.groupPicks, [r.key]: pick }, skip, picks: withoutOwn() });
    else if (adding) { const skipOps = new Set(sel.skipOps); skipOps.delete(adding.tx); onChange({ ...sel, newCategories, picks: { ...sel.picks, [adding.tx]: pick }, skipOps }); }
    setAdding(null);
  };
  const toggleOp = (tx: string, has: boolean) => {
    if (has) { set({ skipOps: new Set(sel.skipOps).add(tx) }); return; }
    const skipOps = new Set(sel.skipOps); skipOps.delete(tx);
    // An operation with no mark yet gets the recipient's most frequent one when it is ticked.
    set({ skipOps, ...(markOf(r, tx, sel, categories) ? {} : { picks: { ...sel.picks, [tx]: { template: r.templates[0].key } } }), skip: new Set([...sel.skip].filter(k => k !== r.key)) });
  };
  return <div className="tw:border-b tw:border-ck-line tw:last:border-b-0" data-recipient={r.key}>
    <div className="tw:grid tw:grid-cols-[20px_minmax(0,1fr)] tw:items-center tw:gap-x-3 tw:gap-y-1.5 tw:px-3 tw:py-2">
      <input type="checkbox" className={checkbox} checked={t.count > 0} ref={el => { if (el) el.indeterminate = partial; }} disabled={locked} onChange={toggleGroup}
        aria-label={`Oznacz ${r.count} operacji: ${r.name}`} />
      <div className="tw:min-w-0">
        <div className="tw:truncate tw:text-sm tw:text-ck-text">{r.name} <span className="tw:text-ck-muted">· {partial ? `${t.count} z ${r.count}` : r.count} {r.count === 1 ? 'operacja' : 'operacji'} · {signed(t.count ? t.total : r.total)}</span></div>
        <button type="button" className="tw:flex tw:max-w-full tw:items-center tw:gap-1 tw:text-left tw:text-xs tw:text-ck-muted tw:hover:text-ck-text" aria-expanded={expanded} onClick={onFlip}>
          {expanded ? <ChevronUp size={13} className="tw:flex-none" aria-hidden="true" /> : <ChevronDown size={13} className="tw:flex-none" aria-hidden="true" />}<span className="tw:truncate">{historyText(r)}</span>
        </button>
      </div>
      <div className="tw:col-start-2 tw:flex tw:flex-wrap tw:items-center tw:gap-1.5" role="group" aria-label={`Szablon dla ${r.name}`}>
        <span className="tw:text-xs tw:text-ck-muted">oznacz jako</span>
        {r.templates.map(tpl => {
          const on = group?.template === tpl.key;
          return <button key={tpl.key} type="button" disabled={locked} aria-pressed={on} onClick={() => pickGroup(tpl)}
            className={`${chip} tw:border ${on ? 'tw:border-ck-cal tw:bg-ck-cal/25 tw:text-ck-text' : 'tw:border-ck-line tw:bg-ck-surface-2 tw:text-ck-muted tw:hover:text-ck-text'}`}>
            {on && <Check size={12} aria-hidden="true" />}{markLabel(tpl.mark)}{tpl.count > 0 && r.templates.length > 1 ? ` ×${tpl.count}` : ''}
          </button>;
        })}
        {group && !group.template && groupText && <button type="button" disabled={locked} aria-pressed="true" onClick={() => { const groupPicks = { ...sel.groupPicks }; delete groupPicks[r.key]; set({ groupPicks }); }}
          className={`${chip} tw:border tw:border-ck-cal tw:bg-ck-cal/25 tw:text-ck-text`}><Check size={12} aria-hidden="true" />{groupText}</button>}
        <select className={selectOff} style={selectStyle} value="" disabled={locked} aria-label={`Inna kategoria dla ${r.name}`} onChange={e => setGroup(e.target.value)}>
          <option className={opt} value="">Inna kategoria…</option>
          <CategoryOptions categories={categories} sel={sel} />
        </select>
      </div>
    </div>
    {adding === 'group' && <div className="tw:px-3 tw:pl-[44px]"><NewCategoryForm onSubmit={named} onCancel={() => setAdding(null)} /></div>}
    {expanded && <ul className="tw:m-0 tw:mb-1 tw:grid tw:list-none tw:gap-1 tw:px-3 tw:pb-2 tw:pl-[44px] tw:text-xs">
      {r.items.map(i => {
        const pick = sel.picks[i.tx];
        const has = !sel.skip.has(r.key) && !sel.skipOps.has(i.tx) && !!markOf(r, i.tx, sel, categories);
        const value = !has ? '__off' : valueOfPick(pick);
        return <li key={i.tx} className="tw:flex tw:flex-wrap tw:items-center tw:gap-2">
          <input type="checkbox" className={checkbox} checked={has} disabled={locked} onChange={() => toggleOp(i.tx, has)} aria-label={`Oznacz ${i.day} ${i.name}`} />
          <span className={`tw:min-w-0 tw:flex-1 tw:truncate ${has ? 'tw:text-ck-text' : 'tw:text-ck-muted'}`}>{i.day} · {i.name} · {signed(i.amount)}</span>
          <select className={has ? selectOn : selectOff} style={selectStyle} value={value} disabled={locked} aria-label={`Oznaczenie: ${i.day} ${i.name}`}
            onChange={e => e.target.value === '__off' ? set({ skipOps: new Set(sel.skipOps).add(i.tx) }) : setOp(i.tx, e.target.value)}>
            <option className={opt} value="__off">nie oznaczaj</option>
            {groupText && <option className={opt} value="">{groupText}</option>}
            <optgroup className={opt} label="Z historii odbiorcy">{r.templates.filter(tpl => tpl.key !== group?.template).map(tpl => <option className={opt} key={tpl.key} value={`t:${tpl.key}`}>{shortLabel(tpl.mark)}</option>)}</optgroup>
            <CategoryOptions categories={categories} sel={sel} />
          </select>
          {adding && adding !== 'group' && adding.tx === i.tx && <span className="tw:basis-full tw:pl-6"><NewCategoryForm onSubmit={named} onCancel={() => setAdding(null)} /></span>}
        </li>;
      })}
      {r.hidden > 0 && <li>… jeszcze {r.hidden} (według szablonu grupy)</li>}
    </ul>}
  </div>;
}

/** A template in words; the other side the user gave it is shown only where the template is not one recipient's own, and as what it is: the user's note (the bank did not name it). */
const templateLabel = (t: BankAssignTemplate, withParty: boolean) => `${markLabel(t.mark)}${withParty && t.party ? ` · ${t.party} (notatka)` : ''}`;

/** How many payments of the pool have a pick (and what they sum to). */
function poolCounted(pool: BankAssignPool | null, sel: AssignSelection) {
  const picked = (pool?.items ?? []).filter(i => sel.picks[i.tx] && !sel.skipOps.has(i.tx));
  return { count: picked.length, total: Math.round(picked.reduce((s, i) => s + i.amount, 0) * 100) / 100 };
}

/**
 * The payments the bank gives no shop for that have a lead: the very same amount was marked the same way before. Ticking a payment takes
 * the template its lead names (written out in full beside it); the field at its end picks another template or any category. Nothing is
 * ticked for the user, and payments with no lead are not here.
 */
function PoolSection({ pool, categories, sel, onChange, locked }: {
  pool: BankAssignPool; categories: BankAssignCategory[]; sel: AssignSelection; onChange: (next: AssignSelection) => void; locked: boolean;
}) {
  const done = poolCounted(pool, sel);
  const [adding, setAdding] = useState<string | null>(null);
  const set = (tx: string, pick: BankAssignPick | null) => {
    const picks = { ...sel.picks };
    if (pick) picks[tx] = pick; else delete picks[tx];
    onChange({ ...sel, picks });
  };
  const named = (name: string) => {
    if (!adding) return;
    const { pick, newCategories } = withNamed(sel, categories, name);
    onChange({ ...sel, newCategories, picks: { ...sel.picks, [adding]: pick } });
    setAdding(null);
  };
  return <div className="tw:grid tw:overflow-hidden tw:rounded-xl tw:border tw:border-ck-line" data-testid="assign-pool">
    <div className="tw:flex tw:justify-between tw:gap-3 tw:bg-ck-surface-2 tw:px-3 tw:py-1.5 tw:text-xs tw:text-ck-muted">
      <span>Bez sklepu, ale ta sama kwota była już oznaczona tak samo. Zaznacz, żeby przyjąć.</span><span className="tw:flex-none">{plural(pool.count, 'płatność', 'płatności')}</span>
    </div>
    <ul className="tw:m-0 tw:grid tw:list-none tw:gap-1.5 tw:px-3 tw:py-2 tw:text-xs">
      {pool.items.map(i => {
        const pick = sel.picks[i.tx];
        const value = valueOfPick(pick);
        const hinted = i.hint ? pool.templates.find(t => t.key === i.hint!.template) : undefined;
        return <li key={i.tx} className="tw:flex tw:flex-wrap tw:items-center tw:gap-x-2 tw:gap-y-0.5">
          <input type="checkbox" className={checkbox} checked={!!pick} disabled={locked || !hinted} aria-label={`Przyjmij ${i.day} ${signed(i.amount)}`}
            onChange={() => hinted && set(i.tx, pick ? null : { template: hinted.key })} />
          <span className="tw:text-ck-muted">{i.day}</span>
          <span className="tw:min-w-0 tw:flex-1 tw:text-ck-text">{signed(i.amount)}</span>
          <select className={value ? selectOn : selectOff} style={selectStyle} value={value} disabled={locked} aria-label={`Oznaczenie płatności ${i.day} ${signed(i.amount)}`}
            onChange={e => { const v = e.target.value; if (v === '__new') setAdding(i.tx); else set(i.tx, v ? pickFromValue(v) : null); }}>
            <option className={opt} value="">nie oznaczaj</option>
            <optgroup className={opt} label="Szablony">{[...pool.templates].sort((a, b) => Number(b.key === i.hint?.template) - Number(a.key === i.hint?.template)).map(t => <option className={opt} key={t.key} value={`t:${t.key}`}>{templateLabel(t, true)}</option>)}</optgroup>
            <CategoryOptions categories={categories} sel={sel} />
          </select>
          {adding === i.tx && <span className="tw:basis-full tw:pl-6"><NewCategoryForm onSubmit={named} onCancel={() => setAdding(null)} /></span>}
          {hinted && i.hint && <span className="tw:basis-full tw:pl-6 tw:text-ck-muted" data-testid="assign-hint">ta sama kwota: {templateLabel(hinted, true)}, {i.hint.count} {times(i.hint.count)}</span>}
        </li>;
      })}
      {pool.hidden > 0 && <li className="tw:text-ck-muted">… i {pool.hidden} kolejnych: poza limitem karty.</li>}
    </ul>
    <div className="tw:border-t tw:border-ck-line tw:px-3 tw:py-1.5 tw:text-xs tw:text-ck-muted">
      Z tej sekcji do zapisu: {plural(done.count, 'płatność', 'płatności')}{done.count ? `, ${signed(done.total)}` : ''}.{pool.rest > 0 ? ` Pominięto ${pool.rest} bez tropu.` : ''}
    </div>
  </div>;
}

/**
 * The recipients with unmarked operations. Those whose earlier operations always got the same mark come first, ticked; the others
 * ("różnie") wait for a template or a category. Both can be changed for the whole group or for one operation.
 */
export function AssignBody({ preview, sel, onChange, locked = false, state = 'open' }: {
  preview: BankAssignPreview; sel: AssignSelection; onChange: (next: AssignSelection) => void; locked?: boolean; state?: 'open' | 'applied' | 'rejected';
}) {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const flip = (key: string) => setOpen(prev => { const next = new Set(prev); if (!next.delete(key)) next.add(key); return next; });
  const sections = [
    { title: 'Zawsze to samo: zaznaczone', rows: preview.recipients.filter(r => r.certain), id: 'assign-certain' },
    { title: 'Różnie: wybierz szablon dla grupy albo operacji', rows: preview.recipients.filter(r => !r.certain), id: 'assign-mixed' },
  ].filter(s => s.rows.length);
  return <div className={`tw:grid tw:gap-3 ${state === 'rejected' ? 'tw:opacity-55' : ''}`} data-state={state}>
    {sections.map(s => <div key={s.id} className="tw:grid tw:overflow-hidden tw:rounded-xl tw:border tw:border-ck-line" data-testid={s.id}>
      <div className="tw:flex tw:justify-between tw:bg-ck-surface-2 tw:px-3 tw:py-1.5 tw:text-xs tw:text-ck-muted"><span>{s.title}</span><span>{plural(s.rows.length, 'odbiorca', 'odbiorców')} · {plural(s.rows.reduce((n, r) => n + r.count, 0), 'operacja', 'operacji')}</span></div>
      {s.rows.map(r => <RecipientRow key={r.key} r={r} sel={sel} categories={preview.categories} onChange={onChange} locked={locked} expanded={open.has(r.key)} onFlip={() => flip(r.key)} />)}
    </div>)}
    {preview.pool && <PoolSection pool={preview.pool} categories={preview.categories} sel={sel} onChange={onChange} locked={locked} />}
  </div>;
}

/** The days the card covers, in words: what was asked and what the operations really span. */
function rangeText(p: BankAssignPreview) {
  const span = p.range.first ? (p.range.first === p.range.last ? p.range.first : `${p.range.first} do ${p.range.last}`) : null;
  if (!p.range.from && !p.range.to) return `Wszystkie zapisane operacje${span ? `: z dni ${span}` : ''}`;
  return `Zakres: ${p.range.from ?? 'od początku'} – ${p.range.to ?? 'do dziś'}${span ? ` · operacje z ${span}` : ''}`;
}

/**
 * `panel_bank_assign`: the consent card for marking many operations. Wektor only named a range of days; the recipients and their
 * templates are worked out here by the panel (`GET /api/bank/assign`), the user ticks, picks a template or a category for a
 * group or one operation, and nothing is marked until „Wykonaj”.
 */
export function BankAssignCard({ toolCallId, args, result }: ToolCallMessagePartProps<BankAssignArgs>) {
  const { respond, running, superseded } = useContext(CardActions);
  const plan = bankAssignSchema.safeParse(args);
  const key = plan.success ? JSON.stringify(plan.data) : '';
  const decided = result && typeof result === 'object' && ['applied', 'rejected'].includes((result as { decision?: string }).decision ?? '') ? result as BankAssignOutcome : undefined;
  const [state, setState] = useState<{ key: string; data?: BankAssignPreview; error?: string }>({ key: '' });
  const needsPreview = !decided || (decided.decision === 'rejected' && !decided.preview);
  const [mine, setMine] = useState<AssignSelection>(EMPTY);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!plan.success || !needsPreview) return;
    const params = new URLSearchParams();
    if (plan.data.from) params.set('from', plan.data.from);
    if (plan.data.to) params.set('to', plan.data.to);
    let gone = false;
    fetch(`/api/bank/assign?${params}`, { signal: AbortSignal.timeout(15_000) }).then(async response => {
      const body = await response.json().catch(() => null) as (BankAssignPreview & { error?: string }) | null;
      if (gone) return;
      setState(response.ok && body ? { key, data: body } : { key, error: body?.error || 'Nie udało się pobrać podglądu oznaczeń.' });
    }, () => { if (!gone) setState({ key, error: 'Nie udało się pobrać podglądu oznaczeń.' }); });
    return () => { gone = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` is the plan
  }, [key, needsPreview]);
  const preview = decided?.preview ?? (state.key === key ? state.data : undefined);
  // After an answer the card shows what was decided; before, what the user has ticked and picked so far.
  const sel = decided?.decision === 'applied' ? fromChoice(decided.choice) : mine;
  const rows = preview?.recipients ?? [];
  const sums = rows.map(r => counted(r, sel, preview?.categories ?? []));
  const poolDone = poolCounted(preview?.pool ?? null, sel);
  const count = sums.reduce((n, t) => n + t.count, 0) + poolDone.count;
  const total = sums.reduce((n, t) => n + t.total, 0) + poolDone.total;
  const title = typeof args.tytul === 'string' && args.tytul.trim() ? args.tytul.trim().slice(0, 80) : 'Oznaczenia z podpowiedzi';
  const unidentified = toolCallId.startsWith('pending:') || !toolCallId.includes(':');
  const stale = !decided && !!superseded?.has(toolCallId);
  const ok = !!preview && !preview.problems.length;
  const answer = async (decision: 'apply' | 'reject') => {
    setSending(true); setError('');
    const live = new Set(rows.map(r => r.key));
    const opsOf = new Map([...rows.flatMap(r => r.items.map(i => [i.tx, r.key] as const)), ...(preview?.pool?.items ?? []).map(i => [i.tx, 'pool'] as const)]);
    const groupPicks = Object.entries(mine.groupPicks).filter(([g]) => live.has(g)).map(([group, p]) => ({ group, ...p }));
    const picks = Object.entries(mine.picks).filter(([tx]) => opsOf.has(tx)).map(([tx, p]) => ({ tx, ...p }));
    // Only the new categories something still uses are sent: one the user made and then dropped is never created.
    const used = mine.newCategories.filter(n => [...groupPicks, ...picks].some(p => p.newCategory && sameName(p.newCategory, n)));
    const extra: BankAssignChoice = {
      ...(mine.skip.size ? { skip: [...mine.skip].filter(k => live.has(k)) } : {}),
      ...([...mine.skipOps].some(tx => opsOf.has(tx)) ? { skipOps: [...mine.skipOps].filter(tx => opsOf.has(tx)) } : {}),
      ...(groupPicks.length ? { groupPicks: groupPicks as BankAssignChoice['groupPicks'] } : {}),
      ...(picks.length ? { picks: picks as BankAssignChoice['picks'] } : {}),
      ...(used.length ? { newCategories: used } : {}),
    };
    try { await respond(toolCallId, { kind: 'bankPlan', decision, ...(decision === 'apply' ? extra : {}) }); }
    catch (e) { setError(e instanceof Error && e.message ? e.message : 'Nie udało się zapisać decyzji.'); }
    finally { setSending(false); }
  };
  return <ConsentShell
    label="Zgoda na masowe oznaczenie"
    heading={!decided ? 'Oznaczyć z podpowiedzi?' : decided.decision === 'applied' ? 'Oznaczono' : 'Odrzucono'}
    subtitle={title}
    notices={!decided && <>
      {args.refused && <p className={refusedNote} role="alert">Panel nie przyjął propozycji: {args.refused}</p>}
      {!plan.success && <p className={refusedNote} role="alert">Agent przysłał niepoprawną propozycję.</p>}
      {state.key === key && state.error && <p className={refusedNote} role="alert">{state.error}</p>}
      {plan.success && !preview && !state.error && <p className="tw:m-0 tw:text-xs tw:text-ck-muted" role="status">Liczę podgląd…</p>}
      {preview?.problems.map(p => <p key={p} className={refusedNote} role="alert">{p}</p>)}
    </>}
    body={ok ? <>
      <p className="tw:m-0 tw:text-xs tw:text-ck-muted" data-testid="assign-range">{rangeText(preview)}</p>
      <AssignBody preview={preview} sel={sel} locked={!!decided} state={decided ? decided.decision : 'open'} onChange={setMine} />
    </> : undefined}
    footnote={!decided && ok ? <div className="tw:grid tw:gap-1 tw:text-xs tw:text-ck-muted">
      <p className="tw:m-0 tw:text-ck-text">Zaznaczone: {plural(count, 'operacja', 'operacji')}{count ? `, ${signed(Math.round(total * 100) / 100)}` : ''}.</p>
      <p className="tw:m-0">Operacje jednego odbiorcy nie muszą mieć tego samego oznaczenia. Kwoty, daty i strony zostają, a nic nie idzie do banku.</p>
    </div> : undefined}
    outcome={decided?.decision === 'applied'
      ? <p className="tw:m-0 tw:flex tw:items-center tw:gap-2 tw:text-ck-green" role="status"><Check size={15} aria-hidden="true" />Oznaczono {plural(decided.assigned, 'operację', 'operacji')}.</p>
      : decided?.decision === 'rejected' ? <p className="tw:m-0 tw:text-xs tw:text-ck-muted" role="status">Nic nie zostało zmienione.</p> : undefined}
    canApply={!running && !unidentified && ok && !args.refused && count > 0}
    canReject={!running && !unidentified}
    onApply={() => void answer('apply')}
    onReject={() => void answer('reject')}
    sending={sending}
    error={error}
    stale={stale}
  />;
}
