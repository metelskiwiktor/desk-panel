# Google Calendar

Integracja loguje się na własne konto użytkownika przez OAuth Google.
Nie używa klucza Google Play ani konta usługi i nie wymaga udostępniania kalendarza.
Jednorazowe przygotowanie w Google Cloud:

1. Włącz Google Calendar API i Gmail API w projekcie (np. `tabnote-cli`).
2. W Google Auth Platform skonfiguruj Audience External; w trybie Testing dodaj
   wszystkie swoje konta (kalendarz i poczta) jako użytkowników testowych. W Data Access
   dodaj zakresy `calendar.readonly` i `gmail.modify`.
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

Serwer używa oficjalnej `google-auth-library` z zakresem `calendar.readonly`
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
nowych zdarzeń panelu. Nie ma operacji zapisu, zapraszania ani edycji wydarzeń.
