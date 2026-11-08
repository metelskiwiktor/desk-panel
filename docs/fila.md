# Fila: rdzeń wątków, zapytania i tablice

Fila to moduł wątków (sprawy, funkcje, błędy, notatki, spotkania) w projektach. Koncept: `C:\Tabularium\Incepta\DeskPanel\Mea\Fila` (Model, Decyzje; numery D-… niżej pochodzą stąd). Ten dokument opisuje **części 1.1a–1.4b etapu 1**: trwały rdzeń, HTTP API, Specyfikacje z rewizjami, zapytania i tablice, MCP z czterema narzędziami (klienci i Wektor), Cezara na wątku oraz migrator offline. Obecne listy zadań (docs/zadania.md) działają bez zmian aż do końcowego przełączenia (1.6); działająca Fila ich nie czyta ani nie zmienia. Warsztat słonia i rybek (1.3b) opisuje sekcja „Warsztat specyfikacji (1.3b)”. Interfejs 1.5 powstaje częściami w odizolowanym podglądzie (sekcja „Interfejs (1.5)”); przełączenia (1.6) jeszcze nie ma.

## Gdzie co jest

| Co | Plik |
| --- | --- |
| kontrakt danych i akcji (zod), limity, typy | `src/fila-contract.ts` |
| tekst zapytania: składnia, parser, postać kanoniczna (wspólne dla serwera i GUI) | `src/fila-query.ts` |
| sprawdzenie zapytania względem danych i jego wykonanie | `server/fila-query.ts` |
| tablice, widoki, sekcje, kolumny, tablica startowa | `server/fila-boards.ts` |
| gotowość C1, podgląd i klucz rejestru wątku (wspólne z GUI) | `src/fila-dispatch.ts` (reguły C1 wspólne z listami: `evaluateDispatch` w `src/todo-dispatch.ts`) |
| zlecenie Cezara z wątku (HTTP) | `server/fila-dispatch.ts` |
| magazyn i reguły domenowe | `server/fila.ts` |
| HTTP, tożsamość, tokeny | `server/fila-routes.ts` |
| MCP: cztery narzędzia, wejście klientów `/api/fila/mcp` | `server/fila-mcp.ts` (paczka atomowa i klucz idempotencji: `applyBatch` w `server/fila.ts`) |
| izolowany panel do prób z prawdziwymi klientami | `scripts/fila-trial.ts` (`just fila-trial`) |
| migrator offline: plan, porównanie, próba i odtworzenie kopii | `server/fila-migration.ts`, `scripts/fila-migrate.ts` (`just fila-migrate`); transformacja kopii kokpitu: `migrateCockpitCopy` w `server/cockpit.ts` |
| dane usługi | `~/.desk-panel/fila.json` (poza Gitem) |
| tokeny klientów | `~/.desk-panel/fila-tokens.json` (poza Gitem) |
| scenariusz | klucz `fila` w `scenarios/*.json` (ten sam schemat co dane), tylko w pamięci |
| interfejs 1.5 (część 1: tablica i kafelek) | `src/fila/` (`api.ts` odczyt i akcje, `ui.tsx` wybór Stanu, menu, okna i edytor zapytania, `threads.tsx` wiersze i karty, `FilaApp.tsx` ekran, `FilaTile.tsx` kafelek, `fila.css`); test `scripts/fila-ui.test.mjs` |

`PanelSources.fila` jest opcjonalne: `real-sources.ts` daje magazyn w pliku, `scenario.ts` magazyn w pamięci zasiany ze scenariusza (bez klucza: workflow Praca i zero projektów). Scenariusz, podgląd i testy nigdy nie zapisują danych usługi.

## Model w tej części

- **Projekt**: klucz, dokładnie cztery wielkie litery A–Z (`^[A-Z]{4}$`, unikalny, niezmienny), nazwa, lista wartości Moduł, licznik `nextNumber`. Projektów na start nie ma w kodzie: trzy projekty (DESK, CEZR, TABL) założy migracja 1.4b.
- **Wątek**: ID `KLUCZ-numer` (np. `DESK-32`), wewnętrzny stały `uid` (rodzic wskazuje `uid`, więc przeniesienie nie zrywa relacji), typ (niezmienny), workflow, Stan, tytuł, opis, rodzic (dowolna głębokość, także w innym projekcie, bez cykli), Moduł, pola, `archived`, `revision`, historia.
- **Typy**: pięć szablonów w kodzie (Sprawa, Funkcja, Błąd, Notatka, Spotkanie), każdy z polem Tagi i workflow Praca. Funkcja i Błąd mają pole Specyfikacja z szablonu, pozostałe typy mogą je dostać (sekcja „Specyfikacja i rewizje”); Kiedy/Termin (etap 3) i Implementacja Cezara (etap 2) nie istnieją. Typów nie edytuje się.
- **Workflow**: dane (id `w-…`), uporządkowana lista Stanów z flagą zamykającą. Seed „Praca” = dzisiejsze stany (`TODO_STATUSES`): Pomysł · Do przygotowania · Gotowe do realizacji · W realizacji · Do sprawdzenia · **Zakończone** · **Porzucone**. Nowy wątek dostaje pierwszy Stan. Wątek jest zamknięty, gdy jego Stan jest zamykający (`closed`); checkboxa nie ma (D-070).
- **Pola własne** (D-047): definicja globalna (nazwa, rodzaj `text|number|date|bool|multi`), pierwsze użycie ustala rodzaj (`setField` z `kind`), potem nazwa znaczy to samo wszędzie; porównanie nazw bez względu na wielkość liter. `date` to `RRRR-MM-DD`, `multi` to lista bez duplikatów. Zastrzeżone nazwy (Stan, Moduł, Tytuł, Opis, Typ, Projekt, Workflow, Rodzic, Specyfikacja, Kiedy, Termin, Zablokowane, Implementacja Cezara, ID) nie są polami własnymi. Zmiana rodzaju pola i usunięcie globalnej definicji są **odłożone poza etap 1, bez terminu** (Q-032); z wątku pole można usunąć (`removeField`).
- **Historia**: każdy wpis ma autora, czas i zmianę (`changes: pole, było, jest`; długie teksty obcięte do 200 znaków). Komentarz to wpis historii (`kind: comment`). Historii nie obcina się (inaczej niż w listach zadań, które trzymają 200 wpisów): ma ją każda zmiana pola, Stanu, tytułu, opisu, rodzica, workflow, projektu, archiwizacji i usunięcia pola.
- **Rewizja** (`revision`) rośnie przy każdej zmianie danych wątku (nie przy komentarzu). Każda akcja zmieniająca wątek przyjmuje opcjonalne `expectedRevision`; niezgodne = 409, nic się nie zmienia.

## Reguły, które odbiór sprawdza

- **Przeniesienie** (`updateThread` z `project`) dotyczy wskazanego wątku, nie podwątków: dostaje kolejny numer projektu docelowego, stare ID trafia do pola „Dawne ID” (`multi`, tworzone przy pierwszym przeniesieniu), dane i relacje zostają, przekierowania ze starego ID nie ma (404). Podwątki zostają w swoim projekcie i wskazują przeniesionego rodzica.
- **Numery nie wracają do puli**: licznik projektu tylko rośnie, po usunięciu i po przeniesieniu też.
- **Pasuje albo jawnie**: przy zmianie projektu lub workflow Stan pasuje, gdy workflow ma Stan o tej samej nazwie (dokładnie), a Moduł, gdy projekt docelowy ma tę wartość. Niepasujący wymaga w **tej samej operacji** nowego Stanu albo nowego Modułu lub `module: null`. Brak wyboru = odrzucenie całej operacji (409). Projekt bez wartości Modułu też nie kasuje Modułu po cichu.
- **Rodzic**: cykl (własny przodek) odrzucony. Trwale usunięcie rodzica zeruje rodzica jego dzieci, z wpisem w ich historii. Zarchiwizowany rodzic nic nie zmienia dzieciom.
- **Archiwizacja** (D-037) to osobna właściwość: Stan zostaje, przywrócenie oddaje wątek bez zmian. **Trwałe usunięcie** tylko z archiwum i tylko przez użytkownika (D-038).
- Definicji w użyciu nie da się pozbawić wartości: `setModules` bez Modułu używanego przez wątek i `updateWorkflow` bez Stanu używanego przez wątek są odrzucone (409). Zmiana nazwy Stanu: nowy Stan, przeniesienie wątków, potem usunięcie starego.

