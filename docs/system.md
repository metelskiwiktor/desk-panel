# System, usługa i kiosk

## Uruchamianie i usługa Windows

Uruchomienie lokalne i `npm run dev` są w [README.md](../README.md).

Autostart Windows obsługuje Servy: `just install` buduje projekt i rejestruje
usługę. Szczegóły i logi opisano w [servy/README.md](../servy/README.md).
`just` wyświetla krótki zestaw komend; `just check` uruchamia testy i build,
a `just service RESTART` przeładowuje działający serwer po zmianach.

## CPU i RAM

`GET /api/system` mierzy cały komputer przez natywne `node:os`, bez dodatkowego
programu, PowerShella, uprawnień administratora czy instalowania zależności.
CPU to średnia zajętość wszystkich logicznych rdzeni obliczona z różnicy czasów
busy/idle pomiędzy dwoma odczytami. Nie jest to obciążenie samego procesu Node
ani procesów Cezara. Pierwszy odczyt zbiera bazę; wynik pojawia się po ok. 2 s.
RAM to pamięć fizyczna total-minus-free, pokazana w GiB (1024³ bajtów).

Panel odczytuje system co ok. 2 s. Backend współdzieli pomiary między kartami
i klientami, nie dopisując próbek częściej niż co 2 s; nie ma osobnego timera
ani procesu. Historia w pamięci jest ograniczona do 150 próbek / 5 minut.
Po przerwie >10 s (np. uśpienie lub brak czytelników) zbiera nową bazę i zaczyna
nową historię. Błąd lub cofnięcie liczników nie daje fikcyjnego 0%; poprzedni
odczyt zachowuje swój timestamp i oznaczenie braku pomiaru. Świeżość systemu
wynosi 15 s. Wysoki RAM zasila regułę zdarzeń panelu.
Endpoint jest lokalny, read-only; nie zbiera danych dysku.

## Tryb kiosku (okno bez przeglądarki)

`just kiosk` (`scripts/kiosk.ps1`) otwiera Pulpit w Chrome jako gołe okno na całym monitorze: bez kart, paska adresu i przycisku „wyjdź z pełnego
ekranu”, który Chrome pokazuje po najechaniu na górę (zamknięcie: Alt+F4). Monitor można wskazać po nazwie (np. `P16`, domyślnie) lub numerze `\.DISPLAYn`: `just kiosk P16`, `just kiosk 2`. Przy starcie automatycznie ukrywa pasek zadań Windows na tym konkretnym monitorze (`scripts/kiosk-taskbar.ps1`), nie ruszając pasków na pozostałych ekranach. Ręczne sterowanie paskiem: `just kiosk-taskbar HIDE|SHOW|STATUS [DISPLAY]`. Skrypt czeka, aż usługa odpowie (do 300 s) i monitor będzie dostępny (do 30 s), więc może startować razem z systemem. Przebieg startu i ewentualne błędy zapisywane są w `%USERPROFILE%\.desk-panel\kiosk.log`.
`just kiosk-autostart ON` (albo `OFF`, `STATUS`, skrypt `scripts/kiosk-autostart.ps1`) rejestruje zadanie użytkownika w Harmonogramie zadań, które uruchamia kiosk
20 s po zalogowaniu; w razie błędu Harmonogram ponawia próbę do 3 razy co minutę. Nie wymaga uprawnień administratora. Start bez wpisywania hasła wymaga automatycznego logowania
Windows (`netplwiz`), co jest kompromisem bezpieczeństwa.

Okno ma własny profil Chrome (`%LOCALAPPDATA%desk-panelkiosk-chrome`), bo uruchomiony już Chrome przejmuje każde nowe
uruchomienie i ignoruje tryb kiosku oraz monitor. Ustawienia Pulpitu zapisywane w przeglądarce (układ widżetów, rozmiary
stref, czas ostatniego otwarcia zdarzeń) są więc osobne. `just kiosk-setup` zamyka kiosk i otwiera ten profil jako zwykłe
okno: wystarczy raz zalogować się na konto Google (np. żeby linki do Gmaila i Kalendarza otwierały się zalogowane) i ustawić
układ Pulpitu, a potem `just kiosk`.
