import { useMemo, type ReactNode } from 'react';
import golden from '../data/golden.json';
import { spotDate, tenorDate, tomDate } from '../engine/calendar';
import { defaultState } from '../engine/defaults';
import { board, checkTrade } from '../engine/lines';
import { dfUsd } from '../engine/market';
import { makeCtx, srByDate, valueLeg } from '../engine/risk';
import { buildTrade, reducer } from '../engine/state';
import type { PairId, Ticket, Trade } from '../engine/types';
import { Calc } from './bits';
import { amt, day, mio, rate, signedAmt } from './format';
import { useLang } from './i18n';
import { Workings } from './Workings';

const M = 1_000_000;
const FAR_TENORS = ['SN', '1W', '1M', '2M', '3M', '6M', '9M', '1Y'] as const;
const EXAMPLE: Ticket = { product: 'SWAP', pair: 'EURUSD', side: 'BUY', amount: 20 * M, tenor: '3M', lpId: 'A-LDN-360T', settlement: 'AUTO' };
const LATER_SPOT = 1.1767; // 1% above the starting 1.1650

const T = {
  en: {
    three: 'One swap, three numbers',
    threeIntro: (n: string) => `Buy and sell back EUR ${n} mio against USD, spot to three months. Trade size is not the risk.`,
    size: ['Trade size', 'Exchanged, not at risk'],
    psr: ['Pre-settlement risk', 'Cost to replace it if the counterparty fails first'],
    sr: 'Settlement risk',
    srNote: (x: string) => `Through CLS. Settled gross: ${x} on each value date`,
    unit: 'USD mio. So each counterparty has two credit lines, and a hedge needs room on both.',
    method: 'The method',
    rows: [
      {
        title: 'Rates',
        text: 'A swap is priced as spot plus swap points. The points are the interest-rate gap between the two currencies, not a view on spot.',
        calcs: ['rate for a date = spot + swap points to that date', 'far ÷ near = (1 + r(quote) × t) ÷ (1 + r(base) × t)'],
      },
      {
        title: 'Market value',
        text: 'What the hedge is worth today. Zero when dealt; it moves with rates and with time.',
        calcs: ["leg value = amount × (today's rate − dealt rate) × USD discount factor"],
      },
      {
        title: 'Pre-settlement risk',
        text: "Today's value plus an add-on for how far it could still move. A swap counts on its far leg. A hedge counts in the pillar it matures in and in every shorter one.",
        calcs: [
          'exposure = max(market value + notional × add-on %, 0)',
          'with close-out netting: max(Σ market value + (0.4 + 0.6 × NGR) × Σ add-on, 0)',
          'NGR = max(Σ market value, 0) ÷ Σ max(market value, 0)',
        ],
      },
      {
        title: 'Settlement risk',
        text: 'What we are due to receive on a settlement day: lost if we pay and are not paid. Zero through CLS and for NDFs.',
        calcs: ['exposure on a date = amounts receivable that day, in USD at spot'],
      },
      {
        title: 'The check',
        text: 'A hedge goes out only if every pillar and date stays within its line. Sending reserves the room until the LP fills or rejects.',
        calcs: ["headroom = credit line − earlier days − today's fills − reservations"],
      },
    ],
    steps: 'The same swap, step by step',
    dealt: (d: string) => `The day it is dealt, ${d}`,
    later: (r: string) => `A week later, spot up 1% to ${r}`,
    laterText: (k: string, mv: string, a: string, b: string, c: string) =>
      `We sell EUR on the far leg at ${k}, now below the market. The market value is USD ${mv}, which offsets part of the add-on: exposure falls from ${a} to ${b}. Dealt the other way round it would have risen to ${c}.`,
    checked: 'Checked against QuantLib',
    checkedText: (v: string, n: string, ok: boolean) =>
      `The app calculates everything itself. As a check, ${v} computed ${n} reference values and the app ${ok ? 'reproduces all of them' : 'does not reproduce all of them'}, recomputed in your browser just now.`,
    head: ['Compared', 'Cases', 'Largest difference'],
    compared: ['Value dates', 'Outright rates', 'Discount factors', 'Market values'],
    none: 'none',
    dates: (n: number) => `${n} dates`,
    cent: 'under USD 0.01',
    more: 'Limits and sources',
    notes: [
      'Pre-settlement and settlement risk are credit rules, not pricing. They are tested against hand-worked cases, not a library.',
      'QuantLib has no Hong Kong or Taiwan lunar holidays after 2026, so USD/CNH and USD/TWD dates in 2027 ignore them.',
      'Net-to-gross ratio and add-on netting: Basel II framework, Annex 4 (current exposure method).',
      'Settlement risk as the amount bought: Basel Committee guidance on FX settlement risk (2013).',
      'Payment-versus-payment and eligible currencies: CLS Group.',
    ],
  },
  zh: {
    three: '一筆掉期，三個數字',
    threeIntro: (n: string) => `買入 EUR ${n} 百萬兌美元，三個月後賣回（即期起三個月）。交易金額不等於風險。`,
    size: ['交易金額', '交換的金額，不是風險'],
    psr: ['交割前風險', '對手先違約時，重新做這筆交易的成本'],
    sr: '結算風險',
    srNote: (x: string) => `經 CLS 交收為零。全額結算則每個交割日 ${x}`,
    unit: '單位：百萬美元。所以每個對手有兩條授信額度，一筆對沖兩條都要放得進。',
    method: '計算方法',
    rows: [
      {
        title: '匯率',
        text: '掉期按即期加掉期點定價。掉期點反映兩種貨幣的利差，不是對即期走勢的看法。',
        calcs: ['某日匯率 = 即期 + 至該日的掉期點', '遠端 ÷ 近端 = (1 + r(報價貨幣) × t) ÷ (1 + r(基礎貨幣) × t)'],
      },
      {
        title: '市值',
        text: '對沖今日值多少。成交時為零，其後隨匯率和時間變動。',
        calcs: ['每邊價值 = 金額 ×（今日匯率 − 成交匯率）× 美元折現因子'],
      },
      {
        title: '交割前風險',
        text: '今日市值，加上一個反映日後可能波動的附加金額。掉期以遠端計算。一筆對沖計入到期所在的期限檔，以及所有更短的期限檔。',
        calcs: [
          '風險敞口 = max(市值 + 名義本金 × 附加因子 %, 0)',
          '有終止淨額結算：max(Σ 市值 + (0.4 + 0.6 × NGR) × Σ 附加金額, 0)',
          'NGR = max(Σ 市值, 0) ÷ Σ max(市值, 0)',
        ],
      },
      {
        title: '結算風險',
        text: '交收日我方應收的金額：若我方已付而對手未付，就是損失。經 CLS 交收和 NDF 為零。',
        calcs: ['某日風險敞口 = 當日應收金額，按即期折算為美元'],
      },
      {
        title: '交易前檢查',
        text: '每個期限檔和每個交收日都不超出額度，對沖才可送出。送出時預佔額度，直至 LP 成交或拒絕。',
        calcs: ['可用額度 = 授信額度 − 往日交易 − 今日成交 − 預佔'],
      },
    ],
    steps: '同一筆掉期，逐步計算',
    dealt: (d: string) => `成交當日：${d}`,
    later: (r: string) => `一週後，即期上升 1% 至 ${r}`,
    laterText: (k: string, mv: string, a: string, b: string, c: string) =>
      `遠端我方以 ${k} 賣出 EUR，現已低於市價。市值為 USD ${mv}，抵銷了部分附加金額：風險敞口由 ${a} 降至 ${b}。若方向相反，則會升至 ${c}。`,
    checked: '與 QuantLib 核對',
    checkedText: (v: string, n: string, ok: boolean) =>
      `所有數字都由本程式自行計算。作為核對，${v} 另外算出 ${n} 個參考值，本程式${ok ? '全部重現' : '未能全部重現'}（剛在你的瀏覽器重新計算）。`,
    head: ['核對項目', '個數', '最大差異'],
    compared: ['交割日', '遠期匯率', '折現因子', '市值'],
    none: '無',
    dates: (n: number) => `${n} 個日期`,
    cent: '少於 USD 0.01',
    more: '限制與資料來源',
    notes: [
      '交割前風險和結算風險屬信貸規則，不是定價，因此以手算個案測試，而非程式庫。',
      'QuantLib 沒有 2026 年之後的香港和台灣農曆假期，因此 2027 年的 USD/CNH 和 USD/TWD 交割日未計這些假期。',
      '淨額對總額比率（NGR）與附加金額的淨額計算：巴塞爾協定二，附件四（現行風險暴露法）。',
      '結算風險以買入金額計：巴塞爾委員會外匯結算風險指引（2013）。',
      '同步交收及合資格貨幣：CLS Group。',
    ],
  },
} as const;

