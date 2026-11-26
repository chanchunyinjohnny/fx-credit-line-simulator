import { PILLARS } from './calendar';
import { notionalUsd, psrByPillar, srByDate, valueTrade, type Ctx, type PillarAgg, type SrDay, type TradeRisk } from './risk';
import type { AppState, Channel, Group, ISODate, Trade } from './types';

const EPS = 0.005; // half a cent

/** The one channel on which the notional dealt with a counterparty is measured against a line of its own. */
export const NOTIONAL_CHANNEL: Channel = '360T';

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
  notional: number; // USD, gross notional dealt today on NOTIONAL_CHANNEL
  notionalParts: { tradeId: string; usd: number }[]; // the hedges that make it up
}

const onNotionalChannel = (s: AppState, lpId: string) => s.lps.find((l) => l.id === lpId)!.channel === NOTIONAL_CHANNEL;

/** Gross notional dealt today on the notional channel: the size of each hedge in USD, buys and sells
 *  added, nothing netted. It starts from zero every day, so only hedges dealt on the business date count. */
const notionalToday = (ctx: Ctx, s: AppState, trades: Trade[]) =>
  trades.filter((t) => t.tradeDate === ctx.t0 && onNotionalChannel(s, t.lpId)).map((t) => ({ tradeId: t.id, usd: notionalUsd(ctx.market, t) }));

function measure(ctx: Ctx, s: AppState, group: Group, trades: Trade[]): Measured {
  const risks = trades.map((t) => valueTrade(ctx, t));
  const notionalParts = notionalToday(ctx, s, trades);
  return {
    risks,
    psr: psrByPillar(risks, group.closeOutNetting, ctx.offsetNegativeMv),
    sr: srByDate(ctx, trades, group.paymentNetting),
    notional: notionalParts.reduce((sum, x) => sum + x.usd, 0),
    notionalParts,
  };
}
const srOn = (m: Measured, date: ISODate) => m.sr.get(date)?.exposure ?? 0;

export type LineStatus = 'OK' | 'WARN' | 'OVER';
/** Where a line stands: over it, at or past the warning level, or neither. A warning level of zero switches warnings off. */
export const lineStatus = (used: number, line: number, warnPct: number): LineStatus =>
  used > line + 0.5 ? 'OVER' : warnPct > 0 && used > 0.5 && used >= (line * warnPct) / 100 - 0.5 ? 'WARN' : 'OK';

// ------------------------------------------------------- credit line board
export interface BoardRow {
  key: string; // pillar label or settlement date
  line: number;
  earlier: number; // exposure of trades filled on earlier days
  initial: number; // line - earlier: what today started with
  today: number; // change from today's fills
  reserved: number; // change from hedges in flight
  used: number; // earlier + today + reserved
  headroom: number; // line - used
}
export interface Board {
  psr: BoardRow[];
  sr: BoardRow[];
  notional?: BoardRow; // absent when the group has no LP on NOTIONAL_CHANNEL
  measured: Measured; // every live trade, for drill-down
}

function boardRow(key: string, line: number, earlier: number, filled: number, all: number): BoardRow {
  return { key, line, earlier, initial: line - earlier, today: filled - earlier, reserved: all - filled, used: all, headroom: line - all };
}

export function board(ctx: Ctx, s: AppState, groupId: string): Board {
  const group = s.groups.find((g) => g.id === groupId)!;
  const sets = groupTrades(s, groupId);
  const earlier = measure(ctx, s, group, sets.earlier);
  const filled = measure(ctx, s, group, sets.filled);
  const all = measure(ctx, s, group, sets.all);
  const psr = PILLARS.map((label, p) => boardRow(label, group.psrLines[p], earlier.psr[p].exposure, filled.psr[p].exposure, all.psr[p].exposure));
  const sr = [...all.sr.keys()]
    .sort()
    .map((date) => boardRow(date, group.srLine, srOn(earlier, date), srOn(filled, date), srOn(all, date)));
  const onChannel = s.lps.some((l) => l.groupId === groupId && l.channel === NOTIONAL_CHANNEL);
  const notional = onChannel ? boardRow(NOTIONAL_CHANNEL, group.notionalLine, earlier.notional, filled.notional, all.notional) : undefined;
  return { psr, sr, notional, measured: all };
}

// --------------------------------------------------------- pre-trade check
export interface CheckRow {
  key: string;
  before: number;
  after: number;
  line: number;
  ok: boolean;
}
export interface CheckResult {
  ok: boolean;
  group: Group;
  trade: Trade; // the candidate
  risk: TradeRisk; // the candidate on its own
  psr: CheckRow[];
  sr: CheckRow[];
  notional?: CheckRow; // only for a hedge on NOTIONAL_CHANNEL
  before: Measured;
  after: Measured;
  /** True when the check fails only because of hedges in flight: without their
   *  reservations it would have passed. */
  blockedByReservation: boolean;
}

/** A row passes when the exposure after the trade is within the line, or when
 *  the trade does not increase it. */
const rowOk = (before: number, after: number, line: number) => after <= line + EPS || after <= before + EPS;

function rows(group: Group, before: Measured, after: Measured, onChannel: boolean) {
  const psr = PILLARS.map((label, p): CheckRow => {
    const b = before.psr[p].exposure;
    const a = after.psr[p].exposure;
    return { key: label, before: b, after: a, line: group.psrLines[p], ok: rowOk(b, a, group.psrLines[p]) };
  });
  const sr = [...after.sr.keys()].sort().map((date): CheckRow => {
    const b = srOn(before, date);
    const a = srOn(after, date);
    return { key: date, before: b, after: a, line: group.srLine, ok: rowOk(b, a, group.srLine) };
  });
  const notional: CheckRow | undefined = onChannel
    ? { key: NOTIONAL_CHANNEL, before: before.notional, after: after.notional, line: group.notionalLine, ok: rowOk(before.notional, after.notional, group.notionalLine) }
    : undefined;
  return { psr, sr, notional };
}
const allOk = (r: { psr: CheckRow[]; sr: CheckRow[]; notional?: CheckRow }) => [...r.psr, ...r.sr, ...(r.notional ? [r.notional] : [])].every((x) => x.ok);

/** Would this hedge fit the group's credit lines? Counts filled trades and the
 *  reservations of hedges in flight. A hedge on NOTIONAL_CHANNEL must also fit the
 *  notional the desk may deal there with the group in one day. */
export function checkTrade(ctx: Ctx, s: AppState, candidate: Trade): CheckResult {
  const group = groupOf(s, candidate.lpId);
  const sets = groupTrades(s, group.id);
  const onChannel = onNotionalChannel(s, candidate.lpId);
  const before = measure(ctx, s, group, sets.all);
  const after = measure(ctx, s, group, [...sets.all, candidate]);
  const { psr, sr, notional } = rows(group, before, after, onChannel);
  const ok = allOk({ psr, sr, notional });

  let blockedByReservation = false;
  if (!ok && sets.all.length > sets.filled.length) {
    blockedByReservation = allOk(rows(group, measure(ctx, s, group, sets.filled), measure(ctx, s, group, [...sets.filled, candidate]), onChannel));
  }
  return { ok, group, trade: candidate, risk: valueTrade(ctx, candidate), psr, sr, notional, before, after, blockedByReservation };
}
