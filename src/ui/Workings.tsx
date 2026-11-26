import type { ReactNode } from 'react';
import reference from '../data/reference.json';
import { PAIR_IDS, PAIRS, PILLARS, dayBeforeSpot, daysBetween, spotDate, tenorSteps, tomDate } from '../engine/calendar';
import type { Measured } from '../engine/lines';
import { RATE_NODES, usdPerUnit, usdRate, type FxCurve } from '../engine/market';
import { settlesGross, type Ctx, type TradeRisk } from '../engine/risk';
import type { Ccy, Group, ISODate, MarketData, PairId, Trade } from '../engine/types';
import { Calc } from './bits';
import { amt, day, num, partyName, pct, pips, rate, shortDay, signedAmt } from './format';
import { useLang, type Lang } from './i18n';

interface Props {
  ctx: Ctx;
  trade: Trade;
  risk: TradeRisk;
  measured: Measured; // the group's trades, including this one
  group: Group;
  isNew: boolean; // a ticket not yet sent: rates are today's, so their build-up can be shown
  openFrom?: number; // steps from this number on start open; none when left out
}

const T = {
  en: {
    and: ' and ',
    s1: 'Value dates',
    dealt: (d: string) => `Dealt on ${d}. The spot date is two business days later.`,
    toSpot: (d0: string, t1: string, spot: string, ccys: string) => `${d0} → ${t1} (a business day for ${ccys}) → ${spot} (a business day for ${ccys} and USD)`,
    on: (tom: string) => `Overnight swap: the near leg settles today and the far leg on the next business day, ${tom}.`,
    tn: (tom: string) => `Tom-next swap: the near leg settles tomorrow, ${tom}, and the far leg on the spot date.`,
    nearSpot: 'Near leg: the spot date',
    farIs: (swap: boolean, tenor: string, target: string) => `${swap ? 'Far leg' : 'Value date'}: spot + ${tenor} = ${target}`,
    stays: ', a business day',
    moved: (f: string) => `, not a business day → ${f}`,
    monthEnd: (f: string) => `. Spot is the last business day of its month, so this becomes the last business day of that month: ${f}`,
    s2: 'Rates',
    newRates: (pair: string, s: string) => `A new hedge is dealt at today's mid rates. Spot ${pair} is ${s}.`,
    oldSwap: (k1: string, k2: string, d: string) => `Dealt at ${k1} on the near leg and ${k2} on the far leg, fixed when the hedge was sent on ${d}.`,
    oldOutright: (k: string, d: string) => `Dealt at ${k}, fixed when the hedge was sent on ${d}.`,
    isSpot: (d: string, s: string) => `${d} is the spot date: rate = spot = ${s}`,
    beforeSpot: (d: string, tom: boolean, s: string, terms: string, pip: number, f: string) =>
      `${d} is ${tom ? 'tomorrow' : 'today'}, before spot, so points are taken off: ${s} − (${terms}) × ${pip} = ${f}`,
    quote: (d: string, tenor: string, p: string) => `Swap points to ${d}: the ${tenor} quote, ${p} pips`,
    between: (d: string, a: string, ad: string, ap: string, b: string, bd: string, bp: string, n: number, total: number) =>
      `Swap points to ${d}: ${n} of the ${total} days from ${a} (${ad}, ${ap} pips) to ${b} (${bd}, ${bp} pips)`,
    pipsWord: 'pips',
    spotWord: 'spot',
    rateIs: (s: string, p: string, pip: number, f: string) => `Rate = spot + points = ${s} + ${p} × ${pip} = ${f}`,
    meanTitle: 'What the points mean.',
    mean: (base: string, quote: string, days: number) =>
      `Swapping ${base} for ${quote} for ${days} ${days === 1 ? 'day' : 'days'} is lending one currency and borrowing the other, so the far rate differs from the near rate by the interest-rate gap (covered interest parity):`,
    parity: (q: string, b: string, days: number, bq: number, bb: number) => `far ÷ near = (1 + r(${q}) × ${days}/${bq}) ÷ (1 + r(${b}) × ${days}/${bb})`,
    usdBetween: (n: number, a: string, an: number, b: string, bn: number, calc: string) => `USD rate for ${n} days, between ${a} (${an} days) and ${b} (${bn} days): ${calc}`,
    usdFlat: (n: number, a: string, r: string) => `USD rate for ${n} days: the ${a} rate, ${r}`,
    s3: 'Cash flows',
    payments: (n: number) => `${n} payments`,
    netOnly: 'Net amount only',
    ndf: (d: string, k: string, base: string, a: string) =>
      `No principal changes hands. On ${d} the difference between ${k} and the fixing rate, on ${base} ${a}, is paid in USD as one net amount.`,
    flowHead: ['Date', 'We receive', 'We pay', 'At rate'],
    settled: ' (settled)',
    s4: 'Market value',
    legFormula: (divide: boolean) => `leg value = amount × (today's rate − dealt rate)${divide ? " ÷ today's rate" : ''} × discount factor`,
    sameRates: "Dealt at today's rates, so each leg starts at zero.",
    todaySpot: (pair: string, s: string) => `Today's spot ${pair} is ${s}. Each leg still to settle is revalued at today's rate for its date.`,
    allSettled: 'Every leg has settled.',
    df: (d: string, r: string, n: number, v: string) => `Discount factor to ${d} = 1 ÷ (1 + ${r} × ${n}/360) = ${v}`,
    legIs: (d: string, calc: string, v: string) => `Leg on ${d} = ${calc} = USD ${v}`,
    mvSum: (legs: string, mv: string) => `Market value = ${legs} = USD ${mv}`,
    s5: 'Add-on and exposure of this hedge',
    noPsr: 'The last leg settles today or has settled, so nothing is left to replace: no pre-settlement risk.',
    notional: (swap: boolean, base: string, a: string, fx: string | null, n: string) =>
      `Notional = ${swap ? 'far-leg ' : ''}amount at spot = ${base} ${a}${fx ? ` × ${fx}` : ''} = USD ${n}`,
    spans: ['', '7 days', '1 month', '3 months', '6 months', '12 months'],
    pillarOn: (end: string) => `O/N pillar: maturities up to the next working day, ${end}`,
    pillarEnd: (p: string, span: string, end: string) => `${p} pillar: maturities up to today + ${span} + 5 working days = ${end}`,
    pillarPick: (d: string, prev: string, prevEnd: string, p: string, pc: string) => `Matures ${d}, after the ${prev} pillar ends (${prevEnd}) → ${p} pillar → add-on ${pc}`,
    pillarFirst: (d: string, p: string, pc: string) => `Matures ${d} → ${p} pillar → add-on ${pc}`,
    pillarBeyond: (d: string, p: string, pc: string) => `Matures ${d}, beyond the longest pillar → counted in ${p} → add-on ${pc}`,
    addOn: (n: string, pc: string, a: string) => `Add-on = ${n} × ${pc} = USD ${a}`,
    exposure: (mv: string, a: string, mid: string, e: string, offset: boolean) =>
      offset
        ? `Exposure = max(market value + add-on, 0) = max(${mv} + ${a}, 0) = max(${mid}, 0) = USD ${e}`
        : `Exposure = max(market value, 0) + add-on = max(${mv}, 0) + ${a} = ${mid} + ${a} = USD ${e}`,
    negative: (offset: boolean) =>
      offset
        ? 'A negative market value reduces the add-on. This is the limit system’s method; the Basel standard method keeps the add-on in full.'
        : 'The standard method is switched on: a negative market value does not reduce the add-on, because the hedge could still turn positive before it matures.',
    s6: (g: string) => `Pre-settlement risk of ${g}`,
    s6Result: (p: string, e: string, l: string) => `${p}: USD ${e} of ${l}`,
    unchanged: 'Unchanged',
    counts: 'A hedge counts in its own pillar and in every shorter one: each pillar’s line caps the risk still open at that point, and this hedge is open at each of them.',
    netting: 'Close-out netting applies: market values offset and the add-on is scaled down.',
    noNetting: 'No close-out netting: exposures are added up.',
    fNgr: 'NGR = max(Σ market value, 0) ÷ Σ max(market value, 0)',
    fNet: 'net add-on = (0.4 + 0.6 × NGR) × gross add-on',
    fExp: (offset: boolean) => (offset ? 'exposure = max(Σ market value + net add-on, 0)' : 'exposure = max(Σ market value, 0) + net add-on'),
    fGross: (offset: boolean) => (offset ? 'exposure = Σ max(market value + add-on, 0), hedge by hedge' : 'exposure = Σ (max(market value, 0) + add-on), hedge by hedge'),
    sumOf: (p: string, list: string, e: string) => `${p} exposure = ${list} = USD ${e}`,
    sumMv: (list: string, s: string) => `Σ market value = ${list} = ${s}`,
    sumPos: (list: string, s: string) => `Σ max(market value, 0) = ${list} = ${s}`,
    sumAddOn: (list: string, s: string) => `gross add-on = ${list} = ${s}`,
    ngrIs: (s: string, pos: string, ngr: string) => `NGR = max(${s}, 0) ÷ ${pos} = ${ngr}`,
    ngrOne: 'no hedge has a positive market value, so NGR is taken as 1',
    netIs: (ngr: string, g: string, n: string) => `net add-on = (0.4 + 0.6 × ${ngr}) × ${g} = ${n}`,
    expIs: (s: string, n: string, mid: string, e: string, offset: boolean) =>
      offset ? `exposure = max(${s} + ${n}, 0) = max(${mid}, 0) = USD ${e}` : `exposure = max(${s}, 0) + ${n} = ${mid} + ${n} = USD ${e}`,
    psrAgainst: (p: string, l: string, e: string, rest: string, over: string | null) =>
      over ? `${p} line ${l} − ${e}: over by ${over}` : `${p} line ${l} − ${e} = ${rest} left`,
    psrHead: ['Pillar', 'Hedges counted', 'Σ market value', 'Gross add-on', 'NGR', 'Net add-on', 'Exposure', 'Line'],
    s7: (g: string) => `Settlement risk of ${g}`,
    atMost: (x: string) => `USD ${x} at most`,
    none: 'None',
    cls: "None. This hedge settles through CLS, where each side's payment is released only if the other's is (payment-versus-payment).",
    clsToday: 'The payment due today is too late for CLS, so it counts in full. The other leg goes through CLS and carries none.',
    cash: 'None. An NDF pays one net amount in USD; no principal is exchanged, so none can be lost in settlement.',
    gross: 'Settled gross: what we are due to receive on a date is lost if we pay and the counterparty does not.',
    payNet: 'Payment netting applies: same-currency flows on a date offset first.',
    noPayNet: 'No payment netting: every receivable is added up.',
    srHead: ['Currency', 'Amount', 'At spot', 'In USD'],
    thisHedge: 'this hedge',
    thisId: (id: string) => `${id} (this hedge)`,
    netBy: (list: string, e: string) => `Net by currency: ${list}; positive nets add to USD ${e}`,
    receivables: (list: string, e: string) => `Receivables: ${list} = USD ${e}`,
    against: (l: string, e: string, rest: string, over: string | null) => (over ? `Daily line ${l} − ${e}: over by ${over}` : `Daily line ${l} − ${e} = ${rest} left`),
    s8: (g: string) => `Gross notional on 360T today, with ${g}`,
    s8Result: (e: string, l: string) => `USD ${e} of ${l}`,
    notionalWhy: 'This hedge is sent on 360T, where a third line applies: the notional dealt with the counterparty there in one day. Every hedge counts at its full size. Buys and sells are added, not netted, and the count starts from zero each day.',
    notionalSize: (swap: boolean, base: string, a: string, fx: string | null, n: string) => `Size of this hedge = ${swap ? 'far-leg ' : ''}amount at spot = ${base} ${a}${fx ? ` × ${fx}` : ''} = USD ${n}`,
    notionalSum: (list: string, e: string) => `Gross notional today = ${list} = USD ${e}`,
  },
  zh: {
    and: '和',
    s1: '交割日',
    dealt: (d: string) => `${d} 成交。即期交割日是兩個營業日後。`,
    toSpot: (d0: string, t1: string, spot: string, ccys: string) => `${d0} → ${t1}（${ccys} 的營業日）→ ${spot}（${ccys} 和美元的營業日）`,
    on: (tom: string) => `隔夜掉期：近端今日交收，遠端在下一個營業日 ${tom} 交收。`,
    tn: (tom: string) => `T/N 掉期：近端明日（${tom}）交收，遠端在即期交割日交收。`,
    nearSpot: '近端：即期交割日',
    farIs: (swap: boolean, tenor: string, target: string) => `${swap ? '遠端' : '交割日'}：即期 + ${tenor} = ${target}`,
    stays: '，是營業日',
    moved: (f: string) => `，不是營業日 → ${f}`,
    monthEnd: (f: string) => `。即期是當月最後一個營業日，所以改為該月最後一個營業日：${f}`,
    s2: '匯率',
    newRates: (pair: string, s: string) => `新對沖按今日中間價成交。${pair} 即期為 ${s}。`,
    oldSwap: (k1: string, k2: string, d: string) => `近端成交匯率 ${k1}，遠端 ${k2}，於 ${d} 送出時鎖定。`,
    oldOutright: (k: string, d: string) => `成交匯率 ${k}，於 ${d} 送出時鎖定。`,
    isSpot: (d: string, s: string) => `${d} 是即期交割日：匯率 = 即期 = ${s}`,
    beforeSpot: (d: string, tom: boolean, s: string, terms: string, pip: number, f: string) =>
      `${d} 是${tom ? '明日' : '今日'}，早於即期交割日，所以減去掉期點：${s} − (${terms}) × ${pip} = ${f}`,
    quote: (d: string, tenor: string, p: string) => `至 ${d} 的掉期點：${tenor} 報價，${p} 點`,
    between: (d: string, a: string, ad: string, ap: string, b: string, bd: string, bp: string, n: number, total: number) =>
      `至 ${d} 的掉期點：由 ${a}（${ad}，${ap} 點）到 ${b}（${bd}，${bp} 點）共 ${total} 日，取第 ${n} 日`,
    pipsWord: '點',
    spotWord: '即期',
    rateIs: (s: string, p: string, pip: number, f: string) => `匯率 = 即期 + 掉期點 = ${s} + ${p} × ${pip} = ${f}`,
    meanTitle: '掉期點代表什麼。',
    mean: (base: string, quote: string, days: number) =>
      `${base} 與 ${quote} 掉期 ${days} 日，等於借出一種貨幣、借入另一種，所以遠端與近端匯率的差距就是兩者的利差（拋補利率平價）：`,
    parity: (q: string, b: string, days: number, bq: number, bb: number) => `遠端 ÷ 近端 = (1 + r(${q}) × ${days}/${bq}) ÷ (1 + r(${b}) × ${days}/${bb})`,
    usdBetween: (n: number, a: string, an: number, b: string, bn: number, calc: string) => `${n} 日的美元利率，介乎 ${a}（${an} 日）與 ${b}（${bn} 日）：${calc}`,
    usdFlat: (n: number, a: string, r: string) => `${n} 日的美元利率：取 ${a} 利率，${r}`,
    s3: '現金流',
    payments: (n: number) => `${n} 筆款項`,
    netOnly: '只付差額',
    ndf: (d: string, k: string, base: string, a: string) => `不交換本金。${d} 按 ${k} 與定盤價的差額（以 ${base} ${a} 計），以美元支付一筆淨額。`,
    flowHead: ['日期', '我方收取', '我方支付', '匯率'],
    settled: '（已交收）',
    s4: '市值',
    legFormula: (divide: boolean) => `每邊價值 = 金額 ×（今日匯率 − 成交匯率）${divide ? ' ÷ 今日匯率' : ''} × 折現因子`,
    sameRates: '按今日匯率成交，所以每邊的價值由零開始。',
    todaySpot: (pair: string, s: string) => `今日 ${pair} 即期為 ${s}。尚未交收的每一邊，按該日期的今日匯率重估。`,
    allSettled: '所有款項已交收。',
    df: (d: string, r: string, n: number, v: string) => `至 ${d} 的折現因子 = 1 ÷ (1 + ${r} × ${n}/360) = ${v}`,
    legIs: (d: string, calc: string, v: string) => `${d} 那一邊 = ${calc} = USD ${v}`,
    mvSum: (legs: string, mv: string) => `市值 = ${legs} = USD ${mv}`,
    s5: '本筆的附加金額與風險敞口',
    noPsr: '最後一邊今日交收或已交收，沒有需要重置的部分：沒有交割前風險。',
    notional: (swap: boolean, base: string, a: string, fx: string | null, n: string) =>
      `名義本金 = ${swap ? '遠端' : ''}金額按即期折算 = ${base} ${a}${fx ? ` × ${fx}` : ''} = USD ${n}`,
    spans: ['', '7 日', '1 個月', '3 個月', '6 個月', '12 個月'],
    pillarOn: (end: string) => `O/N 期限檔：到期日不遲於下一個工作日 ${end}`,
    pillarEnd: (p: string, span: string, end: string) => `${p} 期限檔：到期日不遲於今日 + ${span} + 5 個工作日 = ${end}`,
    pillarPick: (d: string, prev: string, prevEnd: string, p: string, pc: string) => `${d} 到期，遲於 ${prev} 期限檔的截止日（${prevEnd}）→ ${p} 期限檔 → 附加因子 ${pc}`,
    pillarFirst: (d: string, p: string, pc: string) => `${d} 到期 → ${p} 期限檔 → 附加因子 ${pc}`,
    pillarBeyond: (d: string, p: string, pc: string) => `${d} 到期，超出最長的期限檔 → 計入 ${p} → 附加因子 ${pc}`,
    addOn: (n: string, pc: string, a: string) => `附加金額 = ${n} × ${pc} = USD ${a}`,
    exposure: (mv: string, a: string, mid: string, e: string, offset: boolean) =>
      offset
        ? `風險敞口 = max(市值 + 附加金額, 0) = max(${mv} + ${a}, 0) = max(${mid}, 0) = USD ${e}`
        : `風險敞口 = max(市值, 0) + 附加金額 = max(${mv}, 0) + ${a} = ${mid} + ${a} = USD ${e}`,
    negative: (offset: boolean) =>
      offset ? '負市值會減少附加金額。這是額度系統的做法；巴塞爾的標準方法保留全部附加金額。' : '已改用標準方法：負市值不能減少附加金額，因為到期前市值仍可能轉正。',
    s6: (g: string) => `${g}的交割前風險`,
    s6Result: (p: string, e: string, l: string) => `${p}：USD ${e} / ${l}`,
    unchanged: '不變',
    counts: '一筆對沖計入自身的期限檔，以及所有更短的期限檔：每一檔限制的是到那時仍未到期的風險，而這筆對沖在每一檔都還未到期。',
    netting: '適用終止淨額結算：市值互相抵銷，附加金額按比例調低。',
    noNetting: '不適用終止淨額結算：各筆風險敞口直接相加。',
    fNgr: 'NGR = max(Σ 市值, 0) ÷ Σ max(市值, 0)',
    fNet: '淨附加金額 = (0.4 + 0.6 × NGR) × 附加金額總和',
    fExp: (offset: boolean) => (offset ? '風險敞口 = max(Σ 市值 + 淨附加金額, 0)' : '風險敞口 = max(Σ 市值, 0) + 淨附加金額'),
    fGross: (offset: boolean) => (offset ? '風險敞口 = Σ max(市值 + 附加金額, 0)，逐筆計算' : '風險敞口 = Σ (max(市值, 0) + 附加金額)，逐筆計算'),
    sumOf: (p: string, list: string, e: string) => `${p} 風險敞口 = ${list} = USD ${e}`,
    sumMv: (list: string, s: string) => `Σ 市值 = ${list} = ${s}`,
    sumPos: (list: string, s: string) => `Σ max(市值, 0) = ${list} = ${s}`,
    sumAddOn: (list: string, s: string) => `附加金額總和 = ${list} = ${s}`,
    ngrIs: (s: string, pos: string, ngr: string) => `NGR = max(${s}, 0) ÷ ${pos} = ${ngr}`,
    ngrOne: '沒有一筆市值為正，NGR 取 1',
    netIs: (ngr: string, g: string, n: string) => `淨附加金額 = (0.4 + 0.6 × ${ngr}) × ${g} = ${n}`,
    expIs: (s: string, n: string, mid: string, e: string, offset: boolean) =>
      offset ? `風險敞口 = max(${s} + ${n}, 0) = max(${mid}, 0) = USD ${e}` : `風險敞口 = max(${s}, 0) + ${n} = ${mid} + ${n} = USD ${e}`,
    psrAgainst: (p: string, l: string, e: string, rest: string, over: string | null) =>
      over ? `${p} 額度 ${l} − ${e}：超出 ${over}` : `${p} 額度 ${l} − ${e} = 尚餘 ${rest}`,
    psrHead: ['期限檔', '計入筆數', 'Σ 市值', '附加金額總和', 'NGR', '淨附加金額', '風險敞口', '額度'],
    s7: (g: string) => `${g}的結算風險`,
    atMost: (x: string) => `最高 USD ${x}`,
    none: '無',
    cls: '無。本筆經 CLS 交收：一方的款項只在對方款項到位時才放行（同步交收）。',
    clsToday: '當日交收的那一邊趕不上 CLS，計全額。另一邊經 CLS 交收，沒有結算風險。',
    cash: '無。NDF 只以美元支付一筆淨額，不交換本金，結算時不會損失本金。',
    gross: '全額結算：若我方已付款而對手未付，當日應收的款項就是損失。',
    payNet: '適用支付淨額結算：同日同幣種的款項先互相抵銷。',
    noPayNet: '不適用支付淨額結算：每筆應收直接相加。',
    srHead: ['貨幣', '金額', '按即期', '折美元'],
    thisHedge: '本筆',
    thisId: (id: string) => `${id}（本筆）`,
    netBy: (list: string, e: string) => `各幣種淨額：${list}；正數相加 = USD ${e}`,
    receivables: (list: string, e: string) => `應收：${list} = USD ${e}`,
    against: (l: string, e: string, rest: string, over: string | null) => (over ? `每日額度 ${l} − ${e}：超出 ${over}` : `每日額度 ${l} − ${e} = 尚餘 ${rest}`),
    s8: (g: string) => `今日在 360T 與${g}的名義金額總額`,
    s8Result: (e: string, l: string) => `USD ${e} / ${l}`,
    notionalWhy: '這筆對沖經 360T 送出。360T 多一條額度：每日與這個對手在 360T 成交的名義金額。每筆對沖按全額計，買賣相加，不互相抵銷；每日從零開始。',
    notionalSize: (swap: boolean, base: string, a: string, fx: string | null, n: string) => `本筆的金額 = ${swap ? '遠端' : ''}金額按即期折算 = ${base} ${a}${fx ? ` × ${fx}` : ''} = USD ${n}`,
    notionalSum: (list: string, e: string) => `今日名義金額總額 = ${list} = USD ${e}`,
  },
};

