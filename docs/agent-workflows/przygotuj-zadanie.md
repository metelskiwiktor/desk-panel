# Przygotowanie zadania: „słoń i złota rybka”

Proces dla lokalnych agentów w repo: **słoń** zbiera decyzje użytkownika, pisze specyfikację i doprowadza ją do
gotowości; **złota rybka** recenzuje samą specyfikację w świeżej sesji opencode, bez historii rozmowy i bez wykonania
zadania. Użytkownik rozstrzyga pytania o zakres i oczekiwania. Zapis specyfikacji należy do przygotowania;
implementacja, dispatch Cezara, zmiany API/UI oraz menu `@` Wektora są poza tym procesem.

Istniejące zadanie czytaj w całości: `panel_todos` z `zadanie=<id t-…>` albo
`GET /api/agent/todos?zadanie=…`; skrót wskazania/listy może zgubić początek specyfikacji
([zadania.md](../zadania.md#agent-czatu)). Specyfikacja opisuje potrzebę i odbiór; jej nagłówkowany format
(`CEL:`, `ZAKRES:`, …) jest poprawnym briefem executora. [executor-brief.md](executor-brief.md) opisuje dodatkowe,
opcjonalne szczegóły (Allowed files, Read-first, Stop on) i nie jest osobnym obowiązkowym dokumentem.

## Kiedy ten proces

Nie każde zadanie na liście wymaga pełnego procesu słonia i złotej rybki. Używaj go proporcjonalnie do typu zadania:

| Typ zadania | Specyfikacja | Rybka |
| --- | --- | --- |
| Osobiste | brak (wystarczy tytuł i notatka) | zbędna |
| Decyzja | krótka notatka w zadaniu lub komentarz | zbędna |
| Programistyczne lokalnie | zalecana (szablon 6 sekcji) | opcjonalna |
| Programistyczne dla Cezara | obowiązkowa (pełna specyfikacja) | obowiązkowa |

**Zasada:** rybka jest obowiązkowa, gdy wykonawca nie zna rozmowy (Cezar). W pozostałych przypadkach jest opcjonalna albo zbędna. Osobiste zadania nie używają tego procesu.

## Szablon i znaczenie pól

Skopiuj blok i zastąp objaśnienia treścią; zachowaj sześć sekcji treści. Każda etykieta stoi na osobnej linii, od kolumny 0,
wielkimi literami i z dwukropkiem (panel czyta tylko taki nagłówek).

```markdown
CEL:
[oczekiwana, obserwowalna zmiana dla użytkownika]

ZAKRES:
[co dostarczamy: pliki, obszary, zachowania]

POZA ZAKRESEM:
[granice i osobne dalsze prace]

DECYZJE:
- YYYY-MM-DD — [treść decyzji] — źródło: [użytkownik/rozmowa/plik]
- Otwarte pytanie (YYYY-MM-DD): [brakująca decyzja] — [wpływ; tylko w szkicu]

WARUNKI ODBIORU:
1. [sprawdzalny wynik] — [metoda weryfikacji]

ZAŁĄCZNIKI:
[ścieżki względem repo lub dostępna treść; przy braku: brak]
```

Wykonawcę, repozytorium i tryb wybierasz w **polach zadania**, nie w Markdownie: `executor` (`cezar`, `lokalnie` albo
`rozmowa`), `repo` (`desk-panel`) i `mode` (`analiza` albo `implementacja`). Ustawia je `updateTask`; pominięte pole
zachowuje wartość, `null` je czyści, a brak wartości to `null`. Stare sekcje `WYKONAWCA:`/`REPO:`/`TRYB:` w specyfikacji
są tylko granicami treści i nie ustawiają pól; nie dopisuj ich do nowych specyfikacji. Panel liczy z tych pól i sekcji
gotowość (`src/todo-dispatch.ts`, [zadania.md](../zadania.md#gotowość-i-prompt-bez-modelu)) i pokazuje ją w pełnym
widoku agenta. `analiza` zamawia ustalenia, `implementacja` zmiany. Nie zakładaj dostępu do sąsiedniego repo ani
prywatnego pliku jako jedynego załącznika. Dopóki nie ma mechanizmu załączników, makieta trafia do executora tylko jako
plik śledzony w Gicie; `.ai/` jest ignorowany.

### Zmiany UI

Dla zadania zmieniającego widoczny interfejs dodaj dwie sekcje; obie są wymagane przy przygotowaniu, bo executor nie ma
zgadywać parametrów zrzutów. `TYP ZMIANY` mówi, że to UI, a `ZRZUTY` podaje wartości wprost do CLI (`scripts/scenario.ts`):

```markdown
TYP ZMIANY:
Type: UI

ZRZUTY:
Scenario: standard
Page: pulpit
Open: tile:todo
Device: medialove-14
Scale: primary
Before: kafelek bez nowego wiersza gotowości
```

Odpowiada to komendzie `npx tsx scripts/scenario.ts standard --shot --pages pulpit --device medialove-14 --scale primary
--open tile:todo --file .ai/screenshots/after.png`. Executor używa parametrów z tej sekcji (scenario, page, open, device,
scale, before), a nie stałych z przykładowej komendy. `Type: UI` bez parametrów zrzutów zatrzymuje executora zamiast
zgadywania. Dla zadania bez zmian UI obie sekcje są opcjonalne; ich brak znaczy non-UI/none:

```markdown
TYP ZMIANY:
Type: non-UI

ZRZUTY:
none
```

Panel nie interpretuje tych sekcji: służą modelowi i executorowi.

## Definicja gotowości

Przed zapisem `gotowe` sprawdź:

- [ ] Sześć sekcji treści (`CEL`, `ZAKRES`, `POZA ZAKRESEM`, `DECYZJE`, `WARUNKI ODBIORU`, `ZAŁĄCZNIKI`) wypełniono
      bez placeholderów; etykiety stoją na osobnych liniach. Pola zadania `executor`, `repo` i `mode` są ustawione
      jednoznacznie, a załączniki dostępne (albo `ZAŁĄCZNIKI: brak`). Dla UI istnieją `TYP ZMIANY` z `Type: UI` oraz
      `ZRZUTY` z konkretnymi parametrami; dla non-UI brak tych sekcji znaczy non-UI/none.
- [ ] Przed ustawieniem `gotowe` pełny widok `?zadanie=` zgłasza co najwyżej jeden brak: dotyczący stanu zadania.
      Każdy inny brak (blokada, pole albo sekcja) zatrzymuje przygotowanie. Po zapisie stanu `gotowe` ponowny odczyt
      musi pokazać `Gotowość bieżącej rewizji (vN): gotowe` bez żadnych braków.
- [ ] Długość specyfikacji jest proporcjonalna do zadania, a szczegóły API podano tylko tam, gdzie zadanie je zmienia
      (2026-11-02: specyfikacja na 9 tys. znaków dla 3 plików dała dokument na 470 linii).
- [ ] Zadanie dla Cezara mieści się w około 30 minutach pracy executora, łącznie z testami i dokumentacją; większe
      dzielimy na osobne zadania (2026-11-02: zadanie A potrzebowało dwóch runów i oba pominęły testy i dokumentację).
- [ ] CEL i granice są określone; przy każdej decyzji słoń pyta: „jaki realny problem z ostatnich tygodni to rozwiązuje?”
      (2026-11-02: pełne rewizje i edycja w UI rozrosły się ponad potrzebę, a zadanie B2 odłożono); decyzje użytkownika mają datę `YYYY-MM-DD`, treść i źródło.
- [ ] Każdy numerowany warunek odbioru ma sprawdzalny wynik i metodę; sprawdzenie, które przechodzi niezależnie od wyniku,
      nie jest warunkiem odbioru (2026-11-01: walidator rybki zaakceptował samą listę nazw pól); wymagania nie pominięto przez „jeśli dostępne”.
- [ ] Przy nowym sekrecie lub API sprawdzono uprawnienia klucza (w tym tworzenie/usuwanie kluczy, zmianę limitów i wariant
      read-only), sposób przechowywania oraz dostęp procesów potomnych/terminali agentów. DPAPI wspólnego użytkownika
      chroni zapis na dysku, ale nie izoluje procesów tego użytkownika. Rybka ma zapytać o te ustalenia, jeśli ich brakuje.
- [ ] Kontrakt nowego API sprawdzono bezpieczną, autoryzowaną próbą live: data, metoda, status i kształt odpowiedzi
      (pola, typy, null), bez sekretów i kwot. Mock lub przykład z dokumentacji nie zastępuje tej próby; brak dowodu
      pozostawia blokadę. Rybka sprawdza również, czy deklarowany dowód odpowiada naprawdę wybranej trasie.
- [ ] Istnieją skuteczne raporty obu rybek (lub wybranego runnera) dla tej rewizji, która zostaje oznaczona jako gotowa
      (2026-11-01: w pilotażu 1 rybka czytała v1, a zlecona była v2), pokazane użytkownikowi wraz z poprawkami.
- [ ] Rozstrzygnięto wszystkie uwagi wpływające na zakres, zachowanie lub odbiór; pytania o zakres/oczekiwania mają
      odpowiedzi użytkownika, a brakującej decyzji nie dopowiedziano. Sugestie redakcyjne nie blokują gotowości.

Szkic istniejącego zadania pozostaje w `przygotowanie`; nowego nie oznaczaj `gotowe` przed spełnieniem checklisty.
`gotowe` oznacza gotowość do realizacji, nie zakończenie, zgodę na Cezara ani wynik jego runu.

## Rybka: konfiguracja i przegląd

Raport dla każdej uwagi podaje **niejasność, niezapisane założenie, wpływ na wykonanie i pytanie**; przy braku uwag
mówi „brak uwag”. Błąd, timeout, pusty/niekompletny raport nie spełnia definicji gotowości. Słoń ocenia treść raportu,
pokazuje go i poprawki użytkownikowi. Istotna zmiana celu/zakresu po raporcie wymaga nowej rybki; usunięcie wskazanego
braku lub korekta redakcyjna nie wymaga automatycznie kolejnego płatnego przebiegu.

2026-11-03, OpenRouter: poprzedni brief zaproponował management key we wspólnym środowisku i kontrakt tylko na podstawie
dokumentacji. Dopiero użytkownik zatrzymał gotowość i zażądał sprawdzenia uprawnień oraz próby live. Dlatego powyższe
dwa sprawdzenia są w checkliście i w roli recenzenta w `scripts/rybka.mjs`, a nie wyłącznie w retro.

Na uwagi rybki o skrajnych przypadkach słoń odpowiada najpierw uproszczeniem zakresu albo zapisem „poza zakresem, akceptowane ryzyko”;
nową regułę do specyfikacji dodaje tylko przy realnym problemie (pytanie z definicji gotowości: „jaki realny problem z ostatnich tygodni to rozwiązuje?”)
(2026-11-02: zadanie C2 w rewizji 3 urosło do łańcuchów retryOf, replayu po restarcie i klasyfikacji unknown/failed dla jednego użytkownika z jednym przyciskiem).

Raporty zapisuj w zwykłych komentarzach z nagłówkiem `Przegląd rev N — DeepSeek — część i/k` oraz
`Przegląd rev N — Gemini — część i/k`: N to rewizja specyfikacji, i to numer części od 1, k to liczba części
danego raportu (np. `Przegląd rev 2 — DeepSeek — część 1/3`).
Uwzględnij limit 2000 znaków komentarza razem z nagłówkiem i 4096 bajtów UTF-8 całego JSON-a żądania.
Dziel po liniach, a linię dłuższą od limitu przetnij w środku. Złączenie części po usunięciu nagłówków musi dać
dokładnie pierwotny raport; nie przycinaj ani nie dopisuj separatorów w jego treści. Rozstrzygnięcia zapisuj
analogicznie w komentarzu odnoszącym się do tej samej rewizji. Po analizie uwag słoń klasyfikuje je (blokujące,
redakcyjne, chybione, unikalne blokujące) i dopisuje wiersze do rejestru w [rybka-evaluation.md](rybka-evaluation.md).
To reguła przygotowania, nie kod dzielenia raportu w aplikacji.

Domyślnie uruchom lokalnie z id zadania (lub ścieżki pliku): `just rybka <id zadania>` (np. `just rybka t-00c6c30f`).
Domyślnie wołane są obie rybki równolegle: `--runner both` (DeepSeek przez OpenCode oraz Gemini przez agy).
Opcjonalnie można wybrać jednego recenzenta: `--runner opencode` lub `--runner agy`.
Skrypt sam pobiera bieżącą rewizję pola `spec` z `GET /api/agent/todos?zadanie=…`; pusty stan („Brak specyfikacji”) przerywa wykonanie czytelnym błędem.

Skuteczny raport wymaga poprawnego zakończenia tury i procesu, braku błędów oraz tekstu zawierającego w każdej uwadze
pola: **Niejasność, Niezapisane założenie, Wpływ na wykonanie, Pytanie** (lub jawne „brak uwag”).
Samo wymienienie nazw pól ani fragment odpowiedzi nie jest raportem. Błąd procesu, timeout, zawieszenie
ani kod 0 bez zakończonej tury nie spełniają definicji gotowości — w takim wypadku nie zmieniaj zadania na `gotowe`.

Szczegóły techniczne runnera (konfiguracja modeli i OpenCode, limity i watchdogi, postęp co 15 s, metryki, katalogi prób w `.ai/rybka-runs/`, JSONL)
opisuje [rybka.md](rybka.md).

## Przykład statyczny: brak wskazanej listy

W panelu są listy „Dom”, „Praca” i „Do poprawy”; poniższy szkic celowo nie wskazuje docelowej listy:

```markdown
CEL:
Na liście zadań ma pojawić się „Zamów kawę” z notatką „Skończyły się ziarna”.

ZAKRES:
Jedno zadanie na liście; bez zmian API/UI.

POZA ZAKRESEM:
Inne listy, tworzenie list, zamawianie kawy.

DECYZJE:
- 2026-11-01 — zadanie dodaje agent z by: agent — źródło: użytkownik.

WARUNKI ODBIORU:
1. „Zamów kawę” istnieje na wskazanej liście z notatką „Skończyły się ziarna” — GET /api/todos.

ZAŁĄCZNIKI:
brak
```

Pola zadania dla tego szkicu: `executor=rozmowa`, `repo=desk-panel`, `mode=implementacja` (ustawiane `updateTask`, nie
w Markdownie).

Oczekiwane pytania rybki: „Na którą listę ma trafić zadanie: Dom, Praca czy Do poprawy?” i „Czy wybór listy jest
decyzją użytkownika?”. Niejasność: brak listy; niezapisane założenie: dowolna lista wystarczy; wpływ: nie da się
jednoznacznie wykonać zakresu ani sprawdzić kryterium 1. To blokada gotowości, nie uwaga redakcyjna.

Po odpowiedzi użytkownika „Lista Dom” słoń pokazuje poprawki:

- CEL i ZAKRES: zadanie trafia na listę „Dom”.
- DECYZJE: `2026-11-01 — lista docelowa: Dom — źródło: użytkownik (odpowiedź w rozmowie)`.
- Warunek 1: zadanie z podaną notatką istnieje na liście „Dom” — `GET /api/todos` i kontrola id listy.

Pozostałe sekcje pozostają bez zmian; tę konkretną uwagę rozstrzygnięto bez dopowiadania decyzji. Przejście
checklisty: są wszystkie pola, określone granice, datowane decyzje, mierzalny wynik z metodą i `ZAŁĄCZNIKI: brak`;
pytanie użytkownika ma odpowiedź, usunięcie wskazanego braku nie wymaga automatycznie nowej rybki. Przykład i raport
są fikcyjne — w rzeczywistym zadaniu warunek skutecznego przeglądu wymaga rzeczywistego raportu, nie tego przykładu.
Ocena przez lekturę nie wywołuje modelu, nie tworzy rozmów i niczego nie zapisuje; wynik oceny wpisz do podsumowania
wykonawcy, bez przedstawiania go jako dowodu próby modelu.

## Zapis specyfikacji

Przed POST sprawdź adres/wiązanie/port w [server/index.ts](../../server/index.ts), regułę `Origin` w
[server/app.ts](../../server/app.ts) i kontrakt oraz limity w [zadania.md](../zadania.md#zapis-i-dostęp).
Lokalnie domyślnie adres i Origin to `http://127.0.0.1:5174`; nie zakładaj portu bez sprawdzenia.

1. `GET /api/todos`: wybierz jednoznacznie listę wskazaną przez użytkownika. Przy kilku pasujących listach lub
   braku wskazanej listy pytaj, bez cichego wyboru i tworzenia listy.
2. Tytuł ma nazywać rezultat; krótka notatka streszcza cel i wskazuje aktualną wersję pełnej specyfikacji.
3. Pełną specyfikację Markdown zapisuj w dedykowanym polu `spec` przez akcję `updateTask` z `specRevision`
   (numer bazowy szkicu: 0 przy braku wcześniejszej wersji, w kolejnych numer aktualnej rewizji). Zapis przez
   `updateTask` ze `spec`/`specRevision` zastępuje dawny wieloetapowy podział specyfikacji na komentarze; limit
   specyfikacji wynosi 50 000 jednostek UTF-16, a limit ciała JSON to 512 KiB. Reguła dzielenia na części
   w komentarzach (do 2000 znaków) dotyczy wyłącznie raportów przeglądu rybki opisanych w sekcji wyżej.
4. Wykonaj sekwencję poniżej; każda zmiana podaje faktycznego autora według tabeli autorów z [docs/zadania.md](../zadania.md#model): lokalny słoń podaje `by: "codex"` albo `by: "claude"`.

| Krok | Żądanie i wymagane pola |
| --- | --- |
| Utworzenie (nowe) | POST /api/todos/action: `{action:"addTask", list, title, note, by:"codex"}` (lub `"claude"`); zachowaj zwrócone `task.id` |
| Specyfikacja | POST /api/todos/action: `{action:"updateTask", task, spec, specRevision, by:"codex"}` (lub `"claude"`) |
| Wykonanie | POST /api/todos/action: `{action:"updateTask", task, executor:"cezar", repo:"desk-panel", mode:"implementacja", by:"codex"}` (lub `"claude"`); pominięte pole zachowuje wartość, `null` czyści |
| Kontrola zapisu | GET /api/agent/todos?zadanie=<id>: sprawdź pełną treść specyfikacji, rewizję i pola wykonania; dopuszczalny jest tylko brak dotyczący stanu, żaden inny |
| Gotowość | POST: `{action:"setStatus", task, status:"gotowe", by:"codex"}` (lub `"claude"`) dopiero po kontroli zapisu |
| Struktura | Osobny POST: `{action:"addComment", task, text:"Struktura: …", by:"codex"}` (lub `"claude"`, jeśli dotyczy) |
| Potwierdzenie | Końcowy GET /api/agent/todos?zadanie=<id>: stan `gotowe`, specyfikacja, komentarze i gotowość bieżącej rewizji bez żadnych braków; brak lub błąd odczytu nie jest potwierdzeniem gotowości |

Przy istniejącym zadaniu zachowaj jego id, pozostaw szkic w `przygotowanie` i zapisz nową rewizję przez `updateTask`
ze zaktualizowaną treścią `spec` oraz aktualnym `specRevision`; nie wykonuj ponownie `addTask`. Osobny brief executora nie
jest obowiązkowy: nagłówkowana specyfikacja jest briefem, a dodatkowe sekcje z [executor-brief.md](executor-brief.md)
(`Allowed files`, `Read-first`, `Stop on`) są opcjonalne i służą doprecyzowaniu.

**Błąd częściowy przerywa sekwencję**, bez ustawiania `gotowe`. W razie konfliktu 409 odczytaj `GET /api/todos`, id zadania
i aktualną rewizję specyfikacji. Zapisana specyfikacja trafia do wykonawcy w późniejszym zleceniu — samo przygotowanie i status
`gotowe` go nie uruchamiają.
