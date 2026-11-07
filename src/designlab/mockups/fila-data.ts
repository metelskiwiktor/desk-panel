import type { TODO_STATUSES } from '../../todo-contract';

/**
 * Test data of the Fila mockup (docs/designlab.md). Fila has no contract yet, so the mockup keeps its own threads
 * instead of `/api/todos`, which lacks parents, tags, custom fields and archiving.
 */
export type Status = keyof typeof TODO_STATUSES;
export type ThreadType = 'Sprawa' | 'Funkcja' | 'Błąd' | 'Spotkanie' | 'Notatka';
export type Author = 'Ty' | 'Claude Desktop' | 'Claude Code' | 'ChatGPT' | 'Wektor' | 'Panel';
export type Entry = { at: number; by: Author; text: string; comment?: boolean };
export type Revision = { n: number; by: Author; at: number; text: string };
export type CustomField = { name: string; kind: 'tekst' | 'liczba' | 'data' | 'tak/nie' | 'wiele wartości'; value: string };
export type Cezar = { executor: 'Cezar' | 'Lokalnie' | 'Rozmowa' | null; repo: 'desk-panel' | null; mode: 'Analiza' | 'Implementacja' | null; task?: string; pr?: string };
export type Thread = {
  id: string; type: ThreadType; title: string; description: string; status: Status; module: string; project: string;
  tags: string[]; parent?: string; custom: CustomField[]; cezar?: Cezar; spec: Revision[]; activity: Entry[]; archived?: boolean;
};

export const WORKFLOW_PRACA: Status[] = ['pomysl', 'przygotowanie', 'gotowe', 'realizacja', 'sprawdzenie', 'zakonczone', 'porzucone'];
export const MODULES = ['Fila', 'Wektor', 'Pulpit', 'System', 'Cezar'];
export type Project = { key: string; name: string; tone: string; modules: string[] };
export const PROJECTS: Project[] = [
  { key: 'DESK', name: 'DeskPanel', tone: 'blue', modules: MODULES },
  { key: 'CEZR', name: 'Cezar', tone: 'violet', modules: ['Kolejka', 'Executory', 'Runner'] },
  { key: 'TABU', name: 'Tabularium', tone: 'green', modules: [] },
];
export const TYPES: ThreadType[] = ['Sprawa', 'Funkcja', 'Błąd', 'Spotkanie', 'Notatka'];

const at = (text: string) => new Date(`2026-${text}:00`).getTime();

const specRev1 = `## Cel

Wątek pokazuje specyfikację z wyborem rewizji, tak aby było widać, co zmienił słoń, a co rybka.

## Zakres

- lista rewizji z autorem i czasem;
- treść wybranej rewizji jako Markdown;
- aktualna rewizja zaznaczona.`;
const specRev3 = `## Cel

Wątek pokazuje specyfikację z wyborem rewizji. Implementacja Cezara wskazuje konkretną rewizję, więc łatwo sprawdzić, na czym pracował wykonawca.

## Zakres

- lista rewizji z numerem, autorem (klientem) i czasem;
- treść wybranej rewizji jako Markdown, tylko do odczytu;
- aktualna rewizja oznaczona; starsze otwierają się bez zmiany Stanu.

## Poza zakresem

- porównanie dwóch rewizji;
- edycja specyfikacji w GUI (zapisuje tylko AI).

## Warunki odbioru

1. Wybór rewizji 1 pokazuje jej treść, autora i czas.
2. Powrót do aktualnej rewizji nie przeładowuje strony.
3. \`just rybka DESK-37\` czyta aktualną rewizję po ID wątku.`;

