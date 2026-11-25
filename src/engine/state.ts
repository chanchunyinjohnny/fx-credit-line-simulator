import { OUTRIGHT_TENORS, PAIRS, SWAP_TENORS, isWeekend, nextWeekday, valueDates } from './calendar';
import { CHANNELS, checksBook, openOn } from './channels';
import { defaultState } from './defaults';
import { checkTrade, groupOf } from './lines';
import { usdPerUnit } from './market';
import { makeCtx, type Ctx } from './risk';
import type { AppState, Channel, ISODate, Ticket, Trade } from './types';

export const MAX_AMOUNT_USD = 50_000_000;

/** Why a ticket cannot be dealt. The screen turns the code into words. */
export type TicketError = 'USE_SWAP_OR_FORWARD' | 'NDF_ONLY' | 'TENOR' | 'AMOUNT' | 'TOO_LARGE' | 'NO_TOM_NEXT' | 'NOT_CLS_PAIR' | 'BOOK_PRODUCT' | 'BOOK_EMPTY';

/** Turn a ticket into a trade dealt at today's mid rates, or say why it cannot be dealt. */
export function buildTrade(ctx: Ctx, ticket: Ticket): Trade | { error: TicketError } {
  const pair = PAIRS[ticket.pair];
  if (pair.deliverable === (ticket.product === 'NDF')) return { error: pair.deliverable ? 'USE_SWAP_OR_FORWARD' : 'NDF_ONLY' };
  const tenors = ticket.product === 'SWAP' ? SWAP_TENORS : OUTRIGHT_TENORS;
  if (!tenors.includes(ticket.tenor)) return { error: 'TENOR' };
  if (!(ticket.amount > 0)) return { error: 'AMOUNT' };
  // The flow covers hedges up to this size with one LP; larger orders are split upstream.
  if (ticket.amount * usdPerUnit(ctx.market, pair.base) > MAX_AMOUNT_USD) return { error: 'TOO_LARGE' };
  const dates = valueDates(ctx.t0, ticket.pair, ticket.product, ticket.tenor);
  if (!dates) return { error: 'NO_TOM_NEXT' }; // tomorrow is already the spot date

  const curve = ctx.curve(ticket.pair);
  const sign = ticket.side === 'BUY' ? 1 : -1;
  const legs =
    dates.near !== undefined
      ? [
          { date: dates.near, base: sign * ticket.amount, rate: curve.forward(dates.near) },
          { date: dates.far, base: -sign * ticket.amount, rate: curve.forward(dates.far) },
        ]
      : [{ date: dates.far, base: sign * ticket.amount, rate: curve.forward(dates.far) }];

  // CLS needs both currencies to be eligible. A payment due today still counts in full: see settlesGross.
  const auto = ticket.product === 'NDF' ? 'CASH' : pair.cls ? 'CLS' : 'GROSS';
  const settlement = ticket.product === 'NDF' || ticket.settlement === 'AUTO' ? auto : ticket.settlement;
  if (settlement === 'CLS' && !pair.cls) return { error: 'NOT_CLS_PAIR' };

  return {
    id: 'new',
    product: ticket.product,
    pair: ticket.pair,
    tenor: ticket.tenor,
    side: ticket.side,
    amount: ticket.amount,
    legs,
    lpId: ticket.lpId,
    tradeDate: ctx.t0,
    settlement,
    status: 'IN_FLIGHT',
  };
}

/** The channel whose book the order goes to, when the desk cannot choose the LP there. */
export function bookOf(s: AppState, ticket: Ticket): Channel | undefined {
  if (ticket.book) return ticket.book;
  const channel = s.lps.find((l) => l.id === ticket.lpId)!.channel;
  return CHANNELS[channel].disclosed === 'AFTER' ? channel : undefined;
}

/** The reservations a ticket would make. A hedge sent to an LP makes one. An order
 *  on a channel that discloses after the trade makes one for every counterparty
 *  that could fill it, because the desk cannot choose among them. */
export function candidates(ctx: Ctx, s: AppState, ticket: Ticket): Trade[] | { error: TicketError } {
  const built = buildTrade(ctx, ticket);
  if ('error' in built) return built;
  const book = bookOf(s, ticket);
  if (!book) return [built];
  const only = CHANNELS[book].only;
  if (only && ticket.product !== only) return { error: 'BOOK_PRODUCT' };
  const lps = openOn(s, book);
  return lps.length > 0 ? lps.map((lp) => ({ ...built, lpId: lp.id })) : { error: 'BOOK_EMPTY' };
}

const fitsAll = (ctx: Ctx, s: AppState, trades: Trade[]) => trades.every((t) => checkTrade(ctx, s, t).ok);

/** The largest amount of this ticket, up to its own, that every counterparty it
 *  could fill with has room for. Rounded down to a thousand. */
export function largestThatFits(ctx: Ctx, s: AppState, ticket: Ticket): number {
  const fits = (amount: number) => {
    const trades = candidates(ctx, s, { ...ticket, amount });
    return !('error' in trades) && fitsAll(ctx, s, trades);
  };
  if (fits(ticket.amount)) return ticket.amount;
  let lo = 0;
  let hi = ticket.amount;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  return Math.floor(lo / 1000 + 1e-6) * 1000;
}

