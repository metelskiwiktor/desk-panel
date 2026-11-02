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
| C1 `t-fb294d14` rev 1 | DeepSeek | 394,388 | 90 953 | 0,034133 | 3 | 4 | 1 | 1 | nie wykonywano | — | nie wykonywano |
| C1 `t-fb294d14` rev 1 | Gemini | 142,293 | 67 837 | brak danych | 2 | 4 | 2 | 0 | nie wykonywano | — | nie wykonywano |
| C2 `t-7dea9734` rev 1 | DeepSeek | 174,218 | 170 850 | 0,021466 | 2 | 3 | 3 | 1 | nie wykonywano | — | nie wykonywano |
| C2 `t-7dea9734` rev 1 | Gemini | 249,017 | 104 782 | brak danych | 1 | 5 | 2 | 0 | nie wykonywano | — | nie wykonywano |
| C1 `t-fb294d14` rev 2 | DeepSeek — próba 1, read-limit | 236,517 | 211 156 | 0,017017 | — | — | — | — | nie wykonywano | — | nie wykonywano |
| C1 `t-fb294d14` rev 2 | DeepSeek — ponowienie | 401,395 | 110 014 | 0,034144 | 0 | 6 | 2 | 0 | nie wykonywano | — | nie wykonywano |
| C1 `t-fb294d14` rev 2 | Gemini | 230,839 | 81 183 | brak danych | 0 | 6 | 2 | 0 | nie wykonywano | — | nie wykonywano |
| C2 `t-7dea9734` rev 2 | DeepSeek | 524,176 | 177 094 | 0,028975 | 0 | 5 | 3 | 0 | nie wykonywano | — | nie wykonywano |
| C2 `t-7dea9734` rev 2 | Gemini | 126,493 | 84 587 | brak danych | 2 | 4 | 2 | 2 | nie wykonywano | — | nie wykonywano |
| C2 `t-7dea9734` rev 4 | DeepSeek — idle-timeout | 587,171 | 55 906 | 0,003680 | — | — | — | — | nie wykonywano | — | nie wykonywano |
| C2 `t-7dea9734` rev 4 | Gemini | 262,530 | 89 693 | brak danych | 2 | 5 | 1 | — | nie wykonywano | — | nie wykonywano |
| C2a `t-7dea9734` rev 5 | DeepSeek | 284,313 | 108 804 | 0,026364 | 0 | 5 | 3 | 0 | nie wykonywano | — | nie wykonywano |
| C2a `t-7dea9734` rev 5 | Gemini — timeout procesu | 600,204 | 61 465 | brak danych | — | — | — | — | nie wykonywano | — | nie wykonywano |
| C2a `t-7dea9734` rev 5 | Gemini — ponowienie | 180,541 | 66 468 | brak danych | 0 | 6 | 2 | 0 | nie wykonywano | — | nie wykonywano |

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

Klasyfikacja słonia przekazana użytkownikowi do ewentualnej korekty (bez przypisywania jej zatwierdzenia):
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
