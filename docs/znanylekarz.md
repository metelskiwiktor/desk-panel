# Wizyty ZnanyLekarz w rozmowie Wektora

Wektor pokazuje kartę **Dni i godziny** przez `panel_znanylekarz`. Otrzymuje profil lekarza, nazwę usługi, tryb
`online` / `gabinet` / `dowolnie` oraz opcjonalnie gabinet, pierwszą/kolejną wizytę i zakres dni. Profil pochodzi od użytkownika
albo z rzeczywistego wyniku wyszukiwania, a nie z domysłu modelu. Przy kilku pasujących usługach/gabinetach narzędzie podaje
nazwy do doprecyzowania. Zasady rozmowy są w `PANEL_GUIDES.wizyty` (`panel_guide`, temat `wizyty`).

## Co robi użytkownik

1. Wybiera dzień i godzinę na karcie, następnie **Wybieram…**. Panel ponownie sprawdza ten konkretny termin, usługę, cenę
   i długość wizyty. Jeśli coś się zmieniło, odmawia wyboru i prosi o aktualną kartę.
2. **Otwórz ZnanyLekarz** otwiera osobne okno/kartę (`target=_blank`, `noopener noreferrer`) z datą, godziną i usługą.
   Link rozpoczyna formularz; serwis może wymagać logowania, informacji o pierwszej wizycie, zgód i płatności.
3. Użytkownik sam kończy rezerwację i ewentualną płatność. Panel ani Wektor tego nie robią.
4. Wraca do karty i sprawdza wybrany termin. Nazwa, początek, koniec i miejsce wydarzenia są uzupełnione automatycznie.
   Nazwę i zakończenie może poprawić. **Zarezerwowałem ten termin — zapisz** tworzy wydarzenie Google Calendar.

Zamknięcie okna, powrót do panelu ani samo otwarcie linku nie potwierdzają rezerwacji. Wektor nie zakłada, że rezerwacja się
udała. Po potwierdzeniu nie sprawdzamy ponownie wolnego terminu: prawidłowo zarezerwowana godzina może już zniknąć z listy.
Karta nie tworzy automatycznych zaproszeń ani linku do wideokonferencji. Link do konsultacji wysyła sam ZnanyLekarz.

## Odczyt serwisu

`server/znanylekarz.ts` korzysta z anonimowego profilu i endpointów używanych przez publiczny formularz pacjenta. To
**nieoficjalny kontrakt strony**, który może się zmienić. Oficjalne [Docplanner Integrations API](https://integrations.docplanner.com/guide/)
jest przeznaczone dla dostawców oprogramowania medycznego i autoryzowanych zasobów placówek, nie tej lokalnej integracji pacjenta.

- Tylko `GET`, do `https://www.znanylekarz.pl`; profil i przekierowania są walidowane, obcy host jest odrzucany przed połączeniem.
- Krótkotrwały publiczny token z profilu pozostaje tylko w pamięci backendu. Nie trafia do modelu, przeglądarki, cache ani błędu.
- Nazwa lekarza, gabinet, usługa, cena i czas trwania są walidowane. Czas wymaga `with[]=service.duration`; nie jest w zwykłej
  liście usług. Nie wolno wyliczać długości z odstępów pomiędzy wolnymi godzinami.
- Terminy są filtrowane przez `filters[address_service_id]`, `filters[is_new_patient]` i `filters[has_insurance]=0` (wizyty prywatne).
  Bez `firstVisit` karta pokazuje przecięcie dostępności pierwszej i kolejnej wizyty, z opisem tego ograniczenia.
- `booking_url` musi wskazywać tego samego lekarza, adres i początek co termin. Panel dodaje wybrane `address_service_id`.
- Domyślnie 42 dni od dziś; zakres do 90 dni, najwyżej 180 dni naprzód. Odczyt ma czas obserwacji, timeout i limit stron.
  Daty dla publicznego endpointu muszą być bez ułamka sekundy (z `.000` odpowiada `404 Invalid date given`).
  `timezone: null` w liście gabinetów jest poprawne; panel pokazuje czas w `Europe/Warsaw` i zachowuje prawdziwy moment z offsetu terminu.
  Cache jest w pamięci przez 60 s; wybór użytkownika zawsze robi świeży odczyt. Nie ma odpytywania w tle.
- Jeśli brak `duration`, karta wymaga jawnego zakończenia od użytkownika. Nie podstawia umownych 30 minut.

29.10.2026 odczyt na żywo potwierdził dodatkowe pole `service.duration`; nie jest to gwarancja zgodności przyszłej wersji serwisu.

## Zgoda i trwałość

Kontrakty: `src/appointment-contract.ts`. Logika decyzji: `server/appointments.ts`. Panel przechowuje odczyty, wybory i wyniki
w `~/.desk-panel/appointments.dpapi` (Windows DPAPI bieżącego użytkownika, poza Gitem). Uszkodzonego zapisu nie zastępuje pustym.
Zmiany pliku są atomowe i serializowane; błąd zapisu nie zatwierdza zmiany w pamięci.

Agent tylko proponuje. `GET /api/chats/:id/appointment?toolCallId=…` czyta kartę. `POST /api/chats/:id/appointment` przyjmuje
`{toolCallId, action}`: `select` z kluczem terminu, `reset` z kluczem wyboru lub `confirm` z kluczem wyboru i opcjonalną korektą
`title` / `endAt`. Każdy POST wymaga własnego `Origin`. Lekarz, gabinet, usługa, początek i URL nigdy nie pochodzą z żądania decyzji.
Panel odszukuje zakończone wywołanie w tej rozmowie, sprawdza wynik i stabilne id, a odczyt bierze z jego `ref`.

Id karty to wiadomość i skrót jej argumentów oraz `ref` odczytu (`server/appointment-cards.ts`). Jest odtwarzane ze strumienia
i kanonicznej historii Hermesa, również po restarcie. Inna rozmowa ani stary klucz wyboru nie mogą potwierdzić tej karty.

Przed wywołaniem Google panel zapisuje stały identyfikator i dokładną treść wydarzenia. Powtórzone kliknięcie, restart lub utrata
odpowiedzi używają tego samego id; odpowiedź `409` jest uzgadniana przez odczyt tego wydarzenia i sprawdzenie prywatnego skrótu.
Nie powstaje drugie wydarzenie. Przy niepewności karta pokazuje błąd zamiast zapewnienia o sukcesie. Szczegóły Google:
[calendar.md](calendar.md). Oddzielne wydarzenia z rozmowy mają tę samą ochronę, przez `panel_calendar_propose`.

## Sprawdzenie

`just screenshots wizyty --pages pulpit --open chat-appointment` pokazuje kartę na syntetycznych danych. Stany:
`chat-appointment-selected` (godzina wybrana, pola uzupełnione) i `chat-appointment-saved` (zapis do atrapy Google).
Scenariusz nie wywołuje ZnanyLekarz ani prawdziwego Google. Nie klikaj potwierdzenia w prawdziwym czacie jako testu.

Testy: `server/znanylekarz.test.ts`, `server/appointments.test.ts`, `server/calendar-write.test.ts`,
`server/appointment-routes.test.ts`, `server/google-oauth.test.ts`, `src/appointment-card.test.tsx`
i odtwarzanie kart po restarcie w `server/hermes-chat.test.ts`.
