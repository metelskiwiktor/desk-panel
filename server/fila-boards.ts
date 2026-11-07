import { randomUUID } from 'node:crypto';
import { FILA_LIMITS, type FilaBoard, type FilaBoardAction, type FilaBoardActor, type FilaData, type FilaResult, type FilaSection, type FilaSectionInput } from '../src/fila-contract';
import { FilaError } from './fila-error';
import { canonicalFilaQuery } from './fila-query';

type View = FilaBoard['views'][number];
type Column = FilaSection['columns'][number];
type Entry = FilaBoard['history'][number];

const usedIds = (data: FilaData) => {
  const ids = new Set<string>();
  for (const b of data.boards) { ids.add(b.id); for (const v of b.views) { ids.add(v.id); for (const s of v.sections) { ids.add(s.id); for (const c of s.columns) ids.add(c.id); } } }
  return ids;
};
/** An id no board, view, section or column of the data has; `reserve` are ids already handed out but not stored yet. */
const freshId = (data: FilaData, prefix: 'b' | 'v' | 's' | 'c', reserve: string[] = []) => {
  const ids = usedIds(data);
  for (;;) { const id = `${prefix}-${randomUUID().slice(0, 8)}`; if (!ids.has(id) && !reserve.includes(id)) return id; }
};
const nowhere = (what: string, id: string) => new FilaError(404, `Nie ma ${what} ${id}.`);
const placeNew = (length: number, at: number | undefined, label: string): number => {
  if (at === undefined) return length;
  if (at > length) throw new FilaError(409, `Pozycja ${at} jest poza zakresem: ${label} jest ${length}, liczone od 0.`);
  return at;
};
const placeOld = (length: number, at: number) => {
  if (at >= length) throw new FilaError(409, `Pozycja ${at} jest poza zakresem (0–${length - 1}).`);
  return at;
};

/** The ids a new section and its columns get, all different from each other and from everything stored. */
function buildSection(data: FilaData, input: FilaSectionInput): FilaSection {
  if (input.kind === 'list' && input.columns?.length) throw new FilaError(400, 'Sekcja listy nie ma kolumn: kolumny ma tylko kanban.');
  const section: FilaSection = {
    id: freshId(data, 's'), name: input.name, kind: input.kind, query: canonicalFilaQuery(input.query, data, 'section'),
    columns: [],
  };
  const reserve = [section.id];
  for (const column of input.columns ?? []) {
    const id = freshId(data, 'c', reserve);
    reserve.push(id);
    section.columns.push({ id, name: column.name, query: canonicalFilaQuery(column.query, data, 'column') });
  }
  return section;
}

/** The board a project gets: one view with one list section choosing the whole project, closed threads included (D-019). */
export function createStarterBoard(data: FilaData, projectKey: string, by: FilaBoardActor, at: number) {
  const project = data.projects.find(p => p.key === projectKey)!;
  const query = `projekt = ${project.key}`;
  const section: FilaSection = { id: freshId(data, 's'), name: 'Wszystkie wątki', kind: 'list', query, columns: [] };
  const view: View = { id: freshId(data, 'v'), name: 'Widok', sections: [section] };
  const board: FilaBoard = {
    id: freshId(data, 'b'), name: project.name, createdAt: at, views: [view],
    history: [
      { at, by, kind: 'created', target: 'board', name: project.name },
      { at, by, kind: 'created', target: 'view', name: view.name },
      { at, by, kind: 'created', target: 'section', name: section.name, in: view.name, changes: [{ field: 'Zapytanie', from: null, to: query }] },
    ],
  };
  data.boards.push(board);
  data.starterBoards[project.key] = board.id;
}

/** Gives every project that never had a starter board one, once (also the projects from before 1.2); true when it changed anything. */
export function seedStarterBoards(data: FilaData, at: number): boolean {
  const missing = data.projects.filter(p => !data.starterBoards[p.key]);
  for (const project of missing) createStarterBoard(data, project.key, 'panel', at);
  return missing.length > 0;
}

