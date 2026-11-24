import holidaysJson from '../data/holidays.json';
import reference from '../data/reference.json';
import type { Ccy, ISODate, PairId, PairInfo, Product, Tenor } from './types';

// Weekday holidays per currency, exported from QuantLib by oracle/generate.py.
const HOLIDAYS = Object.fromEntries(
  Object.entries(holidaysJson as Record<string, string[]>).map(([ccy, days]) => [ccy, new Set(days)]),
) as Record<Ccy, Set<ISODate>>;

const MS_PER_DAY = 86_400_000;
export const toDay = (d: ISODate) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / MS_PER_DAY;
export const fromDay = (n: number): ISODate => new Date(n * MS_PER_DAY).toISOString().slice(0, 10);
export const addDays = (d: ISODate, n: number) => fromDay(toDay(d) + n);
export const daysBetween = (from: ISODate, to: ISODate) => toDay(to) - toDay(from);

export function isWeekend(d: ISODate) {
  const weekday = new Date(toDay(d) * MS_PER_DAY).getUTCDay();
  return weekday === 0 || weekday === 6;
}

/** Same day of the month n months on, clamped to the month's last day. */
export function addMonths(d: ISODate, n: number): ISODate {
  const first = new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1 + n, 1));
  const y = first.getUTCFullYear();
  const m = first.getUTCMonth();
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(+d.slice(8, 10), lastDay))).toISOString().slice(0, 10);
}

function lastDayOfMonth(d: ISODate): ISODate {
  return new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7), 0)).toISOString().slice(0, 10);
}

export const PAIRS = reference.pairs as Record<PairId, PairInfo>;
export const PAIR_IDS = Object.keys(PAIRS) as PairId[];

const pairCcys = (pair: PairId): Ccy[] => [PAIRS[pair].base, PAIRS[pair].quote];
/** A value date must be a business day for both currencies and for USD. */
const settlementCcys = (pair: PairId): Ccy[] => [...new Set<Ccy>([...pairCcys(pair), 'USD'])];

export const isGood = (d: ISODate, ccys: Ccy[]) => !isWeekend(d) && ccys.every((c) => !HOLIDAYS[c].has(d));

function nextGood(d: ISODate, ccys: Ccy[]) {
  let x = addDays(d, 1);
  while (!isGood(x, ccys)) x = addDays(x, 1);
  return x;
}
function following(d: ISODate, ccys: Ccy[]) {
  let x = d;
  while (!isGood(x, ccys)) x = addDays(x, 1);
  return x;
}
function preceding(d: ISODate, ccys: Ccy[]) {
  let x = d;
  while (!isGood(x, ccys)) x = addDays(x, -1);
  return x;
}

export const tomDate = (t0: ISODate, pair: PairId) => nextGood(t0, settlementCcys(pair));

/** The day between the trade date and the spot date. It only has to be a business day for the non-USD currency. */
export const dayBeforeSpot = (t0: ISODate, pair: PairId) =>
  nextGood(
    t0,
    pairCcys(pair).filter((c) => c !== 'USD'),
  );

/** T+2. The spot date itself must be good for both currencies and USD. */
export const spotDate = (t0: ISODate, pair: PairId) => nextGood(dayBeforeSpot(t0, pair), settlementCcys(pair));

/** How a tenor's value date is reached from the spot date: the calendar date the
 *  tenor lands on (target) and the business day it becomes (date). Weeks roll
 *  forward; months roll forward unless that leaves the month, and a spot date on
 *  the last business day of its month maps to the last business day of the target month. */
export function tenorSteps(spot: ISODate, tenor: Tenor, pair: PairId): { target: ISODate; date: ISODate; monthEnd: boolean } {
  const ccys = settlementCcys(pair);
  if (tenor === 'SN') return { target: addDays(spot, 1), date: nextGood(spot, ccys), monthEnd: false };
  if (tenor === '1W') return { target: addDays(spot, 7), date: following(addDays(spot, 7), ccys), monthEnd: false };
  const months = tenor === '1Y' ? 12 : parseInt(tenor, 10);
  const target = addMonths(spot, months);
  const monthEnd = nextGood(spot, ccys).slice(0, 7) !== spot.slice(0, 7);
  if (monthEnd) return { target, date: preceding(lastDayOfMonth(target), ccys), monthEnd };
  const rolled = following(target, ccys);
  return { target, date: rolled.slice(0, 7) === target.slice(0, 7) ? rolled : preceding(target, ccys), monthEnd };
}

export const tenorDate = (spot: ISODate, tenor: Tenor, pair: PairId) => tenorSteps(spot, tenor, pair).date;

export const SWAP_TENORS: Tenor[] = ['ON', 'TN', 'SN', '1W', '1M', '2M', '3M', '6M', '9M', '1Y'];
export const OUTRIGHT_TENORS: Tenor[] = ['1W', '1M', '2M', '3M', '6M', '9M', '1Y'];

export interface ValueDates {
  tom: ISODate;
  spot: ISODate;
  near?: ISODate; // swaps only
  far: ISODate;
}

/** Value dates for a new trade. Returns null when the tenor does not exist today
 *  (tom-next when tomorrow is already the spot date). */
export function valueDates(t0: ISODate, pair: PairId, product: Product, tenor: Tenor): ValueDates | null {
  const tom = tomDate(t0, pair);
  const spot = spotDate(t0, pair);
  if (product !== 'SWAP') return { tom, spot, far: tenorDate(spot, tenor, pair) };
  if (tenor === 'ON') return { tom, spot, near: t0, far: tom };
  if (tenor === 'TN') return tom < spot ? { tom, spot, near: tom, far: spot } : null;
  return { tom, spot, near: spot, far: tenorDate(spot, tenor, pair) };
}

// ------------------------------------------------------------ time pillars
export const PILLARS = ['O/N', '1W', '1M', '3M', '6M', '1Y'] as const;
/** Working days added to each pillar's end so that a trade starting from the
 *  spot date still falls in the pillar named after its tenor. */
const PILLAR_BUFFER_WORKING_DAYS = 5;

export function nextWeekday(d: ISODate) {
  let x = addDays(d, 1);
  while (isWeekend(x)) x = addDays(x, 1);
  return x;
}
function addWorkingDays(d: ISODate, n: number) {
  let x = d;
  while (isWeekend(x)) x = addDays(x, 1);
  for (let i = 0; i < n; i++) x = nextWeekday(x);
  return x;
}

/** Last maturity date that falls in each pillar, as seen from the business date. */
export function pillarEnds(t0: ISODate): ISODate[] {
  const ends = [addDays(t0, 7), addMonths(t0, 1), addMonths(t0, 3), addMonths(t0, 6), addMonths(t0, 12)];
  return [nextWeekday(t0), ...ends.map((d) => addWorkingDays(d, PILLAR_BUFFER_WORKING_DAYS))];
}

/** Index of the pillar a maturity falls in, or -1 when it is beyond the last pillar. */
export const pillarIndex = (ends: ISODate[], maturity: ISODate) => ends.findIndex((end) => maturity <= end);
