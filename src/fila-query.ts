import { FILA_TYPES } from './fila-contract';

/**
 * The Fila query (Q-008): one line of text, the canonical form for the AI, the API and the GUI's pills, and its parsed
 * structure. Syntax only lives here (it has no data to check names against); `server/fila-query.ts` binds a parsed query
 * to the data and runs it. Grammar and rules: docs/fila.md.
 *
 *   projekt = DESK AND typ = funkcja AND stan IN ("Pomysł", "W realizacji") AND tag = "x" AND moduł = "Wektor"
 *   AND pole("Koszt") = 3 AND pole("Etykieta") istnieje AND otwarte AND rodzic brak AND archiwum = tylko SORTUJ stan, id malejąco
 */
export type FilaQueryValue = string | number | boolean;
export type FilaCondition =
  | { kind: 'type' | 'state' | 'module' | 'tag'; any: string[] }
  | { kind: 'closed'; value: boolean }
  | { kind: 'parent'; is: 'none' | 'any' | string }
  | { kind: 'field'; name: string; test: 'exists' | 'missing' | 'eq'; value?: FilaQueryValue };
export interface FilaSortKey { key: 'state' | 'title' | 'id'; desc: boolean }
export interface FilaQuery {
  /** The one project the query asks in (stage 1); a column query has none, it inherits the section's. */
  project: string | null;
  conditions: FilaCondition[];
  /** Archived threads are out unless asked for (D-037): `include` = both, `only` = just the archived. */
  archive: 'exclude' | 'include' | 'only';
  /** `null` = not stated: the section's order, else by ID. */
  sort: FilaSortKey[] | null;
}
export type FilaQueryKind = 'section' | 'column';
export class FilaQueryError extends Error {}

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').replace(/Ł/g, 'L').toLowerCase();
const MAX_VALUES = 50;
const MAX_SORT = 3;
const UNSUPPORTED_DATES = 'Warunki dat i terminów (Kiedy, Termin, zakresy, daty względne) nie są obsługiwane w etapie 1.';
const UNSUPPORTED_PROJECTS = 'Zapytania przez kilka lub wszystkie projekty nie są obsługiwane w etapie 1: wskaż jeden projekt (projekt = KLUCZ).';
const fail = (message: string): never => { throw new FilaQueryError(message); };

type Token = { t: 'word' | 'str' | 'sym'; v: string };
function tokenize(text: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i]!;
    if (/\s/.test(c)) { i += 1; continue; }
    if (c === '"') {
      let value = '';
      i += 1;
      for (;;) {
        if (i >= text.length) fail('Brakuje zamykającego cudzysłowu.');
        const d = text[i++]!;
        if (d === '\\' && i < text.length) { value += text[i++]; continue; }
        if (d === '"') break;
        value += d;
      }
      out.push({ t: 'str', v: value });
    } else if ('(),'.includes(c)) { out.push({ t: 'sym', v: c }); i += 1; }
    else if ('=!<>~'.includes(c)) {
      let run = '';
      while (i < text.length && '=!<>~'.includes(text[i]!)) run += text[i++];
      out.push({ t: 'sym', v: run });
    } else {
      let word = '';
      while (i < text.length && !/[\s(),="!<>~]/.test(text[i]!)) word += text[i++];
      out.push({ t: 'word', v: word });
    }
  }
  return out;
}

const typeKey = (value: string) => {
  const found = Object.entries(FILA_TYPES).find(([key, type]) => fold(key) === fold(value) || fold(type.label) === fold(value));
  return found?.[0] ?? fail(`Nieznany typ „${value}”. Dostępne: ${Object.keys(FILA_TYPES).join(', ')}.`);
};

