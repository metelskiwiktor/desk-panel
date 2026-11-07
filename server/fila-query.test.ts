// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { FilaAction } from '../src/fila-contract';
import { formatFilaQuery, parseFilaQuery } from '../src/fila-query';
import { createFilaStore, FilaError, type FilaStore } from './fila';

const act = (store: FilaStore, action: FilaAction) => store.apply(action, 'claude-code');
const ids = async (store: FilaStore, text: string) => (await store.query(text)).threads.map(t => t.id);
const refused = async (promise: Promise<unknown>, text: RegExp) => {
  const error = await promise.then(() => null, e => e);
  expect(error).toBeInstanceOf(FilaError);
  expect(error.status).toBe(400);
  expect(error.message).toMatch(text);
};

/** DESK-1..4 (the last archived) and CEZA-1, with a field of every kind. */
async function seeded() {
  const store = createFilaStore();
  await act(store, { action: 'createProject', key: 'DESK', name: 'DeskPanel' });
  await act(store, { action: 'createProject', key: 'CEZA', name: 'Cezar' });
  await act(store, { action: 'setModules', project: 'DESK', modules: ['Wektor', 'Bank'] });
  await act(store, { action: 'createThread', project: 'DESK', type: 'funkcja', title: 'Beta', module: 'Wektor' });
  await act(store, { action: 'createThread', project: 'DESK', type: 'blad', title: 'alfa', parent: 'DESK-1' });
  await act(store, { action: 'createThread', project: 'DESK', type: 'sprawa', title: 'Gamma' });
  await act(store, { action: 'createThread', project: 'DESK', type: 'notatka', title: 'Delta' });
  await act(store, { action: 'createThread', project: 'CEZA', type: 'sprawa', title: 'Obca' });
  await act(store, { action: 'updateThread', thread: 'DESK-2', state: 'W realizacji' });
  await act(store, { action: 'updateThread', thread: 'DESK-3', state: 'Zakończone' });
  await act(store, { action: 'setField', thread: 'DESK-1', field: 'Tagi', value: ['a'] });
  await act(store, { action: 'setField', thread: 'DESK-2', field: 'Tagi', value: ['a', 'b'] });
  await act(store, { action: 'setField', thread: 'DESK-1', field: 'Koszt', value: 3, kind: 'number' });
  await act(store, { action: 'setField', thread: 'DESK-3', field: 'Etykieta', value: 'x', kind: 'text' });
  await act(store, { action: 'setField', thread: 'DESK-3', field: 'Przegląd', value: '2026-11-07', kind: 'date' });
  await act(store, { action: 'setField', thread: 'DESK-2', field: 'Pilne', value: true, kind: 'bool' });
  await act(store, { action: 'setField', thread: 'DESK-1', field: 'Pilne', value: false });
  await act(store, { action: 'archiveThread', thread: 'DESK-4' });
  return store;
}