/** An outright rate with one digit more than a quoted one. */
const fineRate = (pair: PairId, x: number) => x.toFixed(PAIRS[pair].dp + 3);

/** A negative number in brackets, so it reads correctly inside a sum or a difference. */
const par = (x: string) => (x.startsWith('-') ? `(${x})` : x);

/** How an amount of a currency becomes USD at spot: '× 1.1650' or '÷ 7.1000'. */
function toUsd(market: MarketData, ccy: Ccy): string {
  for (const id of PAIR_IDS) {
    const p = PAIRS[id];
    if (p.quote === 'USD' && p.base === ccy) return `× ${market.pairs[id].spot.toFixed(p.dp)}`;
    if (p.base === 'USD' && p.quote === ccy) return `÷ ${market.pairs[id].spot.toFixed(p.dp)}`;
  }
  return '';
}

function Step(p: { title: string; result: ReactNode; open: boolean; children: ReactNode }) {
  return (
    <li>
      <details open={p.open}>
        <summary>
          <span className="step-title">{p.title}</span>
          <span className="step-result">{p.result}</span>
        </summary>
        <div className="step-body">{p.children}</div>
      </details>
    </li>
  );
}

/** How today's outright rate for one date is put together. */
function RateBuild({ ctx, pair, date, curve, lang }: { ctx: Ctx; pair: PairId; date: ISODate; curve: FxCurve; lang: Lang }) {
  const t = T[lang];
  const { spot: s, points } = ctx.market.pairs[pair];
  const pip = PAIRS[pair].pip;
  const f = curve.forward(date);
  const d = shortDay(date, lang);
  if (date === curve.spot) return <Calc>{t.isSpot(d, rate(pair, s))}</Calc>;
  if (date < curve.spot) {
    const isTom = date === curve.tom;
    const terms = [curve.tom < curve.spot ? `${num(points.TN, 2)} T/N` : '', isTom ? '' : `${num(points.ON, 2)} O/N`].filter(Boolean).join(' + ');
    return <Calc>{t.beforeSpot(d, isTom, rate(pair, s), terms, pip, rate(pair, f))}</Calc>;
  }
  const i = Math.max(1, curve.nodes.findIndex((n) => n.date >= date));
  const a = curve.nodes[i - 1];
  const b = curve.nodes[i];
  const ap = pips(pair, a.points);
  const bp = pips(pair, b.points);
  const n = daysBetween(a.date, date);
  const total = daysBetween(a.date, b.date);
  if (b.date === date) {
    return (
      <>
        <Calc>{t.quote(d, b.tenor, bp)}</Calc>
        <Calc>{t.rateIs(rate(pair, s), par(bp), pip, rate(pair, f))}</Calc>
      </>
    );
  }
  const p = num((f - s) / pip, 3);
  return (
    <>
      <Calc>{t.between(d, a.tenor === 'SPOT' ? t.spotWord : a.tenor, shortDay(a.date, lang), ap, b.tenor, shortDay(b.date, lang), bp, n, total)}</Calc>
      <Calc>
        {ap} + ({bp} − {par(ap)}) × {n}/{total} = {p} {t.pipsWord}
      </Calc>
      <Calc>{t.rateIs(rate(pair, s), par(p), pip, fineRate(pair, f))}</Calc>
    </>
  );
}

