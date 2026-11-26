import { PAIRS, PILLARS, pillarEnds, pillarIndex } from './calendar';
import { dfUsd, fxCurve, usdPerUnit, type FxCurve } from './market';
import type { Ccy, ISODate, Leg, MarketData, PairId, Trade } from './types';

/** Everything a valuation needs for one business date. */
export interface Ctx {
  t0: ISODate;
  market: MarketData;
  addOnPct: number[];
  offsetNegativeMv: boolean;
  pillarEnds: ISODate[];
  curve(pair: PairId): FxCurve;
}

export function makeCtx(s: { businessDate: ISODate; market: MarketData; addOnPct: number[]; offsetNegativeMv: boolean }): Ctx {
  const curves = new Map<PairId, FxCurve>();
  return {
    t0: s.businessDate,
    market: s.market,
    addOnPct: s.addOnPct,
    offsetNegativeMv: s.offsetNegativeMv,
    pillarEnds: pillarEnds(s.businessDate),
    curve(pair) {
      let c = curves.get(pair);
      if (!c) curves.set(pair, (c = fxCurve(s.market, s.businessDate, pair)));
      return c;
    },
  };
}

export interface LegValue {
  date: ISODate;
  base: number;
  rate: number;
  forward: number; // today's outright rate for the leg's date
  df: number; // USD discount factor to the leg's date
  mv: number; // USD
}

/** Market value in USD of one unsettled leg: revalue it at today's outright rate
 *  for its date and discount the difference at the USD rate. */
export function valueLeg(ctx: Ctx, pair: PairId, leg: { date: ISODate; base: number; rate: number }): LegValue {
  const forward = ctx.curve(pair).forward(leg.date);
  const df = dfUsd(ctx.market, ctx.t0, leg.date);
  const gainInQuote = leg.base * (forward - leg.rate);
  const gainInUsd = PAIRS[pair].quote === 'USD' ? gainInQuote : gainInQuote / forward;
  return { ...leg, forward, df, mv: gainInUsd * df };
}

export interface TradeRisk {
  trade: Trade;
  legs: LegValue[]; // unsettled legs only
  mv: number; // USD
  maturity: ISODate; // value date of the last leg
  pillar: number; // index into PILLARS; -1 when the trade no longer carries PSR
  notionalUsd: number; // last (forward) leg, base currency amount at spot
  addOnPct: number;
  addOn: number; // USD
  exposure: number; // USD, standalone: see exposureOf
}

/** Exposure from a market value and an add-on.
 *  The limit system's method, and the default here: max(mv + add-on, 0), so a
 *  trade that is out of the money uses less than its add-on.
 *  Standard variant (Basel current exposure method): max(mv, 0) + add-on. A trade
 *  that is out of the money can still turn positive, so its add-on is kept in full. */
export const exposureOf = (mv: number, addOn: number, offsetNegativeMv: boolean) =>
  offsetNegativeMv ? Math.max(mv + addOn, 0) : Math.max(mv, 0) + addOn;

/** Size of a trade for the add-on: the last (forward) leg's base amount, in USD at spot. */
export const notionalUsd = (market: MarketData, trade: Trade) =>
  Math.abs(trade.legs[trade.legs.length - 1].base) * usdPerUnit(market, PAIRS[trade.pair].base);

export function valueTrade(ctx: Ctx, trade: Trade): TradeRisk {
  const legs = trade.legs.filter((l) => l.date >= ctx.t0).map((l) => valueLeg(ctx, trade.pair, l));
  const mv = legs.reduce((sum, l) => sum + l.mv, 0);
  const maturity = trade.legs[trade.legs.length - 1].date;
  // A trade whose last leg settles today has nothing left to replace.
  const found = pillarIndex(ctx.pillarEnds, maturity);
  // Beyond the longest pillar still counts: it uses the longest pillar and every shorter one.
  const pillar = maturity > ctx.t0 ? (found >= 0 ? found : PILLARS.length - 1) : -1;
  const notional = notionalUsd(ctx.market, trade);
  const addOnPct = pillar >= 0 ? ctx.addOnPct[pillar] : 0;
  const addOn = (notional * addOnPct) / 100;
  const exposure = pillar >= 0 ? exposureOf(mv, addOn, ctx.offsetNegativeMv) : 0;
  return { trade, legs, mv, maturity, pillar, notionalUsd: notional, addOnPct, addOn, exposure };
}

