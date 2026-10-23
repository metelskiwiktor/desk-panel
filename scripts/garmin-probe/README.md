# garmin-probe

Jednorazowa, **tylko odczytowa** sonda danych Garmin Connect (biblioteka
[garminconnect-js](https://github.com/DynamicsNinja/garminconnect-js) 0.10.0, nieoficjalna).
Sprawdza, jakie dane treningowe zwraca Twoje konto, zanim cokolwiek trafi do panelu.
Nie jest częścią budowy ani usługi panelu i ma własny `package.json`.

## Uruchomienie (sam, we własnym terminalu)

```powershell
cd scripts\garmin-probe
npm install --ignore-scripts
npm run selftest   # bez sieci: sprawdza, że anonimizacja nic nie przepuszcza
npm run probe      # pyta o e-mail, hasło (niewidoczne) i kod MFA
```

Uruchom `probe` **raz**. Garmin ogranicza liczbę logowań; nie powtarzaj w pętli.

## Co się dzieje z danymi

- Hasło i kod MFA tylko w pamięci procesu, nigdzie nie zapisywane ani nie wypisywane.
- Tokeny tylko w pamięci (`MemoryTokenStore`) — znikają z końcem procesu.
- Odczyty to wyłącznie GET-y (plan na 7 dni naprzód i 7 dni wstecz, tabela `workoutPhrase` na 28 dni,
  kroki i interwały trzech najbliższych treningów, aktywności, wydarzenia, gotowość, body battery,
  sen, HRV, tętno spoczynkowe, VO2max, prognozy, kroki), po jednym, z przerwami.
- Wynik: `output\garmin-probe\shape-<data>.json` (katalog `output/` jest w `.gitignore`).
  To *kształt* odpowiedzi: klucze, typy, długości list oraz daty, nazwy typów, nazwy treningów i
  zawodów oraz liczby. Imiona, e-mail, identyfikatory, miejsca, współrzędne, teksty swobodne i
  wszystko przypominające token są zastąpione znacznikami.
- Przed zapisem skrypt sprawdza, czy w wyniku nie ma Twojego e-maila, hasła, kodu MFA ani
  żadnej wartości tokenu. Jeśli jest, **nie zapisuje pliku** i kończy się błędem.
- Liczby (np. czas treningu, body battery, tętno) zostają w pliku: to dane o zdrowiu, więc
  przejrzyj plik przed udostępnieniem.

## Sieć

Biblioteka łączy się z hostami Garmina (`sso.garmin.com`, `connectapi.garmin.com`,
`mobile.integration.garmin.com`) oraz pobiera klucz konsumenta OAuth z
`thegarth.s3.amazonaws.com` (koszyk osób trzecich; bez niego logowanie się nie uda).
Paczka nie ma zależności ani skryptów instalacyjnych; stąd `--ignore-scripts` jest tylko
dodatkowym zabezpieczeniem.