## Uprawnienia i tożsamość

Autor zmiany **nigdy nie pochodzi z akcji** (pole `by` jest odrzucane jako nieznane); serwer bierze go z uwierzytelnienia (D-006):

| Wywołanie | Autor |
| --- | --- |
| `Authorization: Bearer <token klienta>` z loopbacku | ten klient: `claude-desktop`, `claude-code`, `codex`, `wektor` (D-057); rola AI, także gdy żądanie ma Origin panelu |
| bez tokenu, `Origin` = adres panelu | `user` (GUI bez loginu, jak inne akcje panelu) |
| bez tokenu i bez Origin panelu, inny Origin | 403 |
| token niepoprawny | 401, także przy odczycie; nic się nie zapisuje |
| token przez nazwę Tailscale | 403 (tokeny tylko lokalnie, jak `/api/mcp`) |

Odczyty (`GET`) są jak inne widoki panelu, bez uwierzytelnienia.

| Operacja | Użytkownik | AI |
| --- | --- | --- |
| założenie projektu (`createProject`), wątku, zmiana tytułu/opisu/pól/Stanu/Modułu/rodzica/projektu, przypisanie istniejącego workflow, komentarz, archiwizacja i przywrócenie | tak | tak |
| definicja workflow i jego Stany (`createWorkflow`, `updateWorkflow`), wartości Modułu (`setModules`) | **nie** (403) | tak |
| trwałe usunięcie z archiwum (`deleteThread`) | tak | **nie** (403) |

Refuzja (rola, walidacja, konflikt) niczego nie zapisuje. Wspomniane „Origin chroni przeglądarkę, nie izoluje procesu tego samego konta”: proces lokalny może wysłać Origin panelu i być użytkownikiem; tak jest we wszystkich akcjach panelu (AGENTS.md), a token chroni przed pomyleniem klienta AI z człowiekiem, nie przed złośliwym procesem tego samego konta.

### Tokeny

`filaTokens()` tworzy przy starcie `~/.desk-panel/fila-tokens.json` (po jednym 64-znakowym tokenie na klienta, uzupełnia brakujące) i nie nadpisuje istniejących. Plik jest poza Gitem; token nie trafia do przeglądarki, odpowiedzi, cache ani logu (test sprawdza, że odpowiedzi go nie zawierają). Porównanie stałoczasowe. Klient bierze swój token z tego pliku (podłączenie MCP: sekcja „MCP”). Procesy agy nie dziedziczą `panel.env`, ale mogą odczytać plik jak każdy proces tego użytkownika: to zmniejszenie ekspozycji, nie izolacja (docs/hermes.md). Minimalne uprawnienia: token daje dostęp wyłącznie do `/api/fila` (zapis wątków i projektów, bez dostępu do poczty, Cezara, banku ani czatów); Fila nie używa zewnętrznego API ani klucza dostawcy, więc nie ma próby live u dostawcy.

## API

Wszystko pod `/api/fila`, JSON, `Cache-Control: no-store`.

| Metoda i ścieżka | Odpowiedź |
| --- | --- |
| `GET /api/fila` | rejestry: `projects` (z `counts` otwarte/zamknięte/archiwum i `board`: id tablicy startowej albo `null`), `boards` (id, nazwa, widoki), `workflows`, `types`, `fieldDefs`, `notice` |
| `GET /api/fila/threads/KLUCZ-n` | wątek: pola, `closed`, `parent`, `children`, `createdBy`, `history` |
| `POST /api/fila/action` | jedna akcja, odpowiedź `{ ok, project? \| workflow? \| thread: { id, revision, previousId? } \| removed? }` |

Akcje (`action`): `setSpec`, `addSpecField`, `removeSpecField` (niżej), `createProject`, `setModules`, `createWorkflow`, `updateWorkflow`, `createThread`, `updateThread`, `setField`, `removeField`, `addCezarKit`, `removeCezarKit`, `setCezar`, `linkCezar`, `unlinkCezar`, `comment`, `archiveThread`, `restoreThread`, `deleteThread` (pola: `src/fila-contract.ts`). Błąd: `{ "error": "zdanie po polsku" }` ze statusem 400 (kształt), 403 (rola), 404, 409 (konflikt, reguła domenowa) albo 413. Odczyt Specyfikacji: `GET /api/fila/threads/KLUCZ-n/spec` (bieżąca) i `…/spec/N` (rewizja N). Listowanie wątków to zapytania (niżej).

## Specyfikacja i rewizje (1.1b)

Zaprogramowane pole wątku (nie pole własne; nazwa zastrzeżona). Kontrakt, na którym opiera się 1.3 (MCP, runner, skille słonia i rybki); GUI nie ma (1.4–1.6).

- **Pole**: Funkcja i Błąd mają je od utworzenia; do dowolnego innego typu dodaje je `addSpecField`, a `removeSpecField` zdejmuje (obie tylko AI; zmiana pola to wpis historii i rewizja wątku, powtórzenie bez zmiany nic nie robi). Wątki zapisane przed 1.1b czytają się z polem z szablonu i bez rewizji.
- **Zapis** `{ action: "setSpec", thread, text, baseRevision }`: tylko AI (użytkownik 403, `by` odrzucone jako nieznane, autor z tokenu); `text` najwyżej **50 000 jednostek UTF-16** (dłuższy: 400; limit jak w zadaniach); `baseRevision` wymagane (0 = jeszcze nie ma rewizji). Odpowiedź ma `specRevision`.
  - Inna treść niż bieżąca i `baseRevision` = numer bieżącej rewizji: nowa rewizja n+1 (pełna treść, klient, czas serwera), rewizja wątku rośnie, w historii wpis `Specyfikacja: v(n) → v(n+1)`.
  - Inna treść i nieaktualna baza: **409**, bez zmiany treści, numeru, historii i innych pól.
  - Ta sama treść co bieżąca, **niezależnie od bazy**: nic się nie zmienia, odpowiedź z bieżącym numerem (bezpieczne ponowienie). Pierwszy zapis pustej treści (brak rewizji) jest więc no-opem; wyczyszczenie istniejącej treści to nowa, pusta rewizja.
  - Brak pola na wątku: 409 z podpowiedzią `addSpecField`.
- **Odczyt** (jak inne GET-y), odpowiedź `{ thread, enabled, revision, text, by, at, latest }`:

  | Wywołanie | Wynik |
  | --- | --- |
  | `/spec`, pole jest, brak rewizji | 200, `revision: 0`, `text: null` |
  | `/spec`, pole jest, pusta rewizja | 200, `text: ""` |
  | `/spec`, pola nie ma na wątku | 404 |
  | `/spec/N`, rewizja istnieje (także po zdjęciu pola) | 200 |
  | `/spec/N`, N większe niż najnowsza (lub brak rewizji) | 404 z numerem najnowszej |
  | `/spec/N`, N nie jest liczbą całkowitą ≥ 1 | 400 |
  | wątek nie istnieje | 404 |
- **Zdjęcie i powrót pola**: rewizje zostają i są czytelne po numerze, zapis jest odrzucony; po `addSpecField` bieżąca treść to ostatnia rewizja, a numeracja idzie dalej. Rewizje trzymane są wszystkie, bez limitu liczby (w listach zadań 10); `GET /api/fila/threads/ID` pokazuje tylko `spec: { enabled, revision }`.
- **Przeniesienie** zachowuje rewizje (są w wątku, nie w ID); trwałe usunięcie usuwa je z wątkiem. Rewizje leżą w `fila.json` przy wątku (bez migracji).

