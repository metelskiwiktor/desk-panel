import { Fragment, useState, type ReactNode } from 'react';
import { Bell, Bot, CalendarClock, Check, Cog, FileText, History, Layers3, Lock, MessageSquare, Pause, Play, RotateCcw, Workflow, X, Zap } from 'lucide-react';
import { Link, useSearch } from '../nav';
import { ALERT_FAKTURY, KARTA_PRZEPISU, OCENA, WATKI, automaty, type Automat, type Chwila, type Grupa, type Run } from './machina-data';

/** Conceptual mockup of Machina (docs/designlab.md; concept C:\Tabularium\Incepta\DeskPanel\Mea\Machina). Every element
 * follows a decision D-001–D-058 (automat as a Fila thread: D-053–D-057); the rest is marked as an agent proposal in the conversation. No writes. */

type Widok = 'lista' | 'karta' | 'ocena' | 'alert';
type Zakladka = 'przepis' | 'stany' | 'dziennik' | 'rozmowy' | 'fila';

const MODULY = ['Sport', 'Finanse', 'Zdrowie', 'Praca', 'Osobiste', 'Panel'];
const RODZAJ: Record<Automat['rodzaj'], string> = { cykliczny: 'cykliczny', zdarzenie: 'na zdarzenie', jednorazowy: 'jednorazowy', wbudowany: 'wbudowany' };
/** Stan of the thread in the "Automat" workflow (D-053); there is no separate "status". */
const stanWatku = (a: Automat) => a.status.charAt(0).toUpperCase() + a.status.slice(1);
const watek = (a: Automat) => WATKI[a.id] ?? { id: 'MACH-?', modul: 'Osobiste' };
const GRUPA: Record<Grupa, string> = { odczyt: 'Odczyt', przetwarzanie: 'Przetwarzanie', akcja: 'Akcja', sterowanie: 'Sterowanie' };
const statusTone = (status: Automat['status']) =>
  status === 'aktywny' ? 'ok' : status === 'zakończony' ? 'off' : status === 'wstrzymany' ? 'pause' : 'wait';
const koszt = (a: Automat) => a.runy.reduce((sum, run) => sum + (run.koszt ?? 0), 0);
const usd = (value: number) => `$${value.toFixed(2)}`;
const porownuje = (a: Automat) => !!a.wersje.at(-1)?.klocki.some(k => k.rodzaj === 'Porównanie z sytuacjami');

function Klocki({ klocki, zakresy = true, otwarty }: { klocki: Automat['wersje'][number]['klocki']; zakresy?: boolean; otwarty?: number }) {
  const [open, setOpen] = useState<number | null>(otwarty ?? null);
  return <ol className="mach-klocki">
    {klocki.map((k, i) => <li key={i} className={`mach-klocek-wrap g-${k.grupa}${open === i ? ' open' : ''}`}>
      <button className="mach-klocek" aria-expanded={open === i} onClick={() => setOpen(open === i ? null : i)}>
        <span className="mach-grupa">{GRUPA[k.grupa]}</span>
        <strong>{k.rodzaj}</strong><span className="mach-klocek-opis"><span className="mach-muted">{k.opis}</span>
        {zakresy && k.zakres && <span className="mach-zakres"><Lock size={12} />{k.zakres}</span>}</span>
      </button>
      {open === i && <div className="mach-klocek-detail">
        <dl>
          {k.kiedy && <><dt>Kiedy</dt><dd>{k.kiedy}</dd></>}
          {(k.ustawienia ?? []).map(([key, value]) => <Fragment key={key}><dt>{key}</dt><dd>{value}</dd></Fragment>)}
          {k.zakres && <><dt>Zakres</dt><dd><Lock size={12} /> {k.zakres} (zatwierdzony na karcie, D-009)</dd></>}
        </dl>
        <p className="mach-note">Zmiana ustawień: poproś Wektora w rozmowie automatu; zmiana to nowa wersja przepisu z kartą (D-035).</p>
      </div>}
    </li>)}
  </ol>;
}

