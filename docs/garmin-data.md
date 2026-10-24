# Garmin Connect: jakie dane są dostępne

Notatka na później (np. przygotowania do triathlonu). Panel czyta dziś z Garmina tylko plan, kroki treningów i
podstawy nagrań (patrz README, „Garmin Connect”). To konto zwraca jednak znacznie więcej. Poniżej katalog tego,
co sprawdzono, żeby nie trzeba było tego odkrywać od nowa.

## Jak to sprawdzono

- 2026-10-24, `garminconnect-js` 0.10.0 (ta sama przypięta wersja co w panelu), zapisane tokeny DPAPI, bez hasła.
- 33 odczyty (same GET) w odstępach 0,7 s, wszystkie bez błędu i bez limitu zapytań.
- Surowe odpowiedzi zawierają dane zdrowotne i identyfikatory konta, dlatego **nie ma ich w repozytorium**.
  Skrypt do powtórzenia sondy jest na końcu.
- Zwracane wartości zależą od urządzeń i historii na koncie. Pola puste (`null`) to zwykle brak danych, nie błąd.

## Co panel czyta dziś

| Metoda `Garmin` | Do czego |
|---|---|
| `getScheduledWorkoutSummaries(od, do)` | plan: nazwa, sport, dzień, szacowany czas, `workoutPhrase`, dzień wolny, wyścig |
| `getTrainingPlanWorkouts(dziś)` | nagłówek planu: nazwa, treningów w tygodniu, data celu |
| `getAdaptiveWorkout(uuid)` | kroki treningu, efekt treningowy, `keyWorkout` (tylko najbliższe 7 dni) |
| `getActivities(0, 50)` | czas, sport, średnia moc i tętno, TSS |

## Katalog dostępnych danych

### Trening i obciążenie (pasuje do panelu)

| Metoda | Najciekawsze pola |
|---|---|
| `getTrainingReadiness(data)` / `getMorningTrainingReadiness(data)` | `score`, `level` (np. PRIME), `feedbackShort`, czynniki z procentami i oceną: sen, regeneracja, ACWR, historia stresu, HRV, historia snu; `acuteLoad`, `recoveryTime` (godziny). Poranny odczyt różni się od bieżącego (liczone po przebudzeniu i po treningu). |
| `getTrainingStatus(data)` | `trainingStatus` + `trainingStatusFeedbackPhrase` (np. `RECOVERY_2`), `acuteTrainingLoadDTO` (obciążenie ostre i przewlekłe, ACWR i jego ocena, zakres optymalny `min/maxTrainingLoadChronic`), `mostRecentVO2Max` (ogólne i rowerowe), `fitnessTrend`. Odpowiedź jest mapą po `deviceId` urządzenia. |
| `getTrainingStatus(...).mostRecentTrainingLoadBalance` | miesięczne obciążenie: tlenowe niskie, tlenowe wysokie, beztlenowe, każde z zakresem docelowym, oraz `trainingBalanceFeedbackPhrase` (np. `ANAEROBIC_SHORTAGE`: brakuje bodźca beztlenowego). |
| `getRacePredictions()` | prognozy 5 km, 10 km, półmaratonu i maratonu w sekundach (wg biegania). |
| `getPersonalRecord()` | rekordy osobiste (14 typów, `prTypeId` + wartość + data). |
| `getWeeklyIntensityMinutes(od, do)` / `getIntensityMinutesData(dzień)` | minuty umiarkowane i intensywne, cel tygodnia (150). Intensywne liczą się podwójnie. |
| `getProgressSummaryBetweenDates(od, do)` | liczba aktywności i statystyki per sport w okresie. |

### Pojedyncza aktywność (`getActivities`, `getActivity(id)`)

`aerobicTrainingEffect`, `anaerobicTrainingEffect`, `trainingEffectLabel` (np. RECOVERY, TEMPO),
`activityTrainingLoad`, `trainingStressScore`, `intensityFactor`, `normPower`, `avgPower`/`maxPower`, krzywa mocy
(`maxAvgPower_1…_120`), `averageHR`/`maxHR`, kadencja, `hrTimeInZone_1…5`, `powerTimeInZone_1…7`,
`differenceBodyBattery`, oraz to, co wpisał użytkownik: `directWorkoutRpe`, `directWorkoutFeel` i
`directWorkoutComplianceScore` (zgodność z planem). Czas w strefach osobno: `getActivityHrInTimezones(id)`,
`getActivityPowerInTimezones(id)`.

### Progi i strefy

| Metoda | Dane |
|---|---|
| `getCyclingFtp()` | FTP rowerowe |
| `getPowerZones()` | strefy mocy (dolne granice 1–7) per sport |
| `getHeartRateZones()` | strefy tętna, tętno progowe, maks., spoczynkowe |
| `getLactateThreshold(true)` | próg mleczanowy: tętno, moc |
| `getFunctionalThresholdPowerRange(od, do)` | historia FTP (per sport) |
| `getMaxMetrics(data)` | VO₂max (ogólne, rowerowe) |

### Zdrowie i regeneracja (poza obecną polityką panelu)

`AGENTS.md` zabrania pokazywania ciała i snu w interfejsie. To, co zwracają te endpointy:

- `getSleepData(data)`: wynik snu, fazy (głęboki, lekki, REM, czuwanie), potrzeba snu na dziś i jutro, SpO₂,
  oddech, niespokojne momenty, ruch w nocy.
