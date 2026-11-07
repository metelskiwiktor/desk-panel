# DesignLab: makiety wyglądu w aplikacji

Warsztat, w którym agent buduje makietę wyglądu z prawdziwych komponentów i CSS panelu, na danych scenariusza. Tylko lokalnie, bez prawdziwych dostawców i magazynów.

## Jak działa

- Włącza go wyłącznie podgląd scenariuszowy: `scripts/scenario-runtime.ts` przekazuje Vite `define: { __DESIGNLAB__: true }`. `vite.config.ts` ustawia `false`, więc usługa, `just dev` i build produkcyjny ignorują `?designlab=…` i pokazują normalny pulpit. Kod makiet nie trafia do bundla produkcyjnego (gałąź w `src/main.tsx` jest wycinana).
- Wybór makiety: `?designlab=<nazwa>`. Nieznana nazwa pokazuje listę dostępnych. Bramka: `src/designlab/gate.ts`; mapa makiet: `src/designlab/mockups/index.ts`.
- Dane: `/api/*` scenariusza (`scenarios/`), te same kontrakty co w panelu. Demo używa `standard` i `useCezar()`.

## Uruchomienie i zatrzymanie

```powershell
just scenario standard      # http://127.0.0.1:5175, link do makiety: http://127.0.0.1:5175/?designlab=demo
# Ctrl+C zatrzymuje podgląd i zwalnia jego porty; zapomniane podglądy: just scenario-stop
```

Interaktywny podgląd `just scenario NAME` (dowolny scenariusz) zawsze stoi pod `http://127.0.0.1:5175`, także po ponownym
uruchomieniu (`PREVIEW_PORT` w `scripts/scenario-runtime.ts`). Zajęty port to błąd z komunikatem, bez zmiany adresu: inny
podgląd zatrzymaj `just scenario-stop`. Zrzuty (`just screenshots`), testy, `just wektor-ui` i `just usage-ui` biorą wolne porty,
więc działają obok podglądu. `just update` odmawia przy działającym serwerze scenariusza: przed wdrożeniem zatrzymaj podgląd.

## Szybka praca nad makietą

- Przejścia wewnątrz makiety bez przeładowania dokumentu: `Link` i `useSearch` z `src/designlab/nav.tsx` (historia przeglądarki,
  Wstecz/Dalej i bezpośrednie adresy działają). Linki między widokami tej samej makiety (`?designlab=…&…`) to `<Link href>`, nie
  `<a>`; stan komponentu makiety przeżywa przejście, więc to, co ma zostać odrzucone przy wyjściu (np. robocza zmiana stanu
  wątku w Fili), czyść jawnie. Test: `scripts/designlab.test.mjs` (przeglądarka, scenariusz fila).
- Wyjątek od pełnej publikacji (AGENTS.md): dopóki użytkownik nie przyjął makiety, robocze poprawki wyłącznie
  `src/designlab/mockups/*`, `src/designlab/designlab.css` i danych `scenarios/*.json` sprawdza się w podglądzie na 5175 i commituje
  lokalnie, bez pełnego `just check`, pusha i `just update`. Po wyraźnym przyjęciu makiety: `just check`, push i wdrożenie raz,
  według zwykłych reguł (najpierw `just scenario-stop`). Ryzyko: scenariusze są współdzielone z testami UI (`src/test-fixtures.ts`,
  `server/scenario.test.ts`), więc zmiana danych może wyjść dopiero w pełnym sprawdzeniu. Zmiany wspólnych komponentów, hooków,
  skryptów i infrastruktury (jak ta) podlegają zwykłej procedurze.

## Dodanie makiety

1. Plik `src/designlab/mockups/<nazwa>.tsx` z `export default` komponentem; używaj komponentów z `src/` (np. `Card`, `TaskRow`) i danych z hooków/API. Własne style tylko w `src/designlab/designlab.css`, bez zmian w codziennych ekranach.
2. Jedna linia w `src/designlab/mockups/index.ts`.
3. Zrzuty: `just screenshots standard --query designlab=<nazwa> --device medialove-14 --scale all` → `output/screenshots` (poza Git). Zrzut pokazuje widok wyjściowy (bez klikania); szczegóły oglądamy ręcznie pod linkiem.