/** One swap, valued when dealt and again a week later after spot has risen 1%. */
function buildExample() {
  const s0 = defaultState();
  const ctx0 = makeCtx(s0);
  const trade = buildTrade(ctx0, EXAMPLE) as Trade;
  const check = checkTrade(ctx0, s0, trade);
  const ifGross = srByDate(ctx0, [{ ...trade, settlement: 'GROSS' }], false);

  let s1 = reducer(reducer(s0, { type: 'SEND', ticket: EXAMPLE }), { type: 'FILL', id: 'H1' });
  for (let i = 0; i < 5; i++) s1 = reducer(s1, { type: 'NEXT_DAY' });
  s1 = reducer(s1, { type: 'EDIT', change: (d) => void (d.market.pairs.EURUSD.spot = LATER_SPOT) });
  const ctx1 = makeCtx(s1);
  const measured1 = board(ctx1, s1, 'A').measured;
  return { s0, ctx0, trade, check, ifGross, s1, ctx1, measured1, filled: s1.trades[0], risk1: measured1.risks[0] };
}

/** Recompute every reference case with the app's engine and measure the gap to QuantLib. */
function compareWithQuantLib() {
  const rows = { dates: { cases: 0, worst: 0 }, rates: { cases: 0, worst: 0 }, dfs: { cases: 0, worst: 0 }, legs: { cases: 0, worst: 0 } };
  for (const row of golden.dates as Record<string, string>[]) {
    const pair = row.pair as PairId;
    const spot = spotDate(row.tradeDate, pair);
    const mine: Record<string, string> = { tom: tomDate(row.tradeDate, pair), spot };
    for (const t of FAR_TENORS) mine[t] = tenorDate(spot, t, pair);
    for (const key of Object.keys(mine)) {
      rows.dates.cases++;
      if (mine[key] !== row[key]) rows.dates.worst++;
    }
  }
  for (const sc of golden.scenarios) {
    const ctx = makeCtx({ ...defaultState(), businessDate: sc.businessDate });
    const track = (r: { cases: number; worst: number }, diff: number) => {
      r.cases++;
      r.worst = Math.max(r.worst, Math.abs(diff));
    };
    for (const f of sc.forwards) track(rows.rates, ctx.curve(f.pair as PairId).forward(f.date) - f.forward);
    for (const d of sc.dfs) track(rows.dfs, dfUsd(ctx.market, ctx.t0, d.date) - d.df);
    for (const leg of sc.legs) track(rows.legs, valueLeg(ctx, leg.pair as PairId, leg).mv - leg.mvUsd);
  }
  return { ...rows, version: golden.generatedWith };
}

