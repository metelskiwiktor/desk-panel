import { describe, expect, it } from 'vitest';
import type { TodoTask } from './todo-contract';
import { getTodoDispatch } from './todo-dispatch';

const task = (over: Partial<TodoTask> = {}): TodoTask => ({
  id: 't-00000001', title: 'Zadanie', note: '', done: false, createdAt: 1, completedAt: null, by: 'user',
  status: 'gotowe', blocked: null, links: [], history: [], spec: '', specRevision: 0, specRevisions: [],
  executor: 'cezar', repo: 'desk-panel', mode: 'implementacja', ...over,
});

const READY_SPEC = [
  'CEL:',
  'Zbudować widok gotowości.',
  '',
  'ZAKRES:',
  '- src/todo-dispatch.ts',
  '',
  'POZA ZAKRESEM:',
  'Nic więcej.',
  '',
  'WARUNKI ODBIORU:',
  '1. Testy przechodzą.',
].join('\n');

describe('getTodoDispatch: wymagania', () => {
  it('komplet pól i sekcji daje prompt bez modelu oraz workflow implementacji', () => {
    const result = getTodoDispatch(task({ spec: READY_SPEC, specRevision: 3 }));
    expect(result.missing).toEqual([]);
    expect(result.workflow).toBe('desk-panel-task');
    expect(result.project).toBe('desk-panel');
    expect(result.specRevision).toBe(3);
    expect(result.prompt).toBe(['Przygotowane zadanie Desk Panel', 'Tytuł: Zadanie', 'Zadanie: t-00000001', 'Rewizja specyfikacji: 3', '', READY_SPEC].join('\n'));
  });

  it('analiza mapuje się na wbudowany workflow analysis', () => {
    expect(getTodoDispatch(task({ spec: READY_SPEC, mode: 'analiza' }))).toMatchObject({ missing: [], workflow: 'analysis' });
  });

  it('braki pojawiają się w kolejności: stan, blokada, executor, repo, mode, pusty spec, wymagane sekcje', () => {
    const result = getTodoDispatch(task({ status: 'pomysl', blocked: 'Czekam na decyzję', executor: null, repo: null, mode: null, spec: '' }));
    expect(result.prompt).toBeNull();
    expect(result.workflow).toBeNull();
    expect(result.specRevision).toBe(0);
    expect(result.missing).toHaveLength(10);
    expect(result.missing[0]).toContain('Gotowe do realizacji');
    expect(result.missing[1]).toContain('aktywną blokadę: Czekam na decyzję');
    expect(result.missing[2]).toContain('executor = cezar');
    expect(result.missing[3]).toContain('repo = desk-panel');
    expect(result.missing[4]).toContain('mode');
    expect(result.missing[5]).toBe('Brak specyfikacji.');
    expect(result.missing.slice(6)).toEqual([
      'Brak wymaganej sekcji CEL:',
      'Brak wymaganej sekcji ZAKRES:',
      'Brak wymaganej sekcji POZA ZAKRESEM:',
      'Brak wymaganej sekcji WARUNKI ODBIORU:',
    ]);
  });

  it('sam pusty spec daje braki czterech wymaganych sekcji, a wybrany inny wykonawca jest brakiem', () => {
    const result = getTodoDispatch(task({ spec: '', executor: 'lokalnie', mode: 'analiza' }));
    expect(result.missing).toEqual([
      'Wykonawca (executor) to „lokalnie”, a gotowość wymaga „cezar”.',
      'Brak specyfikacji.',
      'Brak wymaganej sekcji CEL:',
      'Brak wymaganej sekcji ZAKRES:',
      'Brak wymaganej sekcji POZA ZAKRESEM:',
      'Brak wymaganej sekcji WARUNKI ODBIORU:',
    ]);
  });

  it('nie pisze niczego: zamrożone zadanie przechodzi bez wyjątku', () => {
    const frozen = Object.freeze(task({ spec: READY_SPEC }));
    expect(() => getTodoDispatch(frozen)).not.toThrow();
  });
});