## Zapytania (1.2)

Zapytanie to **jedna linia tekstu** (Q-008): postać kanoniczna dla AI, API, MCP (1.3) i „pigułek” GUI (1.5). `src/fila-query.ts` parsuje tekst do struktury (`FilaQuery`) i formatuje z powrotem (`parse(format(q)) = q`); GUI i MCP używają tego samego kodu, nie mają odrębnego silnika. Nazwa modułu to *fila* (Q-023).

```
projekt = DESK AND typ IN (funkcja, błąd) AND stan = "W realizacji" AND moduł = "Wektor" AND tag = "x"
AND pole("Koszt") = 3 AND pole("Etykieta") istnieje AND otwarte AND rodzic brak AND archiwum = tylko
SORTUJ stan malejąco, tytuł
```

- Warunki łączy `AND` (albo `i`); wielkość liter i polskie znaki w słowach kluczowych nie mają znaczenia (`moduł`/`modul`). Tekst w cudzysłowie (`\"` to cudzysłów). Kanonicznie: słowa kluczowe małymi literami, `AND`/`IN`/`SORTUJ` wielkimi, klucz projektu wielkimi, typ jako klucz (`funkcja`, `blad`…), wartości tekstowe w cudzysłowie; jedna wartość to `=`, kilka to `IN (…)`; domyślne (`archiwum = wyklucz`, brak sortowania) się pomija.
- **Projekt**: `projekt = KLUCZ`, **jeden, wymagany** w zapytaniu sekcji i samodzielnym; zapytanie kolumny go nie ma (dziedziczy). Kilka projektów i „wszystkie” (`IN`, `*`, lista po przecinku) → 400 „nie są obsługiwane w etapie 1”.
- **Filtry**: `typ`, `stan`, `moduł`, `tag` (`=` albo `IN`; kilka warunków tego samego rodzaju = wszystkie naraz, `IN` = którykolwiek); `pole("Nazwa") = wartość`, `pole("Nazwa") istnieje`, `pole("Nazwa") brak`; `otwarte` albo `zamknięte` (ze Stanu zamykającego, D-018; **brak warunku = jedno i drugie**); `rodzic brak`, `rodzic istnieje`, `rodzic = ID` (ID z dowolnego projektu); `archiwum = wyklucz|włącz|tylko`.
- **Archiwum** (D-037): domyślnie wykluczone, `włącz` daje oba, `tylko` samo archiwum.
- **Stan** to dopasowanie po nazwie (bez względu na wielkość liter) w workflow wątku (D-015): Stan, którego żaden workflow nie ma, daje brak trafień. Tak samo `moduł` spoza projektu i tag, którego nikt nie użył: **brak trafień, nie błąd**.
- **Pola własne**: wszystkie rodzaje z D-047. Wartość: liczba (`3`, `2.5`), `tak`/`nie`, data `RRRR-MM-DD` (dosłowna równość), tekst w cudzysłowie; pole `multi` pasuje, gdy lista **zawiera** wartość. `istnieje` = wątek ma niepustą wartość (pusty tekst i pusta lista to „brak”). **Błąd 400**: nieznana definicja pola, wartość niezgodna z rodzajem (np. tekst do liczby, liczba bez cudzysłowu do tekstu), nazwa zastrzeżona (`pole("Stan")` → użyj `stan`).
- **Poza etapem 1, zgłasza 400**: `Kiedy`, `Termin`, `Zablokowane`, `Implementacja Cezara`, `Specyfikacja` w `pole(…)`, `kiedy`/`termin`/`data` jako filtr, operatory `<`, `>`, `!=`, `~` i daty względne (Q-016, etap 3), kilka projektów.
- **Sortowanie** (`SORTUJ klucz [rosnąco|malejąco], …`, najwyżej 3 klucze): `stan` (kolejność Stanu w workflow, D-034), `tytuł` (bez względu na wielkość liter i polskie znaki), `id` (projekt, potem numer). **Domyślnie ID rosnąco; remisy zawsze rozstrzyga ID rosnąco.** Ręcznego porządkowania wątków nie ma.

### Odczyt zapytań

| Wywołanie | Odpowiedź |
| --- | --- |
| `GET /api/fila/query?q=TEKST[&limit=N&offset=M]` | `{ query, project, total, threads }`; `query` to postać kanoniczna, `threads` to wiersze (`id`, `type`, `state`, `closed`, `title`, `parent`, `module`, `fields`, `archived`, `revision`, `updatedAt`); `limit` domyślnie 500, najwyżej 5000 |
| `GET /api/fila/query/check?q=TEKST[&kind=column]` | `{ ok: true, text, query }` (postać kanoniczna i struktura) bez wykonania i bez zapisu; `kind=column` sprawdza zapytanie kolumny (bez projektu) |
| błąd zapytania | 400 `{ error }` z jednym zdaniem po polsku, co zmienić |

## Tablice (1.2)

Tablica to **nazwa i widoki, bez własnego zakresu** (D-013). Widok ma uporządkowane sekcje (min. 1), sekcja ma `kind`: `list` albo `kanban`, tekst zapytania i (kanban) kolumny, każda z własnym zapytaniem. Zapytania są trzymane w postaci kanonicznej i sprawdzone przy zapisie (projekt istnieje, pola istnieją; poprawne zapytanie nie psuje się później, bo definicji pól nie usuwa się, Q-032).

- **Wynik**: sekcja listy = jej zapytanie. Kanban: **kolumna = zapytanie sekcji AND zapytanie kolumny**; projekt i archiwum dziedziczy po sekcji, sortowanie ma własne, a gdy go nie ma, sekcji; wątek spoza wszystkich kolumn w kanbanie nie występuje (sekcja kanbanu sama nie pokazuje wątków). Wątek pasujący do kilku sekcji jest w każdej (D-014). Zapytanie kolumny nie może mieć `projekt` ani `archiwum` (400): oba ustala sekcja.
- **Odczyt**: `GET /api/fila/boards/b-…` (struktura, `project` tablicy startowej albo `null`, historia), `GET /api/fila/boards/b-…/views/v-…[?limit=N]` (każda sekcja z wątkami; kanban z `columns[].threads`; `total` to pełna liczba). Sekcja, której zapisanego zapytania nie da się wykonać, ma `error`, a reszta widoku odpowiada.
- **Akcje** w `POST /api/fila/action` (id: `b-`, `v-`, `s-`, `c-` + 8 znaków hex, unikalne w całych danych; cel wskazuje samo id): `createBoard` (nazwa, `view?`, pierwsza `section`), `renameBoard`, `deleteBoard`; `createView` (`board`, `name`, `section`, `position?`), `renameView`, `moveView`, `deleteView`; `createSection` (`view`, `section`, `position?`), `updateSection` (`name?`, `query?`), `moveSection`, `deleteSection`; `createColumn` (`section`, `name`, `query`, `position?`), `updateColumn`, `moveColumn`, `deleteColumn`. Sekcja = `{ name, kind, query, columns? }`; rodzaju sekcji się nie zmienia (usuń i utwórz). `position` liczone od 0, poza zakresem = 409. Ostatniego widoku tablicy i ostatniej sekcji widoku nie usuwamy (409); lista nie ma kolumn (400); kolumny tworzy się tylko w kanbanie (409).
- **Uprawnienia i tożsamość**: **użytkownik i AI jednakowo** (D-032, D-060), bez ról jak przy workflow; autor z uwierzytelnienia jak w 1.1a (`by` w akcji odrzucone). Odmowa niczego nie zapisuje.
- **Historia tablicy** (D-062, `history` tablicy): wpis na każdą zmianę struktury i ustawień: `kind` (`created`, `renamed`, `changed`, `moved`, `removed`), `target` (`board`, `view`, `section`, `column`), `name`, `in` (widok sekcji, sekcja kolumny), `changes` (`field`, `from`, `to`: nazwa, zapytanie, pozycja liczona od 1), autor, czas. Powtórzenie bez zmiany (ta sama nazwa, to samo zapytanie, ta sama pozycja) nic nie zapisuje. Autorem tablicy startowej utworzonej wstecznie jest `panel`.
- **Tablica startowa** (D-019): `createProject` w tej samej operacji tworzy tablicę o nazwie projektu z widokiem „Widok” i jedną sekcją listy „Wszystkie wątki” o zapytaniu `projekt = KLUCZ` (bez filtra zamknięcia: otwarte i zamknięte). Przy pierwszym wczytaniu danych każdy projekt bez wpisu w `starterBoards` dostaje taką tablicę **jednorazowo** (projekty sprzed 1.2). Wpis `starterBoards[projekt] = id tablicy` jest osobnym zapisem w `fila.json` i zostaje po usunięciu tablicy, więc **usunięta tablica projektu nie odtwarza się po restarcie**, a restart bez usunięcia niczego nie dubluje. Tablicę projektu rozpoznaje `projects[].board` (a `GET …/boards/b-…` pole `project`); `null` = usunięta.

