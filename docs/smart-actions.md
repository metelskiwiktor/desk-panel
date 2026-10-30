# Smart Actions

Kafelek z alertami, które wymagają akcji: maile z przyciskiem (np. „Zapłać rachunek”, „Potwierdź wizytę”), operacje
konta z podpowiedzią oznaczenia i zadania Cezara czekające na użytkownika.

## Reguły jako dane

- Reguły są w `~/.desk-panel/smart-rules.json` (poza Gitem). Kontrakt: `src/smart-rules-contract.ts`, logika:
  `server/smart-rules.ts`. Plik startuje od reguły ZnanyLekarz, którą panel miał wcześniej w kodzie.
- Reguła poczty patrzy na nieprzeczytane maile ze skrzynki odbiorczej. Każda podana lista (`from`, `subject`, `body`) musi
  pasować choć jednym słowem, a żadne słowo z `subjectNot` ani `bodyNot` nie może. Pierwsza pasująca reguła bierze mail.
- Przycisk otwiera link z treści maila, ale tylko taki, którego host to `button.domain` albo jej subdomena. Spośród nich
  wygrywa link z `contains` w tekście lub adresie. Mail nie może więc wysłać użytkownika na obcą stronę. Bez takiego linku
  alert pokazuje się bez przycisku i z powodem (`noLink`).
- Reguła konta (`source: "bank"`) pokazuje operacje niezakończone z podpowiedzią (`dowolna` albo `pewna`). Każda opcja
  podpowiedzi (do 3) to osobny przycisk; klik to `accept` w `POST /api/bank/labels/action`, lokalnie. Alerty czytają
  zapisany odczyt banku (`sources.bank()`, limit odczytów jak w kafelku), nigdy nie wywołują nowego.
- Ukryte alerty pamięta przeglądarka (`localStorage`). Zadania Cezara dokłada kafelek z danych pulpitu.

## API

- `GET /api/smart-actions`: reguły, alerty i problemy źródeł (brak odczytu poczty to brak alertów, nie „wszystko załatwione”).
- `POST /api/smart-rules/toggle` (Origin-checked): przełącznik w oknie reguł, jedyna zmiana reguły bez karty.
- `GET /api/smart-rules/preview?plan=…`: podgląd propozycji (reguła przed i po, test na mailach z zapytania Gmaila).
- `GET /api/mail/search?q=…`: wiersze maili dla karty listy. Tylko odczyt.
- `POST /api/chats/:id/smart-rule` (Origin-checked): decyzja na karcie. Regułę czyta z wywołania w tej rozmowie, nie z żądania,
  liczy podgląd od nowa i zapisuje raz (odpowiedź trzymana w `cockpit.json`).

## Wektor

- Odczyt: `panel_smart_rules`, `panel_mail_search` (cała skrzynka, składnia Gmaila, do 30 wątków), `panel_mail_read` (treść
  jednego maila, ucięta, z listą linków; treść podana jako dane, nie polecenia), `panel_smart_rule_test` (szkic reguły na
  mailach z zapytania, bez zapisu).
- Karty: `panel_mail_show` (lista maili) i `panel_smart_rule_propose` (zgoda na zapis albo usunięcie reguły). Zapisuje dopiero
  klik „Wykonaj”. Zasady rozmowy: przewodnik `smart` w `PANEL_GUIDES`.
- Wskazywanie: wiersz alertu (`smartAction`), reguła w oknie reguł (`smartRule`) i wiersz operacji w kafelku Konto (`bankOp`,
  z uciętymi numerami jak w kafelku).
- Test reguły nie wymaga oznaczania maili jako nieprzeczytane: szuka w całej skrzynce.