export function parseFilaQuery(text: string, kind: FilaQueryKind): FilaQuery {
  const tokens = tokenize(text);
  let pos = 0;
  const peek = () => tokens[pos];
  const word = (token: Token | undefined) => (token?.t === 'word' ? fold(token.v) : undefined);
  const next = (what: string) => tokens[pos++] ?? fail(`Zapytanie urwane: brakuje ${what}.`);
  const sym = (value: string, what: string) => {
    const token = next(what);
    if (token.t !== 'sym' || token.v !== value) fail(`Oczekiwano „${value}” (${what}), jest „${token.v}”.`);
  };
  const eq = (clause: string) => {
    const token = next(`„=” po ${clause}`);
    if (token.t === 'sym' && token.v === '=') return;
    if (token.t === 'sym' && /^[!<>~]/.test(token.v)) fail(`Operator „${token.v}” nie jest obsługiwany (tylko =, IN, istnieje, brak); ${UNSUPPORTED_DATES}`);
    fail(`Po „${clause}” oczekiwano „=” albo IN (…), jest „${token.v}”.`);
  };
  const value = (clause: string) => {
    const token = next(`wartości po ${clause}`);
    if (token.t === 'sym') fail(`Po „${clause}” oczekiwano wartości, jest „${token.v}”.`);
    return token;
  };
  /** `= v` or `IN (v, w)`. */
  const choice = (clause: string, map: (v: string) => string = v => v): string[] => {
    if (word(peek()) === 'in') {
      pos += 1;
      sym('(', `lista wartości po ${clause} IN`);
      const items: string[] = [];
      for (;;) {
        items.push(map(value(clause).v));
        const token = next('„,” albo „)”');
        if (token.t === 'sym' && token.v === ')') break;
        if (token.t !== 'sym' || token.v !== ',') fail(`W liście IN oczekiwano „,” albo „)”, jest „${token.v}”.`);
        if (items.length >= MAX_VALUES) fail(`Lista IN może mieć najwyżej ${MAX_VALUES} wartości.`);
      }
      return [...new Set(items)];
    }
    eq(clause);
    return [map(value(clause).v)];
  };

  const query: FilaQuery = { project: null, conditions: [], archive: 'exclude', sort: null };
  const seen = new Set<string>();
  const once = (what: string) => { if (seen.has(what)) fail(`„${what}” może wystąpić w zapytaniu tylko raz.`); seen.add(what); };

  const clause = () => {
    const head = next('warunku');
    const name = head.t === 'word' ? fold(head.v) : '';
    if (!name) fail(`Oczekiwano nazwy filtru, jest „${head.v}”.`);
    switch (name) {
      case 'projekt': {
        once('projekt');
        if (kind === 'column') fail('Zapytanie kolumny dziedziczy projekt z sekcji: usuń „projekt”.');
        if (word(peek()) === 'in') fail(UNSUPPORTED_PROJECTS);
        eq('projekt');
        const token = value('projekt');
        if (token.t === 'word' && (token.v === '*' || ['wszystkie', 'all'].includes(fold(token.v)))) fail(UNSUPPORTED_PROJECTS);
        if (peek()?.t === 'sym' && peek()!.v === ',') fail(UNSUPPORTED_PROJECTS);
        if (!/^[A-Za-z]{4}$/.test(token.v)) fail('Klucz projektu to cztery litery, np. DESK.');
        query.project = token.v.toUpperCase();
        return;
      }
      case 'typ': query.conditions.push({ kind: 'type', any: choice('typ', typeKey) }); return;
      case 'stan': query.conditions.push({ kind: 'state', any: choice('stan') }); return;
      case 'modul': query.conditions.push({ kind: 'module', any: choice('moduł') }); return;
      case 'tag': case 'tagi': query.conditions.push({ kind: 'tag', any: choice('tag') }); return;
      case 'otwarte': case 'zamkniete': {
        once('otwarte/zamknięte');
        query.conditions.push({ kind: 'closed', value: name === 'zamkniete' });
        return;
      }
      case 'rodzic': {
        once('rodzic');
        const token = next('wartości po rodzic');
        const w = word(token);
        if (w === 'brak') query.conditions.push({ kind: 'parent', is: 'none' });
        else if (w === 'istnieje') query.conditions.push({ kind: 'parent', is: 'any' });
        else if (token.t === 'sym' && token.v === '=') {
          const id = value('rodzic').v;
          if (!/^[A-Za-z]{4}-[1-9][0-9]*$/.test(id)) fail('Rodzic to ID wątku, np. DESK-12 (albo: rodzic brak, rodzic istnieje).');
          query.conditions.push({ kind: 'parent', is: id.toUpperCase() });
        } else fail('Po „rodzic” oczekiwano: brak, istnieje albo = ID wątku.');
        return;
      }
      case 'archiwum': {
        once('archiwum');
        if (kind === 'column') fail('Zapytanie kolumny dziedziczy archiwum z sekcji: usuń „archiwum”.');
        eq('archiwum');
        const w = fold(value('archiwum').v);
        if (w === 'wyklucz') query.archive = 'exclude';
        else if (w === 'wlacz') query.archive = 'include';
        else if (w === 'tylko') query.archive = 'only';
        else fail('Archiwum: wyklucz, włącz albo tylko.');
        return;
      }
      case 'pole': {
        sym('(', 'nazwa pola w nawiasie, np. pole("Koszt")');
        const field = next('nazwa pola');
        if (field.t === 'sym') fail('Nazwa pola ma być w cudzysłowie: pole("Koszt").');
        sym(')', 'zamknięcie nazwy pola');
        const w = word(peek());
        if (w === 'istnieje' || w === 'brak') { pos += 1; query.conditions.push({ kind: 'field', name: field.v, test: w === 'brak' ? 'missing' : 'exists' }); return; }
        if (w === 'in') fail('Pole porównuje się jedną wartością (=), istnieje albo brak.');
        eq(`pole("${field.v}")`);
        const token = value(`pole("${field.v}")`);
        const bare = token.t === 'word' ? fold(token.v) : '';
        const typed: FilaQueryValue = token.t === 'str' ? token.v
          : ['tak', 'true'].includes(bare) ? true : ['nie', 'false'].includes(bare) ? false
            : /^-?\d+(\.\d+)?$/.test(token.v) ? Number(token.v) : token.v;
        query.conditions.push({ kind: 'field', name: field.v, test: 'eq', value: typed });
        return;
      }
      case 'kiedy': case 'termin': case 'data': case 'zablokowane': fail(UNSUPPORTED_DATES);
      // fallthrough is impossible: fail throws
      default:
        fail(`Nieznany filtr „${head.v}”. Dostępne: projekt, typ, stan, moduł, tag, pole("…"), otwarte, zamknięte, rodzic, archiwum, SORTUJ.`);
    }
  };

  const sort = () => {
    once('SORTUJ');
    const keys: FilaSortKey[] = [];
    for (;;) {
      const token = next('klucza sortowania');
      const w = word(token);
      const key = w === 'stan' ? 'state' : w === 'tytul' ? 'title' : w === 'id' ? 'id' : undefined;
      if (!key) return fail('Sortować można po: stan (kolejność w workflow), tytuł, id.');
      if (keys.some(k => k.key === key)) fail(`Klucz sortowania „${token.v}” powtórzony.`);
      let desc = false;
      const dir = word(peek());
      if (dir === 'rosnaco' || dir === 'malejaco') { desc = dir === 'malejaco'; pos += 1; }
      keys.push({ key, desc });
      if (keys.length > MAX_SORT) fail(`Sortowanie ma najwyżej ${MAX_SORT} klucze.`);
      if (peek()?.t === 'sym' && peek()!.v === ',') { pos += 1; continue; }
      break;
    }
    query.sort = keys;
  };

  if (tokens.length === 0) return query;
  for (;;) {
    if (word(peek()) === 'sortuj') { pos += 1; sort(); break; }
    clause();
    const token = peek();
    if (!token) break;
    const w = word(token);
    if (w === 'and' || w === 'i') {
      pos += 1;
      if (!peek()) fail('Po AND brakuje warunku.');
      continue;
    }
    if (w === 'sortuj') { pos += 1; sort(); break; }
    if (token.t === 'sym' && token.v === ',') fail('Kilka wartości zapisz jako IN (a, b); warunki łączy AND.');
    fail(`Oczekiwano AND albo SORTUJ, jest „${token.v}”.`);
  }
  if (pos < tokens.length) fail(`Nieoczekiwane „${tokens[pos]!.v}” na końcu zapytania.`);
  return query;
}