function RunRow({ run, open }: { run: Run; open: boolean }) {
  return <li className={`mach-run w-${run.wynik.replaceAll(' ', '-')}`}>
    <div className="mach-run-line">
      <span className="mach-run-dot" />
      <strong>{run.at}</strong><span className="mach-pill">{run.wynik}</span>
      <span className="mach-muted">wersja {run.wersja} · {run.wejscie}</span>
      {run.koszt !== undefined && <span className="mach-cost">{usd(run.koszt)}</span>}
    </div>
    <p>{run.opis}</p>
    {open && <ul className="mach-run-klocki">{run.klocki.map((k, i) => <li key={i} className={k.zly ? 'bad' : undefined}><span>{k.rodzaj}</span>{k.wynik}</li>)}</ul>}
    {run.rozmowa && <span className="mach-link"><MessageSquare size={13} />rozmowa automatu</span>}
  </li>;
}

function Szczegoly({ a, zakladka, href, klocekParam }: { a: Automat; zakladka: Zakladka; href: (extra: Record<string, string>) => string; klocekParam?: number }) {
  const [wersja, setWersja] = useState<number | null>(null);
  const shown = a.wersje.find(w => w.n === wersja) ?? a.wersje.at(-1);
  const tab = (id: Zakladka, label: string, n?: number) =>
    <Link className={`mach-tab${zakladka === id ? ' active' : ''}`} href={href({ automat: a.id, zakladka: id })}>{label}{n !== undefined && <span className="mach-count">{n}</span>}</Link>;
  return <section className="mach-detail">
    <header className="mach-detail-head">
      <div>
        <p className="mach-eyebrow"><Workflow size={13} />{watek(a).id} · wątek typu automat · {RODZAJ[a.rodzaj]} · moduł {watek(a).modul}</p>
        <h1>{a.nazwa}</h1>
        <p className="mach-cel">{a.opis}</p>
        <p className="mach-muted">{a.wyzwalacze.join(' · ')}{a.nastepny ? ` · następny run ${a.nastepny}` : ''}{a.runy.length ? ` · ${a.runy.length} runów · ${usd(koszt(a))} łącznie` : ''}</p>
      </div>
      <div className="mach-actions">
        <span className={`mach-status s-${statusTone(a.status)}`} title="Stan wątku w workflow Automat; ustawia go tylko Machina">{stanWatku(a)}</span>
        <button className="mach-icon" aria-label="Uruchom teraz" disabled={a.status === 'czeka na kartę przepisu'}><Play size={16} /></button>
        <button className="mach-icon" aria-label="Wstrzymaj"><Pause size={16} /></button>
        {a.usuwalny && <button className="mach-icon" aria-label="Anuluj"><X size={16} /></button>}
      </div>
    </header>
    {a.status === 'czeka na kartę przepisu' && <div className="mach-banner">
      <CalendarClock size={18} />
      <div><strong>Wstrzymany do zatwierdzenia pierwszego przepisu.</strong> Wektor projektuje go w rozmowie projektowania; do tego czasu automat nie sprawdza stron.</div>
      <Link className="mach-primary small" href={href({ widok: 'karta' })}>Otwórz kartę przepisu</Link>
    </div>}
    {a.status === 'czeka na decyzję' && <div className="mach-banner">
      <Bot size={18} />
      <div><strong>Run 2 gru 19:00 czeka na decyzję:</strong> ocena nazwała sytuację spoza katalogu.</div>
      <Link className="mach-primary small" href={href({ widok: 'ocena' })}>Otwórz rozmowę oceny</Link>
    </div>}
    <div className="mach-tabs">
      {tab('przepis', 'Przepis', a.wersje.length || undefined)}{tab('stany', 'Katalog sytuacji', a.stany.length || undefined)}
      {tab('dziennik', 'Dziennik', a.runy.length || undefined)}{tab('rozmowy', 'Rozmowy', a.rozmowy.length || undefined)}{tab('fila', 'W Fili', watek(a).wyniki?.length || undefined)}
    </div>
    {zakladka === 'przepis' && (shown ? <div className="mach-cols">
      <div><h2>Wersja {shown.n}{shown.n === a.wersje.at(-1)?.n ? ' (bieżąca)' : ''}</h2><p className="mach-muted">{shown.at} · {shown.powod} · {shown.opis}</p>
        <div className="mach-kiedy"><Zap size={15} /><div><strong>Kiedy rusza run</strong>{a.wyzwalacze.map(w => <span key={w}>{w}</span>)}</div></div>
        {porownuje(a) && <p className="mach-note">Akcje wykonują się tylko w reakcji sytuacji (Katalog sytuacji); zwykły run kończy się na porównaniu.</p>}
        <Klocki key={shown.n} klocki={shown.klocki} otwarty={klocekParam} /></div>
      {a.rodzaj !== 'wbudowany' && <aside className="mach-side"><h3><History size={15} />Wersje</h3>
        <ul className="mach-versions">{[...a.wersje].reverse().map(w => <li key={w.n} className={w.n === shown.n ? 'active' : undefined}>
          <button onClick={() => setWersja(w.n)}>v{w.n} · {w.at}<span className="mach-muted">{w.powod}</span></button>
          {w.n !== a.wersje.at(-1)?.n && <button className="mach-text"><RotateCcw size={13} />Przywróć jako v{a.wersje.length + 1}</button>}
        </li>)}</ul>
        {a.wersje.length > 1 && <p className="mach-note">Przywrócona wersja przechodzi sprawdzenie na próbkach katalogu.</p>}</aside>}
      {a.rodzaj === 'wbudowany' && <aside className="mach-side"><h3><Cog size={15} />Przepis panelu</h3><p className="mach-note">Zmienia go tylko kod panelu. Możesz wstrzymać i wznowić; nie da się usunąć.</p></aside>}
    </div> : <p className="mach-empty">Brak przepisu: czeka na rozmowę projektowania.</p>)}
    {zakladka === 'stany' && (a.stany.length ? <ul className="mach-stany">{a.stany.map(s => <li key={s.nazwa} className={`mach-stan r-${s.rodzaj}`}>
      <div className="mach-stan-head"><strong>{s.nazwa}</strong><span className="mach-pill">{s.rodzaj === 'przewidywany' ? 'przewidywana (bez próbki)' : s.rodzaj === 'znany' ? 'znana' : 'wycofana'}</span><span className="mach-muted">→ {s.reakcja}</span></div>
      {s.uwaga && <p className="mach-note">{s.uwaga}</p>}
      {s.probki.map(p => <p key={p.run} className="mach-probka"><span>{p.at} · {p.run}</span>{p.wycinek}</p>)}
    </li>)}</ul> : <p className="mach-empty">{porownuje(a) || !a.wersje.length
      ? 'Katalog powstanie z pierwszym przepisem.'
      : 'Ten przepis nie porównuje wycinków z sytuacjami, więc nie ma katalogu sytuacji: każde zdarzenie wyzwalacza wykonuje klocki od razu. Katalog mają tylko przepisy, które obserwują stronę albo źródło.'}</p>)}
    {zakladka === 'dziennik' && <>
      {a.runy.length ? <ul className="mach-runs">{a.runy.map((run, i) => <RunRow key={run.id} run={run} open={i === 0} />)}</ul> : <p className="mach-empty">Brak runów w Machinie.</p>}
      {a.historia && <div className="mach-history"><h3><History size={15} />Historia sprzed Machiny</h3>
        <p className="mach-muted">{a.historia.runy} runów od {a.historia.od}, w tym {a.historia.bledy} błędów · tylko do wglądu</p>
        <p className="mach-probka"><span>ostatni notatnik</span>{a.historia.notatnik}</p></div>}
    </>}
    {zakladka === 'rozmowy' && (a.rozmowy.length ? <ul className="mach-convs">{a.rozmowy.map(r => <li key={r.id}>
      <span className={`mach-pill p-${r.powod}`}>{r.powod}</span>
      {r.id === 'r-ocena' ? <Link href={href({ widok: 'ocena' })}>{r.tytul}</Link> : r.id === 'r-proj' ? <Link href={href({ widok: 'karta' })}>{r.tytul}</Link> : <span>{r.tytul}</span>}
      <span className="mach-muted">{r.at}{r.run ? ` · ${r.run}` : ''}</span>
    </li>)}</ul> : <p className="mach-empty">Automat wbudowany nie ma rozmów.</p>)}
    {zakladka === 'fila' && <div className="mach-cols">
      <div>
        <h2>Wyniki w Fili</h2>
        {watek(a).wyniki?.length ? <ul className="mach-convs">{watek(a).wyniki!.map(w => <li key={w.id}>
          <span className="mach-pill">{w.typ}</span><strong>{w.id}</strong><span>{w.tytul}</span><span className="mach-muted">{w.opis}</span></li>)}</ul>
          : <p className="mach-empty">{a.id === 'a-f6354232578d' ? 'Jeszcze nic: w sytuacji „Zapisy otwarte” klocek „Wątek w Fili” założy tu Sprawę z linkiem i Terminem.' : 'Ten automat nie zakłada wątków.'}</p>}
        <h2 className="mach-gap">Komentarze wątku</h2>
        <p className="mach-empty">Komentarze w Fili są Twoje; nie zmieniają przepisu.</p>
      </div>
      <aside className="mach-side"><h3><Layers3 size={15} />Wątek {watek(a).id}</h3>
        <dl className="mach-fields">
          <dt>Projekt</dt><dd>Machina (MACH)</dd><dt>Typ</dt><dd>automat</dd><dt>Moduł</dt><dd>{watek(a).modul}</dd>
          <dt>Workflow</dt><dd>Automat</dd><dt>Stan</dt><dd>{stanWatku(a)}</dd>
        </dl>
        <p className="mach-note">Stan ustawia tylko Machina; przepis, sytuacje i dziennik to zestaw Machiny i fila_apply ich nie zmienia.</p></aside>
    </div>}
  </section>;
}

