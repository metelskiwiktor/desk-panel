# Testowanie, scenariusze i weryfikacja

## Scenariusze i zrzuty ekranu

UI czyta wyłącznie lokalne API (`/api/*`), walidowane schematami z `src/*-contract.ts`.
Serwer składa je z interfejsu `PanelSources` (`server/sources.ts`), który ma dwie
implementacje: `server/real-sources.ts` (usługa: Cezar, Google, komputer, adapter
limitów) i `server/scenario.ts` (plik JSON). UI nie wie, która odpowiada.

Scenariusz w `scenarios/*.json` zawiera po jednej odpowiedzi na endpoint (`cezar`,
`calendar`, `calendarConnection`, `training`, `system`, `quotas`; opcjonalnie `todos`, zob. [docs/zadania.md](zadania.md)) dokładnie w kształcie API.
Czasy zapisuje się względem chwili zapytania: `"now"`, `"now-20m"`, `"now+1h30m"`
(ms, s, m, h, d). Dni kalendarzowe: `"today"`, `"today+2"`, `"today-1"` (data lokalna), a
`"today-1@22:10"` to ta godzina tego dnia. Scenariusze `training-*` pokazują dzień z interwałami,
po treningu, bez treningu i listę częściową. Zamiast odpowiedzi endpoint może mieć `{ "$error": 502 }` albo
`{ "$pending": true }` (ładowanie bez końca); brakujący endpoint odpowiada 503.
Plik jest czytany przy każdym zapytaniu, więc zmiany widać od razu, a błędy
kontraktu są zgłaszane ze ścieżką pola.

```powershell
just scenario offline                                  # UI na scenariuszu, adres w konsoli
just screenshots standard                              # output/screenshots/standard-*.png
just screenshots high-ram --pages pulpit,system --device medialove-14 --scale all
just screenshots standard --nav                        # keep the bottom navigation (hidden by default)
npm run scenario -- inbox --shot --query ambient=night # pierwszy ekran z zapytaniem w adresie (zegar nocny)
npm run scenario -- C:\temp\moj.json --shot           # dowolny plik
just screenshots standard --pages pulpit --open tile:github-pr  # kafelek 2x2 po lewej
```

`--open tile:<rodzaj>` wstawia kafelek z pominięciem wyboru, więc najpierw sprawdza, czy pusta komórka pulpitu go proponuje.
Kafelek, który się renderuje, ale którego wybór nie proponuje (brak w `pickable()` w `src/workspace-kinds.ts`, jak `github-pr`
w PR #36), kończy zrzut błędem; użytkownik nie mógłby go dodać. Rodzaj, którego jeszcze nie ma (zrzut „przed” nowym
kafelkiem), daje domyślny układ jak dotąd.

Ekrany pochodzą z `devices.json`: rozdzielczość fizyczna, przekątna, lista skalowań
Windows (pierwsze to główne) i dotyk. Rozmiar CSS, PPI i wartości do Chrome DevTools
(*Settings → Devices → Add custom device*) są wyliczane — `just devices` je wypisuje.
`--device <id>|all` (domyślnie pierwsze urządzenie) i `--scale <współczynnik>|primary|all`
wybierają ekrany; zrzuty mają fizyczną rozdzielczość, np. `standard-pulpit-medialove-14@1.5x.png`.
UI nie czyta tego pliku do układu — w Ustawieniach karta „Ekran” jedynie pokazuje,
któremu urządzeniu i skalowaniu odpowiada bieżący ekran.

### Monitor 14" (Secondary)

- **Identyfikator EDID**: P16 (producent YZA)
- **Rozdzielczość**: 1920 × 1080 @ 60 Hz
- **Pozycja**: X = 3440, Y = 0 (po prawej stronie głównego monitora)
- **Skala w Windows**: 150% (logiczny obszar roboczy 1280 × 720)
- **Orientacja**: Pozioma (Landscape)

Skrypt uruchamia Vite i API scenariusza na wolnych portach (nie dotyka usługi ani
prawdziwych źródeł). Te same pliki zasilają testy UI (`src/test-fixtures.ts`), a
`server/scenario.test.ts` sprawdza, że każdy z nich spełnia kontrakty.


## Weryfikacja

```powershell
npm run typecheck
npm test
npm run build
```

Testy obejmują interfejs (na scenariuszach z `scenarios/` podawanych przez
to samo API co serwer scenariuszy), layout, reguły i historię zdarzeń, gesty oraz integrację:
paginację, autorytatywne liczniki, failed w grupie pytań, niepełne coverage,
błędny JSON, wygasły snapshot, rzeczywiste wiersze i linki oraz awarię bez
zastępczych danych. Testy kalendarza obejmują DST, wydarzenia całodniowe, odrzucone zaproszenia,
paginację, cache, awarię z zachowaniem danych oraz brak wycieku błędów autoryzacji.
Testy OAuth pinują PKCE, konto, state, expiry i odrzucenie powtórnego callbacku.
Build sprawdza także kod serwera.
Katalog `.ai/` (worktree zadań Cezara: inne gałęzie, starszy kod) jest wyłączony z uruchamiania testów w `vite.config.ts`: jego testy czytają `scenarios/` tego
checkoutu i psułyby się przy każdej zmianie schematu scenariuszy.

CI (`.github/workflows/check.yml`) przy każdym PR i pushu do `main` uruchamia
`npm ci`, testy i build na Ubuntu i Windows (tylko tam działa test DPAPI).

