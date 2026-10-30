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
- **Menu ⋯** (ustawienia listy): „Ukryj ukończone” i „Pokaż, co dodał agent” (pola wyboru), nowa lista, zmiana nazwy, „Wyczyść ukończone (N)” i „Usuń listę” (drugie dotknięcie
  potwierdza i mówi, ile zadań zniknie).
- **Zadania**: pole wyboru przy zadaniu (zaznaczenie widać od razu); dotknięcie tytułu otwiera zadanie w **oknie nad całym pulpitem** (`src/TodoDialog.tsx`,
  poza kafelkiem, więc wygląda tak samo w kafelku każdego rozmiaru). Okno ma tytuł, notatkę i przyciski „Usuń” (drugie dotknięcie potwierdza), „Anuluj”
  i „Zapisz”; zapis wysyła tylko to, co się zmieniło, Enter w tytule i Ctrl+Enter w notatce zapisują, Esc i „Anuluj” porzucają zmiany, a dotknięcie
  przyciemnionego tła zamyka okno tylko wtedy, gdy nic nie wpisano. Fokus zostaje w oknie (Tab krąży) i wraca na zadanie. Okno trzyma stan w kafelku
  (po id zadania), więc odczyt co 5 s go nie zamyka ani nie gubi wpisanego tekstu, nawet gdy zadanie zniknie z widoku (np. ukończone przy „Ukryj
  ukończone”); zamyka się dopiero, gdy zadanie zostało usunięte gdzie indziej. Wiersz edytowanego zadania jest podświetlony. Otwarte zadania są przed
  ukończonymi (te skreślone, na końcu); ikona ✦ (domyślnie niewidoczna, włącza ją „Pokaż, co dodał agent” w menu ⋯) oznacza, że dodał je agent. Tytuł ma
  jedną linię (w wąskim, wysokim kafelku dwie). Licznik „ukończone/wszystkie” jest w nagłówku.
- **Dodawanie**: „+” w nagłówku pokazuje pole „Dodaj zadanie…” pływające nad dołem kafelka (zadania przewijają się pod nim). Enter zapisuje, a pole zostaje
  otwarte na kolejne; zamyka je dopiero ponowne dotknięcie „+” (albo Esc).
- **„Ukryj ukończone”** jest ustawieniem **listy**, nie kafelka: leży w danych listy (`hideDone`, akcja `setListOptions`), więc każdy kafelek, który ją pokazuje (także na
  innym urządzeniu), ukrywa ukończone tak samo, a przełączenie kafelka na inną listę pokazuje jej własne ustawienie. Ukończone zostają na liście, dopóki ich
  nie wyczyścisz.
- **Rozmiar kafelka** (liczony w komórkach siatki, `wide` = 2+ kolumny, `tall` = 2+ wiersze) decyduje o układzie: szeroki i niski kafelek układa zadania w dwóch
  kolumnach, notatki widać tylko wtedy, gdy kafelek jest i szeroki, i wysoki (do 2 linii; w mniejszych są w edycji), a ikona listy w nagłówku jest tylko w
  kafelku szerokim.
- **Odświeżanie**: lista jest czytana co 5 s, więc to, co dopisze agent czatu, pojawia się w kilka sekund; po własnej zmianie odczyt następuje od razu.
  Odrzucona zmiana pokazuje powód z serwera (np. „Lista o takiej nazwie już jest.”) nad listą.

## Model

`src/todo-contract.ts` (schematy zod, wspólne dla serwera i interfejsu):

- **Lista**: `id` (`l-` i 8 znaków szesnastkowych), `name` (do 80 znaków, unikalna bez względu na wielkość liter), `createdAt`, `hideDone` i `showAgent` (oba domyślnie `false`; stary plik bez tych pól się wczytuje), `tasks`.
- **Zadanie**: `id` (`t-…`), `title` (do 200), `note` (do 2000, domyślnie pusta), `done`, `createdAt`, `completedAt` (null, dopóki otwarte),
  `by` (`user` albo `agent`: kto dodał). Zadania leżą w kolejności dodania; pokazywanie otwartych przed ukończonymi to sprawa widoku.
- **Stan** `status`: `pomysl` (Pomysł), `przygotowanie` (Do przygotowania), `gotowe` (Gotowe do realizacji), `realizacja` (W realizacji),
  `sprawdzenie` (Do sprawdzenia), `zakonczone` (Zakończone), `porzucone` (Porzucone). Etykiety są w jednej tabeli `TODO_STATUSES`
  w kontrakcie. Stan jest niezależny od Cezara i PR-a; zakończenie taska Cezara nie kończy zadania z listy. Nowe zadanie ma `pomysl`.
  `done` jest pochodne: true dokładnie dla `zakonczone` i `porzucone`; wejście w stan terminalny ustawia `completedAt`, powrót je czyści,
  przejście między terminalnymi zachowuje czas. `updateTask {done:true}` ustawia `zakonczone`; `done:false` przywraca ostatni nieterminalny
  stan z zachowanej historii (gdy go nie ma: `pomysl`); otwartego zadania nie zmienia.
