import { OUTRIGHT_TENORS, PAIRS, SWAP_TENORS, nextWeekday, valueDates } from './calendar';
import { defaultState } from './defaults';
import { checkTrade } from './lines';
import { usdPerUnit } from './market';
import { makeCtx, type Ctx } from './risk';
import type { AppState, Ticket, Trade } from './types';

export const MAX_AMOUNT_USD = 50_000_000;

/** Why a ticket cannot be dealt. The screen turns the code into words. */
export type TicketError = 'USE_SWAP_OR_FORWARD' | 'NDF_ONLY' | 'TENOR' | 'AMOUNT' | 'TOO_LARGE' | 'NO_TOM_NEXT' | 'NOT_CLS_PAIR' | 'CLS_SAME_DAY';

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

  // CLS needs both currencies to be eligible and cannot take a same-day payment.
  const auto = ticket.product === 'NDF' ? 'CASH' : pair.cls && legs[0].date > ctx.t0 ? 'CLS' : 'GROSS';
  const settlement = ticket.product === 'NDF' || ticket.settlement === 'AUTO' ? auto : ticket.settlement;
  if (settlement === 'CLS' && !pair.cls) return { error: 'NOT_CLS_PAIR' };
  if (settlement === 'CLS' && legs[0].date <= ctx.t0) return { error: 'CLS_SAME_DAY' };

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
  | { type: 'RESET' }
  | { type: 'EDIT'; change: (draft: AppState) => void };

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
      // Quotes do not live overnight: anything still in flight lapses and its reservation is released.
      return {
        ...s,
        businessDate: nextWeekday(s.businessDate),
        trades: s.trades.map((t) => (t.status === 'IN_FLIGHT' ? { ...t, status: 'EXPIRED' } : t)),
      };
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
