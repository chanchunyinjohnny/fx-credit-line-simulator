import { OUTRIGHT_TENORS, PAIRS, SWAP_TENORS, isWeekend, nextWeekday, valueDates } from './calendar';
import { CHANNELS } from './channels';
import { defaultState } from './defaults';
import { allocationsOf, channelFill, checkTrade, maxChannelLimit } from './lines';
import { usdPerUnit } from './market';
import { makeCtx, type Ctx } from './risk';
import type { AppState, Channel, ISODate, Ticket, Trade } from './types';

export const MAX_AMOUNT_USD = 50_000_000;

/** Why a ticket cannot be dealt. The screen turns the code into words. */
export type TicketError = 'USE_SWAP_OR_FORWARD' | 'NDF_ONLY' | 'TENOR' | 'AMOUNT' | 'TOO_LARGE' | 'NO_TOM_NEXT' | 'NOT_CLS_PAIR' | 'CHANNEL_ORDER';

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

export const channelOf = (s: AppState, lpId: string) => CHANNELS[s.lps.find((l) => l.id === lpId)!.channel];

/** The ticket as a trade on its LP's channel. A channel that checks credit itself takes one kind of order. */
export function buildFor(ctx: Ctx, s: AppState, ticket: Ticket): Trade | { error: TicketError } {
  const built = buildTrade(ctx, ticket);
  const only = channelOf(s, ticket.lpId).only;
  if ('error' in built || !only) return built;
  return ticket.product === only.product && ticket.pair === only.pair && ticket.tenor === only.tenor ? built : { error: 'CHANNEL_ORDER' };
}

export type Action =
  | { type: 'SEND'; ticket: Ticket }
  | { type: 'CHANNEL_FILL'; ticket: Ticket }
  | { type: 'SET_CHANNEL_LIMIT'; channel: Channel; groupId: string; limitUsd: number }
  | { type: 'FILL'; id: string }
  | { type: 'REJECT'; id: string }
  | { type: 'NEXT_DAY' }
  | { type: 'GO_TO'; date: ISODate }
  | { type: 'RESET' }
  | { type: 'EDIT'; change: (draft: AppState) => void };

/** The holiday tables end here. */
export const LAST_DATE = '2029-12-31';

/** Set one channel limit. It cannot go below what the channel has filled today,
 *  and it can only rise while the group's lines have room to hold the extra. */
function setChannelLimit(s: AppState, channel: Channel, groupId: string, limitUsd: number): AppState {
  const limit = s.channelLimits.find((l) => l.channel === channel && l.groupId === groupId);
  if (!limit || !(limitUsd >= 0)) return s;
  const ctx = makeCtx(s);
  const filled = allocationsOf(ctx, s, groupId).find((a) => a.limit === limit)!.filled;
  const next = Math.max(filled, Math.min(limitUsd, maxChannelLimit(ctx, s, limit)));
  return next === limit.limitUsd ? s : { ...s, channelLimits: s.channelLimits.map((l) => (l === limit ? { ...l, limitUsd: next } : l)) };
}

/** Each morning the channels start counting again, so every limit is checked
 *  against what the lines can still hold and cut where it no longer fits. */
function fitChannelLimits(s: AppState): AppState {
  return s.channelLimits.reduce((state, l) => setChannelLimit(state, l.channel, l.groupId, l.limitUsd), s);
}

/** Move to a later business date. Quotes do not live overnight: anything still
 *  in flight lapses and its reservation is released. */
const goTo = (s: AppState, date: ISODate): AppState =>
  fitChannelLimits({
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
      const built = buildFor(ctx, s, a.ticket);
      if ('error' in built || channelOf(s, a.ticket.lpId).checkedBy !== 'OMS' || !checkTrade(ctx, s, built).ok) return s;
      return { ...s, trades: [...s.trades, { ...built, id: `H${s.nextId}` }], nextId: s.nextId + 1 };
    }
    case 'CHANNEL_FILL': {
      // The channel has matched and filled against its own limit. The desk books what it is told.
      const ctx = makeCtx(s);
      const built = buildFor(ctx, s, a.ticket);
      if ('error' in built || channelOf(s, a.ticket.lpId).checkedBy !== 'CHANNEL') return s;
      const { trade } = channelFill(ctx, s, built);
      return trade ? { ...s, trades: [...s.trades, { ...trade, id: `H${s.nextId}` }], nextId: s.nextId + 1 } : s;
    }
    case 'SET_CHANNEL_LIMIT':
      return setChannelLimit(s, a.channel, a.groupId, a.limitUsd);
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

const STORAGE_KEY = 'fx-credit-line-simulator/v2';

export function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const s = JSON.parse(raw) as AppState;
      if (s.businessDate && s.market?.pairs && Array.isArray(s.trades) && Array.isArray(s.groups) && Array.isArray(s.channelLimits)) return s;
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
