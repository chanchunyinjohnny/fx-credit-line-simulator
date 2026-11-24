import type { ReactNode } from 'react';
import { PAIRS, PILLARS, daysBetween, spotDate, tomDate } from '../engine/calendar';
import type { Measured } from '../engine/lines';
import { usdPerUnit, usdRate, type FxCurve } from '../engine/market';
import type { Ctx, TradeRisk } from '../engine/risk';
import type { Group, ISODate, PairId, Trade } from '../engine/types';
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
}

const T = {
  en: {
    and: ' and ',
    s1: 'Value dates',
    dealt: (d: string, spot: string, ccys: string) =>
      `Dealt on ${d}. The spot date is two business days on: ${spot}. The day in between only has to be a business day for ${ccys}; the spot date itself must be a business day for ${ccys} and USD.`,
    on: (tom: string) => `Overnight swap: the near leg settles today and the far leg on the next business day, ${tom}.`,
    tn: (tom: string) => `Tom-next swap: the near leg settles tomorrow, ${tom}, and the far leg on the spot date.`,
    swapDates: (tenor: string, far: string) => `The near leg settles on the spot date. The far leg settles ${tenor} after spot: ${far}, moved to a business day where needed.`,
    outrightDate: (tenor: string, far: string) => `The value date is ${tenor} after spot: ${far}, moved to a business day where needed.`,
    s2: 'Rates',
    newRates: (pair: string, s: string) => `A new hedge is dealt at today's mid rates. Spot ${pair} is ${s}.`,
    oldSwap: (k1: string, k2: string, d: string) => `Dealt at ${k1} on the near leg and ${k2} on the far leg, fixed when the hedge was sent on ${d}.`,
    oldOutright: (k: string, d: string) => `Dealt at ${k}, fixed when the hedge was sent on ${d}.`,
    isSpot: (d: string, s: string) => `${d} is the spot date: rate = spot = ${s}`,
    beforeSpot: (d: string, tom: boolean, s: string, tn: string | null, on: string | null, f: string) =>
      `${d} is ${tom ? 'tomorrow' : 'today'}, before spot, so points are taken off: ${s}${tn ? ` − ${tn} (T/N)` : ''}${on ? ` − ${on} (O/N)` : ''} pips = ${f}`,
    quote: (d: string, tenor: string, p: string) => `Swap points to ${d}: the ${tenor} quote, ${p} pips`,
    between: (d: string, a: string, ad: string, ap: string, b: string, bd: string, bp: string, n: number, total: number, p: string) =>
      `Swap points to ${d}: between ${a} (${ad}, ${ap}) and ${b} (${bd}, ${bp}), ${n} of ${total} days along = ${p} pips`,
    spotWord: 'spot',
    rateIs: (s: string, p: string, pip: number, f: string) => `Rate = spot + points = ${s} + ${p} × ${pip} = ${f}`,
    meanTitle: 'What the points mean.',
    mean: (base: string, quote: string, days: number) =>
      `Swapping ${base} for ${quote} for ${days} days is lending one currency and borrowing the other, so the far rate differs from the near rate by the interest-rate gap (covered interest parity):`,
    parity: (q: string, b: string, days: number) => `far ÷ near = (1 + r(${q}) × t) ÷ (1 + r(${b}) × t), with t = ${days}/360`,
    implied: (far: string, near: string, ratio: string, rUsd: string, other: string, rOther: string) =>
      `${far} ÷ ${near} = ${ratio}; with USD at ${rUsd} this implies ${other} at ${rOther}`,
    s3: 'Cash flows',
    payments: (n: number) => `${n} payments`,
    netOnly: 'Net amount only',
    ndf: (d: string, k: string, base: string, a: string) =>
      `No principal changes hands. On ${d} the difference between ${k} and the fixing rate, on ${base} ${a}, is paid in USD as one net amount.`,
    flowHead: ['Date', 'We receive', 'We pay', 'At rate'],
    settled: ' (settled)',
    s4: 'Market value',
    legFormula: (divide: boolean) => `leg value = amount × (today's rate − dealt rate)${divide ? " ÷ today's rate" : ''} × discount factor`,
    allSettled: 'Every leg has settled.',
    df: (d: string, r: string, n: number, v: string) => `${d}: discount factor = 1 ÷ (1 + ${r} × ${n}/360) = ${v}`,
    mvSum: (mv: string) => `Market value = sum of the legs = USD ${mv}`,
    s5: 'Add-on and exposure of this hedge',
    noPsr: 'The last leg settles today or has settled, so nothing is left to replace: no pre-settlement risk.',
    notional: (swap: boolean, base: string, a: string, fx: string | null, n: string) =>
      `Notional = ${swap ? 'far-leg ' : ''}amount at spot = ${base} ${a}${fx ? ` × ${fx}` : ''} = USD ${n}`,
    pillar: (d: string, p: string, end: string, pc: string) => `Matures ${d} → ${p} pillar (maturities up to ${end}) → add-on ${pc}`,
    addOn: (n: string, pc: string, a: string) => `Add-on = ${n} × ${pc} = USD ${a}`,
    exposure: (mv: string, a: string, e: string) => `Exposure = max(market value + add-on, 0) = max(${mv} + ${a}, 0) = USD ${e}`,
    s6: (g: string) => `Pre-settlement risk of ${g}`,
    s6Result: (p: string, e: string, l: string) => `${p}: USD ${e} of ${l}`,
    unchanged: 'Unchanged',
    counts: 'A hedge counts in its own pillar and in every shorter one.',
    netting: 'Close-out netting applies: market values offset and the add-on is scaled down.',
    noNetting: 'No close-out netting: exposures are added up.',
    fNgr: 'NGR = max(Σ market value, 0) ÷ Σ max(market value, 0)',
    fNet: 'net add-on = (0.4 + 0.6 × NGR) × gross add-on',
    fExp: 'exposure = max(Σ market value + net add-on, 0)',
    fGross: 'exposure = Σ max(market value + add-on, 0), hedge by hedge',
    ngrOne: 'no hedge has a positive market value, so NGR is taken as 1',
    netIs: (ngr: string, g: string, n: string) => `net add-on = (0.4 + 0.6 × ${ngr}) × ${g} = ${n}`,
    expIs: (s: string, n: string, e: string) => `exposure = max(${s} + ${n}, 0) = USD ${e}`,
    psrHead: ['Pillar', 'Hedges counted', 'Σ market value', 'Gross add-on', 'NGR', 'Net add-on', 'Exposure', 'Line'],
    s7: (g: string) => `Settlement risk of ${g}`,
    atMost: (x: string) => `USD ${x} at most`,
    none: 'None',
    cls: "None. This hedge settles through CLS, where each side's payment is released only if the other's is (payment-versus-payment).",
    cash: 'None. An NDF pays one net amount in USD; no principal is exchanged, so none can be lost in settlement.',
    gross: 'Settled gross: what we are due to receive on a date is lost if we pay and the counterparty does not.',
    payNet: 'Payment netting applies: same-currency flows on a date offset first.',
    noPayNet: 'No payment netting: every receivable is added up.',
    srHead: ['Currency', 'Amount', 'USD at spot'],
    thisHedge: 'This hedge',
    thisId: (id: string) => `${id} (this hedge)`,
    netBy: (list: string, e: string) => `Net by currency: ${list}; positive nets add to USD ${e}`,
    receivables: (list: string, e: string) => `Receivables: ${list} = USD ${e}`,
    against: (l: string, over: string | null) => `Against the daily line of USD ${l}: ${over ? `over by ${over}` : 'within'}`,
  },
  zh: {
    and: '和',
    s1: '交割日',
    dealt: (d: string, spot: string, ccys: string) =>
      `${d} 成交。即期交割日是兩個營業日後：${spot}。中間那天只需是 ${ccys} 的營業日；即期交割日本身必須同時是 ${ccys} 和美元的營業日。`,
    on: (tom: string) => `隔夜掉期：近端今日交收，遠端在下一個營業日 ${tom} 交收。`,
    tn: (tom: string) => `T/N 掉期：近端明日（${tom}）交收，遠端在即期交割日交收。`,
    swapDates: (tenor: string, far: string) => `近端在即期交割日交收，遠端在即期後 ${tenor}：${far}，遇假期順延至營業日。`,
    outrightDate: (tenor: string, far: string) => `交割日是即期後 ${tenor}：${far}，遇假期順延至營業日。`,
    s2: '匯率',
    newRates: (pair: string, s: string) => `新對沖按今日中間價成交。${pair} 即期為 ${s}。`,
    oldSwap: (k1: string, k2: string, d: string) => `近端成交匯率 ${k1}，遠端 ${k2}，於 ${d} 送出時鎖定。`,
    oldOutright: (k: string, d: string) => `成交匯率 ${k}，於 ${d} 送出時鎖定。`,
    isSpot: (d: string, s: string) => `${d} 是即期交割日：匯率 = 即期 = ${s}`,
    beforeSpot: (d: string, tom: boolean, s: string, tn: string | null, on: string | null, f: string) =>
      `${d} 是${tom ? '明日' : '今日'}，早於即期交割日，所以減去掉期點：${s}${tn ? ` − ${tn}（T/N）` : ''}${on ? ` − ${on}（O/N）` : ''} 點 = ${f}`,
    quote: (d: string, tenor: string, p: string) => `至 ${d} 的掉期點：${tenor} 報價，${p} 點`,
    between: (d: string, a: string, ad: string, ap: string, b: string, bd: string, bp: string, n: number, total: number, p: string) =>
      `至 ${d} 的掉期點：介乎 ${a}（${ad}，${ap}）與 ${b}（${bd}，${bp}）之間，${total} 日中的第 ${n} 日 = ${p} 點`,
    spotWord: '即期',
    rateIs: (s: string, p: string, pip: number, f: string) => `匯率 = 即期 + 掉期點 = ${s} + ${p} × ${pip} = ${f}`,
    meanTitle: '掉期點代表什麼。',
    mean: (base: string, quote: string, days: number) =>
      `${base} 與 ${quote} 掉期 ${days} 日，等於借出一種貨幣、借入另一種，所以遠端與近端匯率的差距就是兩者的利差（拋補利率平價）：`,
    parity: (q: string, b: string, days: number) => `遠端 ÷ 近端 = (1 + r(${q}) × t) ÷ (1 + r(${b}) × t)，t = ${days}/360`,
    implied: (far: string, near: string, ratio: string, rUsd: string, other: string, rOther: string) =>
      `${far} ÷ ${near} = ${ratio}；美元利率 ${rUsd} 時，隱含 ${other} 利率 ${rOther}`,
    s3: '現金流',
    payments: (n: number) => `${n} 筆款項`,
    netOnly: '只付差額',
    ndf: (d: string, k: string, base: string, a: string) => `不交換本金。${d} 按 ${k} 與定盤價的差額（以 ${base} ${a} 計），以美元支付一筆淨額。`,
    flowHead: ['日期', '我方收取', '我方支付', '匯率'],
    settled: '（已交收）',
    s4: '市值',
    legFormula: (divide: boolean) => `每邊價值 = 金額 ×（今日匯率 − 成交匯率）${divide ? ' ÷ 今日匯率' : ''} × 折現因子`,
    allSettled: '所有款項已交收。',
    df: (d: string, r: string, n: number, v: string) => `${d}：折現因子 = 1 ÷ (1 + ${r} × ${n}/360) = ${v}`,
    mvSum: (mv: string) => `市值 = 兩邊相加 = USD ${mv}`,
    s5: '本筆的附加金額與風險敞口',
    noPsr: '最後一邊今日交收或已交收，沒有需要重置的部分：沒有交割前風險。',
    notional: (swap: boolean, base: string, a: string, fx: string | null, n: string) =>
      `名義本金 = ${swap ? '遠端' : ''}金額按即期折算 = ${base} ${a}${fx ? ` × ${fx}` : ''} = USD ${n}`,
    pillar: (d: string, p: string, end: string, pc: string) => `${d} 到期 → ${p} 期限檔（到期日不遲於 ${end}）→ 附加因子 ${pc}`,
    addOn: (n: string, pc: string, a: string) => `附加金額 = ${n} × ${pc} = USD ${a}`,
    exposure: (mv: string, a: string, e: string) => `風險敞口 = max(市值 + 附加金額, 0) = max(${mv} + ${a}, 0) = USD ${e}`,
    s6: (g: string) => `${g}的交割前風險`,
    s6Result: (p: string, e: string, l: string) => `${p}：USD ${e} / ${l}`,
    unchanged: '不變',
    counts: '一筆對沖計入自身的期限檔，以及所有更短的期限檔。',
    netting: '適用終止淨額結算：市值互相抵銷，附加金額按比例調低。',
    noNetting: '不適用終止淨額結算：各筆風險敞口直接相加。',
    fNgr: 'NGR = max(Σ 市值, 0) ÷ Σ max(市值, 0)',
    fNet: '淨附加金額 = (0.4 + 0.6 × NGR) × 附加金額總和',
    fExp: '風險敞口 = max(Σ 市值 + 淨附加金額, 0)',
    fGross: '風險敞口 = Σ max(市值 + 附加金額, 0)，逐筆計算',
    ngrOne: '沒有一筆市值為正，NGR 取 1',
    netIs: (ngr: string, g: string, n: string) => `淨附加金額 = (0.4 + 0.6 × ${ngr}) × ${g} = ${n}`,
    expIs: (s: string, n: string, e: string) => `風險敞口 = max(${s} + ${n}, 0) = USD ${e}`,
    psrHead: ['期限檔', '計入筆數', 'Σ 市值', '附加金額總和', 'NGR', '淨附加金額', '風險敞口', '額度'],
    s7: (g: string) => `${g}的結算風險`,
    atMost: (x: string) => `最高 USD ${x}`,
    none: '無',
    cls: '無。本筆經 CLS 交收：一方的款項只在對方款項到位時才放行（同步交收）。',
    cash: '無。NDF 只以美元支付一筆淨額，不交換本金，結算時不會損失本金。',
    gross: '全額結算：若我方已付款而對手未付，當日應收的款項就是損失。',
    payNet: '適用支付淨額結算：同日同幣種的款項先互相抵銷。',
    noPayNet: '不適用支付淨額結算：每筆應收直接相加。',
    srHead: ['貨幣', '金額', '按即期折美元'],
    thisHedge: '本筆',
    thisId: (id: string) => `${id}（本筆）`,
    netBy: (list: string, e: string) => `各幣種淨額：${list}；正數相加 = USD ${e}`,
    receivables: (list: string, e: string) => `應收：${list} = USD ${e}`,
    against: (l: string, over: string | null) => `對比每日額度 USD ${l}：${over ? `超出 ${over}` : '未超出'}`,
  },
};

