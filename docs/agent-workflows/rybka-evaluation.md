# Ewaluacja i pomiary recenzentów specyfikacji (rybka)

Dokument rejestruje wyniki i metryki kolejnych przebiegów lokalnych recenzentów specyfikacji (`scripts/rybka.mjs`).
Służy do porównywania jakości, kosztów i skuteczności modeli (`DeepSeek` na OpenCode i `Gemini 3.8 Flash high` na agy).

## Instrukcja klasyfikacji uwag z raportu

Po każdym przebiegu słoń analizuje uwagi zgłoszone przez danego recenzenta i klasyfikuje je według poniższych kryteriów:

- **Uwagi blokujące**: realne braki, niejasności lub sprzeczne założenia w specyfikacji, które uniemożliwiłyby jednoznaczną implementację lub weryfikację kryteriów odbioru (np. brak docelowej listy, brak formatu danych, kolizja API). Każda taka uwaga wpływa na zakres i musi zostać rozstrzygnięta przed oznaczeniem zadania jako `gotowe`.
- **Uwagi redakcyjne**: sugestie stylistyczne, lepsze nazewnictwo, drobne formatowanie lub uwagi niewpływające na poprawność ani jednoznaczność wykonania zadania. Nie blokują gotowości.
- **Uwagi chybione**: uwagi nieprawdziwe, sprzeczne z jawnymi załącznikami / AGENTS.md, lub wymyślające wymagania poza zakresem zadania.
- **Unikalne blokujące**: uwagi blokujące zgłoszone wyłącznie przez tego jednego recenzenta (niezauważone przez drugiego w tej samej rewizji specyfikacji).
- **Potknięcie executora o niezgłoszone**: problem napotkany przez executora Cezara podczas implementacji lub weryfikacji, którego żaden z recenzentów nie zidentyfikował w specyfikacji (kolumna wypełniana po zakończeniu runu Cezara).
- **Runy do PR-a**: liczba prób / runów Cezara potrzebnych do pomyślnego utworzenia PR-a (wypełniane po zakończeniu realizacji).
- **Dokończone lokalnie**: czy zadanie (lub jego część, np. brakujące testy / poprawki) musiało zostać dokończone lokalnie w checkoucie przez agenta lub człowieka po runie Cezara (`tak` / `nie` ze wskazaniem przyczyny).

## Rejestr przebiegów

