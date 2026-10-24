# Garmin Connect (plan treningowy)

Dane treningowe pochodzą z planu w Garmin Connect, przez nieoficjalną bibliotekę
[garminconnect-js](https://github.com/DynamicsNinja/garminconnect-js) (przypięta wersja 0.10.0, bez
zależności). Garmin nie ma publicznego API, więc jego endpointy mogą się zmienić bez zapowiedzi;
panel działa wtedy dalej, a źródło pokazuje stan „offline" lub „niedostępne".

Logowanie robisz raz, w terminalu — hasła nie wpisuje się w przeglądarce ani w panelu:

```powershell
just garmin-login
```

Skrypt pyta o e-mail, hasło (niewidoczne) i kod MFA. Hasło i kod nie są nigdzie zapisywane;
zapisują się wyłącznie tokeny OAuth, zaszyfrowane DPAPI dla bieżącego użytkownika Windows w
`~/.desk-panel/garmin-tokens.dpapi` (`DESK_GARMIN_TOKEN_FILE`). Usługa musi działać na tym samym
koncie Windows i podchwyci logowanie przy następnym odczycie (do 15 minut), bez restartu. Token OAuth1
wygasa po ok. 30 dniach bez użycia; panel odpytuje Garmin stale, więc się odnawia, ale po dłuższej
przerwie trzeba zalogować się ponownie. Strefa czasowa dnia: `DESK_TIME_ZONE` (domyślnie strefa komputera).

Odczyt to wyłącznie GET: plan od 7 dni wstecz do 35 dni naprzód, kroki treningu (interwały i docelowa
moc) dla najbliższych 7 dni oraz ostatnie aktywności. Garmin jest pytany najwyżej co 15 minut (po błędzie
co 5 min, po limicie zapytań co 30 min), a kroki treningu trzymane są w pamięci 6 godzin. Błąd zachowuje
ostatni plan z pierwotną godziną pomiaru. Do panelu trafiają tylko: nazwa, sport, dzień, szacowany czas,
poziom (`workoutPhrase`), efekt treningowy i kroki, a z aktywności czas, sport, średnia moc i tętno oraz
TSS. Waga, sen, tętno, miejsca, nazwy aktywności i identyfikatory konta nie opuszczają backendu.

`GET /api/training` zwraca kontrakt z `src/training-contract.ts`. Czy trening jest wykonany, liczy
`src/training-progress.ts` z nagrań danego dnia (od 80% planowanego czasu; nagrania krótsze niż 2 min
się nie liczą), bo pole Garmina `associatedActivityId` bywa puste. Gotowość treningowa, status i bilans
obciążenia, prognozy zawodów, sen, HRV i body battery nie są czytane, choć to konto je zwraca; co jeszcze daje
Garmin (pola, pułapki, pomysły na później) opisuje [docs/garmin-data.md](garmin-data.md). Dawny import planu przez zasubskrybowany kalendarz
Garmin w Google (`DESK_EXTRA_CALENDARS`) nie jest już potrzebny do planu; zostaje dla zwykłych
wydarzeń, np. zawodów w głównym kalendarzu Google.
