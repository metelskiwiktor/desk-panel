# OpenRouter: koszty klucza, saldo konta i adnotacja limitu

Kafelek **OpenRouter** (`openrouter`, `src/tiles/OpenRouterUsageTile.tsx`; w pustym miejscu pulpitu ikona monet) pokazuje pięć oficjalnych wartości z API OpenRouter: koszt bieżącego klucza **dziś**, w **tym tygodniu**, w **tym miesiącu** i **łącznie** oraz **saldo całego konta**. Cztery liczniki kosztu dotyczą klucza, saldo konta — całego konta; kafelek oznacza oba zakresy osobno. Limit klucza jest jedną adnotacją: „bez limitu” albo „limit X, zostało Y”. Nie ma wykresu per model, historii dziennej ani resetu limitu.

## Klucz API i współdzielenie z Hermesem

Panel nie wymaga osobnego klucza typu provisioning czy management key. Wykorzystuje **ten sam pojedynczy klucz OpenRouter**, którego używa już Hermes Agent:
- Zmienna: `OPENROUTER_API_KEY` w pliku `%USERPROFILE%\.desk-panel\panel.env`.
- Klucz pozostaje wyłącznie na backendzie; nigdy nie jest przesyłany do przeglądarki ani zapisywany w plikach cache czy logach.
- Bez ustawionego klucza `OPENROUTER_API_KEY` endpoint `/api/openrouter` odpowiada statusem `503`, a kafelek wyświetla czytelną informację po polsku.

## Dwie trasy i mapowanie pól

`server/openrouter.ts` czyta obie trasy tym samym kluczem:

| Trasa | Pola odpowiedzi | Wartość w `OpenRouterUsage` |
| --- | --- | --- |
| `GET https://openrouter.ai/api/v1/key` | `data.usage_daily` | `dailyUsd` |
| | `data.usage_weekly` | `weeklyUsd` |
| | `data.usage_monthly` | `monthlyUsd` |
| | `data.usage` | `allTimeUsd` |
| | `data.limit` | `limitUsd` (`null` = brak limitu) |
| | `data.limit_remaining` | `limitRemainingUsd` |
| `GET https://openrouter.ai/api/v1/credits` | `data.total_credits - data.total_usage` | `balanceUsd` |

Liczniki `/key` są przenoszone 1:1, bez sumowania i bez liczenia własnych okresów. `balanceUsd` to różnica z `/credits`; `usage` klucza nie jest do niej dodawane ani odejmowane. `total_credits` i `total_usage` muszą być skończonymi, nieujemnymi liczbami — brak pola, `null` albo string to błąd formatu, nigdy zero. `balanceUsd` może być ujemne. `limitUsd` musi być skończoną nieujemną liczbą albo `null`; `limitRemainingUsd` skończoną liczbą albo `null`. Brakujące liczniki nie są zamieniane na `0`. Precyzję zachowuje backend; `formatUsd` w kafelku służy tylko do prezentacji.

## Odczyt: równolegle, całościowo, z pamięciowym cache

- **Równoległość**: przy braku trafienia w cache oba żądania startują równocześnie; żadne nie czeka na wynik drugiego. Każde ma własny timeout 10 s.
- **Całość albo błąd**: sukces wymaga obu poprawnych odpowiedzi. Błąd HTTP, sieci, timeoutu lub walidacji któregokolwiek żądania kończy cały odczyt błędem — bez częściowego payloadu i bez zapisu częściowego sukcesu w cache.
- **Statusy**: brak klucza oraz `401`/`403` z którejkolwiek trasy to `503`; pozostałe błędy to `502`.
- **Cache**: klient backendu trzyma w pamięci wyłącznie kompletny udany payload przez 60 s, z pierwotnym `observedAt` (epoch ms). Trafienie zwraca go bez obu żądań i bez zmiany `observedAt`. Po 60 s odczyt jest odświeżany. Nie ma cache błędów, dodatkowego pollera, retry ani deduplikacji równoległych odczytów.
- **UI**: hook po błędzie czyści ostatni odczyt i pokazuje błąd również po wcześniejszym sukcesie, zamiast przedstawiać stare dane jako nowy poprawny odczyt.

Endpoint `GET /api/openrouter` i typ `OpenRouterUsage` (`src/openrouter-contract.ts`) pozostają bez zmian nazwy; zmienił się tylko zestaw pól: `dailyUsd`, `weeklyUsd`, `monthlyUsd`, `allTimeUsd`, `balanceUsd`, `limitUsd`, `limitRemainingUsd`, `observedAt`.

## Dowód kontraktu bez kwot — 2026-11-03

Jedno autoryzowane `GET /api/v1/key` istniejącym kluczem zwróciło HTTP 200 i obiekt `{data: object}`:
`usage_daily`, `usage_weekly`, `usage_monthly`, `usage`: number; `limit`, `limit_remaining`: null;
`limit_reset`: string; `is_management_key`: boolean. Następnie jedno `GET /api/v1/credits` tym samym kluczem zwróciło
HTTP 200 i `{data: object}` z `total_credits`: number i `total_usage`: number. Nie zapisano wartości, etykiety klucza ani
surowego JSON-a; to dowód z przygotowania zadania, niezależny od testów implementacji. Null limitu oznacza brak limitu,
nie zero ani saldo konta. Liczniki `/key` dotyczą tego klucza, a saldo `/credits` — całego konta.