## Cezar na wątku (1.4a)

Gotowość i zlecanie Cezarowi działają na wątku **tak jak dziś na zadaniu z listy** (docs/zadania.md); stare listy i ich ścieżka `POST /api/todos/:id/cezar-dispatch` zostają bez zmian aż do 1.6. Żadnego nowego dispatchu AI, podwątków Implementacja Cezara ani blokady D-040 (etap 2) tu nie ma.

- **Zestaw pól Cezara** (`cezar` w widoku wątku): `enabled`, `executor`, `repo`, `mode`, `blocked`, `links`. Dodaje go do dowolnego typu `addCezarKit` (zdejmuje `removeCezarKit`; użytkownik i AI, bo to zwykłe pola wątku, nie definicje). Słowniki jak w listach: `executor` = `cezar|lokalnie|rozmowa`, `repo` = `desk-panel`, `mode` = `analiza|implementacja`, `null` = nie wybrano, nieznana wartość 400. `setCezar` (`executor`, `repo`, `mode`, `blocked`, `expectedRevision`) zmienia je; pusta blokada czyści; zmiana to wpis historii i rewizja wątku, powtórzenie nic nie robi. Blokada `blocked` (do 300 znaków) to dzisiejsza ręczna blokada; automatyczne blokowanie po błędzie Cezara to dopiero D-040.
- **Task i PR** to powiązania (`links`: `{kind: cezar|pr, id, title?, at}`), nie pola edytowalne: unikalne po `kind+id`, najwyżej 20, PR to pełny URL `https://github.com/<owner>/<repo>/pull/<n>`. `linkCezar` i `unlinkCezar`; powtórzenie istniejącego powiązania nic nie dopisuje. Bez dodanego zestawu `setCezar` i powiązania dają 409. Dane zostają po `removeCezarKit`, żeby rejestr i powiązania nie traciły sensu.
- **Autor `panel`**: wpisy po dispatchu (powiązanie, komentarz, Stan) mają autora `panel`. Nie da się go uzyskać przez HTTP (autor z uwierzytelnienia to użytkownik albo klient); wewnętrzny `panel` może tylko `linkCezar`, `unlinkCezar`, `comment` i `updateThread` (inaczej 403).
- **Gotowość C1** (`getFilaDispatch`) to ta sama funkcja co dla zadania (`evaluateDispatch`), więc braki, ich kolejność i **komunikaty są identyczne**: Stan „Gotowe do realizacji” workflow Praca (inne workflow nie jest gotowe), brak blokady, `executor=cezar`, `repo=desk-panel`, `mode`, Specyfikacja z sekcjami `CEL`, `ZAKRES`, `POZA ZAKRESEM`, `WARUNKI ODBIORU` (wątek bez pola Specyfikacja albo bez rewizji: „Brak specyfikacji.”). `executor=lokalnie` nadal daje brak gotowości dla Cezara i niczego nie zmienia automatycznie. Prompt ma format listowy; w linii `Zadanie:` stoi **bieżące ID wątku** (np. `DESK-32`), `Rewizja specyfikacji` to rewizja Specyfikacji wątku.
- **Podgląd** liczy GUI tą samą funkcją z `src/fila-dispatch.ts` na danych wątku i Specyfikacji (bez osobnego endpointu podglądu). `expected` to odpowiedniki dzisiejszej siódemki: `{specRevision, title, executor, repo, mode, state, blocked}` (`state` to nazwa Stanu).
- **Zlecenie** `POST /api/fila/threads/ID/cezar-dispatch` z ciałem `{expected}`: tylko kliknięcie użytkownika, `Origin` panelu wymagany; żądanie z `Authorization` (token klienta) dostaje 403 także z Origin panelu; nieznany wątek 404. Serwer ponownie czyta wątek i Specyfikację, porównuje `expected` (zmiana → 409 „odśwież podgląd”), sam liczy C1 (braki → 409) i wysyła przez `sources.cezarCreateRun` prompt, projekt i workflow z C1; ciało nie przyjmuje promptu, modelu, workflow ani runnera (400). Zmiana danych unieważnia zgodę z podglądu. Równoległe żądanie tej samej rewizji i trybu spotyka 409.
- **Rejestr** w tym samym `~/.desk-panel/cockpit.json` (`threadDispatches`; jeden właściciel, stary plik bez pola działa). Kluczem jest **`uid` wątku + rewizja Specyfikacji + tryb**, więc przeniesienie wątku (nowe ID) ani restart nie omijają blokady ponowień. Reguła powtórzeń jak dziś: ostatni wpis klucza sprawdzany w zwykłym snapshocie Cezara (`sources.cezar()`); task w toku albo zakończony sukcesem blokuje (409 z linkiem), failed/cancelled albo brak taska pozwalają ponowić po ponownym ustawieniu Stanu „Gotowe do realizacji” przez użytkownika. Błąd lub timeout Cezara to 502 „sprawdź Cezara”: nic się nie zapisuje i nic nie ponawia się samo. Odczyt: `GET /api/fila/threads/ID/cezar-dispatch/register` → `{thread, dispatches: [{thread, specRevision, mode, taskId, url}]}` (projekcja ostatniego wpisu każdego klucza; `thread` to ID z chwili zlecenia).
- **Po sukcesie** panel dopina powiązanie `cezar`, jeden komentarz (rewizja i id taska, przy ponowieniu „Ponowienie po nieudanym tasku …”) i ustawia Stan „W realizacji”, wszystko jako `panel`; błąd opisu nie cofa zleconego runa (tylko log). PR taska dopina później istniejący odczyt zakończonych tasków (`cockpit.linkPrs`) do wątku znalezionego po `uid` (`FilaStore.idOfUid`), także po restarcie i przeniesieniu; PR ani koniec taska nie zmieniają Stanu wątku.
- **Nie ma wspólnego rejestru ze starą ścieżką**: do 1.6 produkcyjnie używane są tylko listy, a nowa ścieżka jest sprawdzana osobno (nie zakładamy dispatchu tej samej rzeczy z dwóch magazynów). Zachowanie blokad i historii przy migracji należy do 1.4b (rejestr `threadDispatches` ma `uid`, więc migrator może zasilić go z `todoDispatches`).
- **Rozstrzygnięcia wykonawcy**: techniczny klucz rejestru to `uid`; w rozmowie nie powstaje powiązanie z czatem (brak kontekstu rozmowy w tym zleceniu); do Cezara nie idzie `todoId` (to pole listy).

## Migrator i propozycja przełączenia (1.4b)