// ---------------------------------------------------- pre-settlement risk
export interface PillarAgg {
  count: number; // trades counted in this pillar
  sumMv: number;
  sumPositiveMv: number;
  ngr: number; // net-to-gross ratio; 1 without netting
  addOnGross: number;
  addOnNet: number;
  exposure: number;
}

/** PSR per time pillar for one group. A trade counts in the pillar its maturity
 *  falls in and in every shorter pillar.
 *  Without close-out netting: the sum of each trade's own exposure.
 *  With it: the exposure of the summed market value and the net add-on, where
 *  net add-on = (0.4 + 0.6 x NGR) x gross add-on and
 *  NGR = max(sum of mv, 0) / sum of max(mv, 0). */
export function psrByPillar(risks: TradeRisk[], closeOutNetting: boolean, offsetNegativeMv: boolean): PillarAgg[] {
  return PILLARS.map((_, p) => {
    const set = risks.filter((r) => r.pillar >= p);
    const sumMv = set.reduce((s, r) => s + r.mv, 0);
    const sumPositiveMv = set.reduce((s, r) => s + Math.max(r.mv, 0), 0);
    const addOnGross = set.reduce((s, r) => s + r.addOn, 0);
    if (!closeOutNetting) {
      const exposure = set.reduce((s, r) => s + r.exposure, 0);
      return { count: set.length, sumMv, sumPositiveMv, ngr: 1, addOnGross, addOnNet: addOnGross, exposure };
    }
    // With no positive market value the ratio is undefined; 1 keeps the full add-on
    // (the value the US swap margin rule gives for the same formula).
    const ngr = sumPositiveMv > 0 ? Math.max(sumMv, 0) / sumPositiveMv : 1;
    const addOnNet = (0.4 + 0.6 * ngr) * addOnGross;
    return { count: set.length, sumMv, sumPositiveMv, ngr, addOnGross, addOnNet, exposure: exposureOf(sumMv, addOnNet, offsetNegativeMv) };
  });
}

// --------------------------------------------------------- settlement risk
export interface SrFlow {
  tradeId: string;
  ccy: Ccy;
  amount: number; // signed, positive = we receive
  usd: number; // signed, at spot
}
export interface SrDay {
  date: ISODate;
  flows: SrFlow[];
  exposure: number; // USD
}

/** SR per settlement date for one group: what we are due to receive that day.
 *  Only principal flows of trades settled gross count; CLS and cash-settled
 *  trades carry none. Without payment netting every receivable is added up.
 *  With it, flows in the same currency on the same date offset first. */
/** A payment due on the day the hedge is dealt is too late for CLS, so it always settles gross. */
export const settlesGross = (trade: Trade, leg: Leg) =>
  trade.settlement === 'GROSS' || (trade.settlement === 'CLS' && leg.date === trade.tradeDate);

export function srByDate(ctx: Ctx, trades: Trade[], paymentNetting: boolean): Map<ISODate, SrDay> {
  const days = new Map<ISODate, SrDay>();
  for (const trade of trades) {
    const { base, quote } = PAIRS[trade.pair];
    for (const leg of trade.legs) {
      if (leg.date < ctx.t0 || !settlesGross(trade, leg)) continue;
      let day = days.get(leg.date);
      if (!day) days.set(leg.date, (day = { date: leg.date, flows: [], exposure: 0 }));
      const add = (ccy: Ccy, amount: number) =>
        day.flows.push({ tradeId: trade.id, ccy, amount, usd: amount * usdPerUnit(ctx.market, ccy) });
      add(base, leg.base);
      add(quote, -leg.base * leg.rate);
    }
  }
  for (const day of days.values()) {
    if (paymentNetting) {
      const net = new Map<Ccy, number>();
      for (const f of day.flows) net.set(f.ccy, (net.get(f.ccy) ?? 0) + f.usd);
      day.exposure = [...net.values()].reduce((s, v) => s + Math.max(v, 0), 0);
    } else {
      day.exposure = day.flows.reduce((s, f) => s + Math.max(f.usd, 0), 0);
    }
  }
  return days;
}
