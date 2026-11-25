import { useMemo, type ReactNode } from 'react';
import golden from '../data/golden.json';
import { spotDate, tenorDate, tomDate } from '../engine/calendar';
import { defaultState } from '../engine/defaults';
import { CHANNELS } from '../engine/channels';
import { board, channelFill, checkTrade, maxChannelLimit } from '../engine/lines';
import { dfUsd } from '../engine/market';
import { makeCtx, srByDate, valueLeg } from '../engine/risk';
import { buildTrade, reducer } from '../engine/state';
import type { PairId, Ticket, Trade } from '../engine/types';
import { Calc } from './bits';
import { amt, day, mio, partyName, rate, signedAmt } from './format';
import { useLang } from './i18n';
import { Workings } from './Workings';

const M = 1_000_000;
const FAR_TENORS = ['SN', '1W', '1M', '2M', '3M', '6M', '9M', '1Y'] as const;
const EXAMPLE: Ticket = { product: 'SWAP', pair: 'EURUSD', side: 'BUY', amount: 20 * M, tenor: '3M', lpId: 'A-LDN-360T', settlement: 'AUTO' };
const LATER_SPOT = 1.1767; // 1% above the starting 1.1650
const CHANNEL_ORDER: Ticket = { product: 'NDF', pair: 'USDTWD', side: 'BUY', amount: 20 * M, tenor: '1M', lpId: 'B-EBSM', settlement: 'AUTO' };

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
        text: "Today's value if it is positive, plus an add-on for how far it could still move. A swap counts on its far leg. A hedge counts in the pillar it matures in and in every shorter one.",
        calcs: [
          'exposure = max(market value, 0) + notional × add-on %',
          'with close-out netting: max(Σ market value, 0) + (0.4 + 0.6 × NGR) × Σ add-on',
          'NGR = max(Σ market value, 0) ÷ Σ max(market value, 0)',
        ],
      },
      {
        title: 'Settlement risk',
        text: 'What we are due to receive on a settlement day: lost if we pay and are not paid. Zero through CLS and for NDFs. A payment due on the day it is dealt always counts in full.',
        calcs: ['exposure on a date = amounts receivable that day, in USD at spot'],
      },
      {
        title: 'The check',
        text: 'A hedge goes out only if every pillar and date stays within its line. Sending reserves the room until the LP fills or rejects. With no answer after 5 seconds the venue is asked, and the room stays reserved until it confirms no trade.',
        calcs: ["headroom = credit line − earlier days − today's fills − reservations − room held for channels"],
      },
      {
        title: 'A channel that checks credit itself',
        text: 'An order book matches first and names the counterparty afterwards, so the desk cannot check each trade. It sets a limit on the channel and holds room for all the channel could still fill. A fill moves from held to in use, on the same line. The channel counts notional and starts again each day, so the limit is recomputed every morning.',
        calcs: ['room held = channel limit left × add-on % of the longest order sent there', 'largest limit = filled today + free room on the line ÷ add-on %'],
      },
    ],
    steps: 'The same swap, step by step',
    ch: 'A channel limit, step by step',
    chIntro: (ch: string, g: string) => `${ch} with ${g}. The desk sends one order there: USD/TWD NDF, 1M.`,
    chSteps: ['Room held this morning', 'The channel fills an order', 'The largest limit the line can hold', 'The next morning'],
    chLimit: (l: string) => `channel limit = USD ${l} of notional`,
    chHeld: (left: string, pct: string, held: string, to: string) => `room held = ${left} × ${pct}% = USD ${held}, on the ${to} line and every shorter one`,
    chRoom: (p: string, line: string, used: string, held: string, rest: string) => `${p} line ${line} − ${used} in use − ${held} held = ${rest} left`,
    chFillIs: (size: string, pct: string, e: string) => `the fill: USD ${size}. In use = max(0, 0) + ${size} × ${pct}% = USD ${e}`,
    chLeft: (limit: string, filled: string, left: string) => `limit left = ${limit} − ${filled} = ${left}`,
    chTotal: (used: string, held: string, total: string) => `in use + held = ${used} + ${held} = ${total}: the same as before the fill`,
    chTight: (p: string, line: string, used: string, room: string) => `tightest line up to 1M: ${p}, ${line} − ${used} in use = ${room} free`,
    chMax: (filled: string, room: string, pct: string, max: string) => `largest limit = ${filled} + ${room} ÷ ${pct}% = USD ${max}`,
    chNext: (limit: string) => `The channel starts counting again, so it can fill USD ${limit} once more. Yesterday's fill is still in use.`,
    chWhy: 'Without a new look each morning the two would add up unnoticed. The app lowers a limit that the line can no longer hold.',
    dealt: (d: string) => `The day it is dealt, ${d}`,
    later: (r: string) => `A week later, spot up 1% to ${r}`,
    laterText: (k: string, mv: string, a: string, c: string) =>
      `We sell EUR on the far leg at ${k}, now below the market, so the market value is USD ${mv}. A negative value does not reduce the add-on, because the hedge could still turn positive: exposure is the add-on, ${a}. Dealt the other way round the value would be positive and exposure ${c}.`,
    checked: 'Checked against QuantLib',
    checkedText: (v: string, n: string, ok: boolean) =>
      `The app calculates everything itself. As a check, ${v} computed ${n} reference values and the app ${ok ? 'reproduces all of them' : 'does not reproduce all of them'}, recomputed in your browser just now.`,
    head: ['Compared', 'Cases', 'Largest difference'],
    compared: ['Value dates', 'Outright rates', 'Discount factors', 'Market values'],
    none: 'none',
    dates: (n: number) => `${n} dates`,
    cent: 'under USD 0.01',
    more: 'Assumptions, limits and sources',
    notes: [
      'Pre-settlement and settlement risk are credit rules, not pricing. They are tested against hand-worked cases, not a library.',
      'Exposure floors the market value at zero before adding the add-on, as in the Basel current exposure method and the OCC handbook on derivatives. Some internal limit systems let a negative value reduce the add-on; a setting under "Credit lines and add-ons" switches to that form.',
      'Net-to-gross ratio and add-on netting: Basel II framework, Annex 4. With no positive market value the ratio is taken as 1, as the US swap margin rule does for the same formula.',
      'Settlement risk is what is due to be received, counted on the value date only. This is the common convention for a daily settlement limit: 52% of institutions in the 2006 CPSS survey measured it this way. Basel (2013) and the HKMA (TA-2) define the exposure as running from when our payment can no longer be cancelled until receipt is confirmed. That took 26 hours on average in the survey, so one day can understate it.',
      'CLS has 18 eligible currencies, without CNH or TWD. Instructions are due by 00:00 CET on the value date, so a payment due on the day it is dealt always counts in full. The other leg can still go through CLS.',
      'The implied interest rate uses Actual/365 for GBP and Actual/360 for USD, EUR, JPY and CNH. Actual/365 for TWD is not confirmed.',
      'QuantLib has no Hong Kong or Taiwan lunar holidays after 2026, so USD/CNH and USD/TWD dates in 2027 ignore them.',
      'EBS Market matches orders only where both sides hold credit for each other on the platform, and names the counterparty after the trade (EBS Dealing Rules, EBS Market appendix; EBS disclosure cover sheet). Sizing the room held by one add-on, and a single order type per channel, are simplifications of this app.',
      'Every assumption is listed in the design notes in the source repository.',
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
        text: '今日市值（為正數時），加上一個反映日後可能波動的附加金額。掉期以遠端計算。一筆對沖計入到期所在的期限檔，以及所有更短的期限檔。',
        calcs: [
          '風險敞口 = max(市值, 0) + 名義本金 × 附加因子 %',
          '有終止淨額結算：max(Σ 市值, 0) + (0.4 + 0.6 × NGR) × Σ 附加金額',
          'NGR = max(Σ 市值, 0) ÷ Σ max(市值, 0)',
        ],
      },
      {
        title: '結算風險',
        text: '交收日我方應收的金額：若我方已付而對手未付，就是損失。經 CLS 交收和 NDF 為零。當日交收的款項一律計全額。',
        calcs: ['某日風險敞口 = 當日應收金額，按即期折算為美元'],
      },
      {
        title: '交易前檢查',
        text: '每個期限檔和每個交收日都不超出額度，對沖才可送出。送出時預佔額度，直至 LP 成交或拒絕。LP 5 秒內沒有回覆，就向場地查詢；確認沒有成交才釋放。',
        calcs: ['可用額度 = 授信額度 − 往日交易 − 今日成交 − 預佔 − 場地切片'],
      },
      {
        title: '自行檢查額度的場地',
        text: '訂單簿先撮合，成交後才知道對手，交易台不能逐筆檢查。交易台在場地設一個限額，並為場地還能成交的全部金額預留額度。成交後，這部分由場地切片轉為已用，記在同一條額度上。場地按名義金額計數，每日重新開始，所以每朝要重算限額。',
        calcs: ['場地切片 = 場地尚餘限額 × 送往該場地最長期限訂單的附加因子 %', '限額上限 = 今日已成交 + 額度上的空間 ÷ 附加因子 %'],
      },
    ],
    steps: '同一筆掉期，逐步計算',
    ch: '場地限額，逐步計算',
    chIntro: (ch: string, g: string) => `${ch} 對 ${g}。交易台只送一種訂單到這個場地：USD/TWD NDF，1M。`,
    chSteps: ['今朝預留的額度', '場地成交一張訂單', '額度最多放得下多大的限額', '翌日早上'],
    chLimit: (l: string) => `場地限額 = 名義金額 USD ${l}`,
    chHeld: (left: string, pct: string, held: string, to: string) => `場地切片 = ${left} × ${pct}% = USD ${held}，佔 ${to} 及所有更短的期限檔`,
    chRoom: (p: string, line: string, used: string, held: string, rest: string) => `${p} 額度 ${line} − 已用 ${used} − 場地切片 ${held} = 尚餘 ${rest}`,
    chFillIs: (size: string, pct: string, e: string) => `成交 USD ${size}。已用 = max(0, 0) + ${size} × ${pct}% = USD ${e}`,
    chLeft: (limit: string, filled: string, left: string) => `尚餘限額 = ${limit} − ${filled} = ${left}`,
    chTotal: (used: string, held: string, total: string) => `已用 + 場地切片 = ${used} + ${held} = ${total}：與成交前相同`,
    chTight: (p: string, line: string, used: string, room: string) => `1M 以內最緊的額度：${p}，${line} − 已用 ${used} = 空間 ${room}`,
    chMax: (filled: string, room: string, pct: string, max: string) => `限額上限 = ${filled} + ${room} ÷ ${pct}% = USD ${max}`,
    chNext: (limit: string) => `場地重新計數，所以可以再成交 USD ${limit}。昨日的成交仍然佔用額度。`,
    chWhy: '如果每朝不重新計算，兩者會不知不覺地疊加。額度放不下時，本程式會調低限額。',
    dealt: (d: string) => `成交當日：${d}`,
    later: (r: string) => `一週後，即期上升 1% 至 ${r}`,
    laterText: (k: string, mv: string, a: string, c: string) =>
      `遠端我方以 ${k} 賣出 EUR，現已低於市價，所以市值是 USD ${mv}。負市值不能減少附加金額，因為到期前市值仍可能轉正：風險敞口就是附加金額 ${a}。若方向相反，市值為正，風險敞口是 ${c}。`,
    checked: '與 QuantLib 核對',
    checkedText: (v: string, n: string, ok: boolean) =>
      `所有數字都由本程式自行計算。作為核對，${v} 另外算出 ${n} 個參考值，本程式${ok ? '全部重現' : '未能全部重現'}（剛在你的瀏覽器重新計算）。`,
    head: ['核對項目', '個數', '最大差異'],
    compared: ['交割日', '遠期匯率', '折現因子', '市值'],
    none: '無',
    dates: (n: number) => `${n} 個日期`,
    cent: '少於 USD 0.01',
    more: '假設、限制與資料來源',
    notes: [
      '交割前風險和結算風險屬信貸規則，不是定價，因此以手算個案測試，而非程式庫。',
      '風險敞口先把市值以零為下限，再加附加金額，與巴塞爾現行風險暴露法和美國 OCC 衍生工具手冊一致。部分內部額度系統容許負市值減少附加金額；「授信額度與附加因子」裡有設定可切換。',
      '淨額對總額比率（NGR）與附加金額的淨額計算：巴塞爾協定二，附件四。沒有任何正市值時 NGR 取 1，與美國掉期保證金規則對同一公式的處理相同。',
      '結算風險是我方應收的金額，只計在交割日當天。這是每日結算額度的行業慣例：2006 年 CPSS 調查中 52% 的機構這樣計。巴塞爾（2013）和金管局（TA-2）的定義是由我方付款不能撤回開始，計到確認收款為止。調查中這段時間平均 26 小時，所以只計一天可能低估。',
      'CLS 有 18 種合資格貨幣，不包括 CNH 和 TWD。指示須在交割日 00:00（歐洲中部時間）前提交，所以當日交收的款項一律計全額。另一邊仍可經 CLS。',
      '隱含利率的計息日數：GBP 用 Actual/365，USD、EUR、JPY、CNH 用 Actual/360；TWD 用 Actual/365，未經證實。',
      'QuantLib 沒有 2026 年之後的香港和台灣農曆假期，因此 2027 年的 USD/CNH 和 USD/TWD 交割日未計這些假期。',
      'EBS Market 只在雙方於平台上互有額度時才撮合，成交後才披露對手（EBS Dealing Rules 的 EBS Market 附錄；EBS 的平台披露表）。以單一附加因子計算場地切片，以及每個場地只接受一種訂單，是本程式的簡化。',
      '所有假設都列在原始碼倉庫的設計說明裡。',
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

/** One channel limit followed through a fill and into the next morning. */
function buildChannelExample() {
  const s0 = defaultState();
  const ctx0 = makeCtx(s0);
  const row = (s: typeof s0) => {
    const b = board(makeCtx(s), s, 'B');
    const a = b.allocations[0];
    return { a, psr: b.psr[a.pillar] };
  };
  const before = row(s0);
  const fill = channelFill(ctx0, s0, buildTrade(ctx0, CHANNEL_ORDER) as Trade);
  const s1 = reducer(s0, { type: 'CHANNEL_FILL', ticket: CHANNEL_ORDER });
  const after = row(s1);
  // The tightest line the room is held on decides how large the limit can be.
  const lines = board(makeCtx(s1), s1, 'B').psr.slice(0, after.a.pillar + 1);
  const tight = lines.reduce((m, r) => (r.line - (r.used - r.allocated) < m.line - (m.used - m.allocated) ? r : m));
  const max = maxChannelLimit(makeCtx(s1), s1, s1.channelLimits[1]);
  const next = row(reducer(s1, { type: 'NEXT_DAY' }));
  return { group: s0.groups[1], channel: CHANNELS[before.a.limit.channel].label, before, fill, after, tight, max, next };
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
  const ch = useMemo(buildChannelExample, []);
  const inUse = (r: { earlier: number; today: number }) => r.earlier + r.today;
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
      <Workings ctx={ex.ctx0} trade={ex.trade} risk={ex.check.risk} measured={ex.check.after} group={ex.check.group} isNew openFrom={1} />
      <h3>{t.later(rate('EURUSD', LATER_SPOT))}</h3>
      <p>
        {t.laterText(rate('EURUSD', far.rate), signedAmt(ex.risk1.mv), amt(ex.risk1.exposure), amt(Math.max(-ex.risk1.mv, 0) + ex.risk1.addOn))}
      </p>
      <Workings ctx={ex.ctx1} trade={ex.filled} risk={ex.risk1} measured={ex.measured1} group={ex.check.group} isNew={false} openFrom={4} />

      <h2>{t.ch}</h2>
      <p>{t.chIntro(ch.channel, partyName(ch.group.name, lang))}</p>
      <h3>1. {t.chSteps[0]}</h3>
      <Calc>{t.chLimit(amt(ch.before.a.limit.limitUsd))}</Calc>
      <Calc>{t.chHeld(amt(ch.before.a.left), String(ch.before.a.addOnPct), amt(ch.before.a.held), ch.before.psr.key)}</Calc>
      <Calc>{t.chRoom(ch.before.psr.key, amt(ch.before.psr.line), amt(inUse(ch.before.psr)), amt(ch.before.psr.allocated), amt(ch.before.psr.headroom))}</Calc>
      <h3>2. {t.chSteps[1]}</h3>
      <Calc>{t.chFillIs(amt(ch.fill.fillUsd), String(ch.fill.risk!.addOnPct), amt(ch.fill.risk!.exposure))}</Calc>
      <Calc>{t.chLeft(amt(ch.after.a.limit.limitUsd), amt(ch.after.a.filled), amt(ch.after.a.left))}</Calc>
      <Calc>{t.chHeld(amt(ch.after.a.left), String(ch.after.a.addOnPct), amt(ch.after.a.held), ch.after.psr.key)}</Calc>
      <Calc>{t.chTotal(amt(inUse(ch.after.psr)), amt(ch.after.psr.allocated), amt(ch.after.psr.used))}</Calc>
      <h3>3. {t.chSteps[2]}</h3>
      <Calc>{t.chTight(ch.tight.key, amt(ch.tight.line), amt(ch.tight.used - ch.tight.allocated), amt(ch.tight.line - (ch.tight.used - ch.tight.allocated)))}</Calc>
      <Calc>{t.chMax(amt(ch.after.a.filled), amt(ch.tight.line - (ch.tight.used - ch.tight.allocated)), String(ch.after.a.addOnPct), amt(ch.max))}</Calc>
      <h3>4. {t.chSteps[3]}</h3>
      <p>{t.chNext(amt(ch.next.a.limit.limitUsd))}</p>
      <Calc>{t.chHeld(amt(ch.next.a.left), String(ch.next.a.addOnPct), amt(ch.next.a.held), ch.next.psr.key)}</Calc>
      <Calc>{t.chRoom(ch.next.psr.key, amt(ch.next.psr.line), amt(inUse(ch.next.psr)), amt(ch.next.psr.allocated), amt(ch.next.psr.headroom))}</Calc>
      <p className="quiet">{t.chWhy}</p>

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
