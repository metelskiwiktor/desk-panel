# DesignLab: makiety wyglądu w aplikacji

Warsztat, w którym agent buduje makietę wyglądu z prawdziwych komponentów i CSS panelu, na danych scenariusza. Tylko lokalnie, bez prawdziwych dostawców i magazynów.

## Jak działa

- Włącza go wyłącznie podgląd scenariuszowy: `scripts/scenario-runtime.ts` przekazuje Vite `define: { __DESIGNLAB__: true }`. `vite.config.ts` ustawia `false`, więc usługa, `just dev` i build produkcyjny ignorują `?designlab=…` i pokazują normalny pulpit. Kod makiet nie trafia do bundla produkcyjnego (gałąź w `src/main.tsx` jest wycinana).
- Wybór makiety: `?designlab=<nazwa>`. Nieznana nazwa pokazuje listę dostępnych. Bramka: `src/designlab/gate.ts`; mapa makiet: `src/designlab/mockups/index.ts`.
- Dane: `/api/*` scenariusza (`scenarios/`), te same kontrakty co w panelu. Demo używa `standard` i `useCezar()`.

## Uruchomienie i zatrzymanie

```powershell
just scenario standard      # wypisuje adres; link do makiety: <adres>?designlab=demo
# Ctrl+C zatrzymuje podgląd i zwalnia jego porty; zapomniane podglądy: just scenario-stop
```

## Dodanie makiety

1. Plik `src/designlab/mockups/<nazwa>.tsx` z `export default` komponentem; używaj komponentów z `src/` (np. `Card`, `TaskRow`) i danych z hooków/API. Własne style tylko w `src/designlab/designlab.css`, bez zmian w codziennych ekranach.
2. Jedna linia w `src/designlab/mockups/index.ts`.
3. Zrzuty: `just screenshots standard --query designlab=<nazwa> --device medialove-14 --scale all` → `output/screenshots` (poza Git). Zrzut pokazuje widok wyjściowy (bez klikania); szczegóły oglądamy ręcznie pod linkiem.

## Weryfikacja

`src/designlab/gate.test.ts` (parametr ignorowany bez włączenia) i `scripts/designlab.test.mjs` (podgląd włącza DesignLab i serwuje źródła scenariusza). Ocena wyglądu zrzutów jest wzrokowa.
