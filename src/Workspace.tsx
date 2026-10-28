import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { Bot, Cpu, Gem, GitPullRequest, Landmark, Layers, ListChecks, Mail, Rocket, Sparkles, Terminal, X, Zap, type LucideIcon } from 'lucide-react';
import { BankTile } from './BankTile';
import { CezarPanel } from './CezarCard';
import type { CezarSnapshot } from './cezar-contract';
import { MailFeed } from './MailFeed';
import type { DashboardData, Detail } from './model';
import { MissingLimit, QuotaTile } from './QuotaBars';
import { getQuotaCards, type QuotaCardItem } from './quota-cards';
import { SmartActionsTile } from './SmartActionsTile';
import { SystemTile } from './SystemTile';
import { TodoTile, todoConfigOf } from './TodoTile';
import { GitHubPrTile } from './tiles/GitHubPrTile';
import type { TodosState } from './useTodos';
import type { BankHook } from './useBank';
import {
  COLS, ROWS, add, autoTiles, configure, emptyCells, move, newTileId, readWorkspace, readingOrder, remove, resize, saveWorkspace, targetRect, type Plan, type Rect, type Tile,
} from './tile-grid';
import type { CezarState } from './useCezar';
import type { MailState } from './useMail';
import { MULTI_KINDS, kindOfCard, limitKinds, pickable } from './workspace-kinds';
import { ctx } from './chat-context';
import { listContext } from './todo-context';
import { workspaceKey } from './pulpits';

const clamp = (n: number, low: number, high: number) => Math.min(high, Math.max(low, n));
const sameLayout = (a: Tile[], b: Tile[]) => a.length === b.length && a.every(t => b.some(o => o.id === t.id && o.c === t.c && o.r === t.r && o.w === t.w && o.h === t.h));
const areaOf = ({ c, r, w, h }: Rect) => ({ '--c': c + 1, '--r': r + 1, '--w': w, '--h': h }) as CSSProperties;

const FIXED: Record<string, { title: string; icon: LucideIcon }> = {
  cezar: { title: 'Cezar', icon: Bot },
  mail: { title: 'Poczta', icon: Mail },
  system: { title: 'Komputer', icon: Cpu },
  todo: { title: 'Zadania', icon: ListChecks },
  bank: { title: 'Konto', icon: Landmark },
  'smart-actions': { title: 'Smart Actions', icon: Zap },
  'github-pr': { title: 'GitHub PR', icon: GitPullRequest },
};
/** Name and icon of a kind. Claude and Codex are known before the first reading; an Antigravity group is named by its card. */
function describe(kind: string, cards: QuotaCardItem[]): { title: string; icon: LucideIcon } {
  if (FIXED[kind]) return FIXED[kind];
  const id = kind.replace(/^quota:/, '');
  const card = cards.find(c => kindOfCard(c) === kind);
  const group = id.startsWith('agy:') ? id.slice('agy:'.length) : id;
  const title = card?.title ?? (group === 'Gemini Models' ? 'Gemini' : group);
  const icon = id === 'Claude' ? Sparkles : id === 'Codex' ? Terminal : /Claude (&|and) GPT/i.test(title) ? Layers : card?.badge === 'frontier' ? Rocket : Gem;
  return { title: card?.badge ? `${title} · ${card.badge}` : title, icon };
}

/** Where the grid is on the screen: its corner and the distance from one cell to the next (a cell and a gap). */
interface Geometry { left: number; top: number; gx: number; gy: number; px: number; py: number }
function measure(grid: HTMLElement | null): Geometry | null {
  const box = grid?.getBoundingClientRect();
  if (!grid || !box || !box.width || !box.height) return null;
  const style = getComputedStyle(grid);
  const gx = parseFloat(style.columnGap) || 0, gy = parseFloat(style.rowGap) || 0;
  return { left: box.left, top: box.top, gx, gy, px: (box.width - gx * (COLS - 1)) / COLS + gx, py: (box.height - gy * (ROWS - 1)) / ROWS + gy };
}
const cellAt = (g: Geometry, x: number, y: number) => ({ c: clamp(Math.floor((x - g.left) / g.px), 0, COLS - 1), r: clamp(Math.floor((y - g.top) / g.py), 0, ROWS - 1) });

interface Drag { id: string; dx: number; dy: number; plan: Plan | null; to: Rect | null }

