import { PILLARS } from './calendar';
import { psrByPillar, srByDate, valueTrade, type Ctx, type PillarAgg, type SrDay, type TradeRisk } from './risk';
import type { AppState, Group, ISODate, Trade } from './types';

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
  return { risks, psr: psrByPillar(risks, group.closeOutNetting), sr: srByDate(ctx, trades, group.paymentNetting) };
}
const srOn = (m: Measured, date: ISODate) => m.sr.get(date)?.exposure ?? 0;

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
  measured: Measured; // every live trade, for drill-down
}

function boardRow(key: string, line: number, earlier: number, filled: number, all: number): BoardRow {
  return { key, line, earlier, initial: line - earlier, today: filled - earlier, reserved: all - filled, used: all, headroom: line - all };
}

export function board(ctx: Ctx, s: AppState, groupId: string): Board {
  const group = s.groups.find((g) => g.id === groupId)!;
  const sets = groupTrades(s, groupId);
  const earlier = measure(ctx, group, sets.earlier);
  const filled = measure(ctx, group, sets.filled);
  const all = measure(ctx, group, sets.all);
  const psr = PILLARS.map((label, p) =>
    boardRow(label, group.psrLines[p], earlier.psr[p].exposure, filled.psr[p].exposure, all.psr[p].exposure),
  );
  const sr = [...all.sr.keys()]
    .sort()
    .map((date) => boardRow(date, group.srLine, srOn(earlier, date), srOn(filled, date), srOn(all, date)));
  return { psr, sr, measured: all };
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
  risk: TradeRisk; // the candidate on its own
  psr: CheckRow[];
  sr: CheckRow[];
  before: Measured;
  after: Measured;
  /** True when the check fails only because of hedges in flight: without their
   *  reservations it would have passed. */
  blockedByReservation: boolean;
}

/** A row passes when the exposure after the trade is within the line, or when
 *  the trade does not increase it. */
const rowOk = (before: number, after: number, line: number) => after <= line + EPS || after <= before + EPS;

function rows(group: Group, before: Measured, after: Measured) {
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
  return { psr, sr };
}

/** Would this hedge fit the group's credit lines? Counts filled trades and the
 *  reservations of hedges in flight. */
export function checkTrade(ctx: Ctx, s: AppState, candidate: Trade): CheckResult {
  const group = groupOf(s, candidate.lpId);
  const sets = groupTrades(s, group.id);
  const before = measure(ctx, group, sets.all);
  const after = measure(ctx, group, [...sets.all, candidate]);
  const { psr, sr } = rows(group, before, after);
  const ok = [...psr, ...sr].every((r) => r.ok);

  let blockedByReservation = false;
  if (!ok && sets.all.length > sets.filled.length) {
    const r = rows(group, measure(ctx, group, sets.filled), measure(ctx, group, [...sets.filled, candidate]));
    blockedByReservation = [...r.psr, ...r.sr].every((x) => x.ok);
  }
  return { ok, group, risk: valueTrade(ctx, candidate), psr, sr, before, after, blockedByReservation };
}