| Zadanie i rewizja | Rybka | Czas [s] | Tokeny | Koszt [USD] | Uwagi blokujące | Redakcyjne | Chybione | Unikalne blokujące | Potknięcie executora o niezgłoszone | Runy do PR-a | Dokończone lokalnie |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: | --- |
| C1 `t-fb294d14` rev 1 | DeepSeek | 394,388 | 90 953 | 0,034133 | 3 | 4 | 1 | 1 | tak: niestabilne testy weryfikacji, szczegóły niżej | 1 | nie — bez lokalnych poprawek kodu; PR wymaga korekt |
| C1 `t-fb294d14` rev 1 | Gemini | 142,293 | 67 837 | brak danych | 2 | 4 | 2 | 0 | tak: niestabilne testy weryfikacji, szczegóły niżej | 1 | nie — bez lokalnych poprawek kodu; PR wymaga korekt |
| C2 `t-7dea9734` rev 1 | DeepSeek | 174,218 | 170 850 | 0,021466 | 2 | 3 | 3 | 1 | nie wykonywano | — | nie wykonywano |
| C2 `t-7dea9734` rev 1 | Gemini | 249,017 | 104 782 | brak danych | 1 | 5 | 2 | 0 | nie wykonywano | — | nie wykonywano |
| C1 `t-fb294d14` rev 2 | DeepSeek — próba 1, read-limit | 236,517 | 211 156 | 0,017017 | — | — | — | — | tak: niestabilne testy weryfikacji, szczegóły niżej | 1 | nie — bez lokalnych poprawek kodu; PR wymaga korekt |
| C1 `t-fb294d14` rev 2 | DeepSeek — ponowienie | 401,395 | 110 014 | 0,034144 | 0 | 6 | 2 | 0 | tak: niestabilne testy weryfikacji, szczegóły niżej | 1 | nie — bez lokalnych poprawek kodu; PR wymaga korekt |
| C1 `t-fb294d14` rev 2 | Gemini | 230,839 | 81 183 | brak danych | 0 | 6 | 2 | 0 | tak: niestabilne testy weryfikacji, szczegóły niżej | 1 | nie — bez lokalnych poprawek kodu; PR wymaga korekt |
| C2 `t-7dea9734` rev 2 | DeepSeek | 524,176 | 177 094 | 0,028975 | 0 | 5 | 3 | 0 | nie wykonywano | — | nie wykonywano |
| C2 `t-7dea9734` rev 2 | Gemini | 126,493 | 84 587 | brak danych | 2 | 4 | 2 | 2 | nie wykonywano | — | nie wykonywano |
| C2 `t-7dea9734` rev 4 | DeepSeek — idle-timeout | 587,171 | 55 906 | 0,003680 | — | — | — | — | nie wykonywano | — | nie wykonywano |
| C2 `t-7dea9734` rev 4 | Gemini | 262,530 | 89 693 | brak danych | 2 | 5 | 1 | — | nie wykonywano | — | nie wykonywano |
| C2a `t-7dea9734` rev 5 | DeepSeek | 284,313 | 108 804 | 0,026364 | 0 | 5 | 3 | 0 | tak: uruchomienie serwera testowego i kodowanie Windows; szczegóły niżej | 1 | nie — bez lokalnych poprawek kodu; PR wymaga korekt |
| C2a `t-7dea9734` rev 5 | Gemini — timeout procesu | 600,204 | 61 465 | brak danych | — | — | — | — | tak: uruchomienie serwera testowego i kodowanie Windows; szczegóły niżej | 1 | nie — bez lokalnych poprawek kodu; PR wymaga korekt |
| C2a `t-7dea9734` rev 5 | Gemini — ponowienie | 180,541 | 66 468 | brak danych | 0 | 6 | 2 | 0 | tak: uruchomienie serwera testowego i kodowanie Windows; szczegóły niżej | 1 | nie — bez lokalnych poprawek kodu; PR wymaga korekt |
| OpenRouter `t-0fc77df7` rev 2 | DeepSeek | 103,031 | 57 500 | 0,016868 | 3 | 3 | 2 | 1 | nie wykonywano | — | nie wykonywano |
| OpenRouter `t-0fc77df7` rev 2 | Gemini | 257,361 | 80 106 | brak danych | 3 | 3 | 2 | 1 | nie wykonywano | — | nie wykonywano |
| OpenRouter `t-0fc77df7` rev 3 | DeepSeek | 68,129 | 67 891 | 0,011283 | 0 | 4 | 4 | 0 | nie wykonywano | — | nie wykonywano |
| OpenRouter `t-0fc77df7` rev 3 | Gemini | 208,519 | 72 840 | brak danych | 0 | 4 | 4 | 0 | nie wykonywano | — | nie wykonywano |
| OpenRouter `t-0fc77df7` rev 4 | DeepSeek | 72,269 | 103 021 | 0,013821 | 0 | 4 | 4 | 0 | nie wykonywano | — | nie wykonywano |
| OpenRouter `t-0fc77df7` rev 4 | Gemini | 207,347 | 72 832 | brak danych | 0 | 4 | 4 | 0 | nie wykonywano | — | nie wykonywano |

### OpenRouter — oficjalne dane konta, 2026-11-03

Wybrano istniejące `t-0fc77df7` z listy „Usprawnienia Desk Panel”. Użytkownik odrzucił proponowane samo oznaczenie
braków lokalnego logu: chce kwoty zgodne z dashboardem OpenRouter. Potwierdził konfigurację osobnego management key
poza Gitem. Oficjalna dokumentacja wskazuje `analytics/meta` i `analytics/query` jako źródło agregatów Explore;
próba `analytics/meta` zwykłym kluczem panelu dała 403. Zakaz `/api/v1/activity` pozostał i nie wywołano tej trasy.
Zmiana jest przygotowana dla `executor=cezar`, `repo=desk-panel`, `mode=implementacja`, bez dispatchu.

Rev 1 nie dotarła do modeli: walidator załączników potraktował wzmiankę o przyszłym pliku scenariusza jako istniejący
załącznik. Usunięto ją z sekcji ZAŁĄCZNIKI; zakres pozostał. Obie rybki skutecznie przeczytały rev 2.
Pełne raporty zapisano w komentarzach zadania, z kontrolą odtworzenia treści. Pierwszy zapis DeepSeek przyciął końce
wierszy części przez `trim` API; zastąpił go oznaczony poprawiony komplet (końcowy LF pliku raportu nie jest treścią modelu).