function Step(p: { title: string; result: ReactNode; children: ReactNode }) {
  return (
    <li>
      <details>
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
    return <Calc>{t.beforeSpot(d, isTom, rate(pair, s), curve.tom < curve.spot ? num(points.TN, 2) : null, isTom ? null : num(points.ON, 2), rate(pair, f))}</Calc>;
  }
  const i = Math.max(1, curve.nodes.findIndex((n) => n.date >= date));
  const a = curve.nodes[i - 1];
  const b = curve.nodes[i];
  return (
    <>
      <Calc>
        {b.date === date
          ? t.quote(d, b.tenor, pips(pair, b.points))
          : t.between(
              d,
              a.tenor === 'SPOT' ? t.spotWord : a.tenor,
              shortDay(a.date, lang),
              pips(pair, a.points),
              b.tenor,
              shortDay(b.date, lang),
              pips(pair, b.points),
              daysBetween(a.date, date),
              daysBetween(a.date, b.date),
              pips(pair, f - s),
            )}
      </Calc>
      <Calc>{t.rateIs(rate(pair, s), pips(pair, f - s), pip, rate(pair, f))}</Calc>
    </>
  );
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
  const time = days / 360;
  const rUsd = usdRate(ctx.market, days) / 100;
  const usdIsQuote = info.quote === 'USD';
  // Covered interest parity: far / near = (1 + r_quote t) / (1 + r_base t)
  const ratio = far.rate / startRate;
  const rOther = usdIsQuote ? ((1 + rUsd * time) / ratio - 1) / time : ((1 + rUsd * time) * ratio - 1) / time;
  return (
    <div className="aside-note">
      <p>
        <strong>{t.meanTitle}</strong> {t.mean(info.base, info.quote, days)}
      </p>
      <Calc>{t.parity(info.quote, info.base, days)}</Calc>
      <Calc>
        {t.implied(rate(trade.pair, far.rate), rate(trade.pair, startRate), ratio.toFixed(6), pct(rUsd * 100), usdIsQuote ? info.base : info.quote, pct(rOther * 100))}
      </Calc>
    </div>
  );
}

