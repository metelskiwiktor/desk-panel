import { FILA_RESERVED_FIELDS, type FilaData, type FilaFieldKind, type FilaThread } from '../src/fila-contract';
import { FilaQueryError, formatFilaQuery, parseFilaQuery, type FilaCondition, type FilaQuery, type FilaQueryKind } from '../src/fila-query';
import { FilaError } from './fila-error';

const lower = (s: string) => s.toLocaleLowerCase('pl');
const reserved = new Set<string>(FILA_RESERVED_FIELDS);
/** Not available in stage 1: dates, deadlines (Q-016) and the properties of later stages. */
const later = new Set(['kiedy', 'termin', 'implementacja cezara', 'specyfikacja']);

const kindName: Record<FilaFieldKind, string> = { text: 'tekst', number: 'liczba', date: 'data', bool: 'tak/nie', multi: 'wiele wartości' };

/** Checks a parsed query against the data and writes the names as the data spell them. Anything unknown or unfit is a 400. */
function bind(query: FilaQuery, data: FilaData, kind: FilaQueryKind): FilaQuery {
  if (kind === 'section') {
    if (!query.project) throw new FilaQueryError('Zapytanie sekcji musi wskazywać projekt: projekt = KLUCZ.');
    if (!data.projects.some(p => p.key === query.project)) throw new FilaQueryError(`Nie ma projektu ${query.project}.`);
  }
  const conditions = query.conditions.map((c): FilaCondition => {
    if (c.kind !== 'field') return c;
    const key = lower(c.name);
    if (key === 'zablokowane') throw new FilaQueryError('„Zablokowane” nie jest polem własnym: użyj filtru zablokowane albo niezablokowane.');
    if (later.has(key)) throw new FilaQueryError(`„${c.name}” nie jest dostępne w zapytaniach w etapie 1.`);
    if (reserved.has(key)) throw new FilaQueryError(`„${c.name}” nie jest polem własnym: użyj filtrów stan, moduł, rodzic albo typ.`);
    const def = data.fieldDefs.find(d => lower(d.name) === key);
    if (!def) throw new FilaQueryError(`Nie ma pola własnego „${c.name}”.`);
    if (c.test === 'eq') {
      const v = c.value!;
      const fits = def.kind === 'number' ? typeof v === 'number'
        : def.kind === 'bool' ? typeof v === 'boolean'
          : def.kind === 'date' ? typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
            : typeof v === 'string';
      if (!fits) throw new FilaQueryError(`Pole „${def.name}” to ${kindName[def.kind]}: wartość ${JSON.stringify(v)} do niego nie pasuje${def.kind === 'text' || def.kind === 'multi' ? ' (tekst podaj w cudzysłowie)' : def.kind === 'date' ? ' (data to RRRR-MM-DD)' : ''}.`);
    }
    return { ...c, name: def.name };
  });
  return { ...query, conditions };
}

/** Text → a checked query, or a `FilaError` 400 with a sentence that says what to change. */
export function compileFilaQuery(text: string, data: FilaData, kind: FilaQueryKind): FilaQuery {
  try { return bind(parseFilaQuery(text, kind), data, kind); }
  catch (error) {
    if (error instanceof FilaQueryError) throw new FilaError(400, error.message);
    throw error;
  }
}
/** The canonical text of a checked query (what a section or column keeps). */
export const canonicalFilaQuery = (text: string, data: FilaData, kind: FilaQueryKind) => formatFilaQuery(compileFilaQuery(text, data, kind));

/** A column is the section's query AND its own; the column's order wins over the section's (D-029). */
export const narrowFilaQuery = (section: FilaQuery, column: FilaQuery): FilaQuery => ({
  project: section.project, conditions: [...section.conditions, ...column.conditions], archive: section.archive, sort: column.sort ?? section.sort,
});

const exists = (value: unknown) => value !== undefined && value !== '' && !(Array.isArray(value) && value.length === 0);
const idCompare = (a: FilaThread, b: FilaThread) => a.project.localeCompare(b.project) || a.number - b.number;

/** The threads a checked query selects, in the order it asks for (default and last tie-break: ID ascending). */
export function selectFilaThreads(data: FilaData, query: FilaQuery): FilaThread[] {
  const workflows = new Map(data.workflows.map(w => [w.id, w]));
  const closing = (t: FilaThread) => workflows.get(t.workflow)?.states.find(s => s.name === t.state)?.closing ?? false;
  const uids = new Map(data.threads.map(t => [t.uid, t]));
  const idOf = (t: FilaThread) => `${t.project}-${t.number}`;
  const matches = (t: FilaThread, c: FilaCondition): boolean => {
    switch (c.kind) {
      case 'type': return c.any.includes(t.type);
      case 'state': return c.any.some(v => lower(v) === lower(t.state));
      case 'module': return t.module !== null && c.any.some(v => lower(v) === lower(t.module!));
      case 'tag': { const tags = t.fields['Tagi']; return Array.isArray(tags) && tags.some(tag => c.any.some(v => lower(v) === lower(tag))); }
      case 'closed': return closing(t) === c.value;
      case 'blocked': return (t.blockers.length > 0) === c.value;
      case 'parent': {
        const parent = t.parent ? uids.get(t.parent) : undefined;
        return c.is === 'none' ? !t.parent : c.is === 'any' ? !!t.parent : !!parent && idOf(parent) === c.is;
      }
      case 'field': {
        const value = t.fields[c.name];
        if (c.test === 'exists') return exists(value);
        if (c.test === 'missing') return !exists(value);
        return Array.isArray(value) ? value.includes(c.value as string) : value === c.value;
      }
    }
  };
  const stateIndex = (t: FilaThread) => workflows.get(t.workflow)?.states.findIndex(s => s.name === t.state) ?? -1;
  const keys = query.sort ?? [];
  const compare = (a: FilaThread, b: FilaThread) => {
    for (const { key, desc } of keys) {
      const order = key === 'state' ? stateIndex(a) - stateIndex(b)
        : key === 'title' ? a.title.localeCompare(b.title, 'pl', { sensitivity: 'base' })
          : idCompare(a, b);
      if (order) return desc ? -order : order;
    }
    return idCompare(a, b);
  };
  return data.threads
    .filter(t => t.project === query.project
      && (query.archive === 'include' || t.archived === (query.archive === 'only'))
      && query.conditions.every(c => matches(t, c)))
    .sort(compare);
}
