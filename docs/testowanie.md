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
just screenshots standard --pages pulpit --open chat-skills     # nowe menu umiejętności Wektora
just screenshots standard --pages pulpit --open chat-compact    # czat obok pulpitu
just screenshots wizyty --pages pulpit --open chat-appointment # syntetyczna karta dni i godzin
just screenshots wizyty --pages pulpit --open chat-appointment-selected # automatycznie wypełniony kalendarz
just screenshots wizyty --pages pulpit --open chat-appointment-saved # zapis do atrapy Google
just screenshots wizyty --pages pulpit --open chat-appointment-axis # oś, kolizje, dni, Cezar i powrót do podsumowania
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

Interakcje GUI Wektora: `just wektor-ui all` lub pojedynczy przypadek `composer`, `keyboard`, `history`, `switching`.
To syntetyczna przeglądarka na tym samym środowisku co scenariusze, bez prawdziwego agenta i zapisów na kontach użytkownika.
Szczegóły i mapa frontendu: [wektor-ui.md](wektor-ui.md). Runner zapisuje raport, zrzuty i trace przy błędzie w `output/wektor-ui`.
Nie zastępuje oceny wyglądu ani pełnego `just check`.

```powershell
just test-fast   # w trakcie pracy: tylko testy, których dotyczą niezacommitowane zmiany (vitest --changed)
just check       # przed publikacją: testy, typy, martwy kod (knip) i build naraz (scripts/check.mjs)
```

`scripts/check.mjs` uruchamia cztery kroki równolegle i pokazuje wyjście tylko tego, który nie przeszedł; `just update` używa
tego samego (build idzie do `dist.next`). tsc jest przyrostowy (cache w `node_modules/.cache`). Vitest ma dwa projekty:
`server` (server/ i scripts/, bez DOM) i `ui` (src/, jsdom). knip (`knip.json`) działa w trybie produkcyjnym: kod, którego
używają tylko testy, też jest martwy. Wyjątkiem jest haczyk dla testów (np. reset pamięci podręcznej modułu) oznaczony `@internal`
w JSDoc. Podkomponenty assistant-ui w `src/components` (kod wygenerowany) są z tego wyłączone.

Czas testów to w większości CPU: ok. 150 s na 8 rdzeniach (było 190 s przed odchudzeniem testów renderujących cały panel),
z czego ok. 40% to jsdom i import `App` w każdym pliku UI. `isolate: false`, happy-dom i `userEvent.setup({ delay: null })`
sprawdzone 29.10.2026: nie skracają czasu albo psują testy z `vi.mock`. Podział pliku pomaga tylko, gdy jeden plik kończy się
długo po reszcie (tak było z czatem: `chat.test.tsx` i `chat-cockpit.test.tsx` mają wspólne `chat.test-kit.tsx`); gdy CPU
jest zajęte do końca, tylko dokłada narzut. Pliki `*.test-kit.tsx` to pomocnicy testów (knip ich nie liczy jako martwych).

### Jak pisać testy

- Test pilnuje niezmiennika, nie commita: tego, co ma zostać prawdą po refaktorze (kontrakt API, Origin-check, brak zapisu,
  maskowanie numerów, reguła podpowiedzi, widoczny skutek kliknięcia). Wygląd sprawdza zrzut scenariusza, nie test.
- Zmiana zachowania przepisuje istniejący test. Nowy test jest dla nowego niezmiennika; test, który sprawdza to samo co inny,
  się scala albo usuwa (w opisie commita: co pilnuje tego dalej).
- Czysta logika ma test na funkcji. `render(<App />)` jest dla przepływu przez kilka elementów panelu: kosztuje ok. 1 s CPU.
  Kafelek testuje się na nim samym, z tym samym hookiem i API scenariusza (`renderTiles` w `src/todos.test.tsx`,
  `renderFeed` w `src/mail.test.tsx`); panel zostaje dla siatki i tego, co kafelek otwiera poza sobą. Co widać na
  standardowym ekranie przed dotknięciem, sprawdza jeden render w `src/App.test.tsx`, a stan zasiewa się w `localStorage`
  zamiast go wyklikiwać.
- Nie dopisuje się kodu ani eksportów po to, żeby test przeszedł. Kod, którego używa tylko test, jest martwy (knip go zgłosi).
- Czas: wstrzykiwany zegar (`now`) albo `vi.useFakeTimers`, nie czekanie na `setTimeout` w teście.

Testy obejmują interfejs (na scenariuszach z `scenarios/` podawanych przez
to samo API co serwer scenariuszy), layout, reguły i historię zdarzeń, gesty oraz integrację:
paginację, autorytatywne liczniki, failed w grupie pytań, niepełne coverage,
błędny JSON, wygasły snapshot, rzeczywiste wiersze i linki oraz awarię bez
zastępczych danych. Testy kalendarza obejmują DST, wydarzenia całodniowe, odrzucone zaproszenia,
paginację, cache, awarię z zachowaniem danych oraz brak wycieku błędów autoryzacji.
Testy OAuth pinują PKCE, konto, state, expiry i odrzucenie powtórnego callbacku.
Build sprawdza także kod serwera.
Katalogi `.ai/` i `.claude/worktrees/` są wyłączone z uruchamiania testów w `vite.config.ts`: zawierają inne checkouty,
które mogą czytać scenariusze z niewłaściwej gałęzi i ładować drugą kopię Reacta (`Invalid hook call`).

