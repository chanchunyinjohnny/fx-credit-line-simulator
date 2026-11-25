import { useMemo, type ReactNode } from 'react';
import { defaultState } from '../engine/defaults';
import { CHANNELS } from '../engine/channels';
import { board, channelFill, checkTrade } from '../engine/lines';
import { makeCtx, srByDate } from '../engine/risk';
import { buildTrade, reducer } from '../engine/state';
import type { Ticket, Trade } from '../engine/types';
import { Calc } from './bits';
import { amt, day, mio, partyName, rate, signedAmt } from './format';
import { useLang } from './i18n';
import { Workings } from './Workings';

const M = 1_000_000;
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
        text: 'An order book matches first and names the counterparty afterwards, so the desk cannot check each trade. But the channel fills only within the limit the desk has set there. So the desk holds room on the credit line first and sets the limit to match. A fill turns that held room into usage, exactly as a reservation does. The desk then holds room again and tops the limit up. As the line fills it tops up less; at zero the channel stops filling with that counterparty.',
        calcs: ['room held = amount available on the channel × add-on % of the longest order sent there', 'amount available = min(amount to keep, free room on the line ÷ add-on %)'],
      },
    ],
    steps: 'The same swap, step by step',
    dealt: (d: string) => `The day it is dealt, ${d}`,
    later: (r: string) => `A week later, spot up 1% to ${r}`,
    laterText: (k: string, mv: string, a: string, c: string) =>
      `We sell EUR on the far leg at ${k}, now below the market, so the market value is USD ${mv}. A negative value does not reduce the add-on, because the hedge could still turn positive: exposure is the add-on, ${a}. Dealt the other way round the value would be positive and exposure ${c}.`,
    ch: 'A channel that checks credit itself, step by step',
    chIntro: (ch: string, g: string, keep: string) => `${ch} with ${g}. The desk sends one order there, USD/TWD NDF 1M, and keeps USD ${keep} available.`,
    chSteps: ['Before any fill: hold room, then set the limit', 'The channel fills an order', 'The fill report: book it, then top up', 'When the line runs short'],
    chHeld: (avail: string, pct: string, held: string, to: string) => `room held = ${avail} × ${pct}% = USD ${held}, on the ${to} line and every shorter one`,
    chRoom: (p: string, line: string, used: string, held: string, rest: string) => `${p} line ${line} − ${used} in use − ${held} held = ${rest} left`,
    chAtChannel: (avail: string, fill: string, rest: string) => `at the channel: ${avail} available − ${fill} filled = ${rest}. The desk does not yet know with whom.`,
    chSafe: (e: string, held: string) => `the most this can add is ${e}, and ${held} is already held: the line cannot be exceeded`,
    chBook: (size: string, pct: string, e: string) => `in use = max(0, 0) + ${size} × ${pct}% = USD ${e}`,
    chFree: (p: string, line: string, used: string, room: string) => `free room on the ${p} line = ${line} − ${used} in use = ${room}`,
    chAvail: (keep: string, room: string, pct: string, fits: string, avail: string) => `amount available = min(${keep}, ${room} ÷ ${pct}%) = min(${keep}, ${fits}) = ${avail}`,
    chCost: (before: string, after: string) => `The fill has come out of headroom: ${before} before, ${after} after. The room held is the same as before.`,
    chShortIntro: (line: string, used: string) => `Take a 1M line of ${line} with ${used} already in use.`,
    chStop: (p: string, line: string, used: string) => `Once ${used} of the ${p} line of ${line} is in use, free room is 0 and the amount available is 0. The channel no longer fills with this group, and nothing went over the line.`,
    more: 'Assumptions, limits and sources',
    notes: [
      'Exposure floors the market value at zero before adding the add-on, as in the Basel current exposure method and the OCC handbook on derivatives. Some internal limit systems let a negative value reduce the add-on; a setting under "Credit lines and add-ons" switches to that form.',
      'Net-to-gross ratio and add-on netting: Basel II framework, Annex 4. With no positive market value the ratio is taken as 1, as the US swap margin rule does for the same formula.',
      'Settlement risk is what is due to be received, counted on the value date only. This is the common convention for a daily settlement limit: 52% of institutions in the 2006 CPSS survey measured it this way. Basel (2013) and the HKMA (TA-2) define the exposure as running from when our payment can no longer be cancelled until receipt is confirmed. That took 26 hours on average in the survey, so one day can understate it.',
      'CLS has 18 eligible currencies, without CNH or TWD. Instructions are due by 00:00 CET on the value date, so a payment due on the day it is dealt always counts in full. The other leg can still go through CLS.',
      'The implied interest rate uses Actual/365 for GBP and Actual/360 for USD, EUR, JPY and CNH. Actual/365 for TWD is not confirmed.',
      'The holiday tables have no Hong Kong or Taiwan lunar holidays after 2026, so USD/CNH and USD/TWD dates in 2027 ignore them.',
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
        text: '訂單簿先撮合，成交後才知道對手，交易台不能逐筆檢查。但場地只會在交易台設定的限額之內成交。所以交易台先在授信額度上預留一份（場地切片），再把場地限額設為同一金額。成交後，這份切片轉為已用，和預佔轉為已用一樣。交易台隨即再預留，補回限額。額度越滿，補得越少；到零時，場地不再和這個對手成交。',
        calcs: ['場地切片 = 場地現在可成交的金額 × 送往該場地最長期限訂單的附加因子 %', '現在可成交 = min(要保持的金額, 額度上的空間 ÷ 附加因子 %)'],
      },
    ],
    steps: '同一筆掉期，逐步計算',
    dealt: (d: string) => `成交當日：${d}`,
    later: (r: string) => `一週後，即期上升 1% 至 ${r}`,
    laterText: (k: string, mv: string, a: string, c: string) =>
      `遠端我方以 ${k} 賣出 EUR，現已低於市價，所以市值是 USD ${mv}。負市值不能減少附加金額，因為到期前市值仍可能轉正：風險敞口就是附加金額 ${a}。若方向相反，市值為正，風險敞口是 ${c}。`,
    ch: '自行檢查額度的場地，逐步計算',
    chIntro: (ch: string, g: string, keep: string) => `${ch} 對 ${g}。交易台只送一種訂單到這個場地（USD/TWD NDF，1M），並保持 USD ${keep} 可成交。`,
    chSteps: ['成交之前：先預留，再設限額', '場地成交一張訂單', '成交回報：記帳，然後補回', '額度快用完的時候'],
    chHeld: (avail: string, pct: string, held: string, to: string) => `場地切片 = ${avail} × ${pct}% = USD ${held}，佔 ${to} 及所有更短的期限檔`,
    chRoom: (p: string, line: string, used: string, held: string, rest: string) => `${p} 額度 ${line} − 已用 ${used} − 場地切片 ${held} = 尚餘 ${rest}`,
    chAtChannel: (avail: string, fill: string, rest: string) => `場地上：可成交 ${avail} − 成交 ${fill} = ${rest}。交易台這時還不知道對手是誰。`,
    chSafe: (e: string, held: string) => `這筆最多增加 ${e}，而額度上已經預留了 ${held}：不可能超額`,
    chBook: (size: string, pct: string, e: string) => `已用 = max(0, 0) + ${size} × ${pct}% = USD ${e}`,
    chFree: (p: string, line: string, used: string, room: string) => `${p} 額度上的空間 = ${line} − 已用 ${used} = ${room}`,
    chAvail: (keep: string, room: string, pct: string, fits: string, avail: string) => `現在可成交 = min(${keep}, ${room} ÷ ${pct}%) = min(${keep}, ${fits}) = ${avail}`,
    chCost: (before: string, after: string) => `這筆成交用掉的是可用額度：之前 ${before}，之後 ${after}。場地切片和成交前一樣。`,
    chShortIntro: (line: string, used: string) => `假設 1M 額度是 ${line}，已用 ${used}。`,
    chStop: (p: string, line: string, used: string) => `到 ${p} 額度 ${line} 已用 ${used} 時，空間是 0，可成交金額是 0。場地不再和這個集團成交，全程沒有超出額度。`,
    more: '假設、限制與資料來源',
    notes: [
      '風險敞口先把市值以零為下限，再加附加金額，與巴塞爾現行風險暴露法和美國 OCC 衍生工具手冊一致。部分內部額度系統容許負市值減少附加金額；「授信額度與附加因子」裡有設定可切換。',
      '淨額對總額比率（NGR）與附加金額的淨額計算：巴塞爾協定二，附件四。沒有任何正市值時 NGR 取 1，與美國掉期保證金規則對同一公式的處理相同。',
      '結算風險是我方應收的金額，只計在交割日當天。這是每日結算額度的行業慣例：2006 年 CPSS 調查中 52% 的機構這樣計。巴塞爾（2013）和金管局（TA-2）的定義是由我方付款不能撤回開始，計到確認收款為止。調查中這段時間平均 26 小時，所以只計一天可能低估。',
      'CLS 有 18 種合資格貨幣，不包括 CNH 和 TWD。指示須在交割日 00:00（歐洲中部時間）前提交，所以當日交收的款項一律計全額。另一邊仍可經 CLS。',
      '隱含利率的計息日數：GBP 用 Actual/365，USD、EUR、JPY、CNH 用 Actual/360；TWD 用 Actual/365，未經證實。',
      '假期表沒有 2026 年之後的香港和台灣農曆假期，因此 2027 年的 USD/CNH 和 USD/TWD 交割日未計這些假期。',
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

/** One channel followed through a fill and its top-up, then on a line that is nearly full. */
function buildChannelExample() {
  const view = (s: ReturnType<typeof defaultState>) => {
    const b = board(makeCtx(s), s, 'B');
    const a = b.allocations[0];
    const psr = b.psr[a.pillar];
    return { a, psr, inUse: psr.used - psr.allocated };
  };
  const s0 = defaultState();
  const ctx0 = makeCtx(s0);
  const before = view(s0);
  const fill = channelFill(ctx0, s0, buildTrade(ctx0, CHANNEL_ORDER) as Trade);
  const after = view(reducer(s0, { type: 'CHANNEL_FILL', ticket: CHANNEL_ORDER }));

  // A line with room for two and a half fills.
  let s = reducer(s0, { type: 'EDIT', change: (d) => void (d.groups[1].psrLines[2] = 500_000) });
  for (let i = 0; i < 2; i++) s = reducer(s, { type: 'CHANNEL_FILL', ticket: CHANNEL_ORDER });
  const short = view(s);
  const full = view(reducer(s, { type: 'CHANNEL_FILL', ticket: CHANNEL_ORDER }));
  return { group: s0.groups[1], channel: CHANNELS[before.a.buffer.channel].label, before, fill, after, short, full };
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
  const ch = useMemo(buildChannelExample, []);
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

      <h2>{t.ch}</h2>
      <p>{t.chIntro(ch.channel, partyName(ch.group.name, lang), amt(ch.before.a.buffer.keepUsd))}</p>
      <h3>1. {t.chSteps[0]}</h3>
      <Calc>{t.chHeld(amt(ch.before.a.available), String(ch.before.a.addOnPct), amt(ch.before.a.held), ch.before.psr.key)}</Calc>
      <Calc>{t.chRoom(ch.before.psr.key, amt(ch.before.psr.line), amt(ch.before.inUse), amt(ch.before.psr.allocated), amt(ch.before.psr.headroom))}</Calc>
      <h3>2. {t.chSteps[1]}</h3>
      <Calc>{t.chAtChannel(amt(ch.fill.available), amt(ch.fill.fillUsd), amt(ch.fill.available - ch.fill.fillUsd))}</Calc>
      <Calc>{t.chSafe(amt(ch.fill.risk!.exposure), amt(ch.before.a.held))}</Calc>
      <h3>3. {t.chSteps[2]}</h3>
      <Calc>{t.chBook(amt(ch.fill.fillUsd), String(ch.fill.risk!.addOnPct), amt(ch.fill.risk!.exposure))}</Calc>
      <Calc>{t.chFree(ch.after.psr.key, amt(ch.after.psr.line), amt(ch.after.inUse), amt(ch.after.psr.line - ch.after.inUse))}</Calc>
      <Calc>
        {t.chAvail(
          amt(ch.after.a.buffer.keepUsd),
          amt(ch.after.psr.line - ch.after.inUse),
          String(ch.after.a.addOnPct),
          amt(((ch.after.psr.line - ch.after.inUse) / ch.after.a.addOnPct) * 100),
          amt(ch.after.a.available),
        )}
      </Calc>
      <Calc>{t.chHeld(amt(ch.after.a.available), String(ch.after.a.addOnPct), amt(ch.after.a.held), ch.after.psr.key)}</Calc>
      <Calc>{t.chRoom(ch.after.psr.key, amt(ch.after.psr.line), amt(ch.after.inUse), amt(ch.after.psr.allocated), amt(ch.after.psr.headroom))}</Calc>
      <p>{t.chCost(amt(ch.before.psr.headroom), amt(ch.after.psr.headroom))}</p>
      <h3>4. {t.chSteps[3]}</h3>
      <p>{t.chShortIntro(amt(ch.short.psr.line), amt(ch.short.inUse))}</p>
      <Calc>{t.chFree(ch.short.psr.key, amt(ch.short.psr.line), amt(ch.short.inUse), amt(ch.short.psr.line - ch.short.inUse))}</Calc>
      <Calc>
        {t.chAvail(
          amt(ch.short.a.buffer.keepUsd),
          amt(ch.short.psr.line - ch.short.inUse),
          String(ch.short.a.addOnPct),
          amt(((ch.short.psr.line - ch.short.inUse) / ch.short.a.addOnPct) * 100),
          amt(ch.short.a.available),
        )}
      </Calc>
      <Calc>{t.chHeld(amt(ch.short.a.available), String(ch.short.a.addOnPct), amt(ch.short.a.held), ch.short.psr.key)}</Calc>
      <p>{t.chStop(ch.full.psr.key, amt(ch.full.psr.line), amt(ch.full.inUse))}</p>

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
