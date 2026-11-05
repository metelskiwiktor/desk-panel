# Pomiar użycia

Panel zbiera lokalnie dane o tym, jak długo i gdzie jest wyświetlany: fundament pod decyzję o pierwszej stronie nowego GUI.
To etap 1 (t-be2f1b56): strony, pulpity, ambient, pełny czat i szczegóły. Użycie kafelków i funkcji (t-01c8aa59) oraz epizody
błędów (t-fbcda0d3) rozbudują ten sam magazyn. Wyświetlanie nie oznacza patrzenia człowieka.

## Co jest mierzone

W każdej chwili liczy się **jeden główny widok** (`src/App.tsx`, `usageView`), w kolejności: ambient, pełny czat, szczegóły
(rodzaj: `task`, `event`, `quota`, `mail`, `workout`, `breakdown`, `system`), strona (`home`, `tasks`, …). Czat kompaktowy
i wskazywanie nie zastępują strony. Ukryta karta (`document.hidden`) wstrzymuje cały pomiar. Brak fokusu okna go nie wstrzymuje
(kiosk na drugim monitorze). Podgląd pionowy wstrzymuje pulpit pod spodem (`PollingContext`), mierzy tylko ramka.

- **Czas wyświetlania** (`ms`): pełny czas widoku, niezależny od interakcji.
- **Interakcja**: tylko zaufane zdarzenia przeglądarki: `pointerdown`, `keydown`, `wheel`, `touchmove`. Ruch wskaźnika, polling,
  przewijanie z kodu, odpowiedzi serwera i praca agentów jej nie liczą. Zapisywany jest tylko czas, nigdy treść ani klawisz.
- **Czas od ostatniej interakcji**: dla czasu po pierwszej interakcji sesji karty `ageIntegral` (s·s; średnia =
  `ageIntegral` / (`ms` − `noInteractionMs`) w sekundach) i `maxAgeMs`. Czas przed pierwszą interakcją sesji to osobno
  `noInteractionMs`. `visitsWithoutInteraction` liczy wizyty (od wejścia w widok do jego zmiany, ukrycia karty lub przerwy), w których
  nie było żadnej interakcji. Nie ma progu „aktywny/nieaktywny”.
- **Przerwa w obserwacji**: gdy między tykaniami zegara (co 5 s, `TICK_MS`) minie więcej niż 15 s (`GAP_MS`), np. po uśpieniu
  komputera, otwarty odcinek kończy się na ostatnim tyknięciu, a czasu przerwy nie doliczamy. Niewykrywalne przerwy
  i niezatwierdzony koniec odcinka po awarii przeglądarki są przyjętym ryzykiem (do 60 s najwyżej, tyle trwa bufor).
- **Kontekst**: widok, strona albo rodzaj szczegółów, **id** pulpitu (tylko na `home`, nigdy jego nazwa), losowe id przeglądarki
  (`localStorage`, `desk-panel.usage-browser`) i karty, rozmiar okna w krokach co 50 px. Zwykli klienci (także host Tailscale) są
  mierzeni tak samo; telefonu się nie wykrywa. Pulpit jest identyfikowany parą przeglądarka + id.

## Dane i zapis

Przeglądarka tnie czas na **odcinki** (`src/usage-meter.ts`, czysta klasa z wstrzykiwanym zegarem): przy zmianie widoku,
na granicy każdej pełnej godziny (godziny epoki są pełnymi godzinami także w Europe/Warsaw), przy przerwie i co 60 s
(`FLUSH_MS`, także przy ukryciu karty i zamknięciu przez `fetch` z `keepalive`). Niewysłane odcinki czekają (do 500) i są
ponawiane. `POST /api/usage` (Origin-checked, loopback albo host Tailscale, do 100 odcinków) przyjmuje wyłącznie odcinki
zgodne ze ściśle zwalidowanym schematem `src/usage-contract.ts`: stałe enumy, losowe id i liczby, żadnych pól tekstowych.
Odcinek starszy niż 48 h lub z przyszłości jest odrzucany.

Magazyn (`server/usage.ts`) jest w `~/.desk-panel/usage`, poza Gitem, bez szyfrowania DPAPI (nie ma tu sekretów ani treści):

| Plik | Zawartość | Retencja |
| --- | --- | --- |
| `details-RRRR-MM-DD.ndjson` | przyjęte odcinki dnia (Europe/Warsaw) | 90 dni (`DETAIL_DAYS`), czyszczone przy starcie i co 6 h |
| `summary-RRRR-MM-DD.json` | sumy godzinowe dnia i liczba bajtów dziennika, które obejmują | bezterminowo |

Odcinek ma unikalne id (`sesja:numer`), więc ponowna wysyłka nie podwaja sum. Sumy dnia powstają z dziennika: podsumowanie
niezgodne z dziennikiem (awaria między zapisami) jest przebudowywane przy następnym odczycie lub zapisie, a przed usunięciem
dziennika podsumowanie jest zapisane. Awaria zapisu daje `503` na ten jeden `POST` i nie wpływa na panel; przeglądarka ponawia.

**Izolacja**: tylko usługa (`server/index.ts`) dostaje magazyn. Serwer scenariuszy, podglądy PR i testy nie przekazują
`usage`, więc `POST /api/usage` przyjmuje i porzuca dane (`204`), a prawdziwa historia nie jest dotykana.
Wyłączenie: nie ma osobnego przełącznika; pomiar nie jest uruchamiany bez `UsageSinkContext` (`src/main.tsx`).

## Odczyt i eksport

`just usage-export [OD] [DO]` (daty `RRRR-MM-DD`, domyślnie ostatnie 7 dni; `node scripts/usage-export.mjs`) czyta z działającej
usługi `GET /api/usage/summary?from=&to=` (tylko loopback, nigdy przez host Tailscale) i drukuje JSON:
`rows` (godzina po godzinie: `date`, `hour`, `browser`, `view`, `page`/`detail`, `pulpit`, `ms`, `entries`,
`visitsWithoutInteraction`, `noInteractionMs`, `ageIntegral`, `maxAgeMs`) oraz zbiorcze `byView`, `byHour`, `byPulpit`
(`przeglądarka/id pulpitu`, tylko `home`) ze średnim czasem od interakcji w sekundach (`meanAgeS`). Dni i godziny są w Europe/Warsaw.
Wektor nie ma do tego narzędzia MCP.

Przykład porównania: `byHour` pokazuje, w których godzinach panel jest wyświetlany; `byView` ile czasu spędza ambient, czat,
szczegóły i każda strona; `byPulpit`, który pulpit jest otwarty najdłużej.

## Katalog pokrycia

| Pomiar | Wspólny dla wszystkich | Tylko w danej funkcji |
| --- | --- | --- |
| Czas widoku, wejścia, interakcje | strony, pulpity, ambient, pełny czat, szczegóły | — (kafelki i funkcje: t-01c8aa59) |
| Błędy i niedostępność | — | t-fbcda0d3 |

## Testy

`src/usage-meter.test.ts` (przebieg z kontrolowanym zegarem), `server/usage.test.ts` (restart, ponowne przyjęcie, retencja,
awaria zapisu, brak treści), `server/usage-route.test.ts` (trasa) (izolacja scenariusza, Origin).