function Lista({ lista, wybrany, href }: { lista: Automat[]; wybrany: string; href: (extra: Record<string, string>) => string }) {
  return <aside className="mach-list" aria-label="Automaty Machiny">
    <p className="mach-query"><Layers3 size={13} />projekt = MACH AND typ = automat</p>
    {MODULY.map(modul => {
      const rows = lista.filter(a => watek(a).modul === modul);
      if (!rows.length) return null;
      return <div key={modul}><h2>{modul}</h2><ul>{rows.map(a => <li key={a.id}>
        <Link className={`mach-row${a.id === wybrany ? ' active' : ''}${a.status === 'zakończony' ? ' closed' : ''}`} href={href({ automat: a.id })}>
          <span className={`mach-dot s-${statusTone(a.status)}`} />
          <span className="mach-row-main"><strong><span className="mach-id">{watek(a).id}</span>{a.nazwa}</strong><span className="mach-muted">{a.status === 'aktywny' ? a.wyzwalacze[0] : stanWatku(a)}</span></span>
          {a.runy.length > 0 && <span className="mach-dots">{a.runy.slice(0, 5).map(r => <i key={r.id} className={`w-${r.wynik.replaceAll(' ', '-')}`} />)}</span>}
        </Link>
      </li>)}</ul></div>;
    })}
  </aside>;
}