Przy serii timeoutów 5 s w różnych testach UI najpierw sprawdź obciążenie i równoległość. 29.10.2026 domyślny przebieg
miewał timeouty, a ta sama wersja przechodziła pełny zestaw z ograniczeniem `VITEST_MAX_WORKERS` do 2 lub 4. W PowerShell:
`$env:VITEST_MAX_WORKERS='4'; just check` (tylko w bieżącej powłoce; usunięcie: `Remove-Item Env:VITEST_MAX_WORKERS`).
Nie podnoś automatycznie timeoutów i nie uznawaj każdego błędu za problem obciążenia — porównaj konkretne błędy i wyniki.

CI (`.github/workflows/check.yml`) przy każdym PR i pushu do `main` uruchamia
`npm ci` i `scripts/check.mjs` na Ubuntu i Windows (tylko tam działa test DPAPI).

Runner zrzutów przerywa działanie przy `pageerror` (wyjątek JavaScript), także gdy oczekuje na element strony.
Oczekiwane HTTP 503 w scenariuszu offline są osobnymi logami konsoli. Nazwy zrzutów uwzględniają `--open`, zapytanie,
stan Hermesa, ekran i skalowanie. `--file` wymaga jednej strony i jednego ekranu/skalowania; dla macierzy używaj `--out`,
żeby kolejne widoki nie nadpisywały jednego pliku.


## Lokalny podgląd PR

`just preview start 123` pobiera dokładny head PR z GitHub `origin`, tworzy osobny lokalny
checkout i instaluje jego zależności (`npm ci --ignore-scripts`). Wypisuje JSON z adresem,
numerem PR i pełnym SHA; pasek w podglądzie pokazuje tę samą tożsamość. `just preview status 123`
zwraca `running`, `stopped` albo `stale`; `just preview stop 123` zatrzymuje proces i usuwa jego
checkout i dane tymczasowe. Po błędzie startu kontroler próbuje bezpiecznie zakończyć worker;
sprawdź wskazany `preview.log`, a następnie użyj `stop`, aby usunąć zachowane pliki. Jeśli
identyfikacji procesu nie da się potwierdzić, komunikat prosi o ręczną diagnostykę. Aby pobrać nowy head po kolejnych commitach, zatrzymaj i uruchom podgląd ponownie.
Katalog stanu domyślnie znajduje się w systemowym katalogu tymczasowym `desk-panel-pr-previews`.
Jeśli Git lub npm zgłosi `Filename too long`, użyj krótszego katalogu bez zmieniania
ustawień systemu ani Gita. Ustaw go **przed** uruchomieniem i zachowaj tę samą wartość
w poleceniach start, status i stop (również w kolejnej sesji PowerShell):

```powershell
$env:DESK_PREVIEW_ROOT = Join-Path $env:LOCALAPPDATA "dp-preview"
just preview start 123
just preview status 123
just preview stop 123
```

Zmienna musi wskazywać ścieżkę bezwzględną; wybiera cały katalog stanu podglądów. Jeśli
poprzedni start pozostawił `stale`, najpierw uruchom `stop` z poprzednią wartością zmiennej
(lub bez niej, gdy użyto domyślnego TEMP). Krótsza ścieżka nie gwarantuje obsługi każdego
PR: bardzo głębokie nazwy w samym PR albo zależnościach nadal mogą przekroczyć limity narzędzi.

Na Windows `stop` może zakończyć nieodpowiadający worker po sprawdzeniu czasu utworzenia
procesu na tym samym uchwycie systemowym, więc nie kończy procesu o ponownie użytym PID.
Gdy przygotowanie checkoutu lub instalacja zależności jeszcze trwają, poczekaj na ich koniec
przed `stop`. Jeśli nie można potwierdzić tożsamości procesu, polecenie odmówi automatycznego
czyszczenia; sprawdź proces ręcznie. Wymuszone odzyskiwanie zawieszonego workera poza Windows
nie jest obsługiwane.

Frontend i moduły API pochodzą z pobranego commitu; API używa syntetycznego pliku `scripts/preview-scenario.json`,
scenariuszowych akcji w pamięci i lokalnej makiety Hermes. Linki symulowanych zleceń Cezara
kierują do lokalnej atrapy, a nie do prawdziwego Cezara. Czat i kokpit zapisują do katalogów
tymczasowych. Porty API, makiety i Vite są przydzielane przez system i dostępne tylko na loopback.
Vite dostaje jawny port sprawdzony przez `listen(0)` (nigdy 5174) i `strictPort: true`.
Między zwolnieniem portu a startem Vite inny proces może go zająć; wtedy start kończy się
błędem zamiast wybierać kolejne porty. Uruchom podgląd ponownie po `stop`.
Worker jest kopiowany do `scripts/` checkoutu PR-a, więc importy `../server/...` wskazują
te same moduły podczas analizy statycznej i działania. Test workera tworzy fixture z bieżących
plików roboczych (także niezacommitowanych i nieignorowanych nowych), a nie z HEAD.
To osobne procesy, bez restartowania usługi i bez odczytu jej konfiguracji. Scenariusz i interfejsy
serwera wybranego PR muszą być zgodne z kontrolerem; niezgodność jest zgłaszana w logu.

Uruchamiaj tylko **zaufane PR-y**: kod PR i jego konfiguracja Vite wykonują się z uprawnieniami
bieżącego użytkownika. Oddzielny katalog i ograniczone środowisko nie są piaskownicą systemową i
nie powstrzymają złośliwego kodu przed dostępem do plików, sieci lub produkcji. `--ignore-scripts`
wyłącza skrypty instalacyjne, ale nie stanowi izolacji uruchamianego kodu. Podgląd nie jest dostępem
z telefonu ani mechanizmem wdrażania.
