# Google Calendar

Agenda zwraca `coverage` (rzeczywisty półotwarty przedział odczytu) i `busy` każdego wydarzenia, na podstawie
Google `transparency`. Prawy panel wyboru wizyty porównuje terminy z tym odczytem; nie uznaje braku wydarzeń za wolny czas,
jeśli dane są niepełne, nieaktualne lub nie obejmują całego dnia. Szczegóły: [znanylekarz.md](znanylekarz.md).

Integracja loguje się na własne konto użytkownika przez OAuth Google.
Nie używa klucza Google Play ani konta usługi i nie wymaga udostępniania kalendarza.
Jednorazowe przygotowanie w Google Cloud:

1. Włącz Google Calendar API i Gmail API w projekcie (np. `tabnote-cli`).
2. W Google Auth Platform skonfiguruj Audience External; w trybie Testing dodaj
   wszystkie swoje konta (kalendarz i poczta) jako użytkowników testowych. W Data Access
   dodaj zakresy `calendar.readonly`, `calendar.events.owned` i `gmail.modify`.
3. Utwórz klienta OAuth typu **Aplikacja komputerowa / Desktop app**. Obsługiwany
   jest też klient **Web**: dodaj w Google Cloud Authorized redirect URI dokładnie
   `http://127.0.0.1:5174/api/calendar/callback` (dostosuj port przy `DESK_PORT`).
4. Pobierz JSON i zapisz jako `~/.desk-panel/google-oauth-client.json` lub wskaż
   jego lokalną ścieżkę przez `DESK_GOOGLE_OAUTH_CLIENT_FILE`.
5. W Desk Panel → Ustawienia → Konta Google kliknij przy każdym koncie „Połącz przez Google”,
   następnie „Otwórz logowanie Google”. Wybierz właściwe konto i zaznacz wszystkie
   uprawnienia (zgoda z odznaczonym uprawnieniem jest odrzucana). Użyj zwykłej przeglądarki Chrome/Edge, jeśli Google odrzuci
   logowanie w przeglądarce osadzonej. Agenda odświeży się automatycznie.

Google w trybie Testing może ograniczać trwałość zgody; jeśli dostęp wygaśnie,
panel poprosi o ponowne logowanie. Nie wymaga publikowania ani weryfikowania
aplikacji dla tej lokalnej konfiguracji testowego użytkownika.

Serwer używa oficjalnej `google-auth-library` z zakresem `calendar.readonly` i dodatkowym `calendar.events.owned` dla konta kalendarza
oraz openid/email do sprawdzenia tożsamości zalogowanego użytkownika. OAuth ma
PKCE, losowy state, jednorazowy callback i dziesięciominutowy limit logowania.
Callback działa wyłącznie na `http://127.0.0.1:5174/api/calendar/callback`
(port zmienia się wraz z `DESK_PORT`). Połączenie z innym kontem jest odrzucane.
Refresh token każdego konta zapisuje się atomowo poza repo — konto kalendarza w
`~/.desk-panel/calendar-token.dpapi`, pozostałe w `~/.desk-panel/google-<email>.dpapi` —
razem z listą przyznanych zakresów, zaszyfrowany DPAPI dla bieżącego użytkownika
Windows. Tokeny i klient OAuth nigdy nie trafiają do przeglądarki. Bez Windows
bezpieczny zapis jest niedostępny; aplikacja zgłasza ten stan zamiast zapisać token jawnie.

Backend
odczytuje strefę kalendarza i rozwinięte wystąpienia wydarzeń przez sześć tygodni (42 dni)
od początku dzisiejszego dnia. Obsługuje paginację (maks. 2500 wydarzeń, potem
oznaczenie częściowej agendy), wydarzenia całodniowe z wyłącznym końcem oraz DST.
Anulowane wydarzenia i odrzucone przez właściciela zaproszenia są pomijane.
Panel pokazuje nadchodzące i trwające wydarzenia; szczegół zawiera opis, lokalizację
i prawdziwy link `htmlLink`. Całodniowe wydarzenia nie wywołują alertu „spotkanie za…”.

Odczyt frontendowy co 15 sekund; backend pobiera Google najwyżej raz na minutę,
współdzieli równoległe żądania i przechowuje cache tylko w pamięci. Po błędzie
ponawia po 15 sekundach, zachowując ostatnią agendę i jej czas. 403/404 i brak
klienta OAuth pokazują brak dostępu, a nie pusty kalendarz. Surowe błędy GoogleAuth
i tokeny nigdy nie trafiają do odpowiedzi lub logów. Stary zapis nie tworzy
nowych zdarzeń panelu.

## Tworzenie wydarzenia po zgodzie na karcie

Stan sprawdzony 29.10.2026: konto kalendarza zwraca `connected` i `canCreateEvents: true`; użytkownik potwierdził
działający zapis po rzeczywistej rezerwacji. Wcześniejsza informacja z tej sesji, że zgoda na zapis nadal jest brakująca,
jest już nieaktualna. Bieżące uprawnienie zawsze sprawdzaj w statusie konta, nie na podstawie tej historycznej notatki.

Wektor może zaproponować jedno wydarzenie narzędziem `panel_calendar_propose` (tytuł, początek i koniec z offsetem,
opcjonalnie miejsce i opis). Model sam niczego nie zapisuje. Karta pokazuje szczegóły; dopiero **Dodaj do Google Calendar**
wysyła `POST /api/chats/:id/calendar-plan` (`Origin` sprawdzany, plan pochodzi z zakończonego wywołania tej rozmowy).
Przy [wizycie ZnanyLekarz](znanylekarz.md) zapis jest w tej samej karcie co rezerwacja, po przycisku
**Zarezerwowałem ten termin — zapisz**. Agent nie proponuje drugiej karty dla tej wizyty.

Stare tokeny `calendar.readonly` nadal pozwalają czytać agendę. Zapis wymaga ponownego połączenia konta w Ustawieniach →
Konta Google i zaznaczenia nowego uprawnienia; karta zachowuje wybrany termin do tego czasu. Nowa zgoda jest wymagana tylko
dla konta kalendarza, nie dla osobnych kont pocztowych. [Zakres `calendar.events.owned`](https://developers.google.com/workspace/calendar/api/auth)
dotyczy wydarzeń w kalendarzach należących do użytkownika. Kod panelu udostępnia wyłącznie utworzenie nowego wydarzenia,
bez edycji, usuwania, gości i zaproszeń. Zapis nie tworzy konferencji Google Meet.

`server/calendar-write.ts` używa `events.insert` z deterministycznym id. Ponowienie po utracie odpowiedzi odczytuje istniejące
wydarzenie przy `409`, sprawdza jego pochodzenie i zwraca ten sam wynik. Treść zapisu zostaje zamrożona przed żądaniem Google
w `appointments.dpapi`; błąd nie daje prawa do zmiany terminu w trakcie ponowienia. Po sukcesie cache agendy jest unieważniany,
z zachowaniem ostatniej obserwacji na wypadek błędu następnego odczytu. Narzędzie propozycji nie wykonuje żadnych zapisów Google.

## Zapis z automatu

Wyjątek od zapisu po kliknięciu karty wydarzenia: trwający run może wykonać `calendarEvent` przez panel_automation_act, jeśli użytkownik wcześniej zatwierdził tę akcję na karcie automatu. Parametry, idempotencja, godziny i przypomnienia: [Automaty](automaty.md#akcje-zatwierdzone-raz-na-karcie). Ten sam moduł calendar-write i konto panelu; scope calendar.events.owned. Wizyty nadal wymagają potwierdzenia użytkownika.