`just fila-migrate preview|trial|rollback KATALOG_KOPII` jest narzędziem **offline**. Nie ma trybu zapisu do usługi ani flagi akceptacji. Plan zawsze ma `status: proposal`, raport `approved: false`, `cutoverAllowed: false` — nawet poprawna próba z kompletnymi danymi nie stanowi zgody użytkownika. Program nie klasyfikuje zadań, nie wywołuje modelu i nie czyta tokenów, konfiguracji usług ani zewnętrznych API. Konkretne przypisania przygotowuje AI jako dane planu; użytkownik zatwierdza je przed 1.6.

### Wejście i plan

W osobnym katalogu poza repo (zalecane `~/.desk-panel/fila-migration/<nazwa-próby>`) przygotuj:

- `offline.json`: `{ "version": 1, "kind": "fila-migration-copy" }` — jawny znacznik kopii.
- `input.json`: `{ todos, cockpit, workspaces, contexts, coverage }`. `todos` to kopia `todos.json` v1/v2 (albo `{lists}`), `cockpit` to kopia `cockpit.json`. `workspaces` to eksporty `{source, raw}`: nazwa urządzenia/origin/profilu i klucz pulpitu oraz oryginalny tekst JSON `desk-panel.workspace*`. `contexts` zawiera zachowane wskazania `{source, kind, id, ...}` z kopii kontekstów rozmów (Hermes: `turns[].context`, stare AGY: `items[].context`), bez przepisywania plików rozmów. `coverage: {workspaces, contexts, notes: []}` jawnie określa kompletność inwentaryzacji; brak eksportu nie jest pustym pulpitem.
- `plan.json`, kontrakt `migrationPlanSchema` w `server/fila-migration.ts`: `version:1`, `id`, `status:"proposal"`, `at` (stały czas utworzenia projektów/tablic), `sourceHash` = SHA-256 kanonicznego całego wejścia (`migrationHash`), `records`, `tiles`, `unresolved`. Kanonizacja sortuje klucze obiektów, zachowuje kolejność tablic. Zmiana któregokolwiek wejścia wymaga nowego skrótu, przeglądu planu i próby.

Każdy `records[]` zawiera `oldId`, `project` (`DESK|CEZR|TABL`), `type`, `newId`, `uid`, `module` (także null), `fields`, `reason`, `unresolved:[]`. Numery i uid są jawnymi danymi planu, a nie wynikiem heurystyki migratora. Każdy `tiles[]` zawiera `source`, `tile` (id kafelka w danym eksporcie), **jedno** `query`, `settings`, `reason`, `unresolved:[]`. Plan musi zawierać dokładnie wszystkie zadania i kafelki Zadania z wejścia; nadmiar, brak i powtórzenia są odrzucane. Niepoprawny workspace, zapytanie, nieznane dane zadania, kolizja definicji pola i brak/sprzeczność bieżącej rewizji także odrzucają próbę; szczegół jest w prywatnym `report.json`, konsola nie drukuje treści walidowanych danych.

Projekty nie odwzorowują list 1:1. Pole `Dawna lista` (text, stare id listy) zachowuje pochodzenie i pozwala przygotować precyzyjne warianty zapytań, np. `projekt = DESK AND pole("Dawna lista") = "l-12345678" AND otwarte`. Pole `Dawne ID` (multi) zawiera `t-…`. Oba ustala migrator; nie mogą być nadpisane polami planu. W planie i raporcie trzeba ocenić, które zapytanie naprawdę ma dostać kafelek: lista rozdzielona między projekty nie mieści się w jednym zapytaniu etapu 1. Raport pokazuje `oldIds`, `newIds`, `added`, `removed`, oryginalną geometrię/config, nowy config oraz stare `hideDone`/`showAgent`; każda różnica wymaga decyzji, a nie cichego dopasowania. `hideDone` wyraża filtr `otwarte`; `showAgent` i inne zaakceptowane opcje idą do `settings`. Nieobecne/nieistniejące `config.list` rozwiązuje się tak jak w starym GUI (pierwsza lista), a raport pokazuje faktycznie użytą listę.

### Zachowane dane i powiązania

- Tytuł, notatka → opis, Stan → nazwa w workflow Praca, autor utworzenia → pierwszy wpis `created`, czasy i wszystkie dostępne wpisy historii/komentarze, numery i pełne teksty dostępnych rewizji. `claude` → `claude-code`; `agent` jest dotychczasowym aliasem `wektor`. Historyczny `panel` jest dozwolony także w odczycie rewizji; zapis `setSpec` nadal wymaga klienta AI. Luk po dawnej retencji nie odtwarzamy; raport sygnalizuje luki rewizji i osiągnięcie dawnego limitu 200 wpisów historii.
- Zestaw Cezara zachowuje wykonawcę/repo/tryb/blokadę oraz linki Cezar/PR. Wszystkie wątki migracji mają aktywne pole Specyfikacja i zestaw Cezara, również z pustymi wartościami. `createdAt` zostaje; `updatedAt` to maksimum dostępnych czasów, nie wymyślona data edycji. Licznik projektu to największy przydzielony numer + 1; brak uzupełniania dziur.
- `migratedTodo` jest nieedytowalnym przez akcje zapisem pochodzenia (`list`, `listName`, `original`: pełne zadanie po dotychczasowej normalizacji kontraktu). Zachowuje oryginalne rodzaje wpisów historii, autora `claude`, `completedAt`, linki rozmów i pozostałe dane bez natywnego odpowiednika. Jest zwracany przez pełny odczyt wątku; nie stanowi drugiego edytowalnego źródła. Po zmianach w Fili nadal opisuje **moment migracji**, a nie bieżący stan.
- Kopię kokpitu transformuje jego właściciel: `migrateCockpitCopy` w `server/cockpit.ts`, bez otwierania/zapisu pliku. Każdy `todoDispatches` zostaje zachowany, a wszystkie udane zlecenia (także kolejne próby tego samego klucza) zasilają `threadDispatches` ze stałym uid i numerem rewizji/trybem/czasem/taskiem/url. Stare karty dispatch zachowują prompt, todoId i decyzję, dostają `threadUid`; brak rewizji na dawnej karcie nie jest zastępowany wymyśloną rewizją. Transformacja zachowuje także obce/nieznane właściwości kopii. Dopinanie PR preferuje powiązanie wątku, więc po migracji nie wraca do list; istniejące listy produkcji nie mają takich powiązań i działają jak dotąd.
- Konteksty rozmów pozostają historycznymi wskazaniami ze swoim dawnym tekstem. Raport przypisuje stare `todo` do uid/bieżącego ID oraz `todoList` do zapytań według projektów i `Dawnej listy`. Odczyt nowym API (`fila_search`/zapytanie) po `pole("Dawne ID") = "t-…"` odnajduje wątek również po późniejszym przeniesieniu. Nie ma HTTP przekierowania ani starego endpointu; `GET …/threads/t-…` nie działa. Podłączenie tych wskazań w GUI/klientach należy do przełączenia 1.6; 1.4b przygotowuje i sprawdza mapowanie, nie aktywuje go w rozmowach produkcji. Osierocone konteksty/zlecenia oraz wskazania rejestru poza pustym celem są jawne w `unresolved`, nigdy automatycznie usuwane.

### Próba, raport i powrót

`preview` zapisuje wyłącznie `report.json` z porównaniem każdego rekordu (treść, Stan, autor, czasy, historia, rewizje, metadane wykonania, powiązania i pełne pochodzenie) i każdego kafelka; nie tworzy wyniku. `trial` zapisuje `before.json` (pusta Fila + wejściowy kokpit), `trial.json` (skróty planu/wejścia/baseline/wyniku) oraz `result.json` (`{fila:{version:1,data},cockpit}`). To **jeden artefakt**, nie dwa nadpisywane magazyny. Można próbować także niezatwierdzony plan z nierozstrzygnięciami: próba służy właśnie do ich obejrzenia. Powtórzenie identycznego wejścia/planu nie dubluje wątków, tablic ani dispatchów i daje identyczny wynik. ID tablic startowych są stabilne z SHA-256 wejścia/projektu/rodzaju obiektu; ich pozostała struktura powstaje przez istniejący kod tablic.

