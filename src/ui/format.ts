import { PAIRS } from '../engine/calendar';
import type { ISODate, PairId, Trade } from '../engine/types';
import type { Lang } from './i18n';

const clean = (n: number) => (Math.abs(n) < 1e-9 ? 0 : n);

export const num = (n: number, dp = 0) =>
  clean(Number(n.toFixed(dp))).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
/** Whole amount. */
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
const WEEKDAYS_ZH = '日一二三四五六';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const weekday = (d: ISODate) => new Date(`${d}T00:00:00Z`).getUTCDay();
/** 'Wed 02 Dec 2026' or '2026年12月2日（週三）' */
export const day = (d: ISODate, lang: Lang) =>
  lang === 'zh'
    ? `${d.slice(0, 4)}年${+d.slice(5, 7)}月${+d.slice(8, 10)}日（週${WEEKDAYS_ZH[weekday(d)]}）`
    : `${WEEKDAYS[weekday(d)]} ${d.slice(8, 10)} ${MONTHS[+d.slice(5, 7) - 1]} ${d.slice(0, 4)}`;
/** '02 Dec 26' or '2026/12/02' */
export const shortDay = (d: ISODate, lang: Lang) =>
  lang === 'zh' ? d.replaceAll('-', '/') : `${d.slice(8, 10)} ${MONTHS[+d.slice(5, 7) - 1]} ${d.slice(2, 4)}`;

export const PRODUCT_LABEL = {
  en: { SWAP: 'FX swap', FORWARD: 'Forward', NDF: 'NDF' },
  zh: { SWAP: '外匯掉期', FORWARD: '遠期', NDF: 'NDF' },
} as const;
export const SETTLEMENT_LABEL = {
  en: { CLS: 'CLS (PVP)', GROSS: 'Gross', CASH: 'Cash-settled' },
  zh: { CLS: 'CLS（同步交收）', GROSS: '全額結算', CASH: '現金差額結算' },
} as const;

export function direction(t: Pick<Trade, 'product' | 'side' | 'pair'>, lang: Lang) {
  const base = PAIRS[t.pair].base;
  const buy = t.side === 'BUY';
  if (lang === 'zh') return t.product === 'SWAP' ? `${buy ? '買/賣' : '賣/買'} ${base}` : `${buy ? '買入' : '賣出'} ${base}`;
  return t.product === 'SWAP' ? `${buy ? 'Buy/Sell' : 'Sell/Buy'} ${base}` : `${buy ? 'Buy' : 'Sell'} ${base}`;
}

/** The invented counterparty names, in the reader's language. */
export function partyName(name: string, lang: Lang) {
  if (lang === 'en') return name;
  const m = /^Bank (\w+)(?: (Group|London|Frankfurt))?$/.exec(name);
  if (!m) return name;
  const suffix = { Group: '銀行集團', London: '銀行（倫敦）', Frankfurt: '銀行（法蘭克福）' }[m[2] as 'Group'] ?? '銀行';
  return `${m[1]} ${suffix}`;
}