describe('getTodoDispatch: gramatyka sekcji', () => {
  it('toleruje BOM, CRLF, końcowe spacje/taby i dowolną kolejność', () => {
    const spec = '\uFEFFWARUNKI ODBIORU:\t \r\n1. Test.\r\n\r\nCEL:\r\nCel.\r\n\r\nPOZA ZAKRESEM:\r\nNic.\r\n\r\nZAKRES:\r\nWszystko.\r\n';
    const result = getTodoDispatch(task({ spec }));
    expect(result.missing).toEqual([]);
    expect(result.prompt!.endsWith(spec)).toBe(true);
  });

  it('pusta treść i powtórzona wymagana sekcja to braki', () => {
    const spec = ['CEL:', '   ', '', 'ZAKRES:', 'x', '', 'ZAKRES:', 'y', '', 'POZA ZAKRESEM:', 'z', '', 'WARUNKI ODBIORU:', 'w'].join('\n');
    expect(getTodoDispatch(task({ spec })).missing).toEqual(['Pusta wymagana sekcja CEL:', 'Powtórzona wymagana sekcja ZAKRES:']);
  });

  it('etykiety w fenced code są ignorowane (backticki, tyldy i blok niedomknięty do końca)', () => {
    const fenced = ['```', 'CEL:', 'ZAKRES:', '```', 'POZA ZAKRESEM:', 'x', 'WARUNKI ODBIORU:', 'y'].join('\n');
    expect(getTodoDispatch(task({ spec: fenced })).missing).toEqual(['Brak wymaganej sekcji CEL:', 'Brak wymaganej sekcji ZAKRES:']);
    const tilde = ['~~~', 'CEL:', 'ZAKRES:', 'POZA ZAKRESEM:', 'WARUNKI ODBIORU:', 'treść w kodzie'].join('\n');
    expect(getTodoDispatch(task({ spec: tilde })).missing).toHaveLength(4);
    const closedTilde = ['~~~', 'CEL:', '~~~', 'ZAKRES:', 'x', 'POZA ZAKRESEM:', 'x', 'WARUNKI ODBIORU:', 'y'].join('\n');
    expect(getTodoDispatch(task({ spec: closedTilde })).missing).toEqual(['Brak wymaganej sekcji CEL:']);
  });

  it('nagłówek to cała linia od kolumny 0; # albo tekst w tej samej linii nie jest sekcją', () => {
    const spec = ['# CEL:', 'ZAKRES: to nie nagłówek', 'CEL: to też nie', 'ZAKRES:', 'x', 'POZA ZAKRESEM:', 'y', 'WARUNKI ODBIORU:', 'z'].join('\n');
    expect(getTodoDispatch(task({ spec }))).toMatchObject({ missing: ['Brak wymaganej sekcji CEL:'] });
  });

  it('treść kończy następna etykieta z listy, a stare WYKONAWCA/REPO/TRYB nie ustawiają pól', () => {
    const spec = ['CEL:', 'x', 'WYKONAWCA: cezar', 'REPO: desk-panel', 'TRYB: implementacja', 'ZAKRES:', 'y', 'POZA ZAKRESEM:', 'z', 'WARUNKI ODBIORU:', 'w'].join('\n');
    const result = getTodoDispatch(task({ spec, executor: null, repo: null, mode: null }));
    expect(result.missing).toEqual([
      'Brak wykonawcy (executor = cezar).',
      'Brak repozytorium (repo = desk-panel).',
      'Brak trybu (mode = analiza albo implementacja).',
    ]);
  });

  it('nie analizuje znaczenia treści: krótka treść sekcji wystarcza', () => {
    expect(getTodoDispatch(task({ spec: ['CEL:', 'a', 'ZAKRES:', 'b', 'POZA ZAKRESEM:', 'c', 'WARUNKI ODBIORU:', 'd'].join('\n') })).missing).toEqual([]);
  });
});

describe('getTodoDispatch: prompt', () => {
  it('przepisuje spec dosłownie: Unicode, białe znaki, polecenia i kod, bez trimowania i końcowego newline', () => {
    const spec = `${READY_SPEC}\n\nDECYZJE:\n- 2026-11-02 — zażółć 🚀 — źródło: użytkownik\n\nZAŁĄCZNIKI:\n- \`src/todo-dispatch.ts\`  \n\nTYP ZMIANY:\nType: UI\n\nZRZUTY:\nScenario: standard\nDevice: medialove-14`;
    const result = getTodoDispatch(task({ title: 'Tytuł z żółcią — pełny', id: 't-abcdef12', spec: `${spec}`, specRevision: 7 }));
    expect(result.prompt).toBe(['Przygotowane zadanie Desk Panel', 'Tytuł: Tytuł z żółcią — pełny', 'Zadanie: t-abcdef12', 'Rewizja specyfikacji: 7', '', spec].join('\n'));
    expect(result.prompt!.endsWith(spec)).toBe(true);
    expect(result.prompt!.endsWith('\n')).toBe(false);
  });

  it('zachowuje końcowy newline spec, jeśli jest, i nie dokłada drugiego', () => {
    const result = getTodoDispatch(task({ spec: `${READY_SPEC}\n` }));
    expect(result.prompt!.endsWith(`${READY_SPEC}\n`)).toBe(true);
    expect(result.prompt!.endsWith('\n\n')).toBe(false);
  });

  it('przy braku któregokolwiek warunku nie ma promptu ani workflow', () => {
    const result = getTodoDispatch(task({ spec: READY_SPEC.replace('WARUNKI ODBIORU:\n1. Testy przechodzą.', '') }));
    expect(result.missing).toEqual(['Brak wymaganej sekcji WARUNKI ODBIORU:']);
    expect(result.prompt).toBeNull();
    expect(result.workflow).toBeNull();
  });
});