export function Workings({ ctx, trade, risk, measured, group, isNew }: Props) {
  const lang = useLang();
  const t = T[lang];
  const info = PAIRS[trade.pair];
  const curve = ctx.curve(trade.pair);
  const isSwap = trade.legs.length > 1;
  const near = isSwap ? trade.legs[0] : undefined;
  const far = trade.legs[trade.legs.length - 1];
  const spot = spotDate(trade.tradeDate, trade.pair);
  const tom = tomDate(trade.tradeDate, trade.pair);
  const nonUsd = [info.base, info.quote].filter((c) => c !== 'USD').join(t.and);
  const baseUsd = usdPerUnit(ctx.market, info.base);
  const own = risk.pillar;
  const agg = own >= 0 ? measured.psr[own] : undefined;
  const legDates = trade.legs.filter((l) => l.date >= ctx.t0).map((l) => l.date);
  const srDays = trade.settlement === 'GROSS' ? legDates.map((d) => measured.sr.get(d)!).filter(Boolean) : [];
  const who = (id: string) => (id === trade.id ? (isNew ? t.thisHedge : t.thisId(id)) : id);
  const g = partyName(group.name, lang);
  const r = (x: number) => rate(trade.pair, x);
  const psrCols = group.closeOutNetting ? t.psrHead : t.psrHead.filter((_, i) => i !== 4 && i !== 5);

  return (
    <ol className="steps">
      <Step title={t.s1} result={isSwap ? `${shortDay(near!.date, lang)} → ${shortDay(far.date, lang)}` : shortDay(far.date, lang)}>
        <p>{t.dealt(day(trade.tradeDate, lang), day(spot, lang), nonUsd)}</p>
        <p>
          {trade.tenor === 'ON'
            ? t.on(day(tom, lang))
            : trade.tenor === 'TN'
              ? t.tn(day(tom, lang))
              : isSwap
                ? t.swapDates(trade.tenor, day(far.date, lang))
                : t.outrightDate(trade.tenor, day(far.date, lang))}
        </p>
      </Step>

      <Step title={t.s2} result={isSwap ? `${r(near!.rate)} / ${r(far.rate)}` : r(far.rate)}>
        {isNew ? (
          <>
            <p>{t.newRates(info.label, r(ctx.market.pairs[trade.pair].spot))}</p>
            {trade.legs.map((l) => (
              <RateBuild key={l.date} ctx={ctx} pair={trade.pair} date={l.date} curve={curve} lang={lang} />
            ))}
            <ImpliedRate ctx={ctx} trade={trade} curve={curve} lang={lang} />
          </>
        ) : (
          <p>{isSwap ? t.oldSwap(r(near!.rate), r(far.rate), day(trade.tradeDate, lang)) : t.oldOutright(r(far.rate), day(trade.tradeDate, lang))}</p>
        )}
      </Step>

      <Step title={t.s3} result={trade.product === 'NDF' ? t.netOnly : t.payments(trade.legs.length * 2)}>
        {trade.product === 'NDF' ? (
          <p>{t.ndf(day(far.date, lang), r(far.rate), info.base, amt(Math.abs(far.base)))}</p>
        ) : (
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
        )}
      </Step>

      <Step title={t.s4} result={`USD ${signedAmt(risk.mv)}`}>
        <Calc>{t.legFormula(info.quote !== 'USD')}</Calc>
        {risk.legs.length === 0 && <p>{t.allSettled}</p>}
        {risk.legs.map((l) => {
          const n = daysBetween(ctx.t0, l.date);
          return (
            <div key={l.date} className="calc-group">
              <Calc>{t.df(shortDay(l.date, lang), pct(usdRate(ctx.market, n), 3), n, l.df.toFixed(6))}</Calc>
              <Calc>
                {signedAmt(l.base)} × ({r(l.forward)} − {r(l.rate)}){info.quote === 'USD' ? '' : ` ÷ ${r(l.forward)}`} × {l.df.toFixed(6)} = USD {signedAmt(l.mv)}
              </Calc>
            </div>
          );
        })}
        {risk.legs.length > 1 && <Calc>{t.mvSum(signedAmt(risk.mv))}</Calc>}
      </Step>

      <Step title={t.s5} result={`USD ${amt(risk.exposure)}`}>
        {own < 0 ? (
          <p>{t.noPsr}</p>
        ) : (
          <>
            <Calc>{t.notional(isSwap, info.base, amt(Math.abs(far.base)), info.base === 'USD' ? null : baseUsd.toFixed(info.dp), amt(risk.notionalUsd))}</Calc>
            <Calc>{t.pillar(shortDay(risk.maturity, lang), PILLARS[own], shortDay(ctx.pillarEnds[own], lang), pct(risk.addOnPct))}</Calc>
            <Calc>{t.addOn(amt(risk.notionalUsd), pct(risk.addOnPct), amt(risk.addOn))}</Calc>
            <Calc>{t.exposure(signedAmt(risk.mv), amt(risk.addOn), amt(risk.exposure))}</Calc>
          </>
        )}
      </Step>

      <Step title={t.s6(g)} result={agg ? t.s6Result(PILLARS[own], amt(agg.exposure), amt(group.psrLines[own])) : t.unchanged}>
        <p>
          {t.counts} {group.closeOutNetting ? t.netting : t.noNetting}
        </p>
        {group.closeOutNetting ? (
          <>
            <Calc>{t.fNgr}</Calc>
            <Calc>{t.fNet}</Calc>
            <Calc>{t.fExp}</Calc>
          </>
        ) : (
          <Calc>{t.fGross}</Calc>
        )}
        {agg && group.closeOutNetting && (
          <div className="calc-group">
            <Calc>
              {PILLARS[own]}: {agg.sumPositiveMv > 0 ? `NGR = max(${signedAmt(agg.sumMv)}, 0) ÷ ${amt(agg.sumPositiveMv)} = ${agg.ngr.toFixed(4)}` : t.ngrOne}
            </Calc>
            <Calc>{t.netIs(agg.ngr.toFixed(4), amt(agg.addOnGross), amt(agg.addOnNet))}</Calc>
            <Calc>{t.expIs(signedAmt(agg.sumMv), amt(agg.addOnNet), amt(agg.exposure))}</Calc>
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

      <Step title={t.s7(g)} result={srDays.length ? t.atMost(amt(Math.max(...srDays.map((d) => d.exposure)))) : t.none}>
        {trade.settlement === 'CLS' && <p>{t.cls}</p>}
        {trade.settlement === 'CASH' && <p>{t.cash}</p>}
        {trade.settlement === 'GROSS' && srDays.length === 0 && <p>{t.allSettled}</p>}
        {trade.settlement === 'GROSS' && srDays.length > 0 && (
          <>
            <p>
              {t.gross} {group.paymentNetting ? t.payNet : t.noPayNet}
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
                          d.flows
                            .filter((f) => f.usd > 0)
                            .map((f) => amt(f.usd))
                            .join(' + '),
                          amt(d.exposure),
                        )}
                  </Calc>
                  <Calc>{t.against(amt(group.srLine), d.exposure <= group.srLine ? null : amt(d.exposure - group.srLine))}</Calc>
                </div>
              );
            })}
          </>
        )}
      </Step>
    </ol>
  );
}