`rollback` przywraca `result.json` z `before.json` i porównuje skróty. Zmodyfikowany baseline/wynik (np. nowe zapisy) blokuje cofnięcie i nadpisanie przez kolejną próbę: tylko naprawa w przód. Nie jest to rollback usługi. Brak znacznika kopii, katalog w repo lub w magazynie usługi poza `fila-migration`, symlinki/junctions do magazynu albo dowiązania plików próby blokują wykonanie. Raport i wynik są zastępowane atomowo; kopia sprzed próby i potwierdzenie próby tworzone wyłącznie jako nowe pliki. Przerwana inicjalizacja, po której istnieje tylko część tych plików, wymaga nowego katalogu próby, bez automatycznego nadpisania. Jeden proces na katalog próby, bez równoległych uruchomień. Dane, plan, wyniki i manifesty pozostają poza Gitem.

### Propozycja procedury 1.6 (wymaga zgody użytkownika)

1. Zakończyć 1.5, zinwentaryzować wszystkie urządzenia/origin/profile/pulpity i konteksty. Użytkownik rozstrzyga mapowanie każdego zadania i każdego kafelka, różnice zbiorów oraz nierozstrzygnięte/osierocone odwołania; zatwierdza plan z jego identyfikatorem i SHA-256 w komentarzu zadania. Samo przygotowanie kodu, tego opisu albo poprawna próba nie zatwierdza planu.
2. W uzgodnionym oknie wyłączyć automaty, zatrzymać zapisy klientów i dispatch, poczekać na koniec tur/runów i zatrzymać właścicieli magazynów. Wykonać świeży spójny snapshot list, Fili, kokpitu, kontekstów oraz konfiguracji urządzeń; sprawdzić manifest skrótów. Zmiana wejścia unieważnia wcześniejszą próbę, wymaga ponownego porównania i zgody.
3. Sprawdzić pusty cel Fili i brak kolizji uid/numerów. Ten migrator **nie scala istniejącej Fili**; niepusty cel wymaga odrębnego planu i obsługi scalania, nie zastąpienia danych wynikiem tej próby. Zainstalowanie wyniku do usługi należy do 1.6, przez właścicieli magazynów; CLI 1.4b tego nie robi.
4. Jednocześnie przełączyć klientów, kafelki, Wektora i instrukcje; podłączyć mapowanie kontekstów; usunąć stare API. Jeszcze przy zablokowanych zapisach sprawdzić odczyty rekordów, rewizji i dawnych ID, wskazania rozmów, zapytania kafelków oraz zachowanie blokad ponownego dispatchu. Dopiero po odbiorze dopuścić zapisy do Fili jako jedynego źródła.
5. Awaria **przed** dopuszczeniem zapisów: odtworzyć cały spójny snapshot i konfiguracje, uruchomić poprzednią wersję. **Po** pierwszym nowym zapisie: zachować dane i naprawiać w przód; bez migracji wstecznej i równoległych źródeł prawdy.

Odświeżenie 8.11.2026 po decyzji o kluczach CEZR i TABL (zamiast CEZA i TABU): kopia 74 zadań (72 + 2 nowe na liście Tabularium, domyślnie DESK), propozycja 65 DESK / 3 CEZR / 6 TABL, `preview → trial → trial → rollback` z identycznym wynikiem ponowienia, baseline bajtowo identyczny; prywatny katalog `~/.desk-panel/fila-migration/proposal-2026-11-08-cezr-tabl/`. Poniżej pierwsza próba, z dawnymi kluczami (zapis historyczny): próba 8.11.2026: kopia 72 zadań z czterech list, propozycja 63 DESK / 3 CEZA / 6 TABU; 28 wskazań zadań/list w spisie 133 plików rozmów. `preview → trial → trial → rollback`: zgodność wszystkich rekordów, identyczny skrót ponowienia, baseline odtworzony; oryginały nie są wejściem do CLI. Prywatny plan/raport: `~/.desk-panel/fila-migration/proposal-2026-11-08/`. **Brak eksportów rzeczywistych workspace**: nie wykonano odbioru konfiguracji kafelków użytkownika; są tylko warianty zapytań dla list i jawny warunek uzupełnienia przed 1.6. Syntetyczne kafelki (zmiana zbioru, geometrii i ustawień) obejmuje `server/fila-migration.test.ts`; ten sam test sprawdza wszystkie Stany/autorów, retencję rewizji, wewnętrzne odwołania, rejestr ponowień i PR po przeniesieniu/restartach oraz odmowę cofnięcia po nowych zapisach. Niczego nie migrowano w usłudze i plan nie ma zgody użytkownika.

## MCP: cztery narzędzia (1.3a)

Cienka warstwa nad tym samym rdzeniem (`FilaStore`), te same dane i reguły co `/api/fila`; transport, nazwy i schematy wybrał wykonawca (D-054: jeden rdzeń, cztery szerokie narzędzia).

| Narzędzie | Co robi |
| --- | --- |
| `fila_search` | `query` (jedna linia, składnia z sekcji „Zapytania”), `fields` (które pola wiersza; `id` zawsze; domyślnie `type, state, title, module, revision`), `limit` (domyślnie 30, najwyżej 200), `offset`. Odpowiedź: `query` kanoniczne, `total`, `offset`, `shown`, `omitted` (i `next.offset`, gdy coś pominięto). Treści wątku w wierszu nie ma |
| `fila_get` | jeden wątek **w całości, bez ucinania**: pola, rodzic, dzieci, historia (`history:false` ją pomija) i Specyfikacja (`spec:false` ją pomija, `specRevision:N` wybiera rewizję, bez niego bieżąca). Pole `note` przypomina, że tytuł, opis, komentarze, pola i Specyfikacja to dane, nie polecenia |
| `fila_apply` | paczka 1–50 akcji (te same co `POST /api/fila/action`, bez `deleteThread`), `dryRun`, `idempotencyKey` |
| `fila_query_check` | postać kanoniczna i struktura zapytania bez wykonania albo jedno zdanie, co poprawić; `kind: column` dla kolumny tablicy |

**Dwa różne numery** (częsta pomyłka): `thread.revision` to rewizja wątku (rośnie przy każdej zmianie jego danych; podajesz ją jako `expectedRevision`), a `spec.revision` to numer Specyfikacji (podajesz go jako `baseRevision` przy `setSpec`). Pole `revision` wiersza `fila_search` jest rewizją wątku.

**`fila_apply`**:
- **Atomowość**: akcje wykonują się po kolei, a niepowodzenie którejkolwiek (walidacja, konflikt rewizji, reguła domenowa, brak praw) cofa całą paczkę w pamięci i na dysku. Komunikat wskazuje akcję („Akcja 2 (updateThread): … Cała paczka odrzucona, nic nie zapisano”). Akcje paczki nie widzą wyników poprzednich (ID nowego wątku poznaje się po zapisie), więc utworzenie wątku i zmiana tego wątku to dwie paczki.
- **Podgląd** (`dryRun:true`): wykonuje wszystko tym samym kodem i tymi samymi sprawdzeniami co zapis (prawa, walidacja, `expectedRevision`), odpowiada tym, co by wyszło (`results`, `threads` po zmianie), po czym przywraca dane; nic nie jest zapisane, plik się nie zmienia, a licznik numerów nie rusza. Podgląd nie używa ani nie zapisuje klucza idempotencji.
- **Idempotencja**: ta sama paczka z tym samym `idempotencyKey` od tego samego klienta nie zapisuje drugi raz i odpowiada tym samym (`replayed:true`); ten sam klucz z inną paczką to 409. Odrzucona paczka nie zajmuje klucza (poprawiony ponowny zapis przejdzie). Klucze są w `fila.json` (pole `idempotency`), pamiętane **7 dni**, najwyżej **200** ostatnich (własne wartości: ponowienie po awarii zwykle następuje w minutach, a plik nie ma rosnąć bez końca), więc przeżywają restart. Klucz należy do klienta.
- **Prawa**: jak w sekcji „Uprawnienia”: klienci AI zmieniają definicje workflow i wartości Modułu oraz Specyfikację; trwałego usunięcia wątku (`deleteThread`) nie ma w MCP w ogóle (narzędzie odmawia, zanim cokolwiek zrobi), zlecenia Cezara też nie (to osobny POST z kliknięcia użytkownika). Pole `by` w akcji jest odrzucane.

