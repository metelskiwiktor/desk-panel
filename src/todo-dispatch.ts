import { TODO_STATUSES, type TodoTask } from './todo-contract';

/**
 * The labelled sections a prepared task may carry. Only the required ones matter for readiness; the rest are boundaries,
 * so a label inside one section does not swallow the next (old WYKONAWCA/REPO/TRYB never set the task's fields).
 */
const TODO_SPEC_SECTIONS = ['CEL', 'ZAKRES', 'POZA ZAKRESEM', 'DECYZJE', 'WARUNKI ODBIORU', 'WYKONAWCA', 'REPO', 'TRYB', 'ZAŁĄCZNIKI', 'TYP ZMIANY', 'ZRZUTY'] as const;
const TODO_REQUIRED_SECTIONS = ['CEL', 'ZAKRES', 'POZA ZAKRESEM', 'WARUNKI ODBIORU'] as const;

export interface TodoDispatch {
  missing: string[];
  prompt: string | null;
  workflow: 'analysis' | 'desk-panel-task' | null;
  project: 'desk-panel';
  specRevision: number;
}

/** The fields a dispatch may rely on: what the user saw in the preview, compared again on the server. */
export interface TodoDispatchExpected {
  specRevision: number;
  title: string;
  executor: TodoTask['executor'];
  repo: TodoTask['repo'];
  mode: TodoTask['mode'];
  status: TodoTask['status'];
  blocked: string | null;
}

export const todoDispatchExpected = (todo: TodoTask): TodoDispatchExpected => ({
  specRevision: todo.specRevision,
  title: todo.title,
  executor: todo.executor,
  repo: todo.repo,
  mode: todo.mode,
  status: todo.status,
  blocked: todo.blocked ?? null,
});

/** Whether the task still holds everything the preview was made from; identical polling changes nothing. */
export const todoDispatchMatches = (todo: TodoTask, expected: TodoDispatchExpected): boolean => {
  const current = todoDispatchExpected(todo);
  return current.specRevision === expected.specRevision && current.title === expected.title
    && current.executor === expected.executor && current.repo === expected.repo && current.mode === expected.mode
    && current.status === expected.status && current.blocked === expected.blocked;
};

/** The register key: one dispatch per to-do, revision and mode. */
export const todoDispatchKey = (todoId: string, specRevision: number, mode: string | null): string => `${todoId}|${specRevision}|${mode ?? ''}`;

const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

/** A header is the whole line from column 0: an uppercase label and a colon, with trailing spaces or tabs only. */
function headerLabel(line: string): string | null {
  const trimmed = line.replace(/[ \t]+$/, '');
  return TODO_SPEC_SECTIONS.find(label => trimmed === `${label}:`) ?? null;
}

/** Each label with every occurrence's lines; labels inside fenced code (closed or not) are ignored. */
function readSections(spec: string): Map<string, string[][]> {
  const text = spec.replace(/^\uFEFF/, '');
  const sections = new Map<string, string[][]>();
  let content: string[] | null = null;
  let fence: { char: string; length: number } | null = null;
  for (const raw of text.split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    const match = FENCE.exec(line);
    if (fence) {
      if (match && match[1][0] === fence.char && match[1].length >= fence.length && /^[ \t]*$/.test(match[2])) fence = null;
      content?.push(line);
      continue;
    }
    // CommonMark: a backtick fence cannot have a backtick in its info string.
    if (match && (match[1][0] !== '`' || !match[2].includes('`'))) {
      fence = { char: match[1][0], length: match[1].length };
      content?.push(line);
      continue;
    }
    const label = headerLabel(line);
    if (label !== null) {
      const occurrence: string[] = [];
      const occurrences = sections.get(label) ?? [];
      sections.set(label, occurrences);
      occurrences.push(occurrence);
      content = occurrence;
      continue;
    }
    content?.push(line);
  }
  return sections;
}

/** What C1 looks at, whichever store it comes from (a to-do task or a Fila thread): the same rules and messages for both. */
export interface DispatchInput {
  id: string; title: string; specRevision: number; spec: string;
  /** Whether the state is „Gotowe do realizacji” of the workflow Praca, and how to name the state when it is not. */
  ready: boolean; stateLabel: string;
  /** The sentence for a state that is not ready, when the caller's rule is not the lists' single state (Fila, 2.1). */
  notReady?: string;
  blocked: string | null; executor: TodoTask['executor']; repo: TodoTask['repo']; mode: TodoTask['mode'];
}

/**
 * Whether the work can be handed to an executor, without a model in the path: the fields must be chosen, the state ready
 * and the Markdown must carry the required labelled sections. Nothing is written or started here; the prompt is only
 * composed when there is no lack.
 */
export function evaluateDispatch(input: DispatchInput): TodoDispatch {
  const missing: string[] = [];
  if (!input.ready) missing.push(input.notReady ?? `Zadanie musi mieć stan „Gotowe do realizacji (gotowe)”, a ma „${input.stateLabel}”.`);
  if (input.blocked !== null && input.blocked !== '') missing.push(`Zadanie ma aktywną blokadę: ${input.blocked}.`);
  if (input.executor !== 'cezar') missing.push(input.executor === null ? 'Brak wykonawcy (executor = cezar).' : `Wykonawca (executor) to „${input.executor}”, a gotowość wymaga „cezar”.`);
  if (input.repo !== 'desk-panel') missing.push(input.repo === null ? 'Brak repozytorium (repo = desk-panel).' : `Repozytorium (repo) to „${input.repo}”, a gotowość wymaga „desk-panel”.`);
  if (input.mode === null) missing.push('Brak trybu (mode = analiza albo implementacja).');
  if (input.spec.trim() === '') missing.push('Brak specyfikacji.');
  const sections = readSections(input.spec);
  for (const label of TODO_REQUIRED_SECTIONS) {
    const occurrences = sections.get(label) ?? [];
    if (occurrences.length === 0) missing.push(`Brak wymaganej sekcji ${label}:`);
    else if (occurrences.length > 1) missing.push(`Powtórzona wymagana sekcja ${label}:`);
    else if (occurrences[0].join('\n').trim() === '') missing.push(`Pusta wymagana sekcja ${label}:`);
  }
  const ready = missing.length === 0;
  const workflow = ready ? (input.mode === 'analiza' ? 'analysis' : 'desk-panel-task') : null;
  const prompt = ready
    ? ['Przygotowane zadanie Desk Panel', `Tytuł: ${input.title}`, `Zadanie: ${input.id}`, `Rewizja specyfikacji: ${input.specRevision}`, '', input.spec].join('\n')
    : null;
  return { missing, prompt, workflow, project: 'desk-panel', specRevision: input.specRevision };
}

/** C1 for a to-do task. */
export const getTodoDispatch = (todo: TodoTask): TodoDispatch => evaluateDispatch({
  id: todo.id, title: todo.title, specRevision: todo.specRevision, spec: todo.spec,
  ready: todo.status === 'gotowe', stateLabel: `${TODO_STATUSES[todo.status]} (${todo.status})`,
  blocked: todo.blocked ?? null, executor: todo.executor, repo: todo.repo, mode: todo.mode,
});
