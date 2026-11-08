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
- **Zadania**: pole wyboru zaznacza „Zakończone”, odznaczenie przywraca poprzedni nieterminalny stan (jak w modelu poniżej).
  Zadania otwarte stoją przed terminalnymi; zakończone są skreślone, porzucone wyszarzone bez skreślenia, ze znakiem „–”.
  Stan inny niż „Pomysł” ma mały znacznik (w wąskim kafelku kolorową kropkę, etykietę w title/aria), blokada ikonę kłódki z powodem w title/aria.
  Ikona ✦ (włączana przez „Pokaż, co dodał agent”) oznacza autora zadania. Licznik „ukończone/wszystkie” obejmuje oba stany terminalne.
- **Okno zadania** (`src/TodoDialog.tsx`, nad całym pulpitem, niezależnie od rozmiaru kafelka): duże okno z zakładkami „Specyfikacja” i „Historia · N”. Zakładka specyfikacji pokazuje bieżący Markdown z `task.spec` (bez trimowania) w trybie tylko do odczytu, przez ten sam renderer co czat Wektora (`src/components/markdown-text.tsx`), z domyślną polityką HTML/URL-i; w B1 nie ma kontrolek edycji Markdown ani wyboru rewizji. Puste stany (`specRevision=0` i `spec=""` oraz pusta bieżąca rewizja przy `specRevision>0`) pokazują „Brak specyfikacji”; metadane istniejącej rewizji (numer, autor, czas) pozostają widoczne. Nagłówek specyfikacji pokazuje autora i czas z wpisu o `revision === specRevision`; `task.by` to autor utworzenia zadania, nie specyfikacji. Panel boczny zawiera tytuł, krótką notatkę, stan, blokadę, powiązania i metadane rewizji (numer i autor). Stopka mówi, że „Zapisz” dotyczy tytułu i notatki; zapis wysyła tylko zmienione pola bez `spec`/`specRevision`. Wybór stanu, blokada, powiązania i komentarze zapisują się od razu; „Anuluj” i Esc porzucają tylko niezapisane szkice; „Usuń” wymaga drugiego dotknięcia. Historia (zakładka „Historia · N”, licznik wszystkich wpisów `task.history`) pokazuje komentarze jako zwykły tekst z nowymi liniami oraz zmiany stanu, blokad, powiązań i specyfikacji, z autorem „Ty”, „Wektor” lub „panel” i lokalnym czasem; formularz komentarza jest w tej zakładce. Linki zewnętrzne w oknie otwierają nową kartę z `target="_blank"` i `rel="noopener noreferrer"`; linki w czacie pozostają bez zmian. Długie nieprzerwane URL-e i tekst poza kodem zawijają się w dostępnej szerokości, a długie linie kodu przewijają się wewnątrz bloku. Na telefonie (<=760 CSS px) układ jest jednokolumnowy: najpierw specyfikacja/historia, potem panel boczny, stopka pozostaje dostępna. Szkice tytułu, notatki, komentarza, powodu blokady i URL-a PR przetrwają polling co 5 s i przełączanie zakładek. Fokus zostaje w oknie (Tab krąży po polach, przyciskach i linkach) i wraca na zadanie. Tło zamyka okno tylko bez szkiców. Okno jest trzymane po id: odczyt co 5 s nie zamyka go ani nie gubi wpisanych szkiców, również gdy zadanie znika z widoku przez „Ukryj ukończone”. Zamknięcie następuje, gdy zadanie usunięto gdzie indziej; edytowany wiersz jest podświetlony.
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
  `by` (`user`, `wektor`, `claude`, `codex`, `panel`; dawne `agent` jest aliasem `wektor` przy zapisie i odczycie). Zadania leżą w kolejności dodania; pokazywanie otwartych przed ukończonymi to sprawa widoku. Wskaźnik ✦ („Pokaż, co dodał agent”) obejmuje autorów `wektor`, `claude`, `codex` oraz `agent`, nie obejmuje `panel`.