/** Where the USD rate for a number of days comes from. */
function UsdRate({ ctx, days, lang }: { ctx: Ctx; days: number; lang: Lang }) {
  const t = T[lang];
  const p = (x: number) => pct(x, 3);
  const r = p(usdRate(ctx.market, days));
  const i = RATE_NODES.findIndex(([, n]) => days <= n);
  if (i <= 0 || RATE_NODES[i][1] === days) return <Calc>{t.usdFlat(days, RATE_NODES[i < 0 ? RATE_NODES.length - 1 : i][0], r)}</Calc>;
  const [a, an] = RATE_NODES[i - 1];
  const [b, bn] = RATE_NODES[i];
  const ar = p(ctx.market.usdRates[a]);
  const br = p(ctx.market.usdRates[b]);
  return <Calc>{t.usdBetween(days, a, an, b, bn, `${ar} + (${br} − ${par(ar)}) × ${days - an}/${bn - an} = ${r}`)}</Calc>;
}

/** The interest rate in the other currency that the swap points imply. */
function ImpliedRate({ ctx, trade, curve, lang }: { ctx: Ctx; trade: Trade; curve: FxCurve; lang: Lang }) {
  const t = T[lang];
  const info = PAIRS[trade.pair];
  const far = trade.legs[trade.legs.length - 1];
  const startDate = trade.legs.length > 1 ? trade.legs[0].date : curve.spot;
  const startRate = trade.legs.length > 1 ? trade.legs[0].rate : ctx.market.pairs[trade.pair].spot;
  const days = daysBetween(startDate, far.date);
  if (days <= 0) return null;
  const basis = reference.dayCount as Record<Ccy, number>; // money-market day count: 360 or 365
  const rUsd = usdRate(ctx.market, days) / 100;
  const usdGrowth = 1 + (rUsd * days) / basis.USD;
  const usdIsQuote = info.quote === 'USD';
  const other = usdIsQuote ? info.base : info.quote;
  // Covered interest parity: far / near = (1 + r_quote t_quote) / (1 + r_base t_base)
  const ratio = far.rate / startRate;
  const otherGrowth = usdIsQuote ? usdGrowth / ratio : usdGrowth * ratio;
  const rOther = (otherGrowth - 1) * (basis[other] / days);
  return (
    <div className="aside-note">
      <p>
        <strong>{t.meanTitle}</strong> {t.mean(info.base, info.quote, days)}
      </p>
      <Calc>{t.parity(info.quote, info.base, days, basis[info.quote], basis[info.base])}</Calc>
      <Calc>
        {rate(trade.pair, far.rate)} ÷ {rate(trade.pair, startRate)} = {ratio.toFixed(6)}
      </Calc>
      <UsdRate ctx={ctx} days={days} lang={lang} />
      <Calc>
        1 + r(USD) × {days}/{basis.USD} = 1 + {pct(rUsd * 100, 3)} × {days}/{basis.USD} = {usdGrowth.toFixed(6)}
      </Calc>
      <Calc>
        1 + r({other}) × {days}/{basis[other]} = {usdGrowth.toFixed(6)} {usdIsQuote ? '÷' : '×'} {ratio.toFixed(6)} = {otherGrowth.toFixed(6)}
      </Calc>
      <Calc>
        r({other}) = ({otherGrowth.toFixed(6)} − 1) × {basis[other]}/{days} = {pct(rOther * 100)}
      </Calc>
    </div>
  );
}