/** A cell nobody covers: a row of what could stand here, in the same order wherever it is. */
function EmptyCell({ cell, kinds, cards, pick }: { cell: { c: number; r: number }; kinds: string[]; cards: QuotaCardItem[]; pick: (kind: string) => void }) {
  const [caption, setCaption] = useState('');
  return <div className="wk-empty" style={areaOf({ ...cell, w: 1, h: 1 })} data-cell={`${cell.c},${cell.r}`}>
    {kinds.length ? <>
      <div className="wk-picks" role="group" aria-label="Wybierz kafelek" onPointerLeave={() => setCaption('')}>
        {kinds.map(kind => {
          const { title, icon: Icon } = describe(kind, cards);
          return <button key={kind} className="wk-pick" aria-label={`Dodaj kafelek: ${title}`} title={title}
            onPointerEnter={() => setCaption(title)} onFocus={() => setCaption(title)} onBlur={() => setCaption('')} onClick={() => pick(kind)}>
            <Icon size={20} aria-hidden="true" />
          </button>;
        })}
      </div>
      <span className="wk-caption" aria-hidden="true">{caption || 'Wybierz kafelek'}</span>
    </> : <span className="wk-caption">Wszystko jest już na pulpicie</span>}
  </div>;
}

/**
 * The work area: a grid of four columns and two rows. Every tile is one thing (a limit, Cezar, mail, the computer) and
 * starts as one cell; every cell without a tile offers to become one. Every tile can be arranged at any time, with no
 * mode to switch on: a grip at its top moves it (the tile it lands on makes room), its right and bottom edges and corner
 * stretch it, and the X in its corner switches it off. A tile that grows over others asks them to move to free cells,
 * and only stops where they have nowhere to go. The arrangement is kept in the browser.
 */
