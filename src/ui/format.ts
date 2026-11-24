import { PAIRS } from '../engine/calendar';
import type { ISODate, PairId, Trade } from '../engine/types';

const clean = (n: number) => (Math.abs(n) < 1e-9 ? 0 : n);

export const num = (n: number, dp = 0) =>
  clean(Number(n.toFixed(dp))).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
/** Whole USD (or other currency) amount. */
export const amt = (n: number) => num(n, 0);
/** Amount in millions, three decimals. */
export const mio = (n: number) => num(n / 1e6, 3);
export const signedAmt = (n: number) => (Math.round(n) > 0 ? '+' : '') + amt(n);
export const signedMio = (n: number) => (Number((n / 1e6).toFixed(3)) > 0 ? '+' : '') + mio(n);
export const pct = (n: number, dp = 2) => `${num(n, dp)}%`;
/** Outright rate, two decimals beyond the pip. */
export const rate = (pair: PairId, r: number) => r.toFixed(PAIRS[pair].dp + 2);
/** Swap points in pips from a rate difference. */
export const pips = (pair: PairId, diff: number) => num(diff / PAIRS[pair].pip, 2);

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthName = (d: ISODate) => MONTHS[+d.slice(5, 7) - 1];
/** 'Wed 02 Dec 2026' */
export const day = (d: ISODate) =>
  `${WEEKDAYS[new Date(`${d}T00:00:00Z`).getUTCDay()]} ${d.slice(8, 10)} ${monthName(d)} ${d.slice(0, 4)}`;
/** '02 Dec 26' */
export const shortDay = (d: ISODate) => `${d.slice(8, 10)} ${monthName(d)} ${d.slice(2, 4)}`;

export const PRODUCT_LABEL = { SWAP: 'FX swap', FORWARD: 'Forward', NDF: 'NDF' } as const;
export const SETTLEMENT_LABEL = { CLS: 'CLS (PVP)', GROSS: 'Gross', CASH: 'Cash-settled' } as const;

export function direction(t: Pick<Trade, 'product' | 'side' | 'pair'>) {
  const base = PAIRS[t.pair].base;
  if (t.product === 'SWAP') return t.side === 'BUY' ? `Buy/Sell ${base}` : `Sell/Buy ${base}`;
  return `${t.side === 'BUY' ? 'Buy' : 'Sell'} ${base}`;
}
