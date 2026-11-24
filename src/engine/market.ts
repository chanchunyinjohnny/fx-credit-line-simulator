import reference from '../data/reference.json';
import { PAIRS, daysBetween, spotDate, tenorDate, tomDate, toDay } from './calendar';
import type { Ccy, ISODate, MarketData, PairId, RateTenor, Tenor } from './types';

const FAR_TENORS: Tenor[] = ['SN', '1W', '1M', '2M', '3M', '6M', '9M', '1Y'];

export interface FxCurve {
  pair: PairId;
  tom: ISODate;
  spot: ISODate;
  /** Tenor dates with their swap points from spot, as a rate difference. */
  nodes: { tenor: Tenor | 'SPOT'; date: ISODate; points: number }[];
  /** Outright rate for a value date on or after the business date. */
  forward(date: ISODate): number;
}

/** Outright rates for one pair: spot plus swap points, interpolated linearly in
 *  calendar days between quoted tenor dates. Dates before spot use the quoted
 *  tom-next and overnight points, subtracted from spot. */
export function fxCurve(market: MarketData, t0: ISODate, pair: PairId): FxCurve {
  const { spot: spotRate, points } = market.pairs[pair];
  const pip = PAIRS[pair].pip;
  const tom = tomDate(t0, pair);
  const spot = spotDate(t0, pair);
  const nodes: FxCurve['nodes'] = [
    { tenor: 'SPOT', date: spot, points: 0 },
    ...FAR_TENORS.map((tenor) => ({ tenor, date: tenorDate(spot, tenor, pair), points: points[tenor] * pip })),
  ];
  const tomRate = tom < spot ? spotRate - points.TN * pip : spotRate;
  const todayRate = tomRate - points.ON * pip;

  function forward(date: ISODate): number {
    if (date >= spot) {
      for (let i = 1; i < nodes.length; i++) {
        const a = nodes[i - 1];
        const b = nodes[i];
        if (date <= b.date) {
          return spotRate + a.points + ((b.points - a.points) * daysBetween(a.date, date)) / daysBetween(a.date, b.date);
        }
      }
      const a = nodes[nodes.length - 2];
      const b = nodes[nodes.length - 1];
      return spotRate + b.points + ((b.points - a.points) * daysBetween(b.date, date)) / daysBetween(a.date, b.date);
    }
    if (date === tom) return tomRate;
    if (date <= t0) return todayRate;
    // Not a tradable value date (a holiday between today and spot): interpolate.
    return todayRate + ((spotRate - todayRate) * daysBetween(t0, date)) / daysBetween(t0, spot);
  }
  return { pair, tom, spot, nodes, forward };
}

const RATE_NODES = (Object.entries(reference.usdRateNodeDays) as [RateTenor, number][]).sort((a, b) => a[1] - b[1]);

/** USD rate in percent for a number of calendar days, linear between nodes, flat outside. */
export function usdRate(market: MarketData, days: number): number {
  const first = RATE_NODES[0];
  const last = RATE_NODES[RATE_NODES.length - 1];
  if (days <= first[1]) return market.usdRates[first[0]];
  if (days >= last[1]) return market.usdRates[last[0]];
  for (let i = 1; i < RATE_NODES.length; i++) {
    const [t0, n0] = RATE_NODES[i - 1];
    const [t1, n1] = RATE_NODES[i];
    if (days <= n1) {
      return market.usdRates[t0] + ((market.usdRates[t1] - market.usdRates[t0]) * (days - n0)) / (n1 - n0);
    }
  }
  return market.usdRates[last[0]];
}

/** USD discount factor from the business date to a date: simple interest, Act/360. */
export function dfUsd(market: MarketData, t0: ISODate, date: ISODate): number {
  const days = toDay(date) - toDay(t0);
  return days <= 0 ? 1 : 1 / (1 + ((usdRate(market, days) / 100) * days) / 360);
}

/** USD value of one unit of a currency at the spot rate. */
export function usdPerUnit(market: MarketData, ccy: Ccy): number {
  if (ccy === 'USD') return 1;
  for (const id of Object.keys(PAIRS) as PairId[]) {
    if (PAIRS[id].base === ccy && PAIRS[id].quote === 'USD') return market.pairs[id].spot;
    if (PAIRS[id].quote === ccy && PAIRS[id].base === 'USD') return 1 / market.pairs[id].spot;
  }
  throw new Error(`No USD rate for ${ccy}`);
}