- **Wykonanie** `executor`, `repo`, `mode`: opcjonalne pola wybierane przy przygotowaniu zadania, niezależne od treści
  Markdownu. `executor`: `cezar`, `lokalnie` albo `rozmowa`; `repo`: wyłącznie `desk-panel`; `mode`: `analiza` albo
  `implementacja`. Wartość `null` znaczy „nie wybrano”; stare zadania czytają się jako `null`/`null`/`null` bez przepisywania
  pliku, a `addTask` ich nie przyjmuje i tworzy `null`. Zmienia je tylko `updateTask`: pominięte pole zachowuje wartość,
  `null` je czyści, a nieznana wartość odrzuca całą akcję. Jak tytuł i notatka nie dodają wpisu do historii. Z tych pól i
  specyfikacji panel liczy gotowość (niżej).
- **Specyfikacja i rewizje**:
  - `spec`: pełna specyfikacja Markdown (do 50 000 jednostek UTF-16, bez cichego przycinania; pusta treść oznacza brak specyfikacji).
  - `specRevision`: bieżący numer rewizji (0 tylko przy braku jakiejkolwiek rewizji).
  - `specRevisions`: tablica do 10 ostatnich pełnych rewizji `{revision, spec, by, at}`, najstarsze wypadają po retencji, a numery rosną dalej i nie są ponownie używane. Zapis nowej rewizji dodaje do historii zadania krótki wpis `{kind: 'spec', text: 'vN', by, at}`; utrata wpisu z historii (limit 200) nie usuwa zachowanych rewizji.
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

## Gotowość i prompt bez modelu

`src/todo-dispatch.ts` (`getTodoDispatch`) składa z zadania pełny prompt executora bez udziału modelu i niczego nie zapisuje.
Reguły liczy wspólny `evaluateDispatch`; te same, z identycznymi komunikatami, stosuje dla wątków Fili `getFilaDispatch` (docs/fila.md, „Cezar na wątku”).
Zadanie jest gotowe, gdy ma stan `gotowe`, brak blokady, `executor=cezar`, `repo=desk-panel`, `mode` oraz niepustą
specyfikację z niepustymi sekcjami `CEL:`, `ZAKRES:`, `POZA ZAKRESEM:` i `WARUNKI ODBIORU:`. Przy brakach wynik ma
`prompt: null` i `workflow: null` oraz polskie komunikaty w kolejności: stan, blokada z powodem, executor, repo, mode,
pusty spec, brakujące/puste/powtórzone wymagane sekcje. Nagłówek sekcji to cała linia od kolumny 0, wielkimi literami,
z dwukropkiem (końcowe spacje/taby, BOM i CRLF tolerowane, kolejność dowolna); treść kończy następna etykieta z listy
`CEL, ZAKRES, POZA ZAKRESEM, DECYZJE, WARUNKI ODBIORU, WYKONAWCA, REPO, TRYB, ZAŁĄCZNIKI, TYP ZMIANY, ZRZUTY`, a etykiety
w blokach kodu są pomijane. Zgodnie z CommonMark backtick w opisie otwieracza backtickowego nie otwiera bloku;
po zamykaczu dozwolone są tylko spacje i taby, nie NBSP. Stare `WYKONAWCA`/`REPO`/`TRYB` nie ustawiają pól. Gotowy prompt to `Przygotowane zadanie
Desk Panel`, `Tytuł: <title>`, `Zadanie: <id>`, `Rewizja specyfikacji: <N>`, pusta linia i specyfikacja dosłownie; `analiza`
daje workflow `analysis`, `implementacja` — `desk-panel-task`. Pełny widok agenta (`?zadanie=`) pokazuje przed linią
specyfikacji `Wykonanie: executor=…, repo=…, mode=…` (brak jako `brak`) oraz gotowość bieżącej rewizji: listę braków albo
docelowy projekt, workflow i rewizję. Przy `wersja=N` wybrana jest historyczna treść, a gotowość nadal dotyczy bieżącej
rewizji.

## Zlecenie na Cezarze z okna zadania

