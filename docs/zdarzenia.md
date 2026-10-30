# Zdarzenia

Zakładka „Zdarzenia” w dolnej nawigacji opisuje aktualne reguły w krótkiej tabeli:
warunek utworzenia oraz kiedy dany wpis może pojawić się ponownie. Pokazuje też
zasady zapisu historii i usuwania. Progi i czasy są współdzielone z detekcją zdarzeń.

Lista zdarzeń panelu rozwija się spod dzwonka na Pulpicie (tylko po dotknięciu) i przewija pionowo.
Przesunięcie wpisu w lewo lub prawo usuwa go; przycisk × jest alternatywą dla gestu,
a „Cofnij” działa przez sześć sekund. Dotknięcie wpisu otwiera szczegóły źródła.
Przewijanie pionowe i przerwany/krótki gest nie usuwają wpisu ani nie otwierają szczegółów.

Lista przechowuje ostatnie 100 wykrytych zdarzeń z godziną wykrycia i opisem z tego
momentu. Zapisuje je lokalnie w przeglądarce, również po usunięciu warunku alertu
lub utracie połączenia. Zamknięty panel nie zbiera zdarzeń w tle.
Zablokowany/uszkodzony localStorage nie blokuje pulpitu.

Reguły: Cezar wymaga odpowiedzi; zadania zakończone w ostatnich 10 minutach;
spotkania w ciągu 15 minut; RAM ≥90% przez ciągłą minutę, CPU ≥90% przez dwie. Limity AI tworzą osobne
zdarzenia dla konta i okna: żółte tempo (>5 p.p.), czerwone (>15 p.p.), zużycie ≥90%.
Każdy próg limitu zgłaszany jest najwyżej raz w danym oknie resetu, także po
usunięciu wpisu i odświeżeniu strony; eskalacja do czerwonego tworzy nowy wpis,
spadek z czerwonego do żółtego nie ostrzega ponownie. Porównanie terminu resetu
toleruje korekty do 5 minut względem pierwotnego zgłoszenia (bez zaokrąglania do
przedziałów). Wygasłe okno nie blokuje nowego. Przy wczytywaniu historii scalane
są potwierdzone duplikaty quota, z zachowaniem pierwszej godziny wykrycia.
Pytania i RAM mogą zgłosić
nowy epizod po potwierdzonym ustąpieniu warunku. Nieaktualne źródło nie potwierdza
ustąpienia. Pamięć deduplikacji jest ograniczona do ostatnich 2000 jednorazowych
sygnałów i 1000 aktywnych warunków.

Reguła „Automat: <nazwa>”: zatwierdzona akcja notify zapisana w runie tworzy wpis z treścią i linkiem, najwyżej raz na run. Dzwonek odbiera historię GET /api/automations co 15 s, również po otwarciu panelu po wykonaniu runu. Usunięcie i odświeżenie nie ponawia wpisu (pamięć signalKey runId+notify). Błąd wysyłki ntfy nie usuwa wpisu. Dane z automatów to wyjątek od wykrywania tylko przy otwartym panelu: wykonanie i treść są utrwalone na serwerze; przeglądarka odbiera je później.