**Dwa wejścia do tych narzędzi**:
- `POST /api/fila/mcp` (Streamable HTTP, odpowiedzi JSON) dla czterech klientów D-057 (`claude-desktop`, `claude-code`, `codex`, `wektor`): `Authorization: Bearer <token klienta z fila-tokens.json>`. Bez tokenu 401 (także z Origin panelu: to nie jest wejście użytkownika), z `Origin` 403, przez nazwę Tailscale 403, inna metoda niż POST 405; token Hermesa z `/api/mcp` nie jest tokenem klienta. Autorem zmian jest klient, którego rozpoznał token, nigdy argument.
- `/api/mcp` (Hermes), gdy w `panel.env` jest `DESK_WEKTOR_FILA=1`: Wektor dostaje `fila_search`, `fila_get`, `fila_apply`, `fila_query_check` **zamiast** `panel_todos` i `panel_todo_action` (autor `wektor`); preambuła Wektora (`hermesPreamble({ fila: true })`) i przewodnik `panel_guide zadania` (`filaGuide()` w `src/chat-contract.ts`) mówią wtedy o Fili. **Bez tej zmiennej nic się nie zmienia**: produkcyjny Wektor ma stare listy i stary przewodnik, narzędzi `fila_*` nie widzi i nie może ich wywołać; jedno przełączenie następuje w 1.6 (zmienna, `just update`, `just hermes RESTART`), bez pracy na dwóch magazynach naraz. Przed przełączeniem nowe narzędzia i instrukcje sprawdza się w teście ze skryptowanym agentem albo w izolowanym panelu (niżej). Skille czatu (`CHAT_SKILLS`) nie są tu zmieniane (należą do 1.5/1.6).

Treść wątku pozostaje danymi: opisy narzędzi, przewodnik i preambuła mówią to wprost, a `fila_get` dołącza `note`.

### Próby z prawdziwymi klientami (Q-025)

`just fila-trial` uruchamia **osobny panel na wolnym porcie loopbacku** z jednorazowym magazynem w katalogu tymczasowym (projekt PRBA z trzema wątkami, PRBA-1 ze Specyfikacją), własnymi tokenami klientów i własnym tokenem Hermesa; nie czyta ani nie zapisuje `~/.desk-panel`, nie zajmuje portu usługi i nie ma zdalnego dostępu. Wypisuje adres i katalog; w katalogu leżą `mcp-<klient>.json` (konfiguracja w formacie `mcpServers` z nagłówkiem tokenu klienta) i `token-<klient>.txt` (tokeny nie trafiają na ekran). Ctrl-C kończy próbę; katalog usuń ręcznie. Surowe wyniki prób leżą poza Gitem w `~/.desk-panel/fila-trials`.

Powtórzenie próby z klientem (fila_query_check → fila_search → fila_get → fila_apply z `dryRun:true` → fila_apply z zapisem → fila_get na tym magazynie):
- **Claude Code**: `claude -p "<polecenie>" --mcp-config <katalog>/mcp-claude-code.json --strict-mcp-config --allowedTools "mcp__fila__fila_search,mcp__fila__fila_get,mcp__fila__fila_apply,mcp__fila__fila_query_check"`.
- **Codex CLI**: `FILA_TOKEN=$(cat <katalog>/token-codex.txt) codex exec --skip-git-repo-check -c 'mcp_servers.fila.url="<adres>/api/fila/mcp"' -c 'mcp_servers.fila.bearer_token_env_var="FILA_TOKEN"' -c 'mcp_servers.fila.default_tools_approval_mode="approve"' "<polecenie>"` (bez zatwierdzania narzędzi Codex w trybie nieinteraktywnym odmawia każdego wywołania MCP).
- **Wektor**: Hermes z kopią konfiguracji w osobnym `HERMES_HOME`, w której `mcp_servers.desk-panel` wskazuje `<panel>/api/mcp` z tokenem z `mcp-hermes-token.txt`; zapytanie zaczyna się od `hermesPreamble({ fila: true })`, potem `hermes chat --query-file <plik> --oneshot -Q --yolo`. Kopia `.env` w tym katalogu zawiera sekrety: usuń ją po próbie.
- **Claude Desktop** (aplikacja GUI, nie do uruchomienia z terminala): w `claude_desktop_config.json` (Ustawienia → Developer → Edit Config) dodaj serwer `fila` przez most stdio, np. `{"mcpServers":{"fila":{"command":"npx","args":["-y","mcp-remote","<adres>/api/fila/mcp","--allow-http","--header","Authorization:${FILA_AUTH}"],"env":{"FILA_AUTH":"Bearer <token z token-claude-desktop.txt>"}}}}` (to lokalny most do loopbacku, bez tunelu i zdalnego dostępu); uruchom aplikację ponownie i poproś o sześć wywołań wyżej. Ten zapis nie został sprawdzony w aplikacji (wykonawca jej nie obsługuje). Jeśli aplikacja pokaże narzędzia, ale odmówi połączenia, zgłoś to jako nieudaną próbę z komunikatem.
- **Aplikacja desktopowa ChatGPT (Codex)** (GUI): aplikacja pracuje na Codexie i czyta `~/.codex/config.toml`; dodaj `[mcp_servers.fila]` z `url = "<adres>/api/fila/mcp"`, `bearer_token_env_var = "FILA_TOKEN"` i `default_tools_approval_mode = "approve"` tylko na czas próby (zmienną `FILA_TOKEN` z `token-codex.txt` ustaw w środowisku, z którego uruchamiasz aplikację), potem te same sześć wywołań. Wpis usuń po próbie.

## Warsztat specyfikacji (1.3b)

Słoń, rybki i lokalny wykonawca pracują na Specyfikacji wątku przez ten sam kontrakt co reszta (sekcja „Specyfikacja i rewizje”); runner nie ma własnego protokołu.