Wektor (także `@Zaimplementuj zadanie`) najpierw czyta pełne `panel_todos zadanie=<t-…>` i korzysta z gotowości C1.
Gotowe zadanie kieruje do jego okna: „Pokaż podgląd”, potem „Zleć na Cezarze”; przy niegotowym wymienia braki C1.
Nie robi rekonesansu, nie przepisuje specyfikacji ani nie pokazuje karty dispatch z czatu dla zadania z listy.
Dotychczasowa karta pozostaje dla szybkich próśb spoza list, bez `todoId`; historyczne powiązania kart nadal działają.

Sekcja „Zleć na Cezarze” (w panelu bocznym pod stanem) prowadzi całą ścieżkę bez modelu: selecty `executor`, `repo` i
`mode` z opcją „brak” (od razu `updateTask`; `null` czyści pole), lista braków i dosłowny prompt z C1
(`src/todo-dispatch.ts:getTodoDispatch`), workflow i numer rewizji oraz przycisk zlecenia. Przycisk pojawia się przy
gotowości C1, a aktywny jest dopiero po „Pokaż podgląd”, które rozwija surowy prompt i jest zgodą — kliknięcie nie otwiera
kolejnego dialogu i niczego nie zleca samo. Podczas żądania przyciski są wyłączone. Zmiana danych (także zapisany szkic
tytułu) unieważnia zgodę: podgląd zostaje otwarty, pojawia się „Odśwież podgląd”, a identyczny polling go nie unieważnia.
Utrata gotowości także pozostawia ostatni prompt, obok listy braków i nieaktywnego przycisku zlecenia. „Odśwież podgląd”
pozostaje dostępne; dopóki są braki, zachowuje ostatni prompt, a po ich usunięciu pokazuje bieżący prompt C1.
Szkice tytułu i notatki są najpierw zapisywane (albo porzucane przez „Anuluj”); wynik, link do taska i błąd pokazują się w
tej sekcji. Dotychczasowe akcje, fokus i klawiatura działają bez zmian.

Nowy `POST /api/todos/:id/cezar-dispatch` jest tylko dla interfejsu (nie ma go w MCP) i wymaga `Origin` panelu (`403`).
Ciało to `{expected:{specRevision,title,executor,repo,mode,status,blocked}}` z podglądu. Serwer ponownie czyta zadanie
(`404` dla nieznanego), porównuje expected i liczy C1; zmiana albo braki dają `409` bez zlecenia. Prompt, projekt i workflow
składa wyłącznie C1 na serwerze, a wywołanie idzie przez `sources.cezarCreateRun`; klient nie podaje promptu, modelu ani
workflow. Pełna specyfikacja do 50 000 jednostek UTF-16 plus nagłówek przechodzi bez przycięcia, a podgląd nie ma osobnego
GET-a.

Kluczem rejestru jest `todoId+specRevision+mode`. Ostatni wpis klucza jest sprawdzany w zwykłym snapshocie Cezara
(`sources.cezar()`): task w toku albo zakończony sukcesem blokuje (i pokazuje link), a `POST` odpowiada `409`.
Failed/cancelled albo brak taska w snapshocie pozwalają ponowić bez nowej rewizji, nadal tylko przy gotowości C1;
użytkownik sam przywraca stan „gotowe”. Wyłączony przycisk podczas żądania i kontrola taska na serwerze to cała ochrona
przed ponowieniem — bez replayu i gwarancji exactly-once. Błąd albo timeout mówi „sprawdź Cezara”, bez automatycznego
ponowienia i bez API `unknown`/`failed`.