describe('the query text', () => {
  it('parses to a structure and formats back to the same canonical text', () => {
    const text = 'projekt = DESK AND typ IN (funkcja, blad) AND stan = "W realizacji" AND moduł = "Wektor" AND tag = "a" AND pole("Koszt") = 3 AND pole("Etykieta") istnieje AND pole("Pilne") = tak AND zamknięte AND rodzic = DESK-1 AND archiwum = włącz SORTUJ stan malejąco, tytuł, id';
    const parsed = parseFilaQuery(text, 'section');
    expect(parsed).toMatchObject({ project: 'DESK', archive: 'include', sort: [{ key: 'state', desc: true }, { key: 'title', desc: false }, { key: 'id', desc: false }] });
    expect(formatFilaQuery(parsed)).toBe(text);
    // Without diacritics, in any case, with a Polish "i" for AND: the same query.
    expect(parseFilaQuery('PROJEKT=desk i typ = Błąd i zamkniete sortuj tytul malejaco', 'section'))
      .toEqual(parseFilaQuery('projekt = DESK AND typ = blad AND zamknięte SORTUJ tytuł malejąco', 'section'));
    expect(parseFilaQuery('', 'column')).toEqual({ project: null, conditions: [], archive: 'exclude', sort: null });
    expect(parseFilaQuery('stan = "a \\"b\\""', 'column').conditions).toEqual([{ kind: 'state', any: ['a "b"'] }]);
  });

  it('refuses text that is not a query, and what stage 1 does not offer, with a reason', async () => {
    const store = await seeded();
    await refused(store.query(''), /musi wskazywać projekt/);
    await refused(store.query('typ = funkcja'), /musi wskazywać projekt/);
    await refused(store.query('projekt = NOPE'), /Nie ma projektu NOPE/);
    await refused(store.query('projekt = DESK AND'), /brakuje warunku/);
    await refused(store.query('projekt = DESK typ = funkcja'), /Oczekiwano AND/);
    await refused(store.query('projekt = DESK AND projekt = CEZA'), /tylko raz/);
    await refused(store.query('projekt = DESK AND kolor = zielony'), /Nieznany filtr/);
    await refused(store.query('projekt = DESK AND typ = zadanie'), /Nieznany typ/);
    await refused(store.query('projekt = DESK AND stan = "bez cudzysłowu'), /cudzysłowu/);
    await refused(store.query('projekt = DESK AND archiwum = kiedyś'), /Archiwum/);
    await refused(store.query('projekt = DESK SORTUJ kolor'), /Sortować można/);
    // Not in stage 1: several or all projects, dates and deadlines.
    await refused(store.query('projekt IN (DESK, CEZA)'), /kilka lub wszystkie projekty/);
    await refused(store.query('projekt = *'), /kilka lub wszystkie projekty/);
    await refused(store.query('projekt = wszystkie'), /kilka lub wszystkie projekty/);
    await refused(store.query('projekt = DESK, CEZA'), /kilka lub wszystkie projekty/);
    await refused(store.query('projekt = DESK AND kiedy = jutro'), /dat i terminów/);
    await refused(store.query('projekt = DESK AND pole("Termin") = "2026-01-01"'), /nie jest dostępne/);
    await refused(store.query('projekt = DESK AND pole("Przegląd") < "2026-12-01"'), /Operator „<”/);
    await refused(store.query('projekt = DESK AND pole("Stan") = x'), /nie jest polem własnym/);
    // A column inherits the project; a column or section is checked by the same text without a run.
    await refused(store.check('projekt = DESK', 'column'), /dziedziczy projekt/);
    await refused(store.check('archiwum = tylko', 'column'), /dziedziczy archiwum/);
    expect((await store.check('stan = "Pomysł" SORTUJ id', 'column')).text).toBe('stan = "Pomysł" SORTUJ id');
    expect(await store.check('  Projekt=desk  AND OTWARTE', 'section')).toMatchObject({ text: 'projekt = DESK AND otwarte' });
  });
});