export function Workings({ ctx, trade, risk, measured, group, isNew, openFrom }: Props) {
  const lang = useLang();
  const t = T[lang];
  const info = PAIRS[trade.pair];
  const curve = ctx.curve(trade.pair);
  const isSwap = trade.legs.length > 1;
  const near = isSwap ? trade.legs[0] : undefined;
  const far = trade.legs[trade.legs.length - 1];
  const spot = spotDate(trade.tradeDate, trade.pair);
  const tom = tomDate(trade.tradeDate, trade.pair);
  const fromSpot = trade.tenor === 'ON' || trade.tenor === 'TN' ? undefined : tenorSteps(spot, trade.tenor, trade.pair);
  const nonUsd = [info.base, info.quote].filter((c) => c !== 'USD').join(t.and);
  const baseUsd = usdPerUnit(ctx.market, info.base);
  const own = risk.pillar;
  const agg = own >= 0 ? measured.psr[own] : undefined;
  const counted = measured.risks.filter((x) => own >= 0 && x.pillar >= own);
  const srDays = trade.legs
    .filter((l) => l.date >= ctx.t0 && settlesGross(trade, l))
    .map((l) => measured.sr.get(l.date)!)
    .filter(Boolean);
  const who = (id: string) => (id === trade.id ? (isNew ? t.thisHedge : t.thisId(id)) : id);
  // Only a hedge dealt today on 360T is part of today's gross notional there.
  const inNotional = measured.notionalParts.some((x) => x.tradeId === trade.id);
  const g = partyName(group.name, lang);
  const r = (x: number) => rate(trade.pair, x);
  const today = (x: number) => (isNew ? r(x) : fineRate(trade.pair, x)); // today's rate for an old hedge lies between quotes
  const open = (n: number) => openFrom !== undefined && n >= openFrom;
  const list = (items: string[]) => items.join(' + ');
  const psrCols = group.closeOutNetting ? t.psrHead : t.psrHead.filter((_, i) => i !== 4 && i !== 5);

  return (
    <ol className="steps">
      <Step open={open(1)} title={t.s1} result={isSwap ? `${shortDay(near!.date, lang)} → ${shortDay(far.date, lang)}` : shortDay(far.date, lang)}>
        <p>{t.dealt(day(trade.tradeDate, lang))}</p>
        <Calc>{t.toSpot(day(trade.tradeDate, lang), day(dayBeforeSpot(trade.tradeDate, trade.pair), lang), day(spot, lang), nonUsd)}</Calc>
        {trade.tenor === 'ON' && <p>{t.on(day(tom, lang))}</p>}
        {trade.tenor === 'TN' && <p>{t.tn(day(tom, lang))}</p>}
        {fromSpot && (
          <>
            {isSwap && <Calc>{t.nearSpot}</Calc>}
            <Calc>
              {t.farIs(isSwap, trade.tenor, day(fromSpot.target, lang))}
              {fromSpot.monthEnd ? t.monthEnd(day(fromSpot.date, lang)) : fromSpot.date === fromSpot.target ? t.stays : t.moved(day(fromSpot.date, lang))}
            </Calc>
          </>
        )}
      </Step>

      <Step open={open(2)} title={t.s2} result={isSwap ? `${r(near!.rate)} / ${r(far.rate)}` : r(far.rate)}>
        {isNew ? (
          <>
            <p>{t.newRates(info.label, r(ctx.market.pairs[trade.pair].spot))}</p>
            {trade.legs.map((l) => (
              <div key={l.date} className="calc-group">
                <RateBuild ctx={ctx} pair={trade.pair} date={l.date} curve={curve} lang={lang} />
              </div>
            ))}
            <ImpliedRate ctx={ctx} trade={trade} curve={curve} lang={lang} />
          </>
        ) : (
          <p>{isSwap ? t.oldSwap(r(near!.rate), r(far.rate), day(trade.tradeDate, lang)) : t.oldOutright(r(far.rate), day(trade.tradeDate, lang))}</p>
        )}
      </Step>

      <Step open={open(3)} title={t.s3} result={trade.product === 'NDF' ? t.netOnly : t.payments(trade.legs.length * 2)}>
        {trade.product === 'NDF' ? (
          <p>{t.ndf(day(far.date, lang), r(far.rate), info.base, amt(Math.abs(far.base)))}</p>
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    {t.flowHead.map((h) => (
                      <th key={h}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {trade.legs.map((l) => {
                    const baseFlow = `${info.base} ${amt(Math.abs(l.base))}`;
                    const quoteFlow = `${info.quote} ${amt(Math.abs(l.base * l.rate))}`;
                    return (
                      <tr key={l.date} className={l.date < ctx.t0 ? 'muted-row' : undefined}>
                        <td>
                          {day(l.date, lang)}
                          {l.date < ctx.t0 && t.settled}
                        </td>
                        <td>{l.base > 0 ? baseFlow : quoteFlow}</td>
                        <td>{l.base > 0 ? quoteFlow : baseFlow}</td>
                        <td>{r(l.rate)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {trade.legs.map((l) => (
              <Calc key={l.date}>
                {shortDay(l.date, lang)}: {info.base} {amt(Math.abs(l.base))} × {r(l.rate)} = {info.quote} {amt(Math.abs(l.base * l.rate))}
              </Calc>
            ))}
          </>
        )}
      </Step>

      <Step open={open(4)} title={t.s4} result={`USD ${signedAmt(risk.mv)}`}>
        <Calc>{t.legFormula(info.quote !== 'USD')}</Calc>
        {risk.legs.length === 0 ? (
          <p>{t.allSettled}</p>
        ) : (
          <p>{isNew ? t.sameRates : t.todaySpot(info.label, r(ctx.market.pairs[trade.pair].spot))}</p>
        )}
        {risk.legs.map((l) => {
          const n = daysBetween(ctx.t0, l.date);
          return (
            <div key={l.date} className="calc-group">
              {!isNew && <RateBuild ctx={ctx} pair={trade.pair} date={l.date} curve={curve} lang={lang} />}
              {n > 0 && <UsdRate ctx={ctx} days={n} lang={lang} />}
              <Calc>{t.df(shortDay(l.date, lang), pct(usdRate(ctx.market, n), 3), n, l.df.toFixed(6))}</Calc>
              <Calc>
                {t.legIs(
                  shortDay(l.date, lang),
                  `${signedAmt(l.base)} × (${today(l.forward)} − ${r(l.rate)})${info.quote === 'USD' ? '' : ` ÷ ${today(l.forward)}`} × ${l.df.toFixed(6)}`,
                  signedAmt(l.mv),
                )}
              </Calc>
            </div>
          );
        })}
        {risk.legs.length > 1 && <Calc>{t.mvSum(list(risk.legs.map((l) => par(signedAmt(l.mv)))), signedAmt(risk.mv))}</Calc>}
      </Step>

      <Step open={open(5)} title={t.s5} result={`USD ${amt(risk.exposure)}`}>
        {own < 0 ? (
          <p>{t.noPsr}</p>
        ) : (
          <>
            <Calc>{t.notional(isSwap, info.base, amt(Math.abs(far.base)), info.base === 'USD' ? null : baseUsd.toFixed(info.dp), amt(risk.notionalUsd))}</Calc>
            <Calc>{own === 0 ? t.pillarOn(shortDay(ctx.pillarEnds[0], lang)) : t.pillarEnd(PILLARS[own], t.spans[own], shortDay(ctx.pillarEnds[own], lang))}</Calc>
            <Calc>
              {risk.maturity > ctx.pillarEnds[own]
                ? t.pillarBeyond(shortDay(risk.maturity, lang), PILLARS[own], pct(risk.addOnPct))
                : own === 0
                  ? t.pillarFirst(shortDay(risk.maturity, lang), PILLARS[own], pct(risk.addOnPct))
                  : t.pillarPick(shortDay(risk.maturity, lang), PILLARS[own - 1], shortDay(ctx.pillarEnds[own - 1], lang), PILLARS[own], pct(risk.addOnPct))}
            </Calc>
            <Calc>{t.addOn(amt(risk.notionalUsd), pct(risk.addOnPct), amt(risk.addOn))}</Calc>
            <Calc>
              {t.exposure(
                signedAmt(risk.mv),
                amt(risk.addOn),
                ctx.offsetNegativeMv ? signedAmt(risk.mv + risk.addOn) : amt(Math.max(risk.mv, 0)),
                amt(risk.exposure),
                ctx.offsetNegativeMv,
              )}
            </Calc>
            {risk.mv < -0.5 && <p className="note">{t.negative(ctx.offsetNegativeMv)}</p>}
          </>
        )}
      </Step>

      <Step open={open(6)} title={t.s6(g)} result={agg ? t.s6Result(PILLARS[own], amt(agg.exposure), amt(group.psrLines[own])) : t.unchanged}>
        <p>
          {t.counts} {group.closeOutNetting ? t.netting : t.noNetting}
        </p>
        {group.closeOutNetting ? (
          <>
            <Calc>{t.fNgr}</Calc>
            <Calc>{t.fNet}</Calc>
            <Calc>{t.fExp(ctx.offsetNegativeMv)}</Calc>
          </>
        ) : (
          <Calc>{t.fGross(ctx.offsetNegativeMv)}</Calc>
        )}
        {agg && (
          <div className="calc-group">
            {group.closeOutNetting ? (
              <>
                <Calc>{t.sumMv(list(counted.map((x) => `${who(x.trade.id)} ${par(signedAmt(x.mv))}`)), signedAmt(agg.sumMv))}</Calc>
                <Calc>{t.sumPos(list(counted.map((x) => amt(Math.max(x.mv, 0)))), amt(agg.sumPositiveMv))}</Calc>
                <Calc>{agg.sumPositiveMv > 0 ? t.ngrIs(signedAmt(agg.sumMv), amt(agg.sumPositiveMv), agg.ngr.toFixed(4)) : t.ngrOne}</Calc>
                <Calc>{t.sumAddOn(list(counted.map((x) => amt(x.addOn))), amt(agg.addOnGross))}</Calc>
                <Calc>{t.netIs(agg.ngr.toFixed(4), amt(agg.addOnGross), amt(agg.addOnNet))}</Calc>
                <Calc>
                  {t.expIs(
                    signedAmt(agg.sumMv),
                    amt(agg.addOnNet),
                    ctx.offsetNegativeMv ? signedAmt(agg.sumMv + agg.addOnNet) : amt(Math.max(agg.sumMv, 0)),
                    amt(agg.exposure),
                    ctx.offsetNegativeMv,
                  )}
                </Calc>
              </>
            ) : (
              <Calc>{t.sumOf(PILLARS[own], list(counted.map((x) => `${who(x.trade.id)} ${amt(x.exposure)}`)), amt(agg.exposure))}</Calc>
            )}
            <Calc>
              {t.psrAgainst(
                PILLARS[own],
                amt(group.psrLines[own]),
                amt(agg.exposure),
                amt(group.psrLines[own] - agg.exposure),
                agg.exposure <= group.psrLines[own] ? null : amt(agg.exposure - group.psrLines[own]),
              )}
            </Calc>
          </div>
        )}
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                {psrCols.map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {measured.psr.map((a, p) => (
                <tr key={PILLARS[p]} data-selected={p === own}>
                  <td>{PILLARS[p]}</td>
                  <td>{a.count}</td>
                  <td>{signedAmt(a.sumMv)}</td>
                  <td>{amt(a.addOnGross)}</td>
                  {group.closeOutNetting && <td>{a.ngr.toFixed(4)}</td>}
                  {group.closeOutNetting && <td>{amt(a.addOnNet)}</td>}
                  <td>{amt(a.exposure)}</td>
                  <td>{amt(group.psrLines[p])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Step>

      <Step open={open(7)} title={t.s7(g)} result={srDays.length ? t.atMost(amt(Math.max(...srDays.map((d) => d.exposure)))) : t.none}>
        {trade.settlement === 'CLS' && srDays.length === 0 && <p>{t.cls}</p>}
        {trade.settlement === 'CASH' && <p>{t.cash}</p>}
        {trade.settlement === 'GROSS' && srDays.length === 0 && <p>{t.allSettled}</p>}
        {srDays.length > 0 && (
          <>
            <p>
              {trade.settlement === 'CLS' ? t.clsToday : t.gross} {group.paymentNetting ? t.payNet : t.noPayNet}
            </p>
            {srDays.map((d) => {
              const net = new Map<string, number>();
              for (const f of d.flows) net.set(f.ccy, (net.get(f.ccy) ?? 0) + f.usd);
              return (
                <div key={d.date} className="calc-group">
                  <div className="table-wrap">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>{day(d.date, lang)}</th>
                          {t.srHead.map((h) => (
                            <th key={h}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {d.flows.map((f, i) => (
                          <tr key={i}>
                            <td>{who(f.tradeId)}</td>
                            <td>{f.ccy}</td>
                            <td>{signedAmt(f.amount)}</td>
                            <td>{toUsd(ctx.market, f.ccy as Ccy)}</td>
                            <td>{signedAmt(f.usd)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <Calc>
                    {group.paymentNetting
                      ? t.netBy([...net].map(([c, v]) => `${c} ${signedAmt(v)}`).join(', '), amt(d.exposure))
                      : t.receivables(
                          list(d.flows.filter((f) => f.usd > 0).map((f) => amt(f.usd))),
                          amt(d.exposure),
                        )}
                  </Calc>
                  <Calc>{t.against(amt(group.srLine), amt(d.exposure), amt(group.srLine - d.exposure), d.exposure <= group.srLine ? null : amt(d.exposure - group.srLine))}</Calc>
                </div>
              );
            })}
          </>
        )}
      </Step>

      {inNotional && (
        <Step open={open(8)} title={t.s8(g)} result={t.s8Result(amt(measured.notional), amt(group.notionalLine))}>
          <p>{t.notionalWhy}</p>
          <Calc>{t.notionalSize(isSwap, info.base, amt(Math.abs(far.base)), info.base === 'USD' ? null : baseUsd.toFixed(info.dp), amt(risk.notionalUsd))}</Calc>
          <Calc>{t.notionalSum(list(measured.notionalParts.map((x) => `${who(x.tradeId)} ${amt(x.usd)}`)), amt(measured.notional))}</Calc>
          <Calc>
            {t.against(
              amt(group.notionalLine),
              amt(measured.notional),
              amt(group.notionalLine - measured.notional),
              measured.notional <= group.notionalLine ? null : amt(measured.notional - group.notionalLine),
            )}
          </Calc>
        </Step>
      )}
    </ol>
  );
}