Udane zlecenia zapisuje istniejący właściciel magazynu kokpitu w `todoDispatches` w `~/.desk-panel/cockpit.json`
(`todoId`, `specRevision`, `mode`, `taskId`, `url`, `at`; stary plik bez pola działa, nie ma drugiego writera). `GET
/api/todos` niesie pochodną listę `cezarDispatches` z ostatnim wpisem każdego klucza (`{todoId,specRevision,mode,taskId,url}`);
to projekcja rejestru, nie zapis w `todos.json` ani nowe pole zadania. Po sukcesie jeden zwykły komentarz zapisuje numer
rewizji i id taska (przy ponowieniu także „ponowienie po nieudanym tasku <id>”), panel dopina link `cezar` i ustawia
`realizacja` (`by: panel`), a PR dołącza później istniejące `linkPrs`/snapshot — także po restarcie i bez otwartego czatu.
Wszystkie zlecone taski zostają w mapowaniu do zadania dla PR; nie ma fikcyjnej rozmowy ani obserwatora. Cezar i PR nie
kończą zadania.

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
| `addTask` | `list`, `title`, `note?`, `by?` | dodaje zadanie na koniec; `by` domyślnie `user`, agent podaje `wektor` (`agent` jest aliasem) |
| `updateTask` | `task`, `title?`, `note?`, `done?`, `by?`, `spec?`, `specRevision?`, `executor?`, `repo?`, `mode?` | zmienia podane pola; zgodność done ze stanem jak wyżej; `spec` i `specRevision` podawane razem według macierzy poniżej; `executor`/`repo`/`mode` to metadane wykonania (`null` czyści, pominięcie zachowuje, bez historii) |
| `setStatus` | `task`, `status`, `by?` | zmienia stan i dopisuje historię |
| `setBlocked` | `task`, `reason` (tekst lub null), `by?` | ustawia/usuwa blokadę i dopisuje historię |
| `addComment` | `task`, `text`, `by?` | dopisuje komentarz Markdown do historii |
| `link` | `task`, `kind`, `id`, `title?`, `by?` | dodaje powiązanie z historią; istniejące jest pozostawiane bez zmian |
| `unlink` | `task`, `kind`, `id`, `by?` | usuwa powiązanie z historią |
| `moveTask` | `task`, `list` | przenosi zadanie na inną listę |
| `deleteTask` | `task` | usuwa zadanie |
| `clearDone` | `list` | usuwa ukończone z listy (`removed`) |

Błędy: `400` (zła akcja lub pola), `404` (nie ma takiej listy lub zadania), `409` (limit, zajęta nazwa lub konflikt specyfikacji), `413` (ciało większe niż 512 KiB dla `updateTask` ze `spec`, ponad 4096 B dla innych akcji).
Nowe akcje zwracają `{ok:true, list:{id,name}, task:{id}}`. Autor `by`: `user` (domyślnie, w UI etykieta „Ty”), `wektor` (wywołania Wektora i wymuszone w `panel_todo_action`, etykieta „Wektor”), `claude` („Claude”), `codex` („Codex”) lub `panel` (automatyka panelu). Stare `agent` jest aliasem `wektor` przy zapisie i odczycie. Puste komentarze i powody blokady są odrzucane; do usunięcia blokady służy null.

**Macierz zapisu specyfikacji w `updateTask`:**
Gdy akcja podaje `spec` i `specRevision` (oczekiwany bazowy numer rewizji szkicu, 0 przy braku jakiejkolwiek rewizji):
1. **Identyczna treść** ze specyfikacją aktualną zadania → sukces bez tworzenia nowej rewizji, niezależnie od podanego `specRevision` (bezpieczne ponowienie).
2. **Treść różna i `specRevision` równy aktualnemu** → zapisuje treść i tworzy nową rewizję `vN` (`v1` dla pierwszego niepustego zapisu, w kolejnych aktualny + 1) z autorem i czasem serwera, dopisując krótki wpis `{kind: 'spec', text: 'vN'}` do historii.
3. **Treść różna i `specRevision` różny od aktualnego** → odrzucenie błędem `409` (konflikt edycji) bez modyfikacji jakichkolwiek danych zadania.