describe('running a query', () => {
  it('answers every filter inside the one project, archive excluded unless asked for', async () => {
    const store = await seeded();
    expect(await ids(store, 'projekt = DESK')).toEqual(['DESK-1', 'DESK-2', 'DESK-3']);
    expect(await ids(store, 'projekt = CEZA')).toEqual(['CEZA-1']);
    expect(await ids(store, 'projekt = DESK AND archiwum = włącz')).toEqual(['DESK-1', 'DESK-2', 'DESK-3', 'DESK-4']);
    expect(await ids(store, 'projekt = DESK AND archiwum = tylko')).toEqual(['DESK-4']);
    expect(await ids(store, 'projekt = DESK AND typ = funkcja')).toEqual(['DESK-1']);
    expect(await ids(store, 'projekt = DESK AND typ IN (Błąd, sprawa)')).toEqual(['DESK-2', 'DESK-3']);
    expect(await ids(store, 'projekt = DESK AND tag = a')).toEqual(['DESK-1', 'DESK-2']);
    expect(await ids(store, 'projekt = DESK AND tag = a AND tag = b')).toEqual(['DESK-2']);
    expect(await ids(store, 'projekt = DESK AND tag IN (b, zzz)')).toEqual(['DESK-2']);
    expect(await ids(store, 'projekt = DESK AND stan = "w realizacji"')).toEqual(['DESK-2']);
    expect(await ids(store, 'projekt = DESK AND stan IN (Pomysł, Zakończone)')).toEqual(['DESK-1', 'DESK-3']);
    expect(await ids(store, 'projekt = DESK AND moduł = Wektor')).toEqual(['DESK-1']);
    expect(await ids(store, 'projekt = DESK AND otwarte')).toEqual(['DESK-1', 'DESK-2']);
    expect(await ids(store, 'projekt = DESK AND zamknięte')).toEqual(['DESK-3']);
    expect(await ids(store, 'projekt = DESK AND rodzic brak')).toEqual(['DESK-1', 'DESK-3']);
    expect(await ids(store, 'projekt = DESK AND rodzic istnieje')).toEqual(['DESK-2']);
    expect(await ids(store, 'projekt = DESK AND rodzic = desk-1')).toEqual(['DESK-2']);
    expect(await ids(store, 'projekt = DESK AND rodzic = CEZA-1')).toEqual([]);
  });

  it('asks about fields of every kind: existence and value; a known field with another value finds nothing', async () => {
    const store = await seeded();
    expect(await ids(store, 'projekt = DESK AND pole("koszt") istnieje')).toEqual(['DESK-1']);
    expect(await ids(store, 'projekt = DESK AND pole("Koszt") brak')).toEqual(['DESK-2', 'DESK-3']);
    expect(await ids(store, 'projekt = DESK AND pole("Koszt") = 3')).toEqual(['DESK-1']);
    expect(await ids(store, 'projekt = DESK AND pole("Koszt") = 4')).toEqual([]);
    expect(await ids(store, 'projekt = DESK AND pole("Etykieta") = "x"')).toEqual(['DESK-3']);
    expect(await ids(store, 'projekt = DESK AND pole("Etykieta") = "y"')).toEqual([]);
    expect(await ids(store, 'projekt = DESK AND pole("Przegląd") = 2026-11-07')).toEqual(['DESK-3']);
    expect(await ids(store, 'projekt = DESK AND pole("Pilne") = tak')).toEqual(['DESK-2']);
    expect(await ids(store, 'projekt = DESK AND pole("Pilne") = nie')).toEqual(['DESK-1']);
    expect(await ids(store, 'projekt = DESK AND pole("Tagi") = "b"')).toEqual(['DESK-2']);
    // Empty is not there: DESK-3 has Tagi [] and no value.
    expect(await ids(store, 'projekt = DESK AND pole("Tagi") brak')).toEqual(['DESK-3']);
    // A state no workflow has, a module the project lacks, a tag nobody uses: no hits, no error.
    expect(await ids(store, 'projekt = DESK AND stan = "Nie ma takiego"')).toEqual([]);
    expect(await ids(store, 'projekt = DESK AND moduł = Silnik')).toEqual([]);
    // An unknown definition or a value of the wrong kind is an error.
    await refused(store.query('projekt = DESK AND pole("Nie ma") = 1'), /Nie ma pola własnego/);
    await refused(store.query('projekt = DESK AND pole("Koszt") = "trzy"'), /to liczba/);
    await refused(store.query('projekt = DESK AND pole("Etykieta") = 3'), /w cudzysłowie/);
    await refused(store.query('projekt = DESK AND pole("Pilne") = 1'), /tak\/nie/);
    await refused(store.query('projekt = DESK AND pole("Przegląd") = "jutro"'), /RRRR-MM-DD/);
  });

  it('sorts by the order of the state in the workflow, by title or by ID, with ties by ID, and pages the result', async () => {
    const store = await seeded();
    expect(await ids(store, 'projekt = DESK SORTUJ stan')).toEqual(['DESK-1', 'DESK-2', 'DESK-3']);
    expect(await ids(store, 'projekt = DESK SORTUJ stan malejąco')).toEqual(['DESK-3', 'DESK-2', 'DESK-1']);
    expect(await ids(store, 'projekt = DESK SORTUJ tytuł')).toEqual(['DESK-2', 'DESK-1', 'DESK-3']); // alfa, Beta, Gamma
    expect(await ids(store, 'projekt = DESK SORTUJ id malejąco')).toEqual(['DESK-3', 'DESK-2', 'DESK-1']);
    await act(store, { action: 'updateThread', thread: 'DESK-3', state: 'Pomysł' });
    expect(await ids(store, 'projekt = DESK SORTUJ stan malejąco, tytuł')).toEqual(['DESK-2', 'DESK-1', 'DESK-3']);
    expect(await ids(store, 'projekt = DESK SORTUJ stan')).toEqual(['DESK-1', 'DESK-3', 'DESK-2']); // ties by ID
    const page = await store.query('projekt = DESK', { limit: 1, offset: 1 });
    expect(page).toMatchObject({ total: 3, project: 'DESK', query: 'projekt = DESK' });
    expect(page.threads.map(t => t.id)).toEqual(['DESK-2']);
  });
});