function Kokpit({ a }: { a: Automat }) {
  const last = a.runy[0];
  return <aside className="mach-cockpit" aria-label="Kokpit automatu">
    <p className="mach-eyebrow">Kokpit rozmowy</p>
    <h2>{a.nazwa}</h2>
    <p className="mach-muted">{watek(a).id} · <span className={`mach-status s-${statusTone(a.status)}`}>{stanWatku(a)}</span> wersja {a.wersje.at(-1)?.n}</p>
    {last && <div className="mach-cockpit-run"><h3>Run {last.at}</h3><ul className="mach-run-klocki">{last.klocki.map((k, i) => <li key={i} className={k.zly ? 'bad' : undefined}><span>{k.rodzaj}</span>{k.wynik}</li>)}</ul></div>}
    <h3>Przepis v{a.wersje.at(-1)?.n}</h3>
    <Klocki klocki={a.wersje.at(-1)?.klocki ?? []} zakresy={false} />
  </aside>;
}

function Wiadomosc({ kto, children }: { kto: 'wektor' | 'panel' | 'ty'; children: ReactNode }) {
  return <div className={`mach-msg m-${kto}`}><span className="mach-msg-who">{kto === 'wektor' ? 'Wektor' : kto === 'panel' ? 'Machina' : 'Ty'}</span>{children}</div>;
}

