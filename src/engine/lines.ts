import { PILLARS, pillarIndex, valueDates } from './calendar';
import { CHANNELS } from './channels';
import { notionalUsd, psrByPillar, srByDate, valueTrade, type Ctx, type PillarAgg, type SrDay, type TradeRisk } from './risk';
import type { AppState, ChannelLimit, Group, ISODate, Trade } from './types';

const EPS = 0.005; // half a cent

export const groupOf = (s: AppState, lpId: string): Group => {
  const lp = s.lps.find((l) => l.id === lpId)!;
  return s.groups.find((g) => g.id === lp.groupId)!;
};

/** A group's trades that still use its credit lines. */
function groupTrades(s: AppState, groupId: string) {
  const lpIds = new Set(s.lps.filter((l) => l.groupId === groupId).map((l) => l.id));
  const live = s.trades.filter((t) => lpIds.has(t.lpId) && (t.status === 'FILLED' || t.status === 'IN_FLIGHT'));
  return {
    earlier: live.filter((t) => t.status === 'FILLED' && t.tradeDate < s.businessDate),
    filled: live.filter((t) => t.status === 'FILLED'),
    all: live,
  };
}

export interface Measured {
  risks: TradeRisk[];
  psr: PillarAgg[];
  sr: Map<ISODate, SrDay>;
}
function measure(ctx: Ctx, group: Group, trades: Trade[]): Measured {
  const risks = trades.map((t) => valueTrade(ctx, t));
  return { risks, psr: psrByPillar(risks, group.closeOutNetting, ctx.offsetNegativeMv), sr: srByDate(ctx, trades, group.paymentNetting) };
}
const srOn = (m: Measured, date: ISODate) => m.sr.get(date)?.exposure ?? 0;

// ------------------------------------------------------ channel allocation
/** Room held on a group's lines for a channel that checks credit itself. The
 *  desk cannot check each trade there, so it holds room for everything the
 *  channel could still fill today. A fill moves its exposure from here to
 *  utilisation, on the same lines as every other hedge. */
export interface Allocation {
  limit: ChannelLimit;
  filled: number; // USD notional the channel has filled with the group today
  left: number; // limit - filled: what the channel can still fill today
  pillar: number; // the pillar the channel's order falls in
  addOnPct: number; // that pillar's add-on
  held: number; // left x add-on, held on that pillar and every shorter one
}

export function allocationsOf(ctx: Ctx, s: AppState, groupId: string): Allocation[] {
  return s.channelLimits
    .filter((l) => l.groupId === groupId)
    .map((limit) => {
      const only = CHANNELS[limit.channel].only!;
      const found = pillarIndex(ctx.pillarEnds, valueDates(ctx.t0, only.pair, only.product, only.tenor)!.far);
      const pillar = found >= 0 ? found : PILLARS.length - 1;
      const lpIds = new Set(s.lps.filter((l) => l.groupId === groupId && l.channel === limit.channel).map((l) => l.id));
      // The channel counts by trade date and starts again each day.
      const filled = s.trades
        .filter((t) => t.status === 'FILLED' && t.tradeDate === s.businessDate && lpIds.has(t.lpId))
        .reduce((sum, t) => sum + notionalUsd(ctx.market, t), 0);
      const left = Math.max(limit.limitUsd - filled, 0);
      const addOnPct = ctx.addOnPct[pillar];
      return { limit, filled, left, pillar, addOnPct, held: (left * addOnPct) / 100 };
    });
}

const heldByPillar = (allocations: Allocation[]) => PILLARS.map((_, p) => allocations.reduce((sum, a) => sum + (p <= a.pillar ? a.held : 0), 0));

/** The most a channel limit can be today: what the channel has already filled,
 *  plus the notional the group's lines can still hold. */
export function maxChannelLimit(ctx: Ctx, s: AppState, limit: ChannelLimit): number {
  const group = s.groups.find((g) => g.id === limit.groupId)!;
  const allocations = allocationsOf(ctx, s, group.id);
  const own = allocations.find((a) => a.limit.channel === limit.channel)!;
  if (own.addOnPct === 0) return Infinity;
  const used = measure(ctx, group, groupTrades(s, group.id).all).psr;
  const others = heldByPillar(allocations.filter((a) => a !== own));
  let room = Infinity;
  for (let p = 0; p <= own.pillar; p++) room = Math.min(room, group.psrLines[p] - used[p].exposure - others[p]);
  return own.filled + Math.max(Math.floor(room / (own.addOnPct / 100) + 1e-6), 0);
}

// ------------------------------------------------------- credit line board
export interface BoardRow {
  key: string; // pillar label or settlement date
  line: number;
  earlier: number; // exposure of trades filled on earlier days
  initial: number; // line - earlier: what today started with
  today: number; // change from today's fills
  reserved: number; // change from hedges in flight
  allocated: number; // held for channels that check credit themselves
  used: number; // earlier + today + reserved + allocated
  headroom: number; // line - used
}
export interface Board {
  psr: BoardRow[];
  sr: BoardRow[];
  measured: Measured; // every live trade, for drill-down
  allocations: Allocation[];
}

function boardRow(key: string, line: number, earlier: number, filled: number, all: number, allocated: number): BoardRow {
  const used = all + allocated;
  return { key, line, earlier, initial: line - earlier, today: filled - earlier, reserved: all - filled, allocated, used, headroom: line - used };
}