function Method({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="method-row">
      <h3>{title}</h3>
      <div>{children}</div>
    </div>
  );
}

export function Formulae() {
  const lang = useLang();
  const t = T[lang];
  const ex = useMemo(buildExample, []);
  const cmp = useMemo(compareWithQuantLib, []);
  const [near, far] = ex.trade.legs;
  const total = cmp.dates.cases + cmp.rates.cases + cmp.dfs.cases + cmp.legs.cases;
  const allMatch = cmp.dates.worst === 0 && cmp.rates.worst < 1e-9 && cmp.dfs.worst < 1e-9 && cmp.legs.worst < 0.01;
  const gap = (x: number) => (x < 1e-9 ? t.none : x.toExponential(1));
  const results = [
    [cmp.dates.cases, cmp.dates.worst === 0 ? t.none : t.dates(cmp.dates.worst)],
    [cmp.rates.cases, gap(cmp.rates.worst)],
    [cmp.dfs.cases, gap(cmp.dfs.worst)],
    [cmp.legs.cases, cmp.legs.worst < 0.01 ? t.cent : `USD ${cmp.legs.worst.toFixed(2)}`],
  ];

  return (
    <div className="prose">
      <h2>{t.three}</h2>
      <p>{t.threeIntro(amt(EXAMPLE.amount / M))}</p>
      <div className="stats">
        <div className="stat">
          <span className="stat-label">{t.size[0]}</span>
          <span className="stat-value">{mio(ex.check.risk.notionalUsd)}</span>
          <span className="stat-note">{t.size[1]}</span>
        </div>
        <div className="stat">
          <span className="stat-label">{t.psr[0]}</span>
          <span className="stat-value">{mio(ex.check.risk.exposure)}</span>
          <span className="stat-note">{t.psr[1]}</span>
        </div>
        <div className="stat">
          <span className="stat-label">{t.sr}</span>
          <span className="stat-value">0</span>
          <span className="stat-note">{t.srNote(mio(ex.ifGross.get(near.date)!.exposure))}</span>
        </div>
      </div>
      <p className="quiet">{t.unit}</p>

      <h2>{t.method}</h2>
      <div className="method">
        {t.rows.map((r) => (
          <Method key={r.title} title={r.title}>
            <p>{r.text}</p>
            {r.calcs.map((c) => (
              <Calc key={c}>{c}</Calc>
            ))}
          </Method>
        ))}
      </div>

      <h2>{t.steps}</h2>
      <h3>{t.dealt(day(ex.s0.businessDate, lang))}</h3>
      <Workings ctx={ex.ctx0} trade={ex.trade} risk={ex.check.risk} measured={ex.check.after} group={ex.check.group} isNew />
      <h3>{t.later(rate('EURUSD', LATER_SPOT))}</h3>
      <p>
        {t.laterText(
          rate('EURUSD', far.rate),
          signedAmt(ex.risk1.mv),
          amt(ex.check.risk.exposure),
          amt(ex.risk1.exposure),
          amt(Math.max(-ex.risk1.mv + ex.risk1.addOn, 0)),
        )}
      </p>
      <Workings ctx={ex.ctx1} trade={ex.filled} risk={ex.risk1} measured={ex.measured1} group={ex.check.group} isNew={false} />

      <h2>{t.checked}</h2>
      <p>{t.checkedText(cmp.version, amt(total), allMatch)}</p>
      <div className="table-wrap">
        <table className="table compact">
          <thead>
            <tr>
              {t.head.map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {results.map(([cases, worst], i) => (
              <tr key={t.compared[i]}>
                <td>{t.compared[i]}</td>
                <td>{cases}</td>
                <td>{worst}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <details className="more">
        <summary>{t.more}</summary>
        <ul>
          {t.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      </details>
    </div>
  );
}