export const THREADS: Thread[] = [
  { id: 'DESK-32', type: 'Błąd', title: 'Wektor gubi kontekst wskazanego wątku', description: 'Po wskazaniu wątku i drugim pytaniu Wektor odpowiada o poprzednim elemencie.', status: 'pomysl', module: 'Wektor', project: 'DESK', tags: ['kontekst'], custom: [], spec: [],
    activity: [{ at: at('11-06T21:14'), by: 'Claude Desktop', text: 'utworzył wątek' }, { at: at('11-06T21:15'), by: 'Claude Desktop', text: 'Moduł: Wektor' }, { at: at('11-07T08:02'), by: 'Ty', text: 'Dzieje się tylko wtedy, gdy wskazanie było w innym widoku.', comment: true }] },
  { id: 'DESK-33', type: 'Błąd', title: 'Podwójne wiadomości po ponownym połączeniu z Hermesem', description: '', status: 'zakonczone', module: 'Wektor', project: 'DESK', tags: [], custom: [], spec: [],
    activity: [{ at: at('11-02T10:00'), by: 'Wektor', text: 'utworzył wątek' }, { at: at('11-04T16:40'), by: 'Claude Code', text: 'Stan: W realizacji → Zakończone' }] },
  { id: 'DESK-34', type: 'Błąd', title: 'Długa odpowiedź zasłania pole wpisywania na małym ekranie', description: 'Na Medialove 14″ w skali 150% ostatnia linia odpowiedzi chowa się pod polem.', status: 'sprawdzenie', module: 'Wektor', project: 'DESK', tags: ['medialove'], custom: [], spec: [],
    activity: [{ at: at('11-05T12:30'), by: 'Ty', text: 'utworzył wątek' }, { at: at('11-06T18:10'), by: 'Claude Code', text: 'Stan: W realizacji → Do sprawdzenia' }] },
  { id: 'DESK-35', type: 'Sprawa', title: 'Sprawdzić autostart panelu po aktualizacji Windows', description: '', status: 'pomysl', module: 'System', project: 'DESK', tags: [], custom: [], spec: [],
    activity: [{ at: at('11-07T07:45'), by: 'ChatGPT', text: 'utworzył wątek' }] },
  { id: 'DESK-36', type: 'Funkcja', title: 'Wątki zamiast dzisiejszych list zadań', description: 'Etap 1 Fili: dzisiejsze listy zastępują wątki w projektach DeskPanel, Cezar i Tabularium.', status: 'przygotowanie', module: 'Fila', project: 'DESK', tags: ['etap-1'], custom: [], spec: [],
    activity: [{ at: at('11-01T09:00'), by: 'Claude Desktop', text: 'utworzył wątek' }, { at: at('11-03T11:20'), by: 'Claude Code', text: 'dodał podwątki DESK-38, DESK-39, DESK-47' }] },
  { id: 'DESK-37', type: 'Funkcja', title: 'Specyfikacja z wyborem rewizji', description: 'Strona wątku pokazuje treść specyfikacji i pozwala otworzyć starszą rewizję.', status: 'gotowe', module: 'Fila', project: 'DESK', tags: ['etap-1', 'specyfikacja'], custom: [],
    cezar: { executor: 'Cezar', repo: 'desk-panel', mode: 'Implementacja' },
    spec: [{ n: 1, by: 'Claude Code', at: at('11-05T14:02'), text: specRev1 }, { n: 2, by: 'Claude Code', at: at('11-06T10:40'), text: specRev3.replace(/\n\n## Warunki odbioru[\s\S]*/, '') }, { n: 3, by: 'Claude Code', at: at('11-06T19:25'), text: specRev3 }],
    activity: [{ at: at('11-05T13:50'), by: 'Claude Desktop', text: 'utworzył wątek' }, { at: at('11-05T14:02'), by: 'Claude Code', text: 'Specyfikacja: rewizja 1' }, { at: at('11-06T10:40'), by: 'Claude Code', text: 'Specyfikacja: rewizja 2' }, { at: at('11-06T12:05'), by: 'Ty', text: 'Rybka miała rację z porównaniem rewizji, wyrzućmy je poza zakres.', comment: true }, { at: at('11-06T19:25'), by: 'Claude Code', text: 'Specyfikacja: rewizja 3' }, { at: at('11-06T19:26'), by: 'Claude Code', text: 'Stan: Do przygotowania → Gotowe do realizacji' }] },
  { id: 'DESK-38', type: 'Funkcja', title: 'Lista i kanban na tablicy DeskPanel', description: 'Sekcje listy i kanbanu z jednego silnika renderowania.', status: 'realizacja', module: 'Fila', project: 'DESK', tags: ['etap-1'], parent: 'DESK-36', custom: [],
    cezar: { executor: 'Cezar', repo: 'desk-panel', mode: 'Implementacja', task: 'cz-1182', pr: '#412' },
    spec: [{ n: 1, by: 'Claude Code', at: at('11-03T12:00'), text: '## Cel\n\nSekcja listy i sekcja kanban na tablicy DeskPanel.' }],
    activity: [{ at: at('11-03T11:20'), by: 'Claude Code', text: 'utworzył wątek' }, { at: at('11-04T09:10'), by: 'Ty', text: 'zlecił Cezarowi (Implementacja), task cz-1182' }, { at: at('11-04T09:12'), by: 'Ty', text: 'Stan: Gotowe do realizacji → W realizacji' }, { at: at('11-05T15:30'), by: 'Panel', text: 'Cezar otworzył PR #412' }] },
  { id: 'DESK-39', type: 'Funkcja', title: 'Historia zmian wątku i komentarze', description: 'Jedna oś aktywności: komentarze i zmiany pól.', status: 'sprawdzenie', module: 'Fila', project: 'DESK', tags: ['etap-1'], parent: 'DESK-36', custom: [], spec: [],
    activity: [{ at: at('11-03T11:20'), by: 'Claude Code', text: 'utworzył wątek' }] },
  { id: 'DESK-40', type: 'Funkcja', title: 'Wyszukiwanie wątków po ID i tytule', description: '', status: 'przygotowanie', module: 'Fila', project: 'DESK', tags: [], custom: [], spec: [],
    activity: [{ at: at('11-06T15:00'), by: 'Wektor', text: 'utworzył wątek' }] },
  { id: 'DESK-41', type: 'Funkcja', title: 'Czytelny komunikat, gdy Hermes jest niedostępny', description: 'Zamiast pustej odpowiedzi Wektor mówi, że Hermes nie działa, i podaje, co sprawdzić.', status: 'gotowe', module: 'Wektor', project: 'DESK', tags: [], custom: [{ name: 'Dawne ID', kind: 'wiele wartości', value: 'CEZR-7' }],
    cezar: { executor: 'Lokalnie', repo: 'desk-panel', mode: 'Implementacja' }, spec: [{ n: 1, by: 'ChatGPT', at: at('11-04T20:00'), text: '## Cel\n\nKomunikat o niedostępnym Hermesie.' }],
    activity: [{ at: at('10-29T10:00'), by: 'Claude Desktop', text: 'utworzył wątek w projekcie Cezar' }, { at: at('11-04T19:58'), by: 'Ty', text: 'przeniósł z Cezar (CEZR-7) do DeskPanel' }] },
  { id: 'DESK-42', type: 'Sprawa', title: 'Wymienić filtr w oczyszczaczu powietrza', description: 'Filtr HEPA, model z instrukcji w szufladzie.', status: 'realizacja', module: 'System', project: 'DESK', tags: ['dom'], custom: [{ name: 'Koszt', kind: 'liczba', value: '149' }], spec: [],
    activity: [{ at: at('11-06T17:00'), by: 'Ty', text: 'utworzył wątek' }, { at: at('11-06T17:01'), by: 'Ty', text: 'dodał pole Koszt' }, { at: at('11-07T09:12'), by: 'Ty', text: 'Zamówiony, przyjdzie w poniedziałek.', comment: true }] },
  { id: 'DESK-43', type: 'Spotkanie', title: 'Przegląd kolejki Cezara', description: 'Co czeka na zlecenie i które executory są wolne.', status: 'pomysl', module: 'Cezar', project: 'DESK', tags: [], custom: [], spec: [],
    activity: [{ at: at('11-07T08:30'), by: 'Claude Desktop', text: 'utworzył wątek' }] },
  { id: 'DESK-44', type: 'Funkcja', title: 'Kafelek Zadania na pulpicie pokazuje wyniki jednego zapytania Fili, pozwala zmieniać Stan bez otwierania wątku i zachowuje dzisiejszy układ także na małym ekranie Medialove w skali 150%', status: 'pomysl', module: 'Pulpit', project: 'DESK', tags: ['etap-1', 'pulpit', 'medialove'], custom: [], spec: [],
    description: 'W dniu wdrożenia etapu 1 kafelek Zadania musi dalej działać, tylko już na wątkach. Pokazuje wyniki jednego zapytania, tak jak sekcja listy, i pozwala zmieniać Stan; pełne widgety Fili przychodzą później.\n\nNa małym ekranie kafelek ma dziś trzy linie na zadanie; po zmianie ma zostać tak samo zwarty, a długie tytuły mają się łamać, nie ucinać. Zapytanie kafelka ustawia AI, użytkownik może poprawić jego tekst.\n\nDo sprawdzenia: czy kafelek odświeża się po zmianie Stanu z tablicy, i co pokazuje, gdy zapytanie nie zwraca żadnego wątku.',
    activity: [{ at: at('11-07T10:05'), by: 'Claude Desktop', text: 'utworzył wątek' }] },
  { id: 'DESK-45', type: 'Notatka', title: 'Język zapytań: przykłady od Claude Code', description: '- `projekt = DESK AND otwarte`\n- `typ = Funkcja AND nie ma rodzica`\n- `rodzic = DESK-36`', status: 'pomysl', module: 'Fila', project: 'DESK', tags: ['zapytania'], custom: [], spec: [],
    activity: [{ at: at('11-05T22:10'), by: 'Claude Code', text: 'utworzył wątek' }] },
  { id: 'DESK-46', type: 'Błąd', title: 'Zegar przeskakuje o minutę po wybudzeniu', description: 'Nie dało się powtórzyć po aktualizacji.', status: 'porzucone', module: 'Pulpit', project: 'DESK', tags: [], custom: [], spec: [],
    activity: [{ at: at('10-30T08:00'), by: 'Ty', text: 'utworzył wątek' }, { at: at('11-03T08:20'), by: 'Ty', text: 'Stan: Pomysł → Porzucone' }] },
  { id: 'DESK-47', type: 'Funkcja', title: 'Klucze projektów i ID wątków', description: '', status: 'zakonczone', module: 'Fila', project: 'DESK', tags: ['etap-1'], parent: 'DESK-36', custom: [], spec: [],
    activity: [{ at: at('11-03T11:20'), by: 'Claude Code', text: 'utworzył wątek' }, { at: at('11-05T18:00'), by: 'Claude Code', text: 'Stan: Do sprawdzenia → Zakończone' }] },
  { id: 'DESK-48', type: 'Funkcja', title: 'Zlecanie Cezarowi z wątku', description: 'Zestaw pól Cezara na wątku; zlecenie i gotowość działają jak dziś z zadania.', status: 'realizacja', module: 'Cezar', project: 'DESK', tags: ['etap-1'], custom: [],
    cezar: { executor: 'Cezar', repo: 'desk-panel', mode: 'Analiza', task: 'cz-1190' }, spec: [{ n: 1, by: 'Claude Code', at: at('11-06T09:00'), text: '## Cel\n\nZlecanie z wątku.' }],
    activity: [{ at: at('11-05T09:00'), by: 'Claude Desktop', text: 'utworzył wątek' }, { at: at('11-06T09:30'), by: 'Ty', text: 'zlecił Cezarowi (Analiza)' }] },
  { id: 'DESK-49', type: 'Funkcja', title: 'Narzędzia Fili w Wektorze w miejsce panel_todos', description: '', status: 'przygotowanie', module: 'Wektor', project: 'DESK', tags: ['etap-1'], custom: [], spec: [],
    activity: [{ at: at('11-06T11:00'), by: 'Claude Desktop', text: 'utworzył wątek' }] },
  { id: 'DESK-50', type: 'Funkcja', title: 'Edycja tekstu zapytania sekcji', description: '', status: 'sprawdzenie', module: 'Fila', project: 'DESK', tags: ['etap-1', 'zapytania'], custom: [], spec: [],
    activity: [{ at: at('11-04T14:00'), by: 'Claude Code', text: 'utworzył wątek' }] },
  { id: 'DESK-51', type: 'Błąd', title: 'Kanban nie odświeża licznika kolumny po zmianie Stanu', description: '', status: 'realizacja', module: 'Fila', project: 'DESK', tags: [], custom: [], spec: [],
    activity: [{ at: at('11-07T09:40'), by: 'Wektor', text: 'utworzył wątek' }] },
  { id: 'DESK-52', type: 'Sprawa', title: 'Odnowić certyfikat lokalnego HTTPS', description: '', status: 'zakonczone', module: 'System', project: 'DESK', tags: [], custom: [], spec: [],
    activity: [{ at: at('11-01T19:00'), by: 'Ty', text: 'utworzył wątek' }, { at: at('11-02T19:30'), by: 'Ty', text: 'Stan: Pomysł → Zakończone' }] },
  { id: 'DESK-53', type: 'Funkcja', title: 'Czasomierz według pola Kiedy', description: 'Etap 3.', status: 'pomysl', module: 'Fila', project: 'DESK', tags: ['etap-3'], custom: [], spec: [],
    activity: [{ at: at('11-02T13:00'), by: 'ChatGPT', text: 'utworzył wątek' }] },
  { id: 'CEZR-12', type: 'Błąd', title: 'Executor Codex nie zwalnia slotu po przekroczeniu czasu', description: '', status: 'realizacja', module: 'Executory', project: 'CEZR', tags: [], custom: [], spec: [],
    activity: [{ at: at('11-06T22:40'), by: 'Claude Code', text: 'utworzył wątek' }] },
  { id: 'CEZR-13', type: 'Funkcja', title: 'Priorytety w kolejce zleceń', description: '', status: 'pomysl', module: 'Kolejka', project: 'CEZR', tags: [], custom: [], spec: [],
    activity: [{ at: at('11-07T07:10'), by: 'ChatGPT', text: 'utworzył wątek' }] },
  { id: 'DESK-30', type: 'Sprawa', title: 'Sprawdzić import starych list z pliku JSON', description: '', status: 'zakonczone', module: 'System', project: 'DESK', tags: [], custom: [], spec: [], archived: true,
    activity: [{ at: at('10-28T12:00'), by: 'Wektor', text: 'utworzył wątek' }, { at: at('11-02T09:15'), by: 'Claude Code', text: 'zarchiwizował wątek' }] },
  { id: 'DESK-31', type: 'Błąd', title: 'Wektor gubi kontekst (duplikat)', description: '', status: 'pomysl', module: 'Wektor', project: 'DESK', tags: [], custom: [], spec: [], archived: true,
    activity: [{ at: at('11-06T21:13'), by: 'Claude Desktop', text: 'utworzył wątek' }, { at: at('11-06T21:20'), by: 'Ty', text: 'zarchiwizował wątek' }] },
];

export type Query = { pills: string[]; text: string; match: (thread: Thread) => boolean };
export type Section =
  | { id: string; kind: 'lista'; name: string; query: Query }
  | { id: string; kind: 'kanban'; name: string; query: Query; columns: { status: Status; query: Query }[] };
export type View = { id: string; name: string; sections: Section[] };

const open = (thread: Thread) => thread.status !== 'zakonczone' && thread.status !== 'porzucone';
const column = (status: Status, label: string) => ({ status, query: { pills: [`Stan = ${label}`], text: `Stan = "${label}"`, match: (thread: Thread) => thread.status === status } });

export const VIEWS: View[] = [
  { id: 'przeglad', name: 'Przegląd', sections: [
    { id: 'inbox', kind: 'lista', name: 'Do przejrzenia', query: { pills: ['DeskPanel', 'otwarte', 'Stan = Pomysł lub typ ≠ Funkcja'], text: 'projekt = DESK AND otwarte\n  AND (Stan = "Pomysł" OR typ != Funkcja)\nORDER BY Stan, id', match: thread => open(thread) && (thread.status === 'pomysl' || thread.type !== 'Funkcja') } },
    { id: 'kanban', kind: 'kanban', name: 'Funkcje', query: { pills: ['DeskPanel', 'Funkcja', 'nie ma rodzica'], text: 'projekt = DESK AND typ = Funkcja AND nie ma rodzica\nORDER BY id', match: thread => thread.type === 'Funkcja' && !thread.parent },
      columns: [column('przygotowanie', 'Do przygotowania'), column('gotowe', 'Gotowe do realizacji'), column('realizacja', 'W realizacji'), column('sprawdzenie', 'Do sprawdzenia')] },
    { id: 'pilne', kind: 'lista', name: 'Pilne', query: { pills: ['DeskPanel', 'otwarte', 'tag = pilne'], text: 'projekt = DESK AND otwarte AND tag = pilne', match: thread => open(thread) && thread.tags.includes('pilne') } },
  ] },
  { id: 'wszystko', name: 'Wszystko', sections: [
    { id: 'all', kind: 'lista', name: 'DeskPanel', query: { pills: ['DeskPanel'], text: 'projekt = DESK\nORDER BY id DESC', match: () => true } },
  ] },
];

export const BOARD_HISTORY: Entry[] = [
  { at: at('11-07T09:50'), by: 'Ty', text: 'zmienił tekst zapytania kolumny „Do sprawdzenia” w sekcji Funkcje' },
  { at: at('11-06T20:30'), by: 'Claude Desktop', text: 'dodał sekcję Pilne' },
  { at: at('11-05T16:12'), by: 'Claude Code', text: 'zmienił zapytanie sekcji Do przejrzenia' },
  { at: at('11-03T10:00'), by: 'Ty', text: 'dodał widok Wszystko' },
  { at: at('11-01T08:55'), by: 'Claude Code', text: 'dodał sekcję kanban Funkcje' },
  { at: at('11-01T08:50'), by: 'Panel', text: 'utworzył tablicę DeskPanel z sekcją „projekt = DESK”' },
];