const quote = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
const literal = (v: FilaQueryValue) => typeof v === 'string' ? quote(v) : typeof v === 'boolean' ? (v ? 'tak' : 'nie') : String(v);
const choiceText = (name: string, items: string[], map: (v: string) => string) => items.length === 1 ? `${name} = ${map(items[0]!)}` : `${name} IN (${items.map(map).join(', ')})`;

/** The canonical text of a query; `parseFilaQuery(formatFilaQuery(q))` gives `q` back. */
export function formatFilaQuery(query: FilaQuery): string {
  const parts: string[] = [];
  if (query.project) parts.push(`projekt = ${query.project}`);
  for (const c of query.conditions) {
    switch (c.kind) {
      case 'type': parts.push(choiceText('typ', c.any, v => v)); break;
      case 'state': parts.push(choiceText('stan', c.any, quote)); break;
      case 'module': parts.push(choiceText('moduł', c.any, quote)); break;
      case 'tag': parts.push(choiceText('tag', c.any, quote)); break;
      case 'closed': parts.push(c.value ? 'zamknięte' : 'otwarte'); break;
      case 'parent': parts.push(c.is === 'none' ? 'rodzic brak' : c.is === 'any' ? 'rodzic istnieje' : `rodzic = ${c.is}`); break;
      case 'field': parts.push(`pole(${quote(c.name)}) ${c.test === 'exists' ? 'istnieje' : c.test === 'missing' ? 'brak' : `= ${literal(c.value!)}`}`); break;
    }
  }
  if (query.archive !== 'exclude') parts.push(`archiwum = ${query.archive === 'include' ? 'włącz' : 'tylko'}`);
  let text = parts.join(' AND ');
  if (query.sort) {
    const names = { state: 'stan', title: 'tytuł', id: 'id' } as const;
    text += `${text ? ' ' : ''}SORTUJ ${query.sort.map(k => `${names[k.key]}${k.desc ? ' malejąco' : ''}`).join(', ')}`;
  }
  return text;
}