- **Blokada** `blocked`: powód do 300 znaków albo null, niezależnie od stanu.
- **Powiązania** `links`: do 20 `{kind, id, title?, at}`, unikalne po `kind+id`. `chat` to id rozmowy Wektora, `cezar` id taska Cezara,
  `pr` pełny URL `https://github.com/<owner>/<repo>/pull/<n>` (bez query i fragmentu, dodatni numer). `id` ma do 500 znaków, tytuł do 200.
- **Historia** `history`: do 200 `{at, by, kind, text?, from?, to?}`, najstarsze wypadają. `by`: `user`, `agent`, `panel`;
  `kind`: `status` (from/to to id stanów), `comment` (Markdown do 2000 znaków), `link` (tekst dodania/usunięcia z kind i id), `blocked`
  (nowy powód; pusty tekst oznacza usunięcie blokady). Czasy to milisekundy epoch, nadawane przez serwer. Każda zmiana stanu, blokady
  i powiązania dopisuje historię; ponowienie tej samej wartości, istniejącego linku lub usunięcia nieistniejącego linku nic nie dopisuje.
- Limity: 50 list, 500 zadań na liście. Ukończone zostają, dopóki ich nie wyczyścisz (`clearDone`).
- Źródło `GET /api/todos` ma kształt jak inne źródła (`live`, `name: "Zadania"`, `status`, `observedAt`, `data: { lists }`, opcjonalnie `message`).

## Zapis i dostęp

Dane leżą w `~/.desk-panel/todos.json` (`{ "version": 2, "lists": [...] }`, poza Gitem), bo korzystają z nich razem komputer, telefon, kiosk i
agent czatu. `server/todos.ts` trzyma listy w pamięci i **zmienia je małymi akcjami**, jedna po drugiej: ekran i agent dopisują do tego, co
zostawił drugi, zamiast nadpisywać cały dokument. Po każdej zmianie cały plik jest zapisywany atomowo (plik tymczasowy, potem zmiana nazwy).
Akcja odrzucona nic nie zmienia, a gdy zapis się nie uda, zmiana jest wycofana z pamięci. Uszkodzony plik jest odkładany na bok
(`todos.json.corrupt-<czas>`), panel zaczyna od pustych list i mówi o tym w `message` źródła; nigdy nie nadpisuje tego, czego nie umiał odczytać.
Jeżeli odłożenie pliku się nie uda albo odczyt zawiedzie z powodu innego niż brak pliku, zapis jest blokowany do ponownego otwarcia sklepu.
Plik v1 migruje w pamięci: otwarte zadania → `pomysl`, ukończone → `zakonczone`, blokada null, powiązania i historia puste.
Odczyt nic nie zapisuje. Przed pierwszym zapisem v2 powstaje `todos.json.v1-backup` z oryginalnego pliku v1; istniejącej kopii nie nadpisujemy.
Błąd wykonania kopii (poza jej wcześniejszym istnieniem) odrzuca zapis i wycofuje zmianę z pamięci.

Zmiany: `POST /api/todos/action` z nagłówkiem `Origin` równym adresowi panelu (jak akcje Gmaila i Cezara, inaczej `403`) i ciałem JSON z polem `action`.
Odpowiedź to `{ "ok": true, ... }` z identyfikatorami tego, co powstało lub się zmieniło; błąd ma `{ "error": "powód" }`.

| `action` | Pola | Skutek |
| --- | --- | --- |
| `createList` | `name` | nowa lista; jeśli lista o tej nazwie już jest, zwraca ją (`created: false`) |
| `renameList` | `list`, `name` | zmiana nazwy (`409`, gdy nazwę ma inna lista) |
| `setListOptions` | `list`, `hideDone?`, `showAgent?` | ustawienia listy dla ekranu (co najmniej jedno pole; agent nie dostaje tej akcji w instrukcji) |
| `deleteList` | `list` | usuwa listę z zadaniami (`removed` to liczba zadań) |
| `addTask` | `list`, `title`, `note?`, `by?` | dodaje zadanie na koniec; `by` domyślnie `user`, agent podaje `agent` |
| `updateTask` | `task`, `title?`, `note?`, `done?`, `by?` | zmienia podane pola; zgodność done ze stanem jak wyżej |
| `setStatus` | `task`, `status`, `by?` | zmienia stan i dopisuje historię |
| `setBlocked` | `task`, `reason` (tekst lub null), `by?` | ustawia/usuwa blokadę i dopisuje historię |
| `addComment` | `task`, `text`, `by?` | dopisuje komentarz Markdown do historii |
| `link` | `task`, `kind`, `id`, `title?`, `by?` | dodaje powiązanie z historią; istniejące jest pozostawiane bez zmian |
| `unlink` | `task`, `kind`, `id`, `by?` | usuwa powiązanie z historią |
| `moveTask` | `task`, `list` | przenosi zadanie na inną listę |
| `deleteTask` | `task` | usuwa zadanie |
| `clearDone` | `list` | usuwa ukończone z listy (`removed`) |

