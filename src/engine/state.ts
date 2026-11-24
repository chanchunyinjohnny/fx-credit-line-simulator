import { OUTRIGHT_TENORS, PAIRS, SWAP_TENORS, isWeekend, nextWeekday, valueDates } from './calendar';
import { defaultState } from './defaults';
import { checkTrade } from './lines';
import { usdPerUnit } from './market';
import { makeCtx, type Ctx } from './risk';
import type { AppState, ISODate, Ticket, Trade } from './types';

export const MAX_AMOUNT_USD = 50_000_000;

/** Why a ticket cannot be dealt. The screen turns the code into words. */
export type TicketError = 'USE_SWAP_OR_FORWARD' | 'NDF_ONLY' | 'TENOR' | 'AMOUNT' | 'TOO_LARGE' | 'NO_TOM_NEXT' | 'NOT_CLS_PAIR';

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

export type Action =
  | { type: 'SEND'; ticket: Ticket }
  | { type: 'FILL'; id: string }
  | { type: 'REJECT'; id: string }
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
      // Check and reserve in one step: the hedge is only sent if it still fits.
      const ctx = makeCtx(s);
      const built = buildTrade(ctx, a.ticket);
      if ('error' in built || !checkTrade(ctx, s, built).ok) return s;
      return { ...s, trades: [...s.trades, { ...built, id: `H${s.nextId}` }], nextId: s.nextId + 1 };
    }
    case 'FILL':
      return setStatus(s, a.id, 'FILLED');
    case 'REJECT':
      return setStatus(s, a.id, 'REJECTED');
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

const STORAGE_KEY = 'fx-credit-line-simulator/v1';

export function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const s = JSON.parse(raw) as AppState;
      if (s.businessDate && s.market?.pairs && Array.isArray(s.trades) && Array.isArray(s.groups)) return s;
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