export function Workspace({ data, now, open, cezar, snapshot, mail, todos, bank, showTasks, showBreakdown, available, systemThreshold, pulpit = 'main' }: {
  data: DashboardData; now: number; open?: ((d: Detail) => void) | string; cezar?: CezarState; snapshot: CezarSnapshot | null; mail: MailState; todos: TodosState; bank: BankHook;
  showTasks: () => void; showBreakdown?: () => void; available: (kind: string) => boolean; systemThreshold: number;
  /** The virtual desktop whose arrangement this is (pulpits.ts); each one is kept under its own key. */
  pulpit?: string;
}) {
  const openDetail = typeof open === 'function' ? open : () => {};
  const [stored, setStored] = useState(() => readWorkspace(workspaceKey(pulpit)));
  const cards = getQuotaCards(data.quotas.data);
  const openedKind = typeof open === 'string' && open.startsWith('tile:') ? open.slice('tile:'.length).trim() : null;
  const forcedTiles: Tile[] | null = openedKind ? [
    { id: openedKind, kind: openedKind, c: 0, r: 0, w: 2, h: 2 },
    { id: openedKind === 'mail' ? 'quota:Claude' : 'mail', kind: openedKind === 'mail' ? 'quota:Claude' : 'mail', c: 2, r: 0, w: 2, h: 1 },
    { id: openedKind === 'cezar' ? 'quota:Codex' : 'cezar', kind: openedKind === 'cezar' ? 'quota:Codex' : 'cezar', c: 2, r: 1, w: 2, h: 1 },
  ] : null;
  // Until the panel is arranged by hand the layout follows what there is to show; then the saved one is kept as it is.
  // A tile of a kind the settings switched off is not drawn, and the next change drops it from the saved layout for good.
  const tiles = (forcedTiles ?? stored ?? autoTiles([...limitKinds(cards), 'mail', 'cezar'].filter(available))).filter(t => available(t.kind));
  const tilesRef = useRef(tiles);
  tilesRef.current = tiles;
  const commit = (next: Tile[]) => { tilesRef.current = next; setStored(next); saveWorkspace(next, workspaceKey(pulpit)); };
  const grid = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [notice, setNotice] = useState('');
  // The tile being moved or stretched: it shows its size and is outlined while the pointer is down.
  const [active, setActive] = useState<string | null>(null);
  const noticeTimer = useRef<number | undefined>(undefined);
  const say = (text: string) => { setNotice(text); window.clearTimeout(noticeTimer.current); noticeTimer.current = window.setTimeout(() => setNotice(''), 3000); };
  // A gesture in progress is listened to on the window, so it goes on when the pointer leaves the tile.
  const stop = useRef<(() => void) | null>(null);
  useEffect(() => () => { stop.current?.(); window.clearTimeout(noticeTimer.current); }, []);
  const track = (onMove: (e: PointerEvent) => void, onEnd: (e: PointerEvent | null) => void) => {
    const release = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', cancel); stop.current = null; };
    const up = (e: PointerEvent) => { release(); onEnd(e); };
    const cancel = () => { release(); onEnd(null); };
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', cancel);
    stop.current = cancel;
  };
  const capture = (event: ReactPointerEvent) => { try { event.currentTarget.setPointerCapture?.(event.pointerId); } catch { /* the window listeners are enough */ } };

  const startMove = (event: ReactPointerEvent, tile: Tile) => {
    const g = measure(grid.current);
    if (event.button > 0 || !g) return;
    event.preventDefault();
    capture(event);
    setActive(tile.id);
    const grab = cellAt(g, event.clientX, event.clientY);
    // The tile is held by the cell it was taken by, so a wide tile lands where its grabbed part is pointing.
    const held = { c: clamp(grab.c - tile.c, 0, tile.w - 1), r: clamp(grab.r - tile.r, 0, tile.h - 1) };
    const aim = (e: PointerEvent) => {
      const cell = cellAt(measure(grid.current) ?? g, e.clientX, e.clientY), at = { c: cell.c - held.c, r: cell.r - held.r };
      return { plan: move(tilesRef.current, tile.id, at), to: targetRect(tilesRef.current, tile.id, at) };
    };
    setDrag({ id: tile.id, dx: 0, dy: 0, plan: null, to: null });
    track(e => setDrag({ id: tile.id, dx: e.clientX - event.clientX, dy: e.clientY - event.clientY, ...aim(e) }), e => {
      setDrag(null);
      setActive(null);
      if (!e) return;
      const { plan } = aim(e);
      if (!plan) say('Nie ma tam miejsca: sąsiedni kafelek nie ma dokąd się przesunąć.');
      else if (!sameLayout(plan.tiles, tilesRef.current)) commit(plan.tiles);
    });
  };

  const startResize = (event: ReactPointerEvent, id: string, edges: 'r' | 'b' | 'rb') => {
    const g = measure(grid.current);
    if (event.button > 0 || !g) return;
    event.preventDefault();
    capture(event);
    setActive(id);
    let told = false;
    track(e => {
      const geo = measure(grid.current) ?? g, tile = tilesRef.current.find(t => t.id === id);
      if (!tile) return;
      // The edge follows the pointer: the size is how many cells the pointer has gone past from the tile's corner.
      const w = edges.includes('r') ? Math.round((e.clientX - (geo.left + tile.c * geo.px) + geo.gx) / geo.px) : tile.w;
      const h = edges.includes('b') ? Math.round((e.clientY - (geo.top + tile.r * geo.py) + geo.gy) / geo.py) : tile.h;
      const plan = resize(tilesRef.current, id, { w, h });
      if (!sameLayout(plan.tiles, tilesRef.current)) commit(plan.tiles);
      else if ((w > tile.w || h > tile.h) && !told) { told = true; say('Nie ma miejsca: sąsiednie kafelki nie mają dokąd się przesunąć. Usuń któryś albo zmniejsz.'); }
    }, () => setActive(null));
  };

  const content = (tile: Tile): ReactNode => {
    const roomy = tile.w > 1 || tile.h > 1;
    if (tile.kind === 'cezar') return <CezarPanel data={data} snapshot={snapshot} now={now} open={openDetail} showAll={showTasks} beside={tile.h < 2}
      finished={cezar?.finished} archive={cezar?.archive} restore={cezar?.restore} markRead={cezar?.markRead} undo={cezar?.undo} error={cezar?.error} />;
    if (tile.kind === 'mail') return <MailFeed mail={mail} now={now} open={openDetail} compact={!roomy} />;
    if (tile.kind === 'system') return <SystemTile data={data} now={now} open={openDetail} roomy={roomy} threshold={systemThreshold} />;
    if (tile.kind === 'bank') return <BankTile bank={bank} now={now} wide={tile.w > 1} tall={tile.h > 1} />;
    if (tile.kind === 'smart-actions') return <SmartActionsTile mail={mail} tasks={data.tasks} wide={tile.w > 1} tall={tile.h > 1} />;
    if (tile.kind === 'todo') return <TodoTile todos={todos} config={tile.config} wide={tile.w > 1} tall={tile.h > 1}
      setConfig={patch => commit(configure(tilesRef.current, tile.id, patch))} />;
    if (tile.kind === 'github-pr') return <GitHubPrTile wide={tile.w > 1} tall={tile.h > 1} />;
    const card = cards.find(c => kindOfCard(c) === tile.kind);
    return card ? <QuotaTile card={card} data={data} now={now} open={openDetail} showBreakdown={showBreakdown} roomy={roomy} />
      : <MissingLimit title={describe(tile.kind, cards).title} loading={data.quotas.status === 'loading'} />;
  };

  // A to-do tile is named after its list, so two of them can be told apart (by a screen reader, and in what is pointed at in the chat).
  const todoListOf = (tile: Tile) => {
    if (tile.kind !== 'todo') return undefined;
    const lists = todos.source.data?.lists, { list } = todoConfigOf(tile.config);
    return lists?.find(l => l.id === list) ?? lists?.[0];
  };
  const tileTitle = (tile: Tile) => {
    const base = describe(tile.kind, cards).title, named = todoListOf(tile);
    return named ? `${base} · ${named.name}` : base;
  };
  // A to-do tile is pointed at as the list it shows (with its tasks and ids), not as an anonymous tile.
  const pointAt = (tile: Tile, title: string) => {
    const named = todoListOf(tile);
    if (!named) return ctx('tile', tile.id, title);
    const c = listContext(named);
    return ctx('todoList', c.id, c.title, c.text);
  };
  const offered = pickable(cards, tiles.map(t => t.kind), available);
  const highlights = drag ? [
    ...(drag.to ? [{ key: 'to', rect: drag.to, ok: !!drag.plan }] : []),
    ...(drag.plan?.tiles.filter(t => drag.plan!.moved.includes(t.id)).map(t => ({ key: t.id, rect: t as Rect, ok: true })) ?? []),
  ] : [];
  return <div className="wk-grid" ref={grid} role="group" aria-label="Obszar roboczy">
    {readingOrder(tiles).map(tile => {
      const title = tileTitle(tile);
      const dragging = drag?.id === tile.id;
      return <div key={tile.id} className={`wk-cell ${dragging ? 'dragging' : ''} ${active === tile.id ? 'active' : ''}`} data-kind={tile.kind} data-tile={tile.id} {...pointAt(tile, title)}
        style={{ ...areaOf(tile), ...(dragging ? { transform: `translate(${drag.dx}px, ${drag.dy}px)` } : {}) }}>
        <div className="wk-body">{content(tile)}</div>
        <button className="wk-grip" aria-label={`Przesuń kafelek: ${title}`} title="Przeciągnij, żeby przesunąć" onPointerDown={e => startMove(e, tile)}><i /></button>
        <button className="wk-x" aria-label={`Wyłącz kafelek: ${title}`} title="Wyłącz kafelek" onClick={() => commit(remove(tilesRef.current, tile.id))}><X size={14} aria-hidden="true" /></button>
        {active === tile.id && <span className="wk-size" aria-hidden="true">{tile.w}×{tile.h}</span>}
        <i className="wk-rz r" onPointerDown={e => startResize(e, tile.id, 'r')} />
        <i className="wk-rz b" onPointerDown={e => startResize(e, tile.id, 'b')} />
        <i className="wk-rz rb" onPointerDown={e => startResize(e, tile.id, 'rb')} />
      </div>;
    })}
    {emptyCells(tiles).map(cell => <EmptyCell key={`${cell.c},${cell.r}`} cell={cell} kinds={offered} cards={cards} pick={kind => commit(add(tilesRef.current, kind, cell.c, cell.r, MULTI_KINDS.includes(kind) ? newTileId(tilesRef.current, kind) : kind))} />)}
    {highlights.map(h => <div key={h.key} className={`wk-hl ${h.ok ? 'ok' : 'bad'}`} style={areaOf(h.rect)} aria-hidden="true" />)}
    {notice && <p className="wk-notice" role="status">{notice}</p>}
  </div>;
}