- **Odczyt**: `GET /api/fila/threads/ID/spec` (bieżąca) albo `…/spec/N`, albo `fila_get` (`specRevision`). Pełny wątek z komentarzami: `GET /api/fila/threads/ID` (`history`, wpisy `kind: comment`) lub `fila_get`; oba oddają pełne teksty.
- **Zapis słonia**: `setSpec` z `baseRevision` = numer przeczytanej rewizji (`spec.revision`, nie `thread.revision`), przez `fila_apply` albo `POST /api/fila/action` z tokenem **własnego** klienta (`claude-code`, `codex`; nigdy cudzego: autor wynika z tokenu). Konflikt (409) słoń zgłasza, czyta rewizję ponownie i łączy z nią zmianę; nie ponawia z nową bazą w ciemno i nie nadpisuje.
- **Rybki**: `just rybka DESK-32` ([docs/agent-workflows/rybka.md](agent-workflows/rybka.md)) czyta bieżącą rewizję raz, zamraża tekst i numer dla obu modeli, a nagłówek raportu podaje ID, przeczytaną rewizję i model. Raport (części z `report-comments.json`) zapisuje się jako kolejne akcje `comment`; po odczycie wątku części sklejone spomiędzy markerów dają raport bez różnic (komentarz wątku ma limit 5000 znaków, części runnera 2000, więc mieszczą się z zapasem).
- **Wykonawca lokalny** (faber) czyta pełny wątek (`fila_get` albo `GET /api/fila/threads/ID` i `…/spec`) po ID. Executor Cezara dostaje serwerowy prompt (1.4a) i nie czyta API sam.
- **Ścieżka przejściowa (do 1.6)**: runner przyjmuje także `t-…` dla list zadań, a instrukcje (AGENTS.md, zadania.md, czat.md, hermes.md, zaimplementuj-zadanie.md w repo; Zadania.md, socius-desk-panel i adiutor w Tabularium) oznaczają odwołania do `/api/agent/todos`, `/api/todos/action`, `panel_todos` i `t-…` słowami „do 1.6”. Codzienna praca zostaje na listach, bo Fila nie ma jeszcze zmigrowanych danych (1.4b). Wątki do prób zakłada się w izolowanym panelu (`just fila-trial`), nie w danych usługi. Przełączenie instrukcji i usunięcie oznaczeń to 1.6.
- **Próba rybek (1.3b)**: sztuczna Specyfikacja (PRBA-1, rewizja 2 po zapisie z bazą 1; zapis z nieaktualną bazą dał 409, powtórzenie tej samej treści nic nie zmieniło), `just rybka PRBA-1` z `DESK_PANEL_URL` izolowanego panelu: oba modele (Sonnet 5.5, Gemini 3.8 Flash) zwróciły pełne raporty z nagłówkiem `PRBA-1`, `v2` i swoim modelem; komentarze opublikowane akcją `comment` i odczytane z wątku odtworzyły oba raporty bez różnic, także syntetyczny raport w czterech częściach z białymi znakami na końcach, cudzysłowami, ukośnikami i emoji.

## Interfejs (1.5)

Budowany z użytkownikiem (pictor) w produkcie, na wdrożonym API. **Dostępny tylko w odizolowanym podglądzie** `just scenario fila` (http://127.0.0.1:5175): bramką jest ta sama flaga co DesignLab (`__DESIGNLAB__`, `src/App.tsx`, `src/Workspace.tsx`), więc usługa, `just dev` i build produkcyjny go nie zawierają, a produkcyjne listy zostają do 1.6. Magazyn podglądu jest w pamięci (dane z klucza `fila` scenariusza), nic nie trafia do usługi i nie ma dispatchu. Zmiany w `scenarios/fila.json` wczytuje dopiero restart podglądu (magazyn Fili tworzy się raz).

**Część 1: tablica i kafelek.** Wejście: ikona warstw w górnym pasku pulpitu. Lewa nawigacja: Tablice (z „+”) i Projekty (otwierają tablicę startową projektu; ekran projektu to część 3). Widoki tablicy to zakładki, każdy z menu „⋯” (nazwa, kolejność, usunięcie); sekcje listy i kanbanu mają menu „⋯” (nazwa, kolejność, usunięcie, w kanbanie dodanie kolumny), kolumny własne menu, a „Dodaj sekcję” stoi pod ostatnią sekcją. Pigułki zapytania rozwijają jego tekst pod sekcją albo kolumną; serwer sprawdza go przy pisaniu (`/api/fila/query/check`), jego zdanie jest widoczne, a zapis odrzuconego tekstu jest zablokowany. Stan zmienia się z wiersza, karty kanbanu i kafelka wyborem z workflow (wartości zamykające osobno), bez checkboxa (D-070); po każdej akcji wszystkie czytniki odświeżają się (`announce` w `src/fila/api.ts`), więc wątek w kilku sekcjach nie rozjeżdża się. Odmowa serwera pojawia się w oknie, które ją wysłało, a bez okna w pasku komunikatu. Historia tablicy jest w panelu bocznym. Jeden poziom podwątków pod rodzicem z licznikiem zamkniętych (D-051). Tytuł wątku nie jest linkiem do czasu strony wątku (część 2).

**Kafelek Zadania** w podglądzie to jedno zapytanie wpisane jako tekst w konfiguracji kafelka (`config.query`); bez niego prosi o konfigurację i nie ma zapytania domyślnego. Zapytania dawnych kafelków ustala plan 1.4b.

**Część 2: strona wątku** (`src/fila/ThreadPage.tsx`). ID wątku na tablicy, w sekcji, na karcie i w kafelku otwiera go (podświetla się pod kursorem); tytuł jest zwykłym tekstem. Kafelek prosi panel o otwarcie przez zdarzenie okna `fila-open-thread` (`src/fila/events.ts`). Przycisk Wstecz i Dalej przeglądarki chodzą po Fili (tablica, widok, wątek; `history.pushState` w `FilaApp`), a Wstecz z pierwszego ekranu wraca na pulpit. Nad podwątkiem stoi jednoliniowa gałąź rodziców od korzenia (każdy prowadzi do siebie). Tablica pokazuje pod wątkiem jego podwątki (jeden poziom, domyślnie rozwinięte, z licznikiem zamkniętych) bez względu na zapytanie sekcji: indeks podwątków to jedno zapytanie `rodzic istnieje` na projekt (`useFilaChildIndex`), kolejność po ID. Strona: edytowalny tytuł (Enter zapisuje, Escape odrzuca) i opis w Markdownie; Stan, Moduł, Typ, Projekt, Workflow i Rodzic w panelu pól; pola własne edytowane w miejscu według rodzaju (tekst, liczba, data, tak/nie, wiele wartości), dodawane i usuwane (nazwa, która już istnieje, ma swój rodzaj w całej Fili, odmowę serwera pokazuje strona); jeden poziom podwątków z licznikiem zamkniętych; Specyfikacja z wyborem rewizji tylko do odczytu; jedna oś aktywności z komentarzami i historią wątku. Każda zmiana niesie `expectedRevision` wątku: konflikt (409) jest pokazany, nic się nie nadpisuje po cichu. Menu „⋯”: przeniesienie do projektu, zmiana workflow i zmiana rodzica. **Przeniesienie i zmiana workflow**: pasujące Stan (ta sama nazwa w workflow) i Moduł (jest w projekcie docelowym) zostają; niepasujący blokuje zapis, aż użytkownik jawnie wybierze nowy Stan albo nowy Moduł lub „Bez modułu”. Po przeniesieniu strona otwiera wątek pod nowym ID. Definicji workflow, jego Stanów i listy Modułu strona nie edytuje (D-033). Archiwizacja, usuwanie i zestaw Cezara są w częściach 3 i 4. Ograniczenie: sekcja Podwątki na stronie wątku szuka ich zapytaniem w projekcie rodzica, więc podwątek z innego projektu się w niej nie pojawi (indeks tablicy znajduje go po jego własnym projekcie).

## Magazyn

Jeden proces, jedna kolejka: akcje wykonują się po kolei na danych w pamięci, a po każdej plik jest zapisywany w całości (plik tymczasowy, potem `rename`), więc awaria nie zostawia pół pliku, a równoległe żądania się nie nadpisują. Akcja odrzucona albo z nieudanym zapisem cofa pamięć; dysk zostaje jak był. Uszkodzony plik jest odkładany jako `fila.json.corrupt-<czas>` i Fila startuje pusta z komunikatem w `notice`; nieczytelny z innego powodu blokuje zapis. Nie ma obsługi wielu procesów piszących ten sam plik.

Własne wartości i powody: limity z `FILA_LIMITS` (tytuł 200, opis 20 000, komentarz 5000, tekst pola 2000, 60 pól na wątek, 50 000 wątków, 100 projektów, 50 workflow, 30 Stanów na workflow, 200 definicji pól) ustawione bardzo szeroko, jak w `todo-contract.ts`, tylko jako ochrona pliku i pamięci (do tego 200 tablic, 30 widoków na tablicę, 30 sekcji na widok, 30 kolumn na sekcję, zapytanie 2000 znaków, wynik najwyżej 5000 wątków na wywołanie); treść ciała żądania najwyżej 512 KiB (Specyfikacja 50 000 jednostek UTF-16 mieści się nawet przy 6 bajtach na znak po zakodowaniu w JSON).
