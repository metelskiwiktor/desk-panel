# Przygotowanie zadania: „słoń i złota rybka”

Proces dla lokalnych agentów w repo: **słoń** zbiera decyzje użytkownika, pisze specyfikację i doprowadza ją do
gotowości; **złota rybka** recenzuje samą specyfikację w świeżej sesji opencode, bez historii rozmowy i bez wykonania
zadania. Użytkownik rozstrzyga pytania o zakres i oczekiwania. Zapis specyfikacji należy do przygotowania;
implementacja, dispatch Cezara, zmiany API/UI oraz menu `@` Wektora są poza tym procesem.

Istniejące zadanie czytaj w całości: `panel_todos` z `zadanie=<id t-…>` albo
`GET /api/agent/todos?zadanie=…`; skrót wskazania/listy może zgubić początek specyfikacji
([zadania.md](../zadania.md#agent-czatu)). Specyfikacja opisuje potrzebę i odbiór; współistnieje z późniejszym
[briefem wykonawcy](executor-brief.md), nie zastępuje jego formatu ani workflow.

## Szablon i znaczenie pól

Skopiuj blok i zastąp objaśnienia treścią; zachowaj wszystkie dziewięć sekcji.

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

WYKONAWCA:
[jedna wartość: cezar / lokalnie / rozmowa]

REPO:
[konkretne repozytorium i lokalizacja dostępna wykonawcy; inne repo to jawna osobna praca]

TRYB:
[analiza / implementacja]

ZAŁĄCZNIKI:
[ścieżki względem repo lub dostępna treść; przy braku: brak]
```

`cezar` wskazuje wykonawcę w workflow Cezara, `lokalnie` pracę w checkoucie, `rozmowa` wykonanie w rozmowie;
wybierz jedną wartość, ale nie uruchamiaj wykonania podczas przygotowania. `analiza` zamawia ustalenia,
`implementacja` zmiany. Nie zakładaj dostępu do sąsiedniego repo ani prywatnego pliku jako jedynego załącznika.
Dopóki nie ma mechanizmu załączników, makieta trafia do executora tylko jako plik śledzony w Gicie; `.ai/` jest ignorowany.

## Definicja gotowości

Przed zapisem `gotowe` sprawdź:

- [ ] Dziewięć sekcji wypełniono bez placeholderów; wykonawca, repo i tryb są jednoznaczne, załączniki dostępne
      (albo `ZAŁĄCZNIKI: brak`).
- [ ] CEL i granice są określone, decyzje użytkownika mają datę `YYYY-MM-DD`, treść i źródło.
- [ ] Każdy numerowany warunek odbioru ma sprawdzalny wynik i metodę; wymagania nie pominięto przez „jeśli dostępne”.
- [ ] Istnieje skuteczny raport rybki, pokazany użytkownikowi wraz z poprawkami.
- [ ] Rozstrzygnięto wszystkie uwagi wpływające na zakres, zachowanie lub odbiór; pytania o zakres/oczekiwania mają
      odpowiedzi użytkownika, a brakującej decyzji nie dopowiedziano. Sugestie redakcyjne nie blokują gotowości.

Szkic istniejącego zadania pozostaje w `przygotowanie`; nowego nie oznaczaj `gotowe` przed spełnieniem checklisty.
`gotowe` oznacza gotowość do realizacji, nie zakończenie, zgodę na Cezara ani wynik jego runu.

## Rybka: konfiguracja i przegląd

Raport dla każdej uwagi podaje **niejasność, niezapisane założenie, wpływ na wykonanie i pytanie**; przy braku uwag
mówi „brak uwag”. Błąd, timeout, pusty/niekompletny raport nie spełnia definicji gotowości. Słoń ocenia treść raportu,
pokazuje go i poprawki użytkownikowi. Istotna zmiana celu/zakresu po raporcie wymaga nowej rybki; usunięcie wskazanego
braku lub korekta redakcyjna nie wymaga automatycznie kolejnego płatnego przebiegu.

Raport zapisuj w zwykłych komentarzach z nagłówkiem `Przegląd rev N — część i/k`: N to rewizja specyfikacji,
i to numer części od 1, k to liczba części raportu (np. `Przegląd rev 2 — część 1/3`).
Uwzględnij limit 2000 znaków komentarza razem z nagłówkiem i 4096 bajtów UTF-8 całego JSON-a żądania.
Dziel po liniach, a linię dłuższą od limitu przetnij w środku. Złączenie części po usunięciu nagłówków musi dać
dokładnie pierwotny raport; nie przycinaj ani nie dopisuj separatorów w jego treści. Rozstrzygnięcia zapisuj
analogicznie w komentarzu odnoszącym się do tej samej rewizji. To reguła przygotowania, nie kod dzielenia raportu w aplikacji.

Uruchom lokalnie z katalogu repo: `just rybka .ai/spec.md` (ogólnie `just rybka SPEC`).
Implementacja: [scripts/rybka.mjs](../../scripts/rybka.mjs); nie uruchamiaj jej w runie wykonawcy Cezara.
Plik SPEC zawiera wyłącznie specyfikację. Skrypt tworzy świeżą sesję opencode na przypiętym modelu
`openrouter/deepseek/deepseek-v4.1-flash-1017`, bez historii i flag continue/session/fork.
Specyfikacja jest jedyną wiadomością użytkownika; rola recenzenta jest osobnym promptem agenta.

Aby recenzent nie błądził po repo, skrypt sprawdza materiały **przed startem modelu**: SPEC, AGENTS.md
oraz jawne ścieżki plików w sekcji ZAŁĄCZNIKI (najlepiej każda ścieżka w backtickach). Przyjmuje tylko tekstowe
pliki wewnątrz repo, bez poświadczeń i dowiązań prowadzących poza repo. Limit to 12 różnych plików, licząc SPEC
i AGENTS.md, oraz 200 000 znaków łącznie. Powtórzone ścieżki nie zwiększają liczby plików. Brak pliku,
przekroczenie limitu lub niedozwolona ścieżka zatrzymuje próbę przed wywołaniem modelu.
Do promptu roli trafia lista dozwolonych plików, bez wklejania całej ich treści. Model czyta AGENTS.md i istotne
załączniki wyłącznie narzędziem `read`: uprawnienia dopuszczają tylko te dokładne ścieżki, pozostałe są odrzucane.
Ma najwyżej 12 wywołań odczytu (ponowne odczyty i odmowy też się liczą); wykrycie przekroczenia przerywa próbę
i wyklucza skuteczny raport. Nie ma wyszukiwania, zapisu, powłoki ani delegacji. MCP są wyłączone. To ograniczenia wejścia
i narzędzi, **nie sandbox OS**: proces nadal działa z prawami użytkownika.
Nie ustawiamy `agent.steps`: OpenCode po dojściu do tej granicy dokleja wiadomość asystenta o wyczerpaniu kroków
(przy wartości 1 już w pierwszym kroku), co może zastąpić recenzję podsumowaniem nieukończonej pracy.
Eksplorację ograniczają jawne ścieżki i licznik odczytów, a czas kontrolują watchdogi. Raport zawiera do 8 najważniejszych uwag.

Konfiguracje OpenCode są scalane: puste `mcp: {}` nie wyłącza serwerów hosta. Skrypt odczytuje rozwiązaną
konfigurację do pamięci, bez jej drukowania, wyłącza każdy MCP i potwierdza uprawnienia oraz model przed startem.
Odczyt konfiguracji ma limit 15 s na każde z dwóch wywołań; nie otwieramy plików uwierzytelnienia.
Zasady: [konfiguracja OpenCode](https://opencode.ai/docs/config/),
[uprawnienia](https://opencode.ai/docs/permissions/), [agenci](https://opencode.ai/docs/agents/).

Limit całej próby to 10 minut (razem z konfiguracją), a limit bez nowego zdarzenia to 8 minut od startu modelu
lub ostatniego zdarzenia. Bajty stderr i niepełne/niepoprawne linie JSON nie resetują limitu ciszy.
CLI emituje zamknięte bloki, nie ich przyrosty: udany pilotaż potrzebował 218 s na ostatni krok,
a większy przegląd przekroczył dawny limit 4 min bez zdarzeń. Cisza JSONL nie dowodzi bezczynności modelu.
Co 15 s skrypt pokazuje liczbę zdarzeń, ostatnie narzędzie i pozostały czas.
Pokazuje też sumę tokenów zakończonych kroków, łącznie z cache (cache dodatkowo osobno), i ostrzega od 800 000.
Licznik aktualizuje się również od razu po `step_finish`. Przed pierwszym takim zdarzeniem jest „n/d”:
JSONL nie podaje przyrostowego zużycia podczas trwającego kroku, więc licznik nie obejmuje go na bieżąco.
Kończy się jawnym powodem: timeout, zawieszenie bez zdarzeń, błąd dostawcy/procesu/konfiguracji, niedozwolone
narzędzie, przekroczenie limitu odczytów albo brak/niekompletność raportu. Błąd daje niezerowy kod wyjścia; skrypt kończy tylko własne drzewo procesu.

Każda próba ma osobny katalog `.ai/rybka-runs/<czas-id>/` poza Gitem: `spec.md`, `events.jsonl`, `stderr.log`,
`metrics.json` oraz przy sukcesie `report.md` (przy błędzie ewentualnie `partial-report.md`). Stare próby pozostają
bez zmian. Metryki sumują tokeny/koszt zakończonych kroków i pokazują czas do pierwszego zdarzenia oraz tekstu;
nie nazywają tych czasów TTFT — dokładnego czasu pierwszego tokenu JSONL nie udostępnia.

Skuteczny raport wymaga poprawnego zakończenia tury i procesu, braku błędów oraz tekstu zawierającego w każdej uwadze
pola Niejasność, Niezapisane założenie, Wpływ na wykonanie, Pytanie z dwukropkiem i treścią albo jawne „brak uwag”.
Samo wymienienie nazw pól ani komunikat o wyczerpaniu kroków nie jest raportem. Kontrola skryptu nie zastępuje
oceny kompletności przez słonia i omówienia uwag z użytkownikiem. Sam JSONL, fragment odpowiedzi, timeout lub
kod 0 bez zakończonej tury nie spełniają definicji gotowości. Nie zmieniaj z tego powodu zadania na `gotowe`.

## Przykład statyczny: brak wskazanej listy

W panelu są listy „Dom”, „Praca” i „Do poprawy”; poniższy szkic celowo nie wskazuje docelowej listy:

```markdown
CEL: Na liście zadań ma pojawić się „Zamów kawę” z notatką „Skończyły się ziarna”.
ZAKRES: Jedno zadanie na liście; bez zmian API/UI.
POZA ZAKRESEM: Inne listy, tworzenie list, zamawianie kawy.
DECYZJE:
- 2026-11-01 — zadanie dodaje agent z by: agent — źródło: użytkownik.
WARUNKI ODBIORU:
1. „Zamów kawę” istnieje na wskazanej liście z notatką „Skończyły się ziarna” — GET /api/todos.
WYKONAWCA: rozmowa
REPO: przyklad-repo, C:\projekty\przyklad-repo (dostępne wykonawcy).
TRYB: implementacja
ZAŁĄCZNIKI: brak
```

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
2. Tytuł ma nazywać rezultat; krótka notatka streszcza cel i wskazuje wersję pełnej specyfikacji w komentarzach.
3. Podziel pełną specyfikację po akapitach/liniach, zachowując tekst i kolejność. Pierwszy komentarz zaczyna
   `spec: <autor>` (np. `spec: Codex`, gdy autorem jest Codex); każda część ma `Specyfikacja vN — i/N`.
   Sprawdź **oba** limity: 2000 znaków z nagłówkiem oraz 4096 bajtów UTF-8 całego JSON-a żądania
   (`Buffer.byteLength(json, 'utf8')` lub `[Text.Encoding]::UTF8.GetByteCount($json)`).
4. Sprawdź miejsce w historii: najwyżej 200 wpisów, licząc nowe komentarze, zmiany statusu i komentarz o strukturze.
   Jeśli zapis wypchnąłby historię, zatrzymaj się i zapytaj; nie usuwaj jej.
5. Wykonaj sekwencję poniżej; każda zmiana ma `by: agent`.

| Krok | Żądanie i wymagane pola |
| --- | --- |
| Utworzenie | POST /api/todos/action: `{action:"addTask", list, title, note, by:"agent"}`; zachowaj zwrócone `task.id` |
| Specyfikacja | Kolejne POST: `{action:"addComment", task, text, by:"agent"}` dla każdej części |
| Kontrola kompletu | GET /api/todos: sprawdź obecność i pełną treść wszystkich części w kolejności |
| Gotowość | POST: `{action:"setStatus", task, status:"gotowe", by:"agent"}` dopiero po kontroli kompletu |
| Struktura | Osobny POST: `{action:"addComment", task, text:"Struktura: …", by:"agent"}` |
| Potwierdzenie | Końcowy GET /api/todos: stan i wszystkie komentarze |

Przy istniejącym zadaniu zachowaj jego id, pozostaw szkic w `przygotowanie` i dopisz pełną nową wersję; nie wykonuj
ponownie `addTask`. Notatkę z numerem aktualnej wersji zmienia `updateTask` z `by: agent`.

**Błąd częściowy przerywa sekwencję**, bez ustawiania `gotowe`. Przed wznowieniem odczytaj `GET /api/todos`, id zadania
i już zapisane części; wznów od brakującej części, bez powtarzania `addTask`. Jeśli id się nie zachowało, odszukaj
zadanie na wskazanej liście; nie twórz duplikatu. Przy błędzie po ustawieniu `gotowe` odczytaj stan i dokończ brakujący
krok, nie traktuj sekwencji jako zakończonej.

Nowa rewizja to pełny komplet oznaczony nową wersją, z własnym `spec: <autor>` w pierwszej części; stare komentarze
pozostają bez zmian. Końcowy komentarz opisuje **braki struktury zadania** ujawnione przy przygotowaniu (np. brak
osobnego pola na wersjonowaną specyfikację) albo `Struktura: brak`; to obserwacja, nie rozszerzenie prac o API/UI.
Zapisana specyfikacja trafia do wykonawcy w późniejszym zleceniu — samo przygotowanie i status `gotowe` go nie uruchamiają.
