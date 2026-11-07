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

`just scenario fila`, następnie `?designlab=fila` (tokeny pulpitu, D-071): tablica DeskPanel z widokami Przegląd i Wszystko, sekcje listy i kanban, pusta sekcja Pilne, oraz strona
wątku `&thread=DESK-37`. Fila nie ma jeszcze kontraktu, więc dane makiety są w `src/designlab/mockups/fila-data.ts`
(rodzic, tagi, pola własne, zestaw Cezara, rewizje, archiwum); scenariusz `fila` służy tylko do uruchomienia podglądu.
Wszystkie zmiany (Stan, sekcje, zapytania, komentarze, pola) żyją w pamięci strony, bez zapisów.

Tablica: Stan zmienia się z wiersza i z karty (wybór z workflow Praca, wartości zamykające osobno), sekcje mają menu „⋯”
(zmień nazwę, przesuń wyżej i niżej, usuń) i „Dodaj sekcję” na końcu, pigułki zapytania rozwijają edytowalny tekst pod sobą
(kolumny kanbanu mają własne), podwątki jeden poziom pod rodzicem z licznikiem zamkniętych i historia tablicy w panelu bocznym; tablica nie tworzy
wątków (D-072). Strona wątku: tytuł i opis edytowalne w GUI (D-073),
podwątki, specyfikacja z wyborem rewizji tylko do odczytu, jedna oś aktywności z komentarzami, pola (Stan, Moduł, tagi,
pola własne) i zestaw Cezara z gotowością i „Zleć Cezarowi”; menu „⋯”: przeniesienie, archiwizacja, trwałe usunięcie z archiwum.
Ekran projektu `&project=DESK`: klucz, liczby wątków, „Nowy wątek” (tytuł, typ), przejście do tablicy, zakładki Archiwum
(przywróć, usuń trwale z potwierdzeniem) i Pola i workflow (`&zakladka=pola`, tylko do odczytu); „+” przy Projektach zakłada projekt.

Zrzuty (PowerShell, zapytanie z `&` bezpośrednio do npm):
`npm run scenario -- fila --shot --nav --query 'designlab=fila&thread=DESK-37' --device medialove-14 --scale 1.5`.
`--nav` zachowuje lewą nawigację makiety (runner domyślnie ukrywa elementy `nav`). Koncept: `C:\Tabularium\Incepta\DeskPanel\Mea\Fila`.
## Sprawdzenia infrastruktury

`src/designlab/gate.test.ts` (parametr ignorowany bez włączenia) i `scripts/designlab.test.mjs` (podgląd włącza DesignLab i serwuje źródła scenariusza; nawigacja Fili bez przeładowania w prawdziwej przeglądarce). Ocena wyglądu zrzutów jest wzrokowa.