Klasyfikacja rev 2: DeepSeek — blokujące 1, 2, 5 (5 unikalna), redakcyjne 3, 4, 6, chybione 7, 8;
Gemini — blokujące 1, 2, 3 (3 unikalna w części o uprawnieniach `credits`, nie nazwie opcji), redakcyjne 4, 5, 8,
chybione 6, 7. Wspólne braki to dokładne body czasu i schemat odpowiedzi. DeepSeek zauważył rzeczywisty konflikt:
hook po błędzie zwracał `last` jako sukces. Gemini wskazał niezapisane założenie o uprawnieniach management key do
`credits`. Rev 3 usuwa te braki: Analytics dostaje managementKey, istniejący `apiKey` służy tylko `credits`, błąd czyści
frontendowy `last`. Cache to wyłącznie jeden udany payload przez 60 s, bez odświeżania `observedAt` przy trafieniu.
Bez retry, paginacji i nowej ochrony współbieżności; odpowiedź ucięta ma jawnie zawieść.

Nie dodano skomplikowanej arytmetyki ani pełnej kopii standardowego scenariusza. Kwoty backendu pozostają Number,
formatowanie robi UI; minimalny scenariusz błędu obsługuje istniejący runner, a wykonanie before po dodaniu samego
fixture było już zapisane. Są to odrzucone rozszerzenia, nie nowe wymagania. Dla finalnej rev 3 uruchomiono ponownie
obie rybki, żeby gotowość odnosiła się do dokładnie przeczytanej rewizji. Prywatne raporty:
`.ai/rybka-runs/2026-11-03T10-57-08-316Z-opencode-22a3f6a6/` i
`.ai/rybka-runs/2026-11-03T10-57-11-612Z-agy-4387116d/`.

DeepSeek rev 3: zero blokujących; redakcyjne 2, 4, 6, 8, chybione 1, 3, 5, 7. Czyszczenie `last`, mapowanie błędów,
jeden pełny payload cache i brak deduplikacji są już jawne. Dokładny tekst komunikatu, dobór walidacji oraz usunięcie
zbędnych opcji/helperów to praca implementacyjna; nie zamawiamy priorytetyzacji dwóch jednoczesnych błędów ani
osobnej gramatyki egzotycznych zapisów liczb. `settled()` ma tylko konsumenta testowego, więc nie potrzebuje no-op
„dla zgodności”. Minimalny fixture `{"openrouterUsage":{"$error":503}}` sprawdzono lokalnym `loadScenario` bez modeli
i zmian implementacji. Raport rev 3: `.ai/rybka-runs/2026-11-03T11-03-43-430Z-opencode-42018f33/`.

Gemini rev 3: zero blokujących; redakcyjne 1, 3, 4, 6, chybione 2, 5, 7, 8. Wymienienie obu kluczy obejmuje klucz
zarządzający, kontrakt określa postać daty i dopuszcza ujemne saldo, a walidacja/formalny błąd 502 nie zamawia obsługi
hipotetycznego konta post-paid. Mechanizm timeoutu i mock respektujący abort są wyborem wykonawcy; nie dokładamy
filtrowania poprawnych zerowych kwot oficjalnej odpowiedzi. Uwagi o czyszczeniu `last` oraz `settled()` były już
rozstrzygnięte w rev 3 i regułach repo. Pełny raport i klasyfikację zapisano w komentarzach bez zmiany rev 3;
`.ai/rybka-runs/2026-11-03T11-03-46-606Z-agy-a5dbd069/`. Pozostałe sugestie nie wprowadzają nowych decyzji produktu.

Minimalny scenariusz dodatkowo przeszedł prawdziwy runner zrzutów na izolowanym API
(`--open tile:openrouter`, 1280×720 CSS), bez `pageerror`; brak pozostałych źródeł daje obsługiwane odpowiedzi 503.
Oba skuteczne przeglądy finalnej rev 3 sklasyfikowano i rozstrzygnięto bez kolejnej rozbudowy specyfikacji.
Końcowy odczyt C1 potwierdził `gotowe`, rev 3, workflow `desk-panel-task`, bez braków. Nie wykonano implementacji
ani dispatchu. Porównanie live z Explore pozostaje jawnym odbiorem po przyszłym PR-ze, z kluczem użytkownika;
przygotowanie ani testy na atrapach go nie zastępują. `just check` przygotowania przeszedł.

#### Cofnięcie gotowości i uproszczenie po kontroli użytkownika

2026-11-03 użytkownik wstrzymał rev 3 blokadą „Czeka na klucz i weryfikację API”: dotychczasowy kontrakt Analytics
pochodził tylko z dokumentacji, a propozycja nowego management key nie uwzględniała dziedziczenia środowiska przez agy
ani braku izolacji DPAPI pomiędzy procesami tego samego konta Windows. Poprzednia klasyfikacja zero pozostałych uwag
nie jest dowodem bezpieczeństwa ani potwierdzeniem kontraktu live. Gotowość została cofnięta; nie było dispatchu.