export function board(ctx: Ctx, s: AppState, groupId: string): Board {
  const group = s.groups.find((g) => g.id === groupId)!;
  const sets = groupTrades(s, groupId);
  const earlier = measure(ctx, group, sets.earlier);
  const filled = measure(ctx, group, sets.filled);
  const all = measure(ctx, group, sets.all);
  const allocations = allocationsOf(ctx, s, groupId);
  const held = heldByPillar(allocations);
  const psr = PILLARS.map((label, p) =>
    boardRow(label, group.psrLines[p], earlier.psr[p].exposure, filled.psr[p].exposure, all.psr[p].exposure, held[p]),
  );
  // A channel that checks credit itself takes cash-settled orders only here, so it holds no settlement risk.
  const sr = [...all.sr.keys()]
    .sort()
    .map((date) => boardRow(date, group.srLine, srOn(earlier, date), srOn(filled, date), srOn(all, date), 0));
  return { psr, sr, measured: all, allocations };
}

// --------------------------------------------------------- pre-trade check
export interface CheckRow {
  key: string;
  before: number; // in use before this hedge, room held for channels included
  after: number;
  line: number;
  ok: boolean;
  hedge: number; // what this hedge adds
  held: number; // room held for channels once this hedge is counted
}
export interface CheckResult {
  ok: boolean;
  group: Group;
  risk: TradeRisk; // the candidate on its own
  psr: CheckRow[];
  sr: CheckRow[];
  before: Measured;
  after: Measured;
  /** True when the check fails only because of hedges in flight: without their
   *  reservations it would have passed. */
  blockedByReservation: boolean;
  /** True when the check fails only because of room held for a channel. */
  blockedByAllocation: boolean;
}

/** A row passes when the exposure after the trade is within the line, or when
 *  the trade does not increase it. */
const rowOk = (before: number, after: number, line: number) => after <= line + EPS || after <= before + EPS;

function rows(group: Group, before: Measured, after: Measured, heldBefore: number[], heldAfter = heldBefore) {
  const psr = PILLARS.map((label, p): CheckRow => {
    const b = before.psr[p].exposure + heldBefore[p];
    const a = after.psr[p].exposure + heldAfter[p];
    return { key: label, before: b, after: a, line: group.psrLines[p], ok: rowOk(b, a, group.psrLines[p]), hedge: after.psr[p].exposure - before.psr[p].exposure, held: heldAfter[p] };
  });
  const sr = [...after.sr.keys()].sort().map((date): CheckRow => {
    const b = srOn(before, date);
    const a = srOn(after, date);
    return { key: date, before: b, after: a, line: group.srLine, ok: rowOk(b, a, group.srLine), hedge: a - b, held: 0 };
  });
  return { psr, sr };
}
const allOk = (r: { psr: CheckRow[]; sr: CheckRow[] }) => [...r.psr, ...r.sr].every((x) => x.ok);

/** Would this hedge fit the group's credit lines? Counts filled trades, the
 *  reservations of hedges in flight and the room held for channels. */
export function checkTrade(ctx: Ctx, s: AppState, candidate: Trade): CheckResult {
  const group = groupOf(s, candidate.lpId);
  const sets = groupTrades(s, group.id);
  const held = heldByPillar(allocationsOf(ctx, s, group.id));
  const before = measure(ctx, group, sets.all);
  const after = measure(ctx, group, [...sets.all, candidate]);
  const { psr, sr } = rows(group, before, after, held);
  const ok = allOk({ psr, sr });

  let blockedByReservation = false;
  if (!ok && sets.all.length > sets.filled.length) {
    blockedByReservation = allOk(rows(group, measure(ctx, group, sets.filled), measure(ctx, group, [...sets.filled, candidate]), held));
  }
  const blockedByAllocation = !ok && held.some((h) => h > EPS) && allOk(rows(group, before, after, PILLARS.map(() => 0)));
  return { ok, group, risk: valueTrade(ctx, candidate), psr, sr, before, after, blockedByReservation, blockedByAllocation };
}

// ----------------------------------------------- a fill the channel reports
export interface ChannelFill {
  group: Group;
  sizeUsd: number; // the order
  left: number; // USD notional the channel limit had left
  fillUsd: number; // what the channel fills: the order, cut to what the limit has left
  trade: Trade | null; // the fill; null when the limit has nothing left
  risk: TradeRisk | null;
  psr: CheckRow[];
  sr: CheckRow[];
  after: Measured;
}

/** What a channel that checks credit itself does with an order matched against
 *  this LP. It fills up to its own limit and does not ask the desk. The filled
 *  part leaves the room held for the channel and becomes utilisation. */
export function channelFill(ctx: Ctx, s: AppState, order: Trade): ChannelFill {
  const group = groupOf(s, order.lpId);
  const channel = s.lps.find((l) => l.id === order.lpId)!.channel;
  const allocations = allocationsOf(ctx, s, group.id);
  const own = allocations.find((a) => a.limit.channel === channel);
  const size = notionalUsd(ctx.market, order);
  const left = own?.left ?? 0;
  const fillUsd = Math.min(size, left);
  const share = size > 0 ? fillUsd / size : 0;
  const trade: Trade | null = fillUsd > EPS ? { ...order, amount: order.amount * share, legs: order.legs.map((l) => ({ ...l, base: l.base * share })), status: 'FILLED' } : null;

  const sets = groupTrades(s, group.id);
  const before = measure(ctx, group, sets.all);
  const after = trade ? measure(ctx, group, [...sets.all, trade]) : before;
  const heldAfter = heldByPillar(allocations.map((a) => (a === own ? { ...a, held: ((a.left - fillUsd) * a.addOnPct) / 100 } : a)));
  const { psr, sr } = rows(group, before, after, heldByPillar(allocations), heldAfter);
  return { group, sizeUsd: size, left, fillUsd, trade, risk: trade ? valueTrade(ctx, trade) : null, psr, sr, after };
}
