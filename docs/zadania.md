# Listy zadań

Własne dane panelu (nie dostawcy): **listy** zadań do zrobienia, np. „Do poprawy - Chat Agy” albo „Dom”. W interfejsie pokaże je widget
Zadania (kolejny krok; widget będzie można postawić na siatce wiele razy, każdy z wybraną listą i własnym „Ukryj ukończone”, zob.
[docs/desk-panel.md](desk-panel.md), „Widget i kafelek”). Ten dokument opisuje to, co już jest: dane, API i dostęp agenta czatu.

**Nazewnictwo.** „Zadanie” bez dopowiedzenia to zadanie z listy. Zadania Cezara to osobna rzecz ([docs/cezar.md](cezar.md)) i tak się je
nazywa („zadania Cezara”, „taski Cezara”). W kodzie i API to `todo` (rodzaj `task` zajmuje kontekst czatu dla Cezara), a w interfejsie
„lista” (dawniej „temat”).

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
