# OpenRouter: kafelek zużycia per model i budżetu

Kafelek **OpenRouter** (`openrouter`, `src/tiles/OpenRouterUsageTile.tsx`; w pustym miejscu pulpitu ikona monet) pokazuje wydatki na API OpenRouter: słupkowy dzienny wykres skumulowany per model z ostatnich 30 dni, koszt po najechaniu lub fokusie na segment lub cały dzień, oraz łączne wydatki w oknie, wydatki od początku konta i pozostały budżet w USD.

## Klucz API i współdzielenie z Hermesem

Panel nie wymaga osobnego klucza typu provisioning czy management key. Wykorzystuje **ten sam pojedynczy klucz OpenRouter**, którego używa już Hermes Agent:
- Zmienna: `OPENROUTER_API_KEY` w pliku `%USERPROFILE%\.desk-panel\panel.env`.
- Klucz pozostaje wyłącznie na backendzie; nigdy nie jest przesyłany do przeglądarki ani zapisywany w plikach cache czy logach.
- Bez ustawionego klucza `OPENROUTER_API_KEY` endpoint `/api/openrouter` odpowiada statusem `503`, a kafelek wyświetla czytelną informację po polsku.

## Dlaczego nie używamy endpointu `/api/v1/activity`?

Endpoint konta `/api/v1/activity` wymaga specjalnego klucza administracyjnego (management/provisioning key) i zwraca błąd `403 Forbidden` przy użyciu standardowego klucza API. Standardowy klucz ma natomiast pełny dostęp do:
- `GET https://openrouter.ai/api/v1/key` — odczyt parametrów klucza: łączny `usage`, limity i `limit_remaining`,
- `GET https://openrouter.ai/api/v1/credits` — odczyt stanu doładowań: `total_credits` i `total_usage`,
- `GET https://openrouter.ai/api/v1/generation?id=<id>` — odczyt szczegółów konkretnego wywołania: koszt (`total_cost`), model i data (`created_at`).

## Odczyt logu Hermesa i śledzenie wywołań

Dzienny rozkład kosztów na poszczególne modele powstaje na podstawie identyfikatorów wywołań (`id=gen-...`), które Hermes Agent rejestruje w swoim pliku dziennika:
- **Ścieżka logu**: domyślnie `%LOCALAPPDATA%\hermes\logs\agent.log` (na Windows) lub `~/.hermes/logs/agent.log`. Można ją nadpisać zmienną środowiskową `HERMES_LOG_PATH`.
- **Wzorzec parsowanej linii**:
  ```text
  2026-10-28 16:55:41,139 INFO [session-id] agent.conversation_loop: API call #1: model=deepseek/deepseek-v4.1-flash-1017 provider=openrouter in=17514 out=68 total=17582 latency=2.5s cache=2048/17514 (12%) id=gen-1793202940-I2y6V33UXxPavx5wGt6H upstream=InferenceNet
  ```
  Serwer filtruje wyłącznie zakończone wywołania, w których `provider=openrouter` i występuje identyfikator `id=gen-...`. Inni dostawcy (`provider=anthropic`, `provider=openai`) są ignorowani.
- **Offset w pliku**: serwer pamięta pozycję w bajtach (`logOffset`) do ostatniego znaku nowej linii. Kolejne odpytanie czyta wyłącznie nowo dopisane linie i nigdy nie przetwarza tego samego wywołania powtórnie. Rotacja lub skrócenie pliku są wykrywane automatycznie (reset offsetu bez błędów).
- **Stare wywołania**: generacje, które miały miejsce przed rozpoczęciem logowania lub z usuniętych plików logu, nie mogą być zrekonstruowane per-model (są jednak wliczone w globalny `allTimeUsd` z endpointu `/api/v1/key`).

## Lokalny cache i rozwiązywanie kosztu generacji

Rozwiązanie kosztu każdej nowej generacji następuje poprzez odpytanie OpenRoutera (`GET /api/v1/generation?id=...`):
- **Lokalizacja cache**: `~/.desk-panel/openrouter-cache.json` (w katalogu stanu panelu).
- **Zapis**: zapis następuje atomowo (zapis do pliku tymczasowego `.tmp` i przemianowanie).
- **Brak powtórnych zapytań**: raz zapisany koszt generacji jest trwale pamiętany w cache; serwer nigdy nie pyta OpenRoutera o ten sam identyfikator generacji po raz drugi.
- **Backfill z limitem**: w jednym odczycie serwer rozwiązuje maksymalnie kilkadziesiąt oczekujących generacji (`cache.pending`), dzięki czemu nawet przy zimnym starcie lub długiej historii endpoint nie blokuje się i odpowiada natychmiast, a historia uzupełnia się sukcesywnie.
- **Odporność na błędy**: nieudane zapytanie o generację (np. chwilowy błąd sieci lub 429) przesuwa identyfikator na koniec kolejki `pending` z licznikiem prób, więc generacje, które ciągle zawodzą, nie zajmują całej partii przy każdym odczycie. Po odpowiedzi 404 (OpenRouter nie zna już generacji) albo po 5 nieudanych próbach identyfikator trafia do `failed` i nie jest już odpytywany; jego koszt nie wchodzi do wykresu (sumy z `/api/v1/key` go zawierają).
- **Dzień generacji**: data z początku linii logu, czyli lokalny czas Hermesa; linia bez daty dostaje lokalny dzień odczytu, tak jak wykres liczy dni.

## Budżet i sumy

- **W oknie**: suma kosztów generacji z ostatnich 30 dni zarejestrowanych w lokalnym cache.
- **Łącznie**: all-time spend zwrócony bezpośrednio z endpointu `/api/v1/key` (`data.usage`).
- **Budżet**: jeśli klucz ma zdefiniowany limit, pokazywana jest wartość `limit_remaining`. W przeciwnym razie obliczana jest różnica dostępnych środków z endpointu `/api/v1/credits`: `total_credits - total_usage`.

## Scenariusze i zrzuty

`scenarios/standard.json` posiada sekcję `openrouterUsage` z kilkoma modelami na przestrzeni 30 dni. Kafelek w scenariuszu testowym otwiera się komendą:
```powershell
npx tsx .ai/scenario.ts standard --shot --pages pulpit --device medialove-14 --scale primary --open tile:openrouter --file .ai/screenshots/after.png
```
