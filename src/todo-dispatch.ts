import { TODO_STATUSES, type TodoTask } from './todo-contract';

/**
 * The labelled sections a prepared task may carry. Only the required ones matter for readiness; the rest are boundaries,
 * so a label inside one section does not swallow the next (old WYKONAWCA/REPO/TRYB never set the task's fields).
 */
const TODO_SPEC_SECTIONS = ['CEL', 'ZAKRES', 'POZA ZAKRESEM', 'DECYZJE', 'WARUNKI ODBIORU', 'WYKONAWCA', 'REPO', 'TRYB', 'ZAŁĄCZNIKI', 'TYP ZMIANY', 'ZRZUTY'] as const;
const TODO_REQUIRED_SECTIONS = ['CEL', 'ZAKRES', 'POZA ZAKRESEM', 'WARUNKI ODBIORU'] as const;

interface TodoDispatch {
  missing: string[];
  prompt: string | null;
  workflow: 'analysis' | 'desk-panel-task' | null;
  project: 'desk-panel';
  specRevision: number;
}

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
      if (match && match[1][0] === fence.char && match[1].length >= fence.length && match[2].trim() === '') fence = null;
      content?.push(line);
      continue;
    }
    if (match) {
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

/**
 * Whether the task can be handed to an executor, without a model in the path: the fields must be chosen, the status ready
 * and the Markdown must carry the required labelled sections. Nothing is written or started here; the prompt is only
 * composed when there is no lack.
 */
export function getTodoDispatch(todo: TodoTask): TodoDispatch {
  const missing: string[] = [];
  if (todo.status !== 'gotowe') missing.push(`Zadanie musi mieć stan „Gotowe do realizacji (gotowe)”, a ma „${TODO_STATUSES[todo.status]} (${todo.status})”.`);
  if (todo.blocked !== null && todo.blocked !== '') missing.push(`Zadanie ma aktywną blokadę: ${todo.blocked}.`);
  if (todo.executor !== 'cezar') missing.push(todo.executor === null ? 'Brak wykonawcy (executor = cezar).' : `Wykonawca (executor) to „${todo.executor}”, a gotowość wymaga „cezar”.`);
  if (todo.repo !== 'desk-panel') missing.push(todo.repo === null ? 'Brak repozytorium (repo = desk-panel).' : `Repozytorium (repo) to „${todo.repo}”, a gotowość wymaga „desk-panel”.`);
  if (todo.mode === null) missing.push('Brak trybu (mode = analiza albo implementacja).');
  if (todo.spec.trim() === '') missing.push('Brak specyfikacji.');
  const sections = readSections(todo.spec);
  for (const label of TODO_REQUIRED_SECTIONS) {
    const occurrences = sections.get(label) ?? [];
    if (occurrences.length === 0) missing.push(`Brak wymaganej sekcji ${label}:`);
    else if (occurrences.length > 1) missing.push(`Powtórzona wymagana sekcja ${label}:`);
    else if (occurrences[0].join('\n').trim() === '') missing.push(`Pusta wymagana sekcja ${label}:`);
  }
  const ready = missing.length === 0;
  const workflow = ready ? (todo.mode === 'analiza' ? 'analysis' : 'desk-panel-task') : null;
  const prompt = ready
    ? ['Przygotowane zadanie Desk Panel', `Tytuł: ${todo.title}`, `Zadanie: ${todo.id}`, `Rewizja specyfikacji: ${todo.specRevision}`, '', todo.spec].join('\n')
    : null;
  return { missing, prompt, workflow, project: 'desk-panel', specRevision: todo.specRevision };
}
