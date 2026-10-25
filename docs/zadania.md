# Listy zadań

Własne dane panelu (nie dostawcy): **listy** zadań do zrobienia, np. „Do poprawy - Chat Agy” albo „Dom”. W interfejsie pokazuje je widget
**Zadania**, który można postawić na siatce wiele razy (każdy kafelek ma wybraną listę i własne „Ukryj ukończone”, zob.
[docs/desk-panel.md](desk-panel.md), „Widget i kafelek”). Ten dokument opisuje widget, dane, API i dostęp agenta czatu.

**Nazewnictwo.** „Zadanie” bez dopowiedzenia to zadanie z listy. Zadania Cezara to osobna rzecz ([docs/cezar.md](cezar.md)) i tak się je
nazywa („zadania Cezara”, „taski Cezara”). W kodzie i API to `todo` (rodzaj `task` zajmuje kontekst czatu dla Cezara), a w interfejsie
„lista” (dawniej „temat”).

## Widget Zadania

Kod: `src/TodoTile.tsx`, stan i odczyt w `src/useTodos.ts` (jeden hook dla wszystkich kafelków), style `.todo-*` w `src/pulpit.css`. Widget jest oferowany
w pustych komórkach siatki zawsze (`MULTI_KINDS`), każdy kafelek ma `id` `todo#1`, `todo#2`… i nazywa się „Zadania · <lista>”. Włącza go i wyłącza sekcja
„Zadania” w Ustawieniach.

- **Lista** wybierana jest z rozwijanej listy w nagłówku (ostatnia pozycja „＋ Nowa lista…”); wybór zapisuje się w ustawieniach kafelka (`config.list`), więc
  dwa kafelki mogą pokazywać różne listy. Jeśli zapisana lista zniknęła, kafelek pokazuje pierwszą.
- **Menu ⋯**: nowa lista, zmiana nazwy, „Wyczyść ukończone (N)” i „Usuń listę” (drugie dotknięcie potwierdza i mówi, ile zadań zniknie).
- **Zadania**: pole „Dodaj zadanie…” (Enter), pole wyboru przy zadaniu (zaznaczenie widać od razu), dotknięcie tytułu otwiera edycję tytułu i notatki
  (Zapisz / Anuluj / Esc), X usuwa po drugim dotknięciu. Otwarte są przed ukończonymi (te skreślone, na końcu), notatka i plakietka „agent” (zadanie dodał
  agent) są pod tytułem.
- **„Ukryj ukończone”**: pole w stopce kafelka, zapamiętane **per kafelek** w jego ustawieniach (`config.hideDone`); obok licznik „ukończone/wszystkie”.
  Ukończone zostają na liście, dopóki ich nie wyczyścisz.
- **Kafelek jednokomórkowy** nie ma miejsca na pole dodawania i stopkę: pole pokazuje przycisk „+” w nagłówku, a „Ukryj ukończone” jest w menu ⋯; notatek i
  plakietek nie widać.
- **Odświeżanie**: lista jest czytana co 5 s, więc to, co dopisze agent czatu, pojawia się w kilka sekund; po własnej zmianie odczyt następuje od razu.
  Odrzucona zmiana pokazuje powód z serwera (np. „Lista o takiej nazwie już jest.”) nad listą.

## Model

`src/todo-contract.ts` (schematy zod, wspólne dla serwera i interfejsu):

- **Lista**: `id` (`l-` i 8 znaków szesnastkowych), `name` (do 80 znaków, unikalna bez względu na wielkość liter), `createdAt`, `tasks`.
- **Zadanie**: `id` (`t-…`), `title` (do 200), `note` (do 2000, domyślnie pusta), `done`, `createdAt`, `completedAt` (null, dopóki otwarte),
  `by` (`user` albo `agent`: kto dodał). Zadania leżą w kolejności dodania; pokazywanie otwartych przed ukończonymi to sprawa widoku.
- Limity: 50 list, 500 zadań na liście. Ukończone zostają, dopóki ich nie wyczyścisz (`clearDone`).
- Źródło `GET /api/todos` ma kształt jak inne źródła (`live`, `name: "Zadania"`, `status`, `observedAt`, `data: { lists }`, opcjonalnie `message`).

## Zapis i dostęp

