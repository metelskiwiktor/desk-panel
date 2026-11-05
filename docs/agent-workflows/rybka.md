# Runner recenzji specyfikacji: złota rybka (scripts/rybka.mjs)

Dokument techniczny dla [scripts/rybka.mjs](../../scripts/rybka.mjs) — runnera procesu recenzji specyfikacji
przez **złotą rybkę** w procesie słonia i rybki (skille `slon` i `rybka` w `C:\Tabularium\skills`).
Runner uruchamia recenzję w świeżej sesji, bez historii rozmowy i z jawnymi, ograniczonymi materiałami referencyjnymi.
Nie uruchamiaj go w runie wykonawcy Cezara.

## Uruchomienie i argumenty

```bash
just rybka SPEC [--runner opencode|agy|both]
```

- `SPEC`: id zadania z panelu (`t-…`, np. `just rybka t-00c6c30f`) lub ścieżka do pliku Markdown (`.ai/spec.md`).
  Gdy podano id zadania, skrypt sam pobiera bieżącą rewizję pola `spec` z `GET /api/agent/todos?zadanie=…`.
  Pusty stan („Brak specyfikacji”) przerywa wykonanie czytelnym błędem. Eksport do pliku pozostaje alternatywą,
  gdy zadanie nie ma jeszcze wpisu w panelu.
- `--runner both` (domyślnie): uruchamia obie rybki równolegle w osobnych podprocesach.
- `--runner opencode`: uruchamia tylko recenzenta DeepSeek.
- `--runner agy`: uruchamia tylko recenzenta Gemini.

Każdy raport zapisuje w nagłówku zadanie, numer przeczytanej rewizji i model rybki.
Przy sukcesie runner zapisuje też `report-comments.json`: gotowe teksty komentarzy (limity 2000 znaków i 4096 bajtów JSON z `by: codex`), których jawne markery chronią wszystkie białe znaki raportu przed `trim` API; przy zapisie i porównywaniu zachowaj markery, a po odczycie sklej treści między nimi — runner sam nie publikuje komentarzy.

## Modele i sesje

Oba przebiegi startują w świeżych sesjach bez historii:

Wspólna rola obu rybek sprawdza także uprawnienia i przechowywanie nowego sekretu oraz dowód próby live nowego API
(data, status, kształt bez sekretów i kwot). Przy braku tych ustaleń ma zgłosić pytanie, zamiast traktować mock lub
przykład dokumentacji jako potwierdzony kontrakt; pełna lista jest w `C:\Tabularium\AI\DeskPanel\Zadania.md` (sekcja „Specyfikacja i gotowość”).

- **DeepSeek** (`opencode`): model `openrouter/deepseek/deepseek-v4.1-flash-1017`. Specyfikacja jest jedyną wiadomością użytkownika,
  a model czyta AGENTS.md i załączniki narzędziem `read` (do 12 wywołań).
- **Gemini** (`agy`): model `gemini-3.8-flash-high` przez lokalne `agy`, bez narzędzi i bez flagi `--dangerously-skip-permissions`.
  Materiały referencyjne i specyfikacja są wklejane bezpośrednio do pojedynczego promptu użytkownika.

## Materiały referencyjne i uprawnienia

Aby recenzenci nie błądzili po repo, skrypt sprawdza materiały **przed startem modeli**: specyfikację, AGENTS.md
oraz jawne ścieżki plików w sekcji ZAŁĄCZNIKI (najlepiej każda ścieżka w backtickach). Przyjmuje tylko tekstowe
pliki wewnątrz repo, bez poświadczeń i dowiązań prowadzących poza repo. Limit to 12 różnych plików, licząc specyfikację
i AGENTS.md, oraz 200 000 znaków łącznie. Powtórzone ścieżki nie zwiększają liczby plików. Brak pliku,
przekroczenie limitu lub niedozwolona ścieżka zatrzymuje próbę przed wywołaniem modelu.

- W OpenCode do promptu roli trafia lista dozwolonych plików, a model czyta AGENTS.md i istotne
  załączniki wyłącznie narzędziem `read`: uprawnienia dopuszczają tylko te dokładne ścieżki, pozostałe są odrzucane.
- W agy treść tych samych sprawdzonych materiałów jest wklejana do wiadomości użytkownika, a model nie ma narzędzi.
- Model ma najwyżej 12 wywołań odczytu (ponowne odczyty i odmowy też się liczą); wykrycie przekroczenia przerywa próbę
  i wyklucza skuteczny raport.
- Nie ma wyszukiwania, zapisu, powłoki ani delegacji. MCP są wyłączone.
- To ograniczenia wejścia i narzędzi, **nie sandbox OS**: proces nadal działa z prawami użytkownika.

Nie ustawiamy `agent.steps`: OpenCode po dojściu do tej granicy dokleja wiadomość asystenta o wyczerpaniu kroków
(przy wartości 1 już w pierwszym kroku), co może zastąpić recenzję podsumowaniem nieukończonej pracy.
Eksplorację ograniczają jawne ścieżki i licznik odczytów, a czas kontrolują watchdogi. Raport zawiera do 8 najważniejszych uwag.

## Konfiguracja OpenCode

Konfiguracje OpenCode są scalane: puste `mcp: {}` nie wyłącza serwerów hosta. Skrypt odczytuje rozwiązaną
konfigurację do pamięci, bez jej drukowania, wyłącza każdy MCP i potwierdza uprawnienia oraz model przed startem.
Odczyt konfiguracji ma limit 15 s na każde z dwóch wywołań; nie otwieramy plików uwierzytelnienia.
Zasady: [konfiguracja OpenCode](https://opencode.ai/docs/config/),
[uprawnienia](https://opencode.ai/docs/permissions/), [agenci](https://opencode.ai/docs/agents/).

## Limity czasu i watchdogi

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

## Katalogi prób i metryki

Każda próba ma osobny katalog `.ai/rybka-runs/<czas-id>/` poza Gitem: `spec.md`, `events.jsonl`, `stderr.log`,
`metrics.json` oraz przy sukcesie `report.md` (przy błędzie ewentualnie `partial-report.md`). Stare próby pozostają
bez zmian. Metryki sumują tokeny/koszt zakończonych kroków i pokazują czas do pierwszego zdarzenia oraz tekstu;
nie nazywają tych czasów TTFT — dokładnego czasu pierwszego tokenu JSONL nie udostępnia.
Dla agy metryki tokenów i kosztu są raportowane, jeśli CLI je podaje; w przeciwnym razie zapisywane jest „brak danych”.

## Kryteria skutecznego raportu

Skuteczny raport wymaga poprawnego zakończenia tury i procesu, braku błędów oraz tekstu zawierającego w każdej uwadze
pola:
- **Niejasność:**
- **Niezapisane założenie:**
- **Wpływ na wykonanie:**
- **Pytanie:**
(lub jawne „brak uwag”).

Samo wymienienie nazw pól ani komunikat o wyczerpaniu kroków nie jest raportem. Kontrola skryptu nie zastępuje
oceny kompletności przez słonia i omówienia uwag z użytkownikiem. Sam JSONL, fragment odpowiedzi, timeout lub
kod 0 bez zakończonej tury nie są raportem (`C:\Tabularium\AI\DeskPanel\Zadania.md`).
Klasyfikację uwag z raportów rejestrujemy w [rybka-evaluation.md](rybka-evaluation.md).
