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