## Dlaczego nie używamy endpointu `/api/v1/activity`?

Endpoint konta `/api/v1/activity` wymaga specjalnego klucza administracyjnego (management/provisioning key) i zwraca błąd `403 Forbidden` przy użyciu standardowego klucza API. Standardowy klucz ma natomiast pełny dostęp do:
- `GET https://openrouter.ai/api/v1/key` — odczyt parametrów klucza: liczniki kosztu i limity,
- `GET https://openrouter.ai/api/v1/credits` — odczyt stanu doładowań: `total_credits` i `total_usage`,
- `GET https://openrouter.ai/api/v1/generation?id=<id>` — odczyt szczegółów konkretnego wywołania (nieużywany przez kafelek).

## Routing DeepSeek w Cezarze i OpenCode (2026-11-02)

Według ustawień konta zgłoszonych przez użytkownika OpenRouter miał sortowanie po cenie; 2.11.2026 zmieniono je na sortowanie po przepustowości. W pomiarze sprzed tej zmiany domyślny routing modelu `deepseek/deepseek-v4.1-flash-1017` wybrał OpenInference: około 24,4 tokena wyjścia/s, 1,538 s do pierwszego tokenu i 1,770 s całości. Jawne `provider.sort: "throughput"` wybrało Together (0,811 / 0,894 s), a przypięcie szybkich dostawców wybrało Wafer (0,373 / 0,540 s). To pojedyncze krótkie żądania z 754 tokenami wejścia, bez narzędzi i bez trafień cache; przepustowość obejmuje reasoning i jest liczona jako tokeny wyjścia / API `generation_time`.

Run Cezara `dc7fd2c8-576b-4fb4-a83c-d2c9c06494c0` pokazał problem długich odpowiedzi: etap implementacji miał 48 odpowiedzi modelu, 107 wywołań narzędzi i 138 253 tokeny reasoning; przedziały strumienia reasoning zajęły 53,47 z 57,39 minuty. W jednej rundzie 899 tokenów reasoning zajęło około 236 s (około 3,8 tokena/s). Późniejszy etap `address` zakończył się timeoutem 30 min. Historyczny zapis nie zawiera identyfikatorów generacji, więc nie ustalono jego dostawców ani nie dowiedziono, że timeout spowodował konkretny host lub sortowanie po cenie. Źródła lokalne: `.ai/cezar/runs/dc7fd2c8-576b-4fb4-a83c-d2c9c06494c0.ndjson` (implementacja: wiersz 744; timeout: 1386) oraz baza `~/.local/share/opencode/opencode.db`, sesja `ses_e62b22f7dffenuJDEWCh0lhAuv`. Baza zawiera tokeny i znaczniki czasu wiadomości/części; sam NDJSON nie daje wszystkich tych czasów.

OpenCode używany przez Cezara ma teraz w `~/.config/opencode/opencode.jsonc`, pod `provider.openrouter.models["deepseek/deepseek-v4.1-flash-1017"].options.provider`:

```json
{
  "data_collection": "deny",
  "order": ["wafer", "together"],
  "allow_fallbacks": true
}
```

Ta kolejność preferuje Wafer, potem Together; `allow_fallbacks: true` pozwala spróbować pozostałych kwalifikujących się dostawców, gdy obaj są niedostępni. Ustawienia effort i limitu wyjścia pozostawiono bez zmian. Konfiguracja użytkownika pozostaje poza Gitem. Jawna kolejność w żądaniu ma pierwszeństwo przed domyślnym sortowaniem konta; szczegóły opisuje [dokumentacja routingu OpenRouter](https://openrouter.ai/docs/guides/routing/provider-selection).

Pojedynczy pomiar domyślnego routingu konta po zmianie, bez `provider.order` w żądaniu, wybrał Relace: 1,087 s do pierwszego tokenu, 1,150 s całości, koszt 0,0002559 USD (754 tokeny wejścia). Ten pomiar sprawdza routing konta, a nie preferencje OpenCode. Bezpieczne wyniki pomiarów i identyfikatory generacji są lokalnie w `~/.desk-panel/analysis-dc7fd2c8/bench-results.json` oraz `bench-after-routing.json`; nie są częścią repozytorium. Zmiana routingu ma ograniczyć ryzyko wolnych hostów, ale te krótkie próby nie gwarantują czasu wykonania dużego zadania.

## Scenariusze i zrzuty

`scenarios/standard.json` posiada sekcję `openrouterUsage` z pięcioma wartościami i adnotacją limitu. Kafelek w scenariuszu testowym otwiera się komendą:
```powershell
npx tsx scripts/scenario.ts standard --shot --pages pulpit --device medialove-14 --scale primary --open tile:openrouter --file .ai/screenshots/after.png
```