Dane leżą w `~/.desk-panel/todos.json` (`{ "version": 1, "lists": [...] }`, poza Gitem), bo korzystają z nich razem komputer, telefon, kiosk i
agent czatu. `server/todos.ts` trzyma listy w pamięci i **zmienia je małymi akcjami**, jedna po drugiej: ekran i agent dopisują do tego, co
zostawił drugi, zamiast nadpisywać cały dokument. Po każdej zmianie cały plik jest zapisywany atomowo (plik tymczasowy, potem zmiana nazwy).
Akcja odrzucona nic nie zmienia, a gdy zapis się nie uda, zmiana jest wycofana z pamięci. Uszkodzony plik jest odkładany na bok
(`todos.json.corrupt-<czas>`), panel zaczyna od pustych list i mówi o tym w `message` źródła; nigdy nie nadpisuje tego, czego nie umiał odczytać.

Zmiany: `POST /api/todos/action` z nagłówkiem `Origin` równym adresowi panelu (jak akcje Gmaila i Cezara, inaczej `403`) i ciałem JSON z polem `action`.
Odpowiedź to `{ "ok": true, ... }` z identyfikatorami tego, co powstało lub się zmieniło; błąd ma `{ "error": "powód" }`.

| `action` | Pola | Skutek |
| --- | --- | --- |
| `createList` | `name` | nowa lista; jeśli lista o tej nazwie już jest, zwraca ją (`created: false`) |
| `renameList` | `list`, `name` | zmiana nazwy (`409`, gdy nazwę ma inna lista) |
| `deleteList` | `list` | usuwa listę z zadaniami (`removed` to liczba zadań) |
| `addTask` | `list`, `title`, `note?`, `by?` | dodaje zadanie na koniec; `by` domyślnie `user`, agent podaje `agent` |
| `updateTask` | `task`, `title?`, `note?`, `done?` | zmienia podane pola; `done` ustawia lub czyści czas ukończenia |
| `moveTask` | `task`, `list` | przenosi zadanie na inną listę |
| `deleteTask` | `task` | usuwa zadanie |
| `clearDone` | `list` | usuwa ukończone z listy (`removed`) |

Błędy: `400` (zła akcja lub pola), `404` (nie ma takiej listy lub zadania), `409` (limit albo zajęta nazwa), `413` (ciało większe niż 4 KB).

## Wskazywanie w czacie

W trybie „Wskaż element” kafelek Zadania jest wskazywany jako **lista**, którą pokazuje (rodzaj `todoList`; ten sam id listy w dwóch kafelkach to jeden element
kontekstu), a pojedynczy wiersz jako **zadanie** (`todo`), bo najbliższy oznaczony element wygrywa. Agent dostaje w bloku `[Kontekst]` id i nazwę listy oraz
zadania do zrobienia z id (ukończone są tylko policzone; do 1800 znaków, nadmiar z odsyłaczem do `/api/agent/todos?list=…`), a przy zadaniu id zadania i listy,
stan, notatkę i autora (`src/todo-context.ts`). Dzięki temu „dodaj tu zadanie” albo „odhacz to” działa bez ponownego czytania list. Kontekst jest zdjęciem z
chwili wskazania (lista odświeża się co 5 s). Kafelek bez listy wskazuje się jak zwykły kafelek, a chip zadania Cezara nazywa się teraz „Task Cezara”.

## Agent czatu

Agent czyta listy przez widok `GET /api/agent/todos` (`?list=<id lub fragment nazwy>`, `&ukonczone=1`; ukończone są domyślnie tylko policzone),
a zmienia je przez `POST /api/todos/action` (instrukcja w `preamble()` w `server/agent-chat.ts` zawiera wszystkie akcje i przykład).
Zasady z instrukcji: samo „zadanie” to zadanie z listy; przy `addTask` zawsze `"by":"agent"`; bez wskazanej listy używa jedynej, tej o pasującej
nazwie, a gdy niepewny, pyta; gdy list nie ma, tworzy „Zadania”; usuwa (`deleteTask`, `clearDone`, `deleteList`) tylko na wyraźną prośbę i
mówi, co zmienił. Szczegóły czatu: [docs/czat.md](czat.md).

## Scenariusze i testy

Scenariusz może mieć pole `todos` w kształcie źródła (listy startowe; bez niego listy są puste i połączone). Listy ze scenariusza są
wczytywane przy pierwszym użyciu, a zmiany z akcji pamiętane w pamięci do restartu, jak akcje poczty. `scenarios/standard.json` ma dwie listy
(jedną z zadaniami „do poprawy” czatu). Testy: `server/todos.test.ts` (sklep, plik, schematy, trasa, widok agenta).