function KartaPrzepisu() {
  const k = KARTA_PRZEPISU;
  return <section className="mach-card" aria-label="Karta przepisu">
    <p className="mach-eyebrow">Karta · nowy przepis</p>
    <h2>{k.automat}: wersja {k.wersja}</h2>
    <h3>Klocki</h3><Klocki klocki={k.klocki} />
    <h3>Znana sytuacja z próbką</h3>
    <p className="mach-probka"><span>{k.znany.nazwa}</span>{k.znany.probka}</p>
    <h3>Sytuacje przewidywane i reakcje zatwierdzane z góry</h3>
    <ul className="mach-stany">{k.przewidywane.map(s => <li key={s.nazwa} className="mach-stan r-przewidywany"><div className="mach-stan-head"><strong>{s.nazwa}</strong><span className="mach-muted">→ {s.reakcja}</span></div></li>)}</ul>
    <p className="mach-note">Każdy inny wygląd wycinków to sytuacja nieznana: ocena Wektora i karta przed reakcją. Pierwsze wejście w „Zapisy otwarte” zawsze potwierdza Wektor.</p>
    <h3>Zakresy</h3><ul className="mach-scopes">{k.zakresy.map(z => <li key={z}><Lock size={12} />{z}</li>)}</ul>
    <div className="mach-card-actions"><button className="mach-primary"><Check size={16} />Zatwierdź przepis</button><button className="mach-text">Odrzuć</button></div>
  </section>;
}

