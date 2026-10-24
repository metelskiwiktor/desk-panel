# Dostęp z telefonu (Tailscale)

Panel działa na telefonie poza domową siecią przez Tailscale (prywatna sieć Twoich urządzeń,
bez otwierania portów). Serwer nadal słucha tylko na `127.0.0.1`; `tailscale serve` wystawia go
po HTTPS wyłącznie w tailnecie.

## Obecna konfiguracja

- Konto Tailscale: `metelski.wiktor@gmail.com`. Urządzenia: ten komputer (`desktop-sgur9l8`, Windows)
  i telefon `galaxy-s24` (Android).
- Adres panelu: `https://desktop-sgur9l8.tail244683.ts.net` (tylko w tailnecie).
- Klient CLI: `C:\Program Files\Tailscale\tailscale.exe`. Sprawdzenie: `tailscale status` (urządzenia),
  `tailscale serve status` (powinno pokazać `/ proxy http://127.0.0.1:5174`, „tailnet only”).
- `DESK_ALLOWED_HOST=desktop-sgur9l8.tail244683.ts.net` w `%USERPROFILE%\.desk-panel\panel.env`
  (poza Gitem). To jedyna nazwa, którą serwer przyjmuje poza loopbackiem; wymaga `*.ts.net`.

## Jak to działa

`server/app.ts` przepuszcza nagłówek `Host` równy `DESK_ALLOWED_HOST` i wtedy traktuje `https://<host>`
jako własny `Origin` przy akcjach POST (poczta, Cezar, warmup, Google). Wszystko inne, także ta sama nazwa
z portem albo `Origin` po `http`, dostaje 403. Bez zmiennej zachowanie jest jak wcześniej (tylko loopback).
Test: `server/allowed-host.test.ts`.

## Konfiguracja od zera (nowy komputer)

1. Zainstaluj Tailscale (`winget install --id Tailscale.Tailscale -e`) i zaloguj to samo konto
   (`tailscale up`, link otwierasz w przeglądarce). To samo na telefonie.
2. W konsoli Tailscale włącz HTTPS/Serve dla tailnetu (jednorazowo; polecenie z kroku 3 poda link).
3. `tailscale serve --bg 5174` — wypisze adres `https://<komputer>.<tailnet>.ts.net`.
4. Dopisz do `%USERPROFILE%\.desk-panel\panel.env`: `DESK_ALLOWED_HOST=<komputer>.<tailnet>.ts.net`
   (bez `https://`), potem `just service RESTART` (albo `just update`).
5. Na telefonie otwórz adres; w Chrome „Dodaj do ekranu głównego" daje ikonę i pełny ekran.

## Czego nie robić

- Nigdy `tailscale funnel`: wystawia panel publicznie.
- Nie dodawać do tailnetu cudzych urządzeń ani nie udostępniać węzła: panel nie ma własnego logowania,
  a pokazuje m.in. metadane Gmaila i dane z Garmina.
- Nie zmieniać nasłuchu serwera z `127.0.0.1`.