Sprawdzono dokumentację: management key ma operacje zarządzania kluczami/limitami, dostępny jest wariant read-only.
Hermes ma oddzielny envFile, lecz agy dostaje pełne środowisko panelu, a obie usługi działają jako Viktor. Użytkownik
najpierw zaakceptował ograniczenia read-only + DPAPI poza env, potem świadomie zrezygnował z nowego klucza: wybrał
oficjalne liczniki obecnego klucza zamiast historii/per-model i Analytics. Nie tworzono magazynu ani polecenia zapisu
sekretu, nie zmieniano tożsamości usług i nie wykonywano analytics/query.

Dowód live dla nowego zakresu: 2026-11-03, jedno autoryzowane `GET /api/v1/key`, HTTP 200, `{data: object}`;
`usage_daily`, `usage_weekly`, `usage_monthly`, `usage`: number; `limit`, `limit_remaining`: null;
`limit_reset`: string; `is_management_key`: boolean. Nie zapisano wartości finansowych, etykiety klucza ani surowej
odpowiedzi. Rev 4 upraszcza zadanie do tych liczników i limitu; poprzednie raporty nie są przeglądem tego zakresu.
Uruchomiono nowe obie rybki z dodatkową regułą kontroli uprawnień i dowodu live. Reguła jest w AGENTS.md,
checkliście przygotowania i wspólnej roli runnera (oba warianty mają asercje w istniejących testach).

DeepSeek rev 4: zero blokujących; redakcyjne 1, 2, 6, 7, chybione 3, 4, 5, 8. Nazwy komunikatów, miejsce opisu resetu
i aktualizacja starych testów są decyzjami wykonawczymi, nie powodem dokładania pól/stanów produktu. Nullable limity,
liczbowe liczniki i błędy formatu są już określone. Nie zmieniamy formatowania mikroskopijnych kwot ani pollera hooka,
nie dokładamy rozmiaru 390×844 do zrzutów zamówionych przy 1280×720. `real-sources.ts` i fixture standard są jawnie
w zakresie, choć załączniki recenzenta nie zawierają całego repo. AGENTS już zabrania commitowania PNG i ujawniania
sekretów. Pełny raport i klasyfikację zapisano w zadaniu;
`.ai/rybka-runs/2026-11-03T11-25-13-005Z-opencode-1d44709b/`.

Gemini rev 4: zero blokujących; redakcyjne 1, 2, 5, 7, chybione 3, 4, 6, 8. Umiejscowienie dopisków i siatki jest
decyzją wykonawczą; nie dokładamy alarmowych stylów. `last` przy remount i czyszczenie po błędzie nie są sprzeczne.
Sprawdzono, że `openrouterUsage` jest wyłącznie w `scenarios/standard.json`, nie w `scripts/preview-scenario.json`.
Pełny raport oraz klasyfikacja są w zadaniu; `.ai/rybka-runs/2026-11-03T11-25-15-766Z-agy-3ff1b198/`.
Po obu przeglądach dokładnej rev 4, dowodzie live i zapisaniu rozstrzygnięć zdjęto blokadę, ustawiono `gotowe`
i potwierdzono brak braków C1. Nie ma nowego sekretu; nie wykonano implementacji ani dispatchu. Test runnera 23/23
oraz pełne `just check` zmian procesu przeszły.

### C2a — wynik executora i niezależny przegląd PR #44, 2026-11-03