Pierwszy pusty zapis (`spec: ""` przy braku rewizji) to no-op (nie tworzy wersji, numer pozostaje 0). Wyczyszczenie istniejącej specyfikacji tworzy pustą wersję `vN`; kolejny zapis bazuje na `N`. Zapis `updateTask` jest atomowy: błąd `409` lub błąd zapisu pliku nie zapisuje żadnego pola przesłanego w tej samej akcji (ani `title`, ani `note`). Limit specyfikacji to 50 000 jednostek UTF-16 bez cichego przycinania; ciało żądania `updateTask` ze `spec` dopuszcza do 512 KiB, a nagłówek `Origin` równy adresowi panelu jest bezwzględnie wymagany (brak lub obcy Origin daje `403` bez zmiany danych).

Jedyna automatyka: po udanym utworzeniu taska Cezara z karty dispatch z `todoId` (`server/cockpit.ts`) panel dopina link `cezar`
(id, tytuł) i `chat` (id rozmowy), następnie ustawia `realizacja`, wszystko z `by: panel`. Ta sama ścieżka działa z okna
zadania (`POST /api/todos/:id/cezar-dispatch`): dopina tylko link `cezar`, zapisuje komentarz rewizji i taska oraz ustawia
`realizacja`, a zlecenie trafia do `todoDispatches` w `cockpit.json` (bez linku rozmowy). Gdy ten task dostanie PR, panel dopina
link `pr` (pełny URL, tytuł, jeśli jest pod ręką) z `by: panel`, a stanu nie zmienia. `todoId` jest zapamiętany w zapisie dispatchu
(`~/.desk-panel/cockpit.json`), więc link działa też po restarcie i przy zamkniętym oknie czatu; PR pochodzi z istniejącego odczytu
zakończonych zadań Cezara, bez nowego odpytywania. Nieistniejące/usunięte zadanie, błąd zapisu i limit 20 powiązań są tylko logowane
i nie unieważniają udanego dispatchu; powtórzenie istniejącego linku nic nie dopisuje do historii. Bez `todoId` listy pozostają
nietknięte. Nie ma innych automatycznych przejść; automat obserwatora Cezara może po zakończeniu taska wysłać turę do jego
rozmowy ([czat.md](czat.md)), ale nie zmienia stanu zadania z listy. Samo proponowanie karty nic nie zmienia.

## Wskazywanie w czacie

W trybie „Wskaż element” kafelek Zadania jest wskazywany jako **lista**, którą pokazuje (rodzaj `todoList`; ten sam id listy w dwóch kafelkach to jeden element
kontekstu), a pojedynczy wiersz jako **zadanie** (`todo`), bo najbliższy oznaczony element wygrywa. Agent dostaje w bloku `[Kontekst]` id i nazwę listy oraz
zadania do zrobienia z id (ukończone są tylko policzone; do 1800 znaków, nadmiar z odsyłaczem do `/api/agent/todos?list=…`), a przy zadaniu id zadania i listy,
stan PL, blokadę, powiązania, ostatnie 3 komentarze po najwyżej 150 znaków, skrót notatki i autora (`src/todo-context.ts`, całość w limicie znaków). Na początku kontekstu jest odsyłacz: pełna treść przez `panel_todos` z `zadanie=<id t-…>`; pozostaje w kontekście także po przycięciu długiego opisu. Dzięki temu „dodaj tu zadanie” albo „odhacz to” działa bez ponownego czytania list. Kontekst jest zdjęciem z
chwili wskazania (lista odświeża się co 5 s). Kafelek bez listy wskazuje się jak zwykły kafelek, a chip zadania Cezara nazywa się teraz „Task Cezara”.

## Agent czatu

Wektor na Hermesie czyta `panel_todos`, adapter widoku `GET /api/agent/todos` (`?list=<id lub fragment nazwy>`, `&ukonczone=1`, `&stan=<id stanu>`).
Widok list bez parametru `zadanie` pozostaje skrótem: stan z polską etykietą, blokada, powiązania, skrót specyfikacji (`Specyfikacja: vN` lub `Specyfikacja: brak`), notatka do 300 znaków i ostatnie 3 komentarze. Ukończone domyślnie tylko liczy; jawny filtr `stan`
wybiera również terminalne bez `ukonczone=1`. Nieznany stan to 400.

