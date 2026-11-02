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