Błędy: `400` (zła akcja lub pola), `404` (nie ma takiej listy lub zadania), `409` (limit albo zajęta nazwa), `413` (ciało większe niż 4 KB).
Nowe akcje zwracają `{ok:true, list:{id,name}, task:{id}}`. `by` zmian domyślnie `user`; `panel` oznacza automatykę panelu,
`agent` wywołania Wektora. Puste komentarze i powody blokady są odrzucane; do usunięcia blokady służy null.

Jedyna automatyka stanu: po udanym utworzeniu taska Cezara z karty dispatch z `todoId` (`server/cockpit.ts`) panel dopina link `cezar`
(id, tytuł) i `chat` (id rozmowy), następnie ustawia `realizacja`, wszystko z `by: panel`. Nieistniejące zadanie lub błąd zapisu jest
logowany i nie unieważnia udanego dispatchu. Bez `todoId` listy pozostają nietknięte. Nie ma odpytywania Cezara/PR-a na potrzeby zmian
zadania, innych automatycznych przejść ani startowania agenta. Samo proponowanie karty nic nie zmienia.

## Wskazywanie w czacie

W trybie „Wskaż element” kafelek Zadania jest wskazywany jako **lista**, którą pokazuje (rodzaj `todoList`; ten sam id listy w dwóch kafelkach to jeden element
kontekstu), a pojedynczy wiersz jako **zadanie** (`todo`), bo najbliższy oznaczony element wygrywa. Agent dostaje w bloku `[Kontekst]` id i nazwę listy oraz
zadania do zrobienia z id (ukończone są tylko policzone; do 1800 znaków, nadmiar z odsyłaczem do `/api/agent/todos?list=…`), a przy zadaniu id zadania i listy,
stan PL, blokadę, powiązania, ostatnie 3 komentarze, notatkę i autora (`src/todo-context.ts`, całość w limicie znaków). Dzięki temu „dodaj tu zadanie” albo „odhacz to” działa bez ponownego czytania list. Kontekst jest zdjęciem z
chwili wskazania (lista odświeża się co 5 s). Kafelek bez listy wskazuje się jak zwykły kafelek, a chip zadania Cezara nazywa się teraz „Task Cezara”.

## Agent czatu

Wektor na Hermesie czyta `panel_todos`, adapter widoku `GET /api/agent/todos` (`?list=<id lub fragment nazwy>`, `&ukonczone=1`, `&stan=<id stanu>`).
Widok pokazuje stan z polską etykietą, blokadę, powiązania i ostatnie 3 komentarze. Ukończone domyślnie tylko liczy; jawny filtr `stan`
wybiera również terminalne bez `ukonczone=1`. Nieznany stan to 400. Zmienia zadania przez `panel_todo_action`, który wymusza `by: agent`
dla każdej akcji mającej autora (również zgodnościowego `updateTask`). `TODO_FIELDS` jest wyprowadzane z kontraktu, obejmuje nowe akcje.
Instrukcje żyją w kodzie: `PANEL_GUIDES.zadania` w `src/chat-contract.ts` i preambuła w `server/hermes-chat.ts`. Stan zmienia na prośbę użytkownika;
ustalenia zapisuje komentarzem, gdy o to prosi; przy propozycji Cezara z zadania podaje `todoId`, a stan i linki zapisuje panel po kliknięciu karty.
Zasady z instrukcji: samo „zadanie” to zadanie z listy; przy `addTask` zawsze `"by":"agent"`; bez wskazanej listy używa jedynej, tej o pasującej
nazwie, a gdy niepewny, pyta; gdy list nie ma, tworzy „Zadania”; usuwa (`deleteTask`, `clearDone`, `deleteList`) tylko na wyraźną prośbę i
mówi, co zmienił. Szczegóły czatu: [docs/czat.md](czat.md).

## Scenariusze i testy

Scenariusz może mieć pole `todos` w kształcie źródła (listy startowe; bez niego listy są puste i połączone). Listy ze scenariusza są
wczytywane przy pierwszym użyciu, a zmiany z akcji pamiętane w pamięci do restartu, jak akcje poczty. `scenarios/standard.json` ma dwie listy
(jedną z zadaniami „do poprawy” czatu). Testy: `server/todos.test.ts` (sklep, plik, schematy, trasa, widok agenta).