export type Action =
  | { type: 'SEND'; ticket: Ticket }
  | { type: 'FILL'; id: string }
  | { type: 'REJECT'; id: string }
  | { type: 'BOOK_FILL'; ticket: Ticket; lpId: string }
  | { type: 'SWITCH_ON_CHANNEL'; lpId: string; on: boolean }
  | { type: 'SWITCH_BOOK_CHECK'; channel: Channel; on: boolean }
  | { type: 'NEXT_DAY' }
  | { type: 'GO_TO'; date: ISODate }
  | { type: 'RESET' }
  | { type: 'EDIT'; change: (draft: AppState) => void };

/** The holiday tables end here. */
export const LAST_DATE = '2029-12-31';

/** Move to a later business date. Quotes do not live overnight: anything still
 *  in flight lapses and its reservation is released. */
const goTo = (s: AppState, date: ISODate): AppState => ({
  ...s,
  businessDate: date,
  trades: s.trades.map((t) => (t.status === 'IN_FLIGHT' ? { ...t, status: 'EXPIRED' } : t)),
});

const setStatus = (s: AppState, id: string, status: Trade['status']): AppState => ({
  ...s,
  trades: s.trades.map((t) => (t.id === id && t.status === 'IN_FLIGHT' ? { ...t, status } : t)),
});

export function reducer(s: AppState, a: Action): AppState {
  switch (a.type) {
    case 'SEND': {
      // Check and reserve in one step: the hedge is only sent if it still fits
      // every counterparty it could fill with.
      const ctx = makeCtx(s);
      const trades = candidates(ctx, s, a.ticket);
      const book = bookOf(s, a.ticket);
      // With the check switched off there is nothing to reserve: see BOOK_FILL.
      if ('error' in trades || (book && !checksBook(s, book)) || !fitsAll(ctx, s, trades)) return s;
      const id = `H${s.nextId}`;
      const sent = book ? trades.map((t) => ({ ...t, id: `${id}-${groupOf(s, t.lpId).id}`, orderId: id })) : [{ ...trades[0], id }];
      return { ...s, trades: [...s.trades, ...sent], nextId: s.nextId + 1 };
    }
    case 'FILL': {
      const hit = s.trades.find((t) => t.id === a.id && t.status === 'IN_FLIGHT');
      if (!hit) return s;
      // The fill names one counterparty: its reservation becomes utilisation, and
      // the reservations the same order made on the others are released.
      const other = (t: Trade) => hit.orderId !== undefined && t.orderId === hit.orderId && t.status === 'IN_FLIGHT';
      return { ...s, trades: s.trades.map((t) => (t === hit ? { ...t, status: 'FILLED' } : other(t) ? { ...t, status: 'UNFILLED' } : t)) };
    }
    case 'REJECT': {
      const hit = s.trades.find((t) => t.id === a.id && t.status === 'IN_FLIGHT');
      if (!hit) return s;
      // An LP rejects its own hedge. An order on a book that ends with no match releases every reservation it made.
      if (hit.orderId === undefined) return setStatus(s, a.id, 'REJECTED');
      return { ...s, trades: s.trades.map((t) => (t.orderId === hit.orderId && t.status === 'IN_FLIGHT' ? { ...t, status: 'UNFILLED' } : t)) };
    }
    case 'BOOK_FILL': {
      // The desk's check is switched off for this book. The channel has filled on its own
      // limits and the desk books what it is told, whether or not the line has room.
      const book = bookOf(s, a.ticket);
      const trades = candidates(makeCtx(s), s, a.ticket);
      if ('error' in trades || !book || checksBook(s, book)) return s;
      const hit = trades.find((t) => t.lpId === a.lpId);
      return hit ? { ...s, trades: [...s.trades, { ...hit, id: `H${s.nextId}`, status: 'FILLED' }], nextId: s.nextId + 1 } : s;
    }
    case 'SWITCH_BOOK_CHECK': {
      if (CHANNELS[a.channel].disclosed !== 'AFTER') return s;
      const off = s.bookCheckOff.filter((c) => c !== a.channel);
      return { ...s, bookCheckOff: a.on ? off : [...off, a.channel] };
    }
    case 'SWITCH_ON_CHANNEL': {
      const lp = s.lps.find((l) => l.id === a.lpId);
      if (!lp || CHANNELS[lp.channel].disclosed !== 'AFTER') return s;
      const off = s.channelOff.filter((id) => id !== a.lpId);
      return { ...s, channelOff: a.on ? off : [...off, a.lpId] };
    }
    case 'NEXT_DAY':
      return goTo(s, nextWeekday(s.businessDate));
    case 'GO_TO': {
      // Forward only, to a weekday, within the years the holiday tables cover.
      if (!/^\d{4}-\d{2}-\d{2}$/.test(a.date) || a.date > LAST_DATE) return s;
      const date = isWeekend(a.date) ? nextWeekday(a.date) : a.date;
      return date > s.businessDate ? goTo(s, date) : s;
    }
    case 'RESET':
      return defaultState();
    case 'EDIT': {
      const draft = structuredClone(s);
      a.change(draft);
      return draft;
    }
  }
}

const STORAGE_KEY = 'fx-credit-line-simulator/v4';

export function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const s = JSON.parse(raw) as AppState;
      if (s.businessDate && s.market?.pairs && Array.isArray(s.trades) && Array.isArray(s.groups) && Array.isArray(s.channelOff) && Array.isArray(s.bookCheckOff)) return s;
    }
  } catch {
    // Unreadable or unavailable storage: start fresh.
  }
  return defaultState();
}

export function saveState(s: AppState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // Storage full or blocked: the session still works, it just is not kept.
  }
}