- `getHrvData(data)`: średnia z nocy, średnia tygodniowa, zakres „zbalansowany”, status, odczyty co 5 min.
- `getBodyBattery(od, do)` oraz pola `bodyBattery*` w `getUserSummary`: stan rano, teraz, zdarzenia (sen, trening,
  drzemka) z wpływem na baterię.
- `getAllDayStress(data)`, `getRhrDay(data)`, `getRespirationData(data)`, `getHeartRates(data)`: stres, tętno
  spoczynkowe, oddech, tętno w ciągu dnia.
- `getUserSummary(data)` / `getDailySummaries(od, do)`: kroki, piętra, kalorie, cel kroków, **godzina ostatniej
  synchronizacji zegarka** (`lastSyncTimestampGMT`), podsumowania stresu i tętna.
- `getFitnessAgeData(data)`: wiek sprawnościowy ze składnikami (zawiera BMI, czyli dane o wadze).
- Niesprawdzone: waga i skład ciała (`getWeighIns`, `getBodyComposition`), nawodnienie, ciśnienie, cykl,
  cele (`getGoals`), odznaki, sprzęt (`getGear`), kursy, golf.

### Puste na tym koncie (zabrakło danych)

`getEnduranceScore`, `getHillScore`, `getRunningTolerance`. Mogą się pojawić po większej liczbie treningów.

## Pułapki

- **FTP jest niespójne między endpointami.** Rowerowe z `getCyclingFtp` i `getPowerZones` różni się od FTP zapisanego
  w szczegółach aktywności i od FTP biegowego z `getFunctionalThresholdPowerRange`. Przed pokazaniem trzeba wybrać
  źródło (najpewniej `getCyclingFtp` dla roweru).
- Odpowiedzi zawierają identyfikatory konta (`userId` i podobne), nazwy urządzeń i współrzędne. Nie zapisuj ich do
  logów, kontraktów ani scenariuszy.
- Wiele odpowiedzi to tablice par (znacznik czasu, wartość) opisane osobną listą deskryptorów, np. stres, oddech,
  Body Battery. Indeks wartości trzeba brać z deskryptora.
- Strefa czasowa aktywności (`timeZoneUnitDTO`) może różnić się od strefy panelu.
- Endpointy są nieoficjalne i mogą się zmienić. Każdą odpowiedź waliduj schematem zod i redukuj do kontraktu, tak jak
  robi to `server/garmin.ts`.
- Rozsądny koszt: panel pyta Garmin co 15 minut kilkoma wywołaniami. Gotowość i status to po jednym wywołaniu
  i zmieniają się kilka razy dziennie, więc wystarczy je czytać rzadziej (co godzinę).

## Pomysły na później

Priorytet pod triathlon i regularne treningi:

1. Kafel „Gotowość i obciążenie” przy dzisiejszym treningu: `score` gotowości, status, obciążenie ostre względem
   zakresu optymalnego (`getTrainingReadiness`, `getTrainingStatus`).
2. Bilans obciążenia miesiąca z komunikatem o niedoborze (`mostRecentTrainingLoadBalance`), np. przy kluczowym
   treningu: dlaczego jest w planie.
3. Prognoza Garmina przy zawodach w kalendarzu (`getRacePredictions`).
4. Podsumowanie po treningu na kafelku: efekt treningowy, obciążenie, moc znormalizowana, czas w strefach.
5. Strefy mocy i tętna jako opis celów kroków („Z2 79–109 W”).
6. Pasek minut intensywnych tygodnia.
7. Przy treningu pływackim i biegowym sprawdzić odpowiedniki (stroke, tempo, prognozy), których to konto jeszcze nie
   zwróciło: na dziś są tylko jazda rowerowa i bieg.

Zasady przy dodawaniu: nowe pole najpierw do kontraktu (`src/training-contract.ts`), walidacja zod w
`server/garmin.ts`, scenariusze w `scenarios/` i testy. Dane o śnie, ciele i regeneracji wymagają najpierw zmiany
zasady w `AGENTS.md` i README (sekcja „Garmin Connect”) oraz decyzji, kto widzi ekran.

## Jak powtórzyć sondę

Jednorazowy skrypt tylko do odczytu; umieść go w katalogu projektu (żeby działały importy), uruchom
`npx tsx tmp-probe/garmin-probe.ts <katalog-na-surowe-odpowiedzi>` i usuń po użyciu. Surowe wyniki zapisuj poza repozytorium.

```ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Garmin, GarminClient } from 'garminconnect-js';
import { createGarminTokenStore, garminTokenFile } from '../server/garmin-tokens';

const out = process.argv[2]; mkdirSync(out, { recursive: true });
const client = new GarminClient({ tokenStore: createGarminTokenStore(garminTokenFile(process.env)) });
if (!(await client.loadTokens())) throw new Error('Brak zapisanego logowania: just garmin-login');
const g = new Garmin(client);
const today = new Date().toLocaleDateString('sv-SE');
for (const [name, call] of Object.entries({
  trainingReadiness: () => g.getTrainingReadiness(today),
  trainingStatus: () => g.getTrainingStatus(today),
  racePredictions: () => g.getRacePredictions(),
  // …kolejne metody z katalogu wyżej
})) {
  writeFileSync(join(out, `${name}.json`), JSON.stringify(await call(), null, 2));
  await new Promise(r => setTimeout(r, 700)); // delikatnie dla Garmina
}
```