`panel_todos` z `zadanie=<id t-…>` (`GET /api/agent/todos?zadanie=…`) zwraca jedno zadanie z nazwą i id listy, pełną notatką, stanem, blokadą, powiązaniami, metadanymi wykonania i gotowością (`Wykonanie:` oraz `Gotowość bieżącej rewizji:`, przed specyfikacją), pełną aktualną specyfikacją Markdown z metadanymi rewizji (`Specyfikacja (vN, autor, data):`, przy braku specyfikacji: `Specyfikacja: Brak specyfikacji`) oraz wszystkimi zapisanymi komentarzami w kolejności historii, bez ucinania. Obejmuje również zadania zakończone; filtry `list`, `stan` i `ukonczone` nie ograniczają wyboru po id (błędny `stan` nadal daje 400). Opcjonalny parametr `wersja=N` pozwala wybrać zachowaną historyczną rewizję specyfikacji (10 ostatnich); żądanie nieistniejącej lub usuniętej z retencji wersji daje czytelny błąd 404 (`wersja N niedostępna; przechowujemy 10 ostatnich.`). Nieznane id to błąd 404, niepoprawny format id to 400. „Wszystkie” oznacza komentarze obecne w historii zadania, z istniejącym limitem 200 wpisów; model i zapis pozostają bez zmian.

Przy pracy nad zadaniem z listy Wektor najpierw czyta jego pełną treść przez `zadanie=`, nawet gdy dostał skrót wskazania. CEL, ZAKRES, DECYZJE i WARUNKI ODBIORU ze specyfikacji w notatce, polu specyfikacji i komentarzach przenosi do promptu executora w całości, dosłownie, bez skracania ani tłumaczenia; ta zasada ma pierwszeństwo przed angielskim formatem briefu. Własnych poleceń od użytkownika nie zamienia w kryteria, a lista plików obejmuje wszystkie moduły, przez które przechodzi zmiana (kontrakt, adaptery, widoki, testy). Rekonesans tylko uzupełnia ustalenia. Reguła jest w `PANEL_GUIDES.zadania` oraz `CHAT_SKILLS` (`@Zaimplementuj zadanie`) w `src/chat-contract.ts`.

Zmienia zadania przez `panel_todo_action`, który wymusza `by: wektor` dla każdej akcji mającej autora (stare `agent` jest aliasem `wektor`). `TODO_FIELDS` jest wyprowadzane z kontraktu, obejmuje nowe akcje.
Instrukcje żyją w kodzie: `PANEL_GUIDES.zadania` w `src/chat-contract.ts` i preambuła w `server/hermes-chat.ts`. Stan zmienia na prośbę użytkownika;
ustalenia zapisuje komentarzem lub specyfikacją (`updateTask` ze `spec`/`specRevision`), gdy o to prosi; przy propozycji Cezara z zadania podaje `todoId`, a stan i linki zapisuje panel po kliknięciu karty.
Zasady z instrukcji: samo „zadanie” to zadanie z listy; przy `addTask` zawsze `"by":"agent"` (lub `"wektor"`); bez wskazanej listy używa jedynej, tej o pasującej
nazwie, a gdy niepewny, pyta; gdy list nie ma, tworzy „Zadania”; usuwa (`deleteTask`, `clearDone`, `deleteList`) tylko na wyraźną prośbę i
mówi, co zmienił. Szczegóły czatu: [docs/czat.md](czat.md).

## Scenariusze i testy

Scenariusz może mieć pole `todos` w kształcie źródła (listy startowe; bez niego listy są puste i połączone). Listy ze scenariusza są
wczytywane przy pierwszym użyciu, a zmiany z akcji pamiętane w pamięci do restartu, jak akcje poczty. `scenarios/standard.json` ma dwie listy
(jedną z zadaniami „do poprawy” czatu). Testy: `server/todos.test.ts` (sklep, plik, schematy, trasa, widok agenta).