export function applyBoardAction(data: FilaData, action: FilaBoardAction, by: FilaBoardActor, at: number): FilaResult {
  const board = (id: string) => data.boards.find(b => b.id === id) ?? (() => { throw nowhere('tablicy', id); })();
  const viewOf = (id: string) => {
    for (const b of data.boards) { const v = b.views.find(x => x.id === id); if (v) return { board: b, view: v }; }
    throw nowhere('widoku', id);
  };
  const sectionOf = (id: string) => {
    for (const b of data.boards) for (const v of b.views) { const s = v.sections.find(x => x.id === id); if (s) return { board: b, view: v, section: s }; }
    throw nowhere('sekcji', id);
  };
  const columnOf = (id: string) => {
    for (const b of data.boards) for (const v of b.views) for (const s of v.sections) { const c = s.columns.find(x => x.id === id); if (c) return { board: b, section: s, column: c }; }
    throw nowhere('kolumny', id);
  };
  const log = (b: FilaBoard, entry: Omit<Entry, 'at' | 'by'>) => { b.history.push({ at, by, ...entry }); };
  const sectionCreated = (b: FilaBoard, v: View, s: FilaSection) => {
    log(b, { kind: 'created', target: 'section', name: s.name, in: v.name, changes: [{ field: 'Zapytanie', from: null, to: s.query }] });
    for (const c of s.columns) log(b, { kind: 'created', target: 'column', name: c.name, in: s.name, changes: [{ field: 'Zapytanie', from: null, to: c.query }] });
  };
  /** Moves `item` to index `to` and says so in the history (nothing when it stays). */
  const move = <T>(b: FilaBoard, items: T[], item: T, to: number, target: Entry['target'], name: string, inside?: string) => {
    const from = items.indexOf(item);
    placeOld(items.length, to);
    if (from === to) return;
    items.splice(from, 1);
    items.splice(to, 0, item);
    log(b, { kind: 'moved', target, name, ...(inside ? { in: inside } : {}), changes: [{ field: 'Pozycja', from: String(from + 1), to: String(to + 1) }] });
  };

  switch (action.action) {
    case 'createBoard': {
      if (data.boards.length >= FILA_LIMITS.boards) throw new FilaError(409, `Może być najwyżej ${FILA_LIMITS.boards} tablic.`);
      const section = buildSection(data, action.section);
      const view: View = { id: freshId(data, 'v'), name: action.view ?? 'Widok', sections: [section] };
      const created: FilaBoard = { id: freshId(data, 'b'), name: action.name, createdAt: at, views: [view], history: [] };
      data.boards.push(created);
      log(created, { kind: 'created', target: 'board', name: created.name });
      log(created, { kind: 'created', target: 'view', name: view.name });
      sectionCreated(created, view, section);
      return { ok: true, board: created.id, view: view.id, section: section.id };
    }
    case 'renameBoard': {
      const b = board(action.board);
      if (b.name !== action.name) { log(b, { kind: 'renamed', target: 'board', name: action.name, changes: [{ field: 'Nazwa', from: b.name, to: action.name }] }); b.name = action.name; }
      return { ok: true, board: b.id };
    }
    case 'deleteBoard': {
      const b = board(action.board);
      // The record in starterBoards stays: a deleted starter board is not made again.
      data.boards.splice(data.boards.indexOf(b), 1);
      return { ok: true, board: b.id };
    }
    case 'createView': {
      const b = board(action.board);
      if (b.views.length >= FILA_LIMITS.views) throw new FilaError(409, `Tablica może mieć najwyżej ${FILA_LIMITS.views} widoków.`);
      const to = placeNew(b.views.length, action.position, 'widoków');
      const section = buildSection(data, action.section);
      const view: View = { id: freshId(data, 'v'), name: action.name, sections: [section] };
      b.views.splice(to, 0, view);
      log(b, { kind: 'created', target: 'view', name: view.name });
      sectionCreated(b, view, section);
      return { ok: true, board: b.id, view: view.id, section: section.id };
    }
    case 'renameView': {
      const { board: b, view } = viewOf(action.view);
      if (view.name !== action.name) { log(b, { kind: 'renamed', target: 'view', name: action.name, changes: [{ field: 'Nazwa', from: view.name, to: action.name }] }); view.name = action.name; }
      return { ok: true, board: b.id, view: view.id };
    }
    case 'moveView': {
      const { board: b, view } = viewOf(action.view);
      move(b, b.views, view, action.position, 'view', view.name);
      return { ok: true, board: b.id, view: view.id };
    }
    case 'deleteView': {
      const { board: b, view } = viewOf(action.view);
      if (b.views.length === 1) throw new FilaError(409, 'Tablica musi mieć co najmniej jeden widok: ostatniego nie usuwamy.');
      b.views.splice(b.views.indexOf(view), 1);
      log(b, { kind: 'removed', target: 'view', name: view.name });
      return { ok: true, board: b.id, view: view.id };
    }
    case 'createSection': {
      const { board: b, view } = viewOf(action.view);
      if (view.sections.length >= FILA_LIMITS.sections) throw new FilaError(409, `Widok może mieć najwyżej ${FILA_LIMITS.sections} sekcji.`);
      const to = placeNew(view.sections.length, action.position, 'sekcji');
      const section = buildSection(data, action.section);
      view.sections.splice(to, 0, section);
      sectionCreated(b, view, section);
      return { ok: true, board: b.id, view: view.id, section: section.id };
    }
    case 'updateSection': {
      const { board: b, view, section } = sectionOf(action.section);
      const query = action.query === undefined ? undefined : canonicalFilaQuery(action.query, data, 'section');
      if (action.name !== undefined && action.name !== section.name) {
        log(b, { kind: 'renamed', target: 'section', name: action.name, in: view.name, changes: [{ field: 'Nazwa', from: section.name, to: action.name }] });
        section.name = action.name;
      }
      if (query !== undefined && query !== section.query) {
        log(b, { kind: 'changed', target: 'section', name: section.name, in: view.name, changes: [{ field: 'Zapytanie', from: section.query, to: query }] });
        section.query = query;
      }
      return { ok: true, board: b.id, view: view.id, section: section.id };
    }
    case 'moveSection': {
      const { board: b, view, section } = sectionOf(action.section);
      move(b, view.sections, section, action.position, 'section', section.name, view.name);
      return { ok: true, board: b.id, view: view.id, section: section.id };
    }
    case 'deleteSection': {
      const { board: b, view, section } = sectionOf(action.section);
      if (view.sections.length === 1) throw new FilaError(409, 'Widok musi mieć co najmniej jedną sekcję: ostatniej nie usuwamy.');
      view.sections.splice(view.sections.indexOf(section), 1);
      log(b, { kind: 'removed', target: 'section', name: section.name, in: view.name });
      return { ok: true, board: b.id, view: view.id, section: section.id };
    }
    case 'createColumn': {
      const { board: b, section } = sectionOf(action.section);
      if (section.kind !== 'kanban') throw new FilaError(409, 'Kolumny ma tylko sekcja kanbanu.');
      if (section.columns.length >= FILA_LIMITS.columns) throw new FilaError(409, `Sekcja może mieć najwyżej ${FILA_LIMITS.columns} kolumn.`);
      const to = placeNew(section.columns.length, action.position, 'kolumn');
      const column: Column = { id: freshId(data, 'c'), name: action.name, query: canonicalFilaQuery(action.query, data, 'column') };
      section.columns.splice(to, 0, column);
      log(b, { kind: 'created', target: 'column', name: column.name, in: section.name, changes: [{ field: 'Zapytanie', from: null, to: column.query }] });
      return { ok: true, board: b.id, section: section.id, column: column.id };
    }
    case 'updateColumn': {
      const { board: b, section, column } = columnOf(action.column);
      const query = action.query === undefined ? undefined : canonicalFilaQuery(action.query, data, 'column');
      if (action.name !== undefined && action.name !== column.name) {
        log(b, { kind: 'renamed', target: 'column', name: action.name, in: section.name, changes: [{ field: 'Nazwa', from: column.name, to: action.name }] });
        column.name = action.name;
      }
      if (query !== undefined && query !== column.query) {
        log(b, { kind: 'changed', target: 'column', name: column.name, in: section.name, changes: [{ field: 'Zapytanie', from: column.query, to: query }] });
        column.query = query;
      }
      return { ok: true, board: b.id, section: section.id, column: column.id };
    }
    case 'moveColumn': {
      const { board: b, section, column } = columnOf(action.column);
      move(b, section.columns, column, action.position, 'column', column.name, section.name);
      return { ok: true, board: b.id, section: section.id, column: column.id };
    }
    case 'deleteColumn': {
      const { board: b, section, column } = columnOf(action.column);
      section.columns.splice(section.columns.indexOf(column), 1);
      log(b, { kind: 'removed', target: 'column', name: column.name, in: section.name });
      return { ok: true, board: b.id, section: section.id, column: column.id };
    }
  }
}
