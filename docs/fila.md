# Fila: rdzeń wątków i API

Fila to moduł wątków (sprawy, funkcje, błędy, notatki, spotkania) w projektach. Koncept: `C:\Tabularium\Incepta\DeskPanel\Mea\Fila` (Model, Decyzje; numery D-… niżej pochodzą stąd). Ten dokument opisuje **części 1.1a i 1.1b etapu 1**: trwały rdzeń, HTTP API oraz Specyfikacje z rewizjami. Obecne listy zadań (docs/zadania.md) działają bez zmian aż do końcowego przełączenia (1.6); Fila ich nie czyta ani nie zmienia. Nie ma jeszcze: zapytań i tablic (1.2), MCP i klientów (1.3), Cezara na wątku i migracji (1.4), interfejsu (1.5).

## Gdzie co jest

| Co | Plik |
| --- | --- |
| kontrakt danych i akcji (zod), limity, typy | `src/fila-contract.ts` |
| magazyn i reguły domenowe | `server/fila.ts` |
| HTTP, tożsamość, tokeny | `server/fila-routes.ts` |
| dane usługi | `~/.desk-panel/fila.json` (poza Gitem) |
| tokeny klientów | `~/.desk-panel/fila-tokens.json` (poza Gitem) |
| scenariusz | klucz `fila` w `scenarios/*.json` (ten sam schemat co dane), tylko w pamięci |

`PanelSources.fila` jest opcjonalne: `real-sources.ts` daje magazyn w pliku, `scenario.ts` magazyn w pamięci zasiany ze scenariusza (bez klucza: workflow Praca i zero projektów). Scenariusz, podgląd i testy nigdy nie zapisują danych usługi.

## Model w tej części

- **Projekt**: klucz, dokładnie cztery wielkie litery A–Z (`^[A-Z]{4}$`, unikalny, niezmienny), nazwa, lista wartości Moduł, licznik `nextNumber`. Projektów na start nie ma w kodzie: trzy projekty (DESK, CEZA, TABU) założy migracja 1.4b.
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

`filaTokens()` tworzy przy starcie `~/.desk-panel/fila-tokens.json` (po jednym 64-znakowym tokenie na klienta, uzupełnia brakujące) i nie nadpisuje istniejących. Plik jest poza Gitem; token nie trafia do przeglądarki, odpowiedzi, cache ani logu (test sprawdza, że odpowiedzi go nie zawierają). Porównanie stałoczasowe. Klient bierze swój token z tego pliku (podłączenie MCP robi 1.3a). Procesy agy nie dziedziczą `panel.env`, ale mogą odczytać plik jak każdy proces tego użytkownika: to zmniejszenie ekspozycji, nie izolacja (docs/hermes.md). Minimalne uprawnienia: token daje dostęp wyłącznie do `/api/fila` (zapis wątków i projektów, bez dostępu do poczty, Cezara, banku ani czatów); Fila nie używa zewnętrznego API ani klucza dostawcy, więc nie ma próby live u dostawcy.

## API

Wszystko pod `/api/fila`, JSON, `Cache-Control: no-store`.

| Metoda i ścieżka | Odpowiedź |
| --- | --- |
| `GET /api/fila` | rejestry: `projects` (z `counts` otwarte/zamknięte/archiwum), `workflows`, `types`, `fieldDefs`, `notice` |
| `GET /api/fila/threads/KLUCZ-n` | wątek: pola, `closed`, `parent`, `children`, `createdBy`, `history` |
| `POST /api/fila/action` | jedna akcja, odpowiedź `{ ok, project? \| workflow? \| thread: { id, revision, previousId? } \| removed? }` |

Akcje (`action`): `setSpec`, `addSpecField`, `removeSpecField` (niżej), `createProject`, `setModules`, `createWorkflow`, `updateWorkflow`, `createThread`, `updateThread`, `setField`, `removeField`, `comment`, `archiveThread`, `restoreThread`, `deleteThread` (pola: `src/fila-contract.ts`). Błąd: `{ "error": "zdanie po polsku" }` ze statusem 400 (kształt), 403 (rola), 404, 409 (konflikt, reguła domenowa) albo 413. Odczyt Specyfikacji: `GET /api/fila/threads/KLUCZ-n/spec` (bieżąca) i `…/spec/N` (rewizja N). Brak listowania wątków: zapytania są w 1.2.

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

## Magazyn

Jeden proces, jedna kolejka: akcje wykonują się po kolei na danych w pamięci, a po każdej plik jest zapisywany w całości (plik tymczasowy, potem `rename`), więc awaria nie zostawia pół pliku, a równoległe żądania się nie nadpisują. Akcja odrzucona albo z nieudanym zapisem cofa pamięć; dysk zostaje jak był. Uszkodzony plik jest odkładany jako `fila.json.corrupt-<czas>` i Fila startuje pusta z komunikatem w `notice`; nieczytelny z innego powodu blokuje zapis. Nie ma obsługi wielu procesów piszących ten sam plik.

Własne wartości i powody: limity z `FILA_LIMITS` (tytuł 200, opis 20 000, komentarz 5000, tekst pola 2000, 60 pól na wątek, 50 000 wątków, 100 projektów, 50 workflow, 30 Stanów na workflow, 200 definicji pól) ustawione bardzo szeroko, jak w `todo-contract.ts`, tylko jako ochrona pliku i pamięci; treść ciała żądania najwyżej 512 KiB (Specyfikacja 50 000 jednostek UTF-16 mieści się nawet przy 6 bajtach na znak po zakodowaniu w JSON).