## Fila — propozycja etapu 1

`just scenario fila`, następnie `?designlab=fila`: tablica DeskPanel, sekcja „Do przejrzenia” i kanban „Funkcje”.
Makieta używa oznaczeń `TODO_STATUSES`, komponentów `Empty` i `MarkdownText` oraz tokenów pulpitu.
Dane testowe są wyłącznie w `scenarios/fila.json`; `/api/todos` służy jako tymczasowe źródło danych makiety,
bez nowego kontraktu Fili i bez zapisów. Wyszukiwanie po ID lub tytule działa lokalnie, kliknięcie skrótu zapytania
odsłania jego roboczy tekst (składnia nie jest decyzją techniczną).
Tekst zapytania rozwija się bezpośrednio pod pigułkami własnej sekcji; sekcje mają niezależne rozwinięcia.
Lewa nawigacja rozdziela Tablice i Projekty; DeskPanel jest klikalny, Cezar i Tabularium pokazują miejsce przyszłych ekranów.
Sekcje i wiersze są bez zewnętrznych kart, typy mają kolorowe ikony, kolumny kanbanu akcenty stanów.
Nie ma tekstowego menu zarządzania tablicą ani dodawania wątku na tablicy. Projekt ma robocze wejście z listą
i nieaktywną ikoną tworzenia wątku; jego docelowy ekran pozostaje do zaprojektowania.

Przytrzymanie nagłówka przez 550 ms wybiera sekcję do przeniesienia; następnie kliknięcie oznaczenia przed lub za
inną sekcją zmienia kolejność tylko w pamięci podglądu. Uchwyt daje to samo wejście klawiaturą, Escape anuluje.
To nie jest przeciąganie wątków ani zmiana zapytań. Gest sprawdzono myszą w przeglądarce; fizyczny dotyk czeka na ocenę użytkownika.

Kliknięcie tytułu otwiera (bez przeładowania) stronę wątku z własnym adresem `?designlab=fila&thread=DESK-37`:
opis, pola, pełny Markdown specyfikacji, wybór rewizji z autorem i czasem, aktywność. Wartość Stanu można zmienić
lokalnie; wyjście ze strony odrzuca zmianę; wyszukiwanie i kolejność sekcji na tablicy przeżywają przejścia. Checkboxy na tablicy są ukryte w tej propozycji wyglądu (Q-041),
co nie zmienia reguł odhaczania z D-018 i D-030. Zestaw Cezara i gotowość pozostają do dopracowania.

Zrzuty: `just screenshots fila --nav --query designlab=fila --device medialove-14 --scale all`.
`--nav` zachowuje także lewą nawigację makiety (runner domyślnie ukrywa wszystkie elementy `nav`).
W PowerShell zapytanie z `&` przekazuj bezpośrednio do npm, gdyż recepta `just screenshots` gubi cudzysłowy:
`npm run scenario -- fila --shot --nav --query 'designlab=fila&thread=DESK-37' --device medialove-14 --scale all`.
Sprawdzono wizualnie trzy skalowania Medialove 14″; przy 150% strona przewija się pionowo.
Pusty wynik można zobaczyć po wpisaniu niepasującej frazy, stany ładowania i niedostępności korzystają z odczytu źródła.
Styl i gesty są propozycją do oceny użytkownika. Koncept: `C:\Tabularium\Incepta\DeskPanel\Mea\Fila`.

## Sprawdzenia infrastruktury

`src/designlab/gate.test.ts` (parametr ignorowany bez włączenia) i `scripts/designlab.test.mjs` (podgląd włącza DesignLab i serwuje źródła scenariusza; nawigacja Fili bez przeładowania w prawdziwej przeglądarce). Ocena wyglądu zrzutów jest wzrokowa.
