import { useMemo, type ReactNode } from 'react';
import { PILLARS } from '../engine/calendar';
import { CHANNELS } from '../engine/channels';
import { defaultState } from '../engine/defaults';
import { board, checkTrade, groupOf } from '../engine/lines';
import { makeCtx, srByDate, valueTrade } from '../engine/risk';
import { buildTrade, candidates, largestThatFits, reducer } from '../engine/state';
import type { Ticket, Trade } from '../engine/types';
import { Calc } from './bits';
import { amt, day, mio, partyName, rate, signedAmt } from './format';
import { useLang } from './i18n';
import { Workings } from './Workings';

const M = 1_000_000;
const EXAMPLE: Ticket = { product: 'SWAP', pair: 'EURUSD', side: 'BUY', amount: 20 * M, tenor: '3M', lpId: 'A-LDN-360T', settlement: 'AUTO' };
const LATER_SPOT = 1.1767; // 1% above the starting 1.1650
const BOOK_ORDER: Ticket = { product: 'NDF', pair: 'USDTWD', side: 'BUY', amount: 20 * M, tenor: '6M', lpId: 'A-LDN-360T', book: 'EBSM', settlement: 'AUTO' };

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
        text: "Today's value if it is positive, plus an add-on for how far it could still move. A swap counts on its far leg. A hedge counts in the pillar it matures in and in every shorter one, because each pillar's line caps the risk still open at that point: the overnight line takes every hedge, the 3M line only those that run past the 1M pillar. The same amount shows in each of those pillars; it is one risk measured against several lines, not added up. Longer risk is worth less room, so lines usually step down as the tenor grows.",
        calcs: [
          'a 3M swap counts in O/N, 1W, 1M and 3M, and not in 6M or 1Y',
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
        calcs: ["headroom = credit line − earlier days − today's fills − reservations"],
      },
      {
        title: 'A channel that discloses after the trade',
        text: 'An order book matches first and names the counterparty afterwards. The desk cannot choose the counterparty or refuse a trade. What it does control is its own order: an order fills for no more than its own amount. So before placing it, the desk runs the same check against every counterparty that could fill it, and reserves on each. When the fill names the counterparty, that reservation becomes usage and the others are released. None of this needs the limits held at the channel to change. The cost is that the counterparty with the tightest line sets how large the order can be. The desk cannot keep one counterparty out from its own side: it can cut the order, or stop using the channel. Excluding one counterparty means setting its limit at the channel to zero, which is done by whoever administers credit there.',
        calcs: ['for every counterparty that could fill it: in use + reserved + this order ≤ credit line', 'largest order = the smallest of the amounts each counterparty has room for'],
      },
    ],
    steps: 'The same swap, step by step',
    dealt: (d: string) => `The day it is dealt, ${d}`,
    later: (r: string) => `A week later, spot up 1% to ${r}`,
    laterText: (k: string, mv: string, a: string, c: string) =>
      `We sell EUR on the far leg at ${k}, now below the market, so the market value is USD ${mv}. A negative value does not reduce the add-on, because the hedge could still turn positive: exposure is the add-on, ${a}. Dealt the other way round the value would be positive and exposure ${c}.`,
    bk: 'A channel that discloses after the trade, step by step',
    bkIntro: (ch: string, n: number, size: string, tenor: string) => `${n} counterparties could fill an order on ${ch}. The desk places a USD/TWD NDF, ${tenor}, for USD ${size}.`,
    bkSteps: ['Before placing: check every counterparty', 'The tightest line sets the largest order', 'Cut the order to that size, then place and reserve', 'The fill: one becomes usage, the others are released'],
    bkRisk: (size: string, pct: string, e: string) => `what the order would use = max(0, 0) + ${size} × ${pct}% = USD ${e}`,
    bkCheck: (g: string, p: string, line: string, before: string, room: string, e: string, ok: boolean) =>
      `${g}: ${p} line ${line} − ${before} in use or reserved = ${room}, ${ok ? 'room for' : 'no room for'} ${e}`,
    bkBlocked: (g: string) => `${g} has no room, so the whole order is held back: the desk cannot choose who fills it.`,
    bkFit: (g: string, room: string, pct: string, x: string) => `${g} has room for ${room} ÷ ${pct}% = ${x}`,
    bkLargest: (x: string) => `largest order = the smallest of these = ${x}, to the thousand below`,
    bkCut: (x: string, pct: string, e: string) => `The desk cuts the order to USD ${x}. It would use ${x} × ${pct}% = USD ${e}.`,
    bkReserve: (g: string, p: string, line: string, res: string, room: string) => `${g}: ${p} line ${line} − ${res} reserved = ${room} left`,
    bkFill: (g: string) => `The channel reports the fill: it was with ${g}.`,
    bkUsed: (g: string, p: string, line: string, used: string, room: string) => `${g}: ${p} line ${line} − ${used} in use = ${room} left`,
    bkFreed: (g: string, p: string, room: string) => `${g}: reservation released, ${p} headroom back to ${room}`,
    bkEnd: (full: string, g: string) => `No limit held at the channel was changed at any point. Placing the full USD ${full} would need ${g} switched off at the channel, which only its credit administrator can do.`,
    more: 'Assumptions, limits and sources',
    notes: [
      'Exposure floors the market value at zero before adding the add-on, as in the Basel current exposure method and the OCC handbook on derivatives. Some internal limit systems let a negative value reduce the add-on; a setting under "Credit lines and add-ons" switches to that form.',
      'Net-to-gross ratio and add-on netting: Basel II framework, Annex 4. With no positive market value the ratio is taken as 1, as the US swap margin rule does for the same formula.',
      'Settlement risk is what is due to be received, counted on the value date only. This is the common convention for a daily settlement limit: 52% of institutions in the 2006 CPSS survey measured it this way. Basel (2013) and the HKMA (TA-2) define the exposure as running from when our payment can no longer be cancelled until receipt is confirmed. That took 26 hours on average in the survey, so one day can understate it.',
      'CLS has 18 eligible currencies, without CNH or TWD. Instructions are due by 00:00 CET on the value date, so a payment due on the day it is dealt always counts in full. The other leg can still go through CLS.',
      'The implied interest rate uses Actual/365 for GBP and Actual/360 for USD, EUR, JPY and CNH. Actual/365 for TWD is not confirmed.',
      'The holiday tables have no Hong Kong or Taiwan lunar holidays after 2026, so USD/CNH and USD/TWD dates in 2027 ignore them.',
      'EBS Market matches orders only where both sides hold credit for each other on the platform, and names the counterparty after the trade (EBS Dealing Rules, EBS Market appendix; EBS disclosure cover sheet). Reserving for the whole order with every counterparty switched on there is the worst case. This app sends one product to each such channel, NDFs to one and swaps to the other, and fills an order once, in full.',
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
        text: '今日市值（為正數時），加上一個反映日後可能波動的附加金額。掉期以遠端計算。一筆對沖計入到期所在的期限檔，以及所有更短的期限檔。原因是每一檔限制的是到那時仍未到期的風險：O/N 檔包含所有對沖，3M 檔只包含過了 1M 檔仍未到期的對沖。各檔顯示的是同一個金額，是同一份風險分別對照幾條額度，不是加起來。期限越長風險越大，所以額度通常隨期限遞減。',
        calcs: [
          '3M 掉期：計入 O/N、1W、1M、3M；不計入 6M、1Y',
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
        title: '事後披露的場地',
        text: '訂單簿先撮合，成交後才披露對手。交易台不能選對手，也不能拒絕個別成交。交易台控制得了的是自己的訂單：一張訂單最多成交它自己的金額。所以掛單前，對場地上每個可能成交的對手都跑一次同樣的檢查，並在每一個那裡預佔。成交回報披露對手後，這個對手的預佔轉為已用，其餘的釋放。這不需要改動場地上的限額。代價是額度最緊的那個對手決定訂單能做多大。交易台不能從自己這邊單獨擋住一個對手：它只能縮小訂單，或者不用這個場地。要排除一個對手，只能在場地上把它的限額設為零，這要由管理場地額度的人做。',
        calcs: ['每個可能成交的對手：已用 + 預佔 + 本筆 ≤ 授信額度', '可掛的最大金額 = 各對手放得下的金額之中最小的一個'],
      },
    ],
    steps: '同一筆掉期，逐步計算',
    dealt: (d: string) => `成交當日：${d}`,
    later: (r: string) => `一週後，即期上升 1% 至 ${r}`,
    laterText: (k: string, mv: string, a: string, c: string) =>
      `遠端我方以 ${k} 賣出 EUR，現已低於市價，所以市值是 USD ${mv}。負市值不能減少附加金額，因為到期前市值仍可能轉正：風險敞口就是附加金額 ${a}。若方向相反，市值為正，風險敞口是 ${c}。`,
    bk: '事後披露的場地，逐步計算',
    bkIntro: (ch: string, n: number, size: string, tenor: string) => `${ch} 上有 ${n} 個對手可能成交。交易台掛一張 USD/TWD NDF，${tenor}，USD ${size}。`,
    bkSteps: ['掛單前：對每個對手檢查', '額度最緊的對手決定最大金額', '把訂單縮小到這個金額，然後掛單並預佔', '成交回報：一個轉為已用，其餘釋放'],
    bkRisk: (size: string, pct: string, e: string) => `這張單要用的額度 = max(0, 0) + ${size} × ${pct}% = USD ${e}`,
    bkCheck: (g: string, p: string, line: string, before: string, room: string, e: string, ok: boolean) =>
      `${g}：${p} 額度 ${line} − 已用和預佔 ${before} = ${room}，${ok ? '放得下' : '放不下'} ${e}`,
    bkBlocked: (g: string) => `${g}放不下，所以整張單不能掛：交易台不能選誰來成交。`,
    bkFit: (g: string, room: string, pct: string, x: string) => `${g}放得下 ${room} ÷ ${pct}% = ${x}`,
    bkLargest: (x: string) => `可掛的最大金額 = 以上最小的一個 = ${x}（取整到千位）`,
    bkCut: (x: string, pct: string, e: string) => `交易台把訂單縮小到 USD ${x}。它要用的額度 = ${x} × ${pct}% = USD ${e}。`,
    bkReserve: (g: string, p: string, line: string, res: string, room: string) => `${g}：${p} 額度 ${line} − 預佔 ${res} = 尚餘 ${room}`,
    bkFill: (g: string) => `場地回報成交：對手是 ${g}。`,
    bkUsed: (g: string, p: string, line: string, used: string, room: string) => `${g}：${p} 額度 ${line} − 已用 ${used} = 尚餘 ${room}`,
    bkFreed: (g: string, p: string, room: string) => `${g}：預佔釋放，${p} 可用額度回到 ${room}`,
    bkEnd: (full: string, g: string) => `全程沒有改過場地上的限額。要掛足 USD ${full}，就要由管理場地額度的人在場地上停用 ${g}。`,
    more: '假設、限制與資料來源',
    notes: [
      '風險敞口先把市值以零為下限，再加附加金額，與巴塞爾現行風險暴露法和美國 OCC 衍生工具手冊一致。部分內部額度系統容許負市值減少附加金額；「授信額度與附加因子」裡有設定可切換。',
      '淨額對總額比率（NGR）與附加金額的淨額計算：巴塞爾協定二，附件四。沒有任何正市值時 NGR 取 1，與美國掉期保證金規則對同一公式的處理相同。',
      '結算風險是我方應收的金額，只計在交割日當天。這是每日結算額度的行業慣例：2006 年 CPSS 調查中 52% 的機構這樣計。巴塞爾（2013）和金管局（TA-2）的定義是由我方付款不能撤回開始，計到確認收款為止。調查中這段時間平均 26 小時，所以只計一天可能低估。',
      'CLS 有 18 種合資格貨幣，不包括 CNH 和 TWD。指示須在交割日 00:00（歐洲中部時間）前提交，所以當日交收的款項一律計全額。另一邊仍可經 CLS。',
      '隱含利率的計息日數：GBP 用 Actual/365，USD、EUR、JPY、CNH 用 Actual/360；TWD 用 Actual/365，未經證實。',
      '假期表沒有 2026 年之後的香港和台灣農曆假期，因此 2027 年的 USD/CNH 和 USD/TWD 交割日未計這些假期。',
      'EBS Market 只在雙方於平台上互有額度時才撮合，成交後才披露對手（EBS Dealing Rules 的 EBS Market 附錄；EBS 的平台披露表）。對場地上每個開通的對手都按整張訂單預佔，是最壞情況。本程式每個這類場地只送一種產品（一個做 NDF，一個做掉期），而且一張訂單只成交一次、全數成交。',
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

/** One order on a book, from the check on every counterparty through the fill with one of them. */
function buildBookExample() {
  const s0 = defaultState();
  const ctx = makeCtx(s0);
  const checks = (candidates(ctx, s0, BOOK_ORDER) as Trade[]).map((t) => checkTrade(ctx, s0, t));
  const { risk } = checks[0];
  // Lines shrink with tenor, so the order's own pillar is the one that binds.
  const at = (s: ReturnType<typeof defaultState>, lpId: string) => {
    const group = groupOf(s, lpId);
    return { lpId, group, row: board(makeCtx(s), s, group.id).psr[risk.pillar] };
  };
  const before = checks.map((c) => ({ ...at(s0, c.trade.lpId), check: c.psr[risk.pillar], ok: c.ok }));
  const blocker = before.find((b) => !b.ok)!;
  const largest = largestThatFits(ctx, s0, BOOK_ORDER);

  // The desk cannot keep the blocker out, so it places what the tightest line can take.
  const placed = reducer(s0, { type: 'SEND', ticket: { ...BOOK_ORDER, amount: largest } });
  const filler = placed.trades[1];
  const filled = reducer(placed, { type: 'FILL', id: filler.id });
  return {
    channel: CHANNELS[BOOK_ORDER.book!].label,
    risk,
    pillar: PILLARS[risk.pillar],
    before,
    blocker,
    largest,
    cut: valueTrade(ctx, placed.trades[0]),
    placed: placed.trades.map((t) => at(placed, t.lpId)),
    after: placed.trades.map((t) => ({ ...at(filled, t.lpId), filled: t.id === filler.id })),
  };
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
  const bk = useMemo(buildBookExample, []);
  const who = (g: { name: string }) => partyName(g.name, lang);
  const [near, far] = ex.trade.legs;

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

      <h2>{t.bk}</h2>
      <p>{t.bkIntro(bk.channel, bk.before.length, amt(BOOK_ORDER.amount), BOOK_ORDER.tenor)}</p>
      <h3>1. {t.bkSteps[0]}</h3>
      <Calc>{t.bkRisk(amt(bk.risk.notionalUsd), String(bk.risk.addOnPct), amt(bk.risk.exposure))}</Calc>
      {bk.before.map((b) => (
        <Calc key={b.lpId}>{t.bkCheck(who(b.group), bk.pillar, amt(b.check.line), amt(b.check.before), amt(b.check.line - b.check.before), amt(bk.risk.exposure), b.ok)}</Calc>
      ))}
      <p>{t.bkBlocked(who(bk.blocker.group))}</p>
      <h3>2. {t.bkSteps[1]}</h3>
      {bk.before.map((b) => (
        <Calc key={b.lpId}>
          {t.bkFit(who(b.group), amt(b.check.line - b.check.before), String(bk.risk.addOnPct), amt(Math.floor(((b.check.line - b.check.before) / bk.risk.addOnPct) * 100 + 1e-6)))}
        </Calc>
      ))}
      <Calc>{t.bkLargest(amt(bk.largest))}</Calc>
      <h3>3. {t.bkSteps[2]}</h3>
      <p>{t.bkCut(amt(bk.cut.notionalUsd), String(bk.cut.addOnPct), amt(bk.cut.exposure))}</p>
      {bk.placed.map((b) => (
        <Calc key={b.lpId}>{t.bkReserve(who(b.group), bk.pillar, amt(b.row.line), amt(b.row.reserved), amt(b.row.headroom))}</Calc>
      ))}
      <h3>4. {t.bkSteps[3]}</h3>
      <p>{t.bkFill(who(bk.after.find((a) => a.filled)!.group))}</p>
      {bk.after.map((a) => (
        <Calc key={a.lpId}>{a.filled ? t.bkUsed(who(a.group), bk.pillar, amt(a.row.line), amt(a.row.used), amt(a.row.headroom)) : t.bkFreed(who(a.group), bk.pillar, amt(a.row.headroom))}</Calc>
      ))}
      <p>{t.bkEnd(amt(BOOK_ORDER.amount), who(bk.blocker.group))}</p>

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