export default function Machina() {
  const params = new URLSearchParams(useSearch());
  const chwila: Chwila = params.get('chwila') === 'pozniej' ? 'pozniej' : 'przeniesienie';
  const widok = (params.get('widok') ?? 'lista') as Widok;
  const lista = automaty(chwila);
  const iron = lista[0];
  const wybrany = lista.find(a => a.id === params.get('automat')) ?? iron;
  const zakladka = (params.get('zakladka') ?? (wybrany.runy.length ? 'dziennik' : 'przepis')) as Zakladka;
  const href = (extra: Record<string, string>, ch: Chwila = chwila) =>
    `?${new URLSearchParams({ designlab: 'machina', ...(ch === 'pozniej' ? { chwila: 'pozniej' } : {}), ...extra })}`;

  return <div className="mach-lab">
    <header className="mach-top">
      <div className="mach-brand"><Workflow size={22} />Machina</div>
      <div className="mach-switch" role="group" aria-label="Chwila makiety (pomoc makiety)">
        <Link className={chwila === 'przeniesienie' ? 'active' : undefined} href={href({}, 'przeniesienie')}>Po przeniesieniu (20 lis)</Link>
        <Link className={chwila === 'pozniej' ? 'active' : undefined} href={href({}, 'pozniej')}>Dwa tygodnie później (2 gru)</Link>
      </div>
      <div className="mach-jump">
        <Link href={href({}, 'przeniesienie')}>1 Lista</Link><Link href={href({ zakladka: 'dziennik' }, 'pozniej')}>2 IRONMAN</Link>
        <Link href={href({ widok: 'karta' }, 'przeniesienie')}>3 Karta przepisu</Link><Link href={href({ widok: 'ocena' }, 'pozniej')}>4 Ocena</Link>
        <Link href={href({ widok: 'alert' }, 'pozniej')}>5 Alert faktury</Link>
      </div>
    </header>

    {widok === 'lista' && <div className="mach-body"><Lista lista={lista} wybrany={wybrany.id} href={href} /><Szczegoly key={`${chwila}-${wybrany.id}`} a={wybrany} zakladka={zakladka} href={href} klocekParam={params.get('klocek') ? Number(params.get('klocek')) : undefined} /></div>}

    {widok === 'karta' && <div className="mach-chat-layout">
      <section className="mach-thread" aria-label="Rozmowa automatu">
        <p className="mach-eyebrow"><span className="mach-pill p-projektowanie">projektowanie</span> {iron.nazwa}</p>
        <h1>Projektowanie przepisu</h1>
        <Wiadomosc kto="panel">Automat przeniesiony do Machiny i wstrzymany do zatwierdzenia pierwszego przepisu. Cel: {iron.opis}</Wiadomosc>
        <Wiadomosc kto="wektor">Sprawdziłem trzy strony z celu. Z każdej biorę tylko fragment o 70.3, więc zmiany przy 5150, Relay czy banerze nie budzą oceny. Obecny wygląd zapisuję jako znaną sytuację „Zamknięte”, a dla otwarcia, którego jeszcze nie widzieliśmy, proponuję sytuacje przewidywane z reakcjami. Automat ma już wątek MACH-1 w Fili.</Wiadomosc>
        <KartaPrzepisu />
      </section>
      <aside className="mach-cockpit"><p className="mach-eyebrow">Kokpit rozmowy</p><h2>{iron.nazwa}</h2>
        <p className="mach-muted">MACH-1 · Stan: <span className="mach-status s-wait">Czeka na kartę przepisu</span></p>
        <p className="mach-muted">{iron.wyzwalacze[0]}</p><p className="mach-note">Brak przepisu i runów w Machinie. Historia sprzed Machiny: 26 runów, 6 błędów.</p></aside>
    </div>}

    {widok === 'ocena' && <div className="mach-chat-layout">
      <section className="mach-thread" aria-label="Rozmowa oceny">
        <p className="mach-eyebrow"><span className="mach-pill p-ocena">ocena</span> {iron.nazwa} · {OCENA.run}</p>
        <h1>{OCENA.tytul}</h1>
        <Wiadomosc kto="panel">Run 2 gru 19:00 (wersja 2): wycinek karty 70.3 nie pasuje do żadnej sytuacji.
          <div className="mach-diff"><p><span>było</span>{OCENA.bylo}</p><p><span>jest</span>{OCENA.jest}</p></div></Wiadomosc>
        <Wiadomosc kto="wektor">{OCENA.wektor}</Wiadomosc>
        <section className="mach-card" aria-label="Karta nowej sytuacji">
          <p className="mach-eyebrow">Karta · nowa sytuacja</p>
          <h2>{OCENA.karta.stan}</h2>
          <p className="mach-probka"><span>próbka z {OCENA.run}</span>{OCENA.karta.probka}</p>
          <h3>Reakcja</h3><ul className="mach-scopes">{OCENA.karta.reakcja.map(r => <li key={r}><Zap size={12} />{r}</li>)}</ul>
          <p className="mach-note">Po zatwierdzeniu sytuacja trafia do katalogu, a reakcja wykonuje się w tym runie.</p>
          <div className="mach-card-actions"><button className="mach-primary"><Check size={16} />Zatwierdź sytuację i reakcję</button><button className="mach-text">Odrzuć</button></div>
        </section>
        <div className="mach-composer">Napisz do Wektora o tym runie albo poproś o zmianę…</div>
      </section>
      <Kokpit a={iron} />
    </div>}

    {widok === 'alert' && <div className="mach-alert-layout">
      <section className="mach-smart" aria-label="Smart Actions">
        <p className="mach-eyebrow"><Bell size={13} /> Smart Actions</p>
        <article className="mach-alert">
          <p className="mach-muted">{ALERT_FAKTURY.autor}</p>
          <h2><FileText size={17} />{ALERT_FAKTURY.tytul}</h2>
          <p>{ALERT_FAKTURY.tresc}</p>
          <div className="mach-card-actions"><button className="mach-primary"><Play size={15} />{ALERT_FAKTURY.przycisk}</button><button className="mach-text">Odrzuć</button></div>
          <p className="mach-note">Przycisk uruchamia automat „{ALERT_FAKTURY.cel}”.</p>
        </article>
      </section>
      <section className="mach-card" aria-label="Run uruchomiony przyciskiem">
        <p className="mach-eyebrow">Automat uruchamiany przyciskiem</p>
        <h2>{ALERT_FAKTURY.cel}</h2>
        <h3>Wejście runu</h3><ul className="mach-scopes">{ALERT_FAKTURY.wejscie.map(w => <li key={w}>{w}</li>)}</ul>
        <h3>Przepis v1</h3><Klocki klocki={lista.find(a => a.id === 'a-faktura-ksieg')?.wersje[0].klocki ?? []} />
        <p className="mach-note">Drugie kliknięcie to nowy run, który nie powtarza wykonanych skutków (np. drugiego pliku na Drive).</p>
      </section>
    </div>}
  </div>;
}