Jedna próba Cezara `b2e33b61-b9f8-4cb1-a21b-dea8a380185a` doprowadziła do [PR #44](https://github.com/metelskiwiktor/desk-panel/pull/44), head `f7d6a8886b3bd19044a41cecc365fd770d99e26e`, baza `f7f03a4837f41e69868daf7ce22465f7d1cb4e8f`. Realizowano C2a rev 5; wynik jest wspólny dla trzech wierszy przeglądów tej rewizji, nie oznacza trzech runów. Implementacja: 18 min 42 s; całość: 24 min 50 s; pierwsza zakończona edycja po 3 min 27,6 s od startu implement (3 min 40,4 s od startu runu, plik scenariusza). Zero rund `fix` i `address`, pierwsze verify przeszło; review agy zakończyło się `approve`, bez uwag. W implement uruchamiano testy celowane (końcowo 191 testów), typecheck i knip; nie znaleziono wywołania pełnego zestawu testów ani `just check` przed krokiem verify. Nie dokończono kodu lokalnie, nie scalono ani nie zmieniono PR-a.

Executor napotkał problemy niezgłoszone przez rybki: nowy helper testowy czekał na `listening` bez uruchomienia serwera, co powodowało timeouty nawet po podwyższeniu limitu; poprawił kolejność `listen`/oczekiwania. Zapis testów przez PowerShell uszkodził polskie literały (13 porażek); executor odtworzył plik z bazy i ponownie naniósł dopisek. Naprawiał też własne asercje czytające odpowiedź JSON dwukrotnie i obliczające prompt już po zmianie stanu. Są to potknięcia implementacji/narzędzi, nie nowe nierozstrzygnięte decyzje specyfikacji. Źródło: `.ai/cezar/runs/b2e33b61-b9f8-4cb1-a21b-dea8a380185a.ndjson`, m.in. wiersze 784, 808, 835, 852, 871, 1031, 1039 i 1073; końcowe podsumowanie implement w wierszu 1570.

Niezależny przegląd dokładnego headu w osobnym worktree: 191/191 testów celowanych oraz pełne `just check` (1168/1168 testów, typy, knip, build) przeszły. Dodatkowe próby z atrapą Cezara potwierdziły odrzucenie czterech kluczy klienta (`prompt`, `model`, `workflow`, `project`) oraz dokładny prompt i workflow C1 dla obu trybów. Odtworzono błąd P2: po otwarciu podglądu zmiana wykonawcy na `lokalnie` ukrywa podgląd i przycisk odświeżenia (`src/TodoDialog.tsx:185`), wbrew jawnemu wymaganiu rev 5; test sprawdza tylko zmianę pomiędzy dwoma gotowymi trybami. To przeoczenie implementacji, a nie niezgłoszony brak specyfikacji (rybki wcześniej wskazywały zachowanie podglądu).

Ponownie wygenerowano i obejrzano widoki obu zadań przy 1280×720 oraz 390×844: sekcja, braki i rozwinięty prompt są czytelne, bez poziomego przepełnienia. Runner `--open todo-dispatch` robi jednak na telefonie tylko gotowe zadanie (`scripts/scenario.ts:352`); niegotowe sprawdzono osobnym przebiegiem tego samego scenariusza. Należy dopiąć ten brakujący zrzut i wymagać obecności podglądu zamiast warunkowo pomijać jego otwarcie. Artefakty i logi pozostają poza Gitem. Nie wykonano prawdziwego zlecenia Cezara. Aktualizacja rejestru nie naprawia tych dwóch uwag P2.

### C1 — wynik executora i niezależny przegląd PR #43, 2026-11-02

Jedna próba Cezara `fbf6bca3-2e74-4274-a81b-83537d1c8456` doprowadziła do [PR #43](https://github.com/metelskiwiktor/desk-panel/pull/43), head `b4534910d1e59be2a7980034d861e0c860768545`, baza `d86d3686c449cd670e654c25004f148a58f14ab7`. Realizowano spec rev 3, zatwierdzoną bez kolejnej rybki po rozstrzygnięciach rev 2; wynik jest wspólny dla pięciu wierszy historycznych przeglądów C1, nie oznacza pięciu runów. Implementacja: 12 min 55 s; całość: 28 min 3 s; pierwsza zakończona edycja po 58 s od startu implement. Jedna runda `fix`, zero `address`; review agy zakończyło się `approve` z uwagą P3 o formatowaniu. Nie dokończono kodu lokalnie i nie scalono PR-a.

Executor potknął się o problemy niewskazane przez rybki: pierwsze automatyczne verify odrzuciło niestabilny test `src/appointment-card.test.tsx`; podczas ponowień pojawiały się również błędy Windows `EPERM: rename` w niezmienianych testach automatów/podglądu. To potknięcia środowiska/weryfikacji, nie nowo odkryte decyzje specyfikacji. `fix` diagnozował je bez zmiany plików źródłowych; drugie automatyczne verify przeszło. Run uruchamiał też pełne testy w implementacji i fix mimo zakazu w promptach (w implementacji dwa `just check` oraz `vitest --no-file-parallelism`); zaliczenie końcowej bramki nie dowodzi przestrzegania całego procesu. Źródło: `.ai/cezar/runs/fbf6bca3-2e74-4274-a81b-83537d1c8456.ndjson`, m.in. wiersze 758, 782, 800, 861, 1041, 1073, 1102, 1252 i 1313. Artefakty runu są prywatne, poza publikowanym diffem.

Niezależny przegląd dokładnego headu PR-a: testy celowane pięciu plików przeszły (122/122), ale parser fenced code nie spełnia w pełni gramatyki Markdownu: akceptuje backtick w info string otwieracza oraz NBSP po zamykaczu. Próby bez zmiany źródeł odtworzyły odpowiednio fałszywe braki i fałszywą gotowość. Reguły były już jawne w spec rev 3 (bloki według Markdownu), więc to błędy implementacji/testów, nie nowe niezgłoszone niejasności. Reguła zatrzymania `Type: UI` bez parametrów zrzutów jest w dokumencie przygotowania, ale brakuje jej w instrukcjach bezpośrednio czytanych przez executora. Nowa checklista i krok „Kontrola zapisu” wymagają też gotowości bez braków przed ustawieniem `gotowe`, choć funkcja wymaga już tego stanu; kolejność przygotowania wymaga korekty. Poprawki pozostawiono do wykonania przed scaleniem; ten przegląd nie naprawiał PR-a. Checki GitHuba dla tego headu zakończyły się błędami testów na Ubuntu i Windows (run Actions `41532023293`), mimo poprawnych typów/knip/build. Nie utożsamiać ich z udanym lokalnym verify Cezara.

### C2 — uproszczenie rev 4 i podział C2a/C2b, 2026-11-02

Użytkownik uznał rev 3 za zbyt dużą. Rev 4 usunęła retryOf/łańcuchy, replay równoległy i po restarcie,
API unknown/failed, odczyt tasków spoza snapshotu i drugi scenariusz. Przyjęto ryzyko ponownego
zlecenia po utracie wyniku lub zniknięciu taska ze snapshotu; nowe reguły wymagają realnego problemu.

DeepSeek rev 4 nie dał raportu: 8 minut bez zdarzeń, idle-timeout po 587,171 s całej próby,
12 odczytów, brak tekstu. Tokeny/koszt obejmują zakończone kroki, nie niedokończony krok.
Powód i metryki pokazano użytkownikowi, bez zmiany skryptu/limitów; rewizja została zastąpiona.
Gemini rev 4 dał skuteczny raport zapisany w komentarzach. Klasyfikacja słonia: blokujące 1 i 8
(dane rejestru dla UI, rozmiar), redakcyjne 3–7, chybiona 2 (istnieje sources.cezar()).
Unikalności nie oceniano wobec braku raportu drugiej rybki.

Użytkownik zatwierdził podział: C2a zachowuje id t-7dea9734 i blokadę „czeka na C1”; C2b t-ed9a64c6
jest lokalne, z trzema sekcjami spec, bez rybek/Cezara, po scaleniu C2a. Dla UI dodano minimalną
projekcję rejestru w istniejącym GET /api/todos, bez nowego endpointu podglądu/pollera i bez zapisu
w danych zadania. Rejestr pozostaje zarządzany przez istniejący Cockpit. C2a rev 5 ma obie rybki
na tej rewizji; przeniesienie skilla do C2b usuwa tę pracę z executora Cezara.

Pierwszy Gemini rev 5 zwrócił result SUCCESS po ok. 137 s (61 465 tokenów), lecz proces CLI nie
wyszedł. Runner zakończył próbę timeoutem po 600,204 s, exit 1. completed:true w metrykach oznacza
wynik modelu, nie zakończenie procesu; próba nie spełnia gotowości. Pokazano powód/metryki,
zapisano komentarz; bez zmian runnera/limitów. Ponowiono tylko Gemini na tej samej rev 5.
Koszt Gemini nie jest dostępny i nie jest zerem. Skuteczny DeepSeek rev 5 zapisano w komentarzach.
Ponowiony Gemini zakończył się skutecznie: 180,541 s, 66 468 tokenów, exit 0. Ma skuteczny raport
na tej samej C2a rev 5 co DeepSeek; raporty zapisano bez ucinania w komentarzach i sprawdzono
odtworzenie wszystkich części. Nie powtarzano skutecznego DeepSeek i nie zmieniano runnera.

Użytkownik zatwierdził poniższą klasyfikację i domknięcie C2a rev 5 bez rozbudowy zakresu
(2026-11-02, odpowiedź na raporty):
- DeepSeek rev 5: redakcyjne 1, 4, 5, 6, 7; chybione 2, 3, 8; brak blokujących.
- Gemini rev 5: redakcyjne 1, 2, 3, 4, 5, 8; chybione 6, 7; brak blokujących.

Szczegóły etykiet, formatowania API/komentarza i prezentacji pozostają wykonawcy w granicach
spec. Enumy i normalizacja pochodzą z C1; executor nie jest runnerem. Rejestr zachowuje wszystkie
zlecenia do mapowania PR, projekcja wybiera ostatnie dla klucza. Każdy istniejący stan inny niż
failed/cancelled blokuje; brak taska jest traktowany jak niepowodzenie, zgodnie z uproszczeniem.
Istniejące Zapisz może zamknąć okno — nie dołożono przebudowy szkiców. Wymóg rozszerzenia mapowania
PR już jest w zakresie; nie jest obietnicą, że stary kod obsłuży nowy rejestr automatycznie.
Zrzuty przed/po dotyczą zmiany kodu; --open todo-dialog już istnieje, telefon to jawny viewport
Playwright. Te odpowiedzi nie rozszerzają zachowania ani nie wymagają nowej rewizji specyfikacji.
Nie przywrócono replayu, retryOf, klas błędów, transakcji ani odczytu poza snapshotem.
Nie ma nowych decyzji o zakresie/zachowaniu ani blokad; nie uzależniono gotowości od potwierdzenia
samej klasyfikacji redakcyjnych/chybionych pytań. Spec rev 5 pozostaje dokładnie tą przeczytaną przez
obie skuteczne rybki. C2a ma gotowe z blokadą „czeka na C1”; C2b gotowe z blokadą do scalenia C2a.

C2b ma krótką spec w polu spec (rev 1, autor codex) i wykonawcę lokalnie w notatce/spec, ponieważ
pole executor dopiero dostarczy C1. Bez rybek/Cezara, blokada do scalenia C2a. Nie wykonano
implementacji, wdrożenia, restartu ani dispatchu.

### C1/C2 — 2026-11-02, rev 2 → rev 3

Użytkownik przyjął klasyfikację drugiej rundy:

- C1 DeepSeek: redakcyjne 1, 2, 3, 5, 6, 8; chybione 4, 7.
- C1 Gemini: redakcyjne 1, 2, 5, 6, 7, 8; chybione 3, 4.
- C2 DeepSeek: redakcyjne 2, 3, 5, 7, 8; chybione 1, 4, 6.
- C2 Gemini: blokujące 3, 4 (obie unikalne); redakcyjne 1, 2, 5, 6; chybione 7, 8.

Pierwsza próba DeepSeek C1 nie dała raportu: model przekroczył 12 odczytów (wykonał 13, w tym ponowne
odczyty tych samych plików), `reason: read-limit`, `completed: false`, `textLength: 0`, exit 1.
Metryki tej próby obejmują tylko zakończone kroki. Powód i metryki pokazano użytkownikowi i zapisano
w komentarzu; nie zmieniono skryptu, limitów ani materiałów. Jedno ponowienie wyłącznie DeepSeek
zakończyło się skutecznie przy 8 odczytach. Pozostałe trzy raporty rev 2 też zakończyły się skutecznie.
Nieudana próba nie ma klasyfikacji uwag i nie jest przeglądem spełniającym definicję gotowości.

Rozstrzygnięcia blokad: aktywne `blocked` zatrzymuje przycisk i unieważnia zgodę; dla taska poza
retencją snapshotu dozwolony jest pojedynczy odczyt istniejącym `cezarRun` przy jawnym podglądzie/POST,
bez nowego pollera. Użytkownik zatwierdził oba. Redakcja doprecyzowała tekstowy widok C1 (także brak
spec/historyczna rewizja), granice sekcji, komunikaty, podział C1/C2, zachowany wynik/retryOf,
typ ostrzeżenia i klasy błędów. Nie dołożono nonce ani nowej funkcji produktu: gwarancja replayu
dotyczy potwierdzonych zachowanych zleceń, a nie unknown bez taskId. Krotka z retryOf już wskazywała
potwierdzoną próbę; braki w `panel_todos` należą do wyniku C1. Automatyczny krok rozwijający podgląd
w scenariuszu był już wymagany, nie potrzebuje osobnej decyzji o składni runnera.

Pełne raporty i rozstrzygnięcia rev 2 zapisano w komentarzach zadań; zgodność wszystkich części
z oryginałem sprawdzono. Rev 3 zapisano w polu `spec` z autorem `codex`. Użytkownik jawnie zwolnił
rev 3 z kolejnej rybki pod warunkiem, że zawiera wyłącznie rozstrzygnięcia tej rundy i redakcję;
warunek spełniono. Oba zadania mają stan `gotowe`, C2 zachowuje blokadę „czeka na C1”. Nie wykonano
implementacji ani dispatchu Cezara.

Sprostowanie przyczyny problemu z kartą: użytkownik dostarczył analizę `state.db` sesji `987ecbe5`,
według której pełne `panel_todos` dotarło do Wektora, a treść zgubił model przy długim kontekście.
To nie było przycinanie przez Hermesa. Źródło i szczegóły są w DECYZJACH C1 rev 3; analizy bazy
nie powtarzano w tym przygotowaniu. Poniższa diagnostyka regexu dotyczy osobnego runnera rybki.

### C1/C2 — 2026-11-02, rev 1

Wszystkie cztery próby zakończyły się skutecznym raportem (`completed`, exit 0), bez błędów narzędzi/providerów.
To pierwszy rzeczywisty przegląd Gemini w tym procesie. Pełne raporty są w komentarzach odpowiednich zadań
(`Przegląd rev 1 — DeepSeek/Gemini — część i/k`); zapis części sprawdzono przez odtworzenie całego raportu.
Tokeny obejmują cache; Gemini nie podał kosztu, więc nie zastępujemy go zerem.

**Użytkownik przyjął poniższą klasyfikację i liczniki w tabeli w odpowiedzi na raporty rev 1.**
Numery oznaczają uwagi w oryginalnych raportach; gotowość wymaga jeszcze usunięcia blokad.

- C1 DeepSeek: blokujące 5, 6, 7 (7 unikalna); redakcyjne 2, 3, 4, 8; chybiona 1.
- C1 Gemini: blokujące 1, 5; redakcyjne 2, 3, 4, 6; chybione 7, 8.
- C2 DeepSeek: blokujące 5, 8 (5 unikalna); redakcyjne 2, 3, 4; chybione 1, 6, 7.
- C2 Gemini: blokująca 3; redakcyjne 1, 4, 6, 7, 8; chybione 2, 5.

Blokady C1: funkcja promptu bez produkcyjnego konsumenta (knip), gramatyka rozpoznawania sekcji oraz
respektowanie parametrów zrzutów ze specyfikacji zamiast stałych przykładowej komendy. Blokady C2:
klucz/zasady ponawiania i zachowanie podglądu po zmianie danych. Pytania o nazwy eksportów/JSON,
położenie metadanych i lokalny magazyn doprecyzowują implementację bez dokładania funkcji produktu.

Kontrola przeciwko kodowi: `panel_todo_action` ma ogólny schemat wejściowy `action: object`
(`server/panel-mcp.ts`); nowe pola wspólnej akcji zmieniają jej walidację i wyprowadzony opis, nie muszą
zmieniać tego zewnętrznego schematu MCP (C1 DeepSeek 1). Samodzielna zmiana/wyczyszczenie pól oraz
zachowanie bramki zakresu były już wymagane (C1 Gemini 7–8). C2 jawnie czeka na wynik C1, dopuszcza
rewizję w historii albo powiązaniu, wymaga obsługi pełnego spec ponad dawny limit 32 tys. i wprost
dopuszcza viewport Playwright 390×844 (C2 DeepSeek 1, 6–7; Gemini 2, 5). Ponadto
`sources.cezarCreateRun` nie waliduje ponownie `cezarCreateRunSchema`; limit 32 tys. dotyczy starej
trasy wejściowej (`server/app.ts`, `server/real-sources.ts`, `server/cezar-finished.ts`).

### Diagnostyka pobierania specyfikacji po id — 2026-11-02

Przed startem modeli odtworzono błąd `fetchTaskSpec`: B1 `t-ad1c4414` rev 2 miało w zapisanym `spec`
12 828 znaków i wszystkie dziewięć sekcji, natomiast runner pobierał tylko cztery znaki `CEL:`.
Alternatywa `\s*$` w regexie z flagą `m` pasowała do końca pierwszej linii. Istniejący test sprawdzał
obecność początku, więc nie wykrywał utraty pozostałych sekcji. Diagnostyka nie wywoływała modelu
(tokeny i koszt: 0). Nie dowodzi braku tych sekcji w B1 ani błędu jego wcześniejszego przeglądu,
który według komentarza zadania korzystał z pełnego pliku.

Po jawnej zgodzie użytkownika poprawiono warunek końca odpowiedzi i wzmocniono istniejący test:
porównuje całą wielosekcyjną treść wraz z załącznikami, z komentarzem i bez niego, LF/CRLF.
23 testy runnera oraz pełne `just check` przeszły. Przed czterema przeglądami potwierdzono zgodność
pełnego pobranego tekstu z zapisanym `spec` dla C1, C2 i B1 (pomijając wyłącznie istniejący trim runnera).
