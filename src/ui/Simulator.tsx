import { useMemo, useState, type Dispatch } from 'react';
import { OUTRIGHT_TENORS, PAIRS, PAIR_IDS, PILLARS, SWAP_TENORS } from '../engine/calendar';
import { CHANNELS, checksBook } from '../engine/channels';
import { NOTIONAL_CHANNEL, board, checkTrade, groupOf, lineStatus, type BoardRow, type CheckResult, type CheckRow } from '../engine/lines';
import { makeCtx, valueTrade, type Ctx } from '../engine/risk';
import { usdPerUnit } from '../engine/market';
import { MAX_AMOUNT_USD, NOTIONAL_LINE, SR_LINE, bookOf, buildTrade, candidates, largestThatFits, psrLine, type Action, type TicketError } from '../engine/state';
import type { AppState, Channel, Group, PairId, Product, RateTenor, Tenor, Ticket, Trade } from '../engine/types';
import { NumInput, Status } from './bits';
import { PRODUCT_LABEL, SETTLEMENT_LABEL, amt, day, direction, mio, num, partyName, rate, shortDay, signedMio } from './format';
import { useLang, type Lang } from './i18n';
import { BarLegend, LineBar } from './LineBar';
import { Workings } from './Workings';

const M = 1_000_000;
/** The ticket opens with no amount, so the lines first show only what is in use and reserved. */
const DEFAULT_TICKET: Ticket = { product: 'SWAP', pair: 'EURUSD', side: 'BUY', amount: 0, tenor: '3M', lpId: 'A-LDN-360T', settlement: 'AUTO' };
const POINT_TENORS: Tenor[] = ['ON', 'TN', 'SN', '1W', '1M', '2M', '3M', '6M', '9M', '1Y'];
const RATE_TENORS: RateTenor[] = ['ON', '1W', '1M', '2M', '3M', '6M', '9M', '1Y'];

const T = {
  en: {
    product: 'Product',
    pair: 'Pair',
    direction: 'Direction',
    amount: (ccy: string) => `${ccy} mio`,
    tenor: 'Tenor',
    settlement: 'Settlement',
    standard: (s: string) => `Standard${s ? `: ${s}` : ''}`,
    sendTo: 'Send to',
    orBook: 'Or place on',
    lpGroup: 'Liquidity provider. A tick means it has room for this hedge.',
    bookGroup: 'A channel that names the counterparty after the trade. A tick means every counterparty there has room for this order.',
    hasRoom: ', has room',
    noRoom: ', no room',
    offList: ', off the counterparty list',
    idle: (g: string) => `These are ${g}'s lines as they stand. Enter an amount to see how much this hedge would use, and whether it fits.`,
    idleBook: (ch: string) => `These are the lines of every counterparty on ${ch} as they stand. Enter an amount to see whether the order fits each of them.`,
    fits: 'Fits',
    blocked: 'Blocked',
    adds: (psr: string, sr: string | null, g: string) =>
      `Adds USD ${psr} mio of pre-settlement risk${sr ? ` and up to ${sr} mio of settlement risk a day` : ''} to ${g}.`,
    psrOver: (k: string, a: string, l: string) => `Pre-settlement risk at ${k} would reach ${a} against a line of ${l}.`,
    srOver: (d: string, a: string, l: string) => `Settlement risk on ${d} would reach ${a} against a line of ${l}.`,
    notionalOver: (a: string, l: string) => `Gross notional on 360T today would reach ${a} against a line of ${l}.`,
    warned: (what: string, used: string, level: number) => ` Warning: ${what} would be ${used}% used, past the warning level of ${level}%.`,
    warnPsr: (k: string) => `the ${k} pre-settlement line`,
    warnSr: (d: string) => `the settlement line on ${d}`,
    warnNotional: 'the 360T notional line',
    warnNote: (level: number) => `! marks a line at or past the warning level of ${level}%.`,
    onlyReservation: ' On its own this hedge would fit. Another hedge has been sent and has no answer yet, so its room is still held. If that one is rejected, this one fits.',
    bookFits: 'Every counterparty has room',
    bookBlocked: (g: string) => `No room with ${g}`,
    bookWhy: (ch: string, n: number) =>
      `${ch} names the counterparty only after the trade, and the desk cannot choose it. The order could fill with any of ${n} counterparties, so it is checked against each and reserved on each.`,
    bookCap: (ccy: string, x: string, g: string) => ` The largest order all of them have room for is ${ccy} ${x} mio. A larger one needs ${g} switched off at the channel, which only its credit administrator can do.`,
    bookCapNone: (g: string) => ` No size fits while ${g} is switched on at the channel. The desk cannot keep one counterparty out on its own.`,
    bookHeld: ' It would fit on its own. Another order or hedge is still open, and its room is held on the same line whichever channel it is on.',
    bookOff: (ch: string) => `The check is switched off for ${ch}. The desk neither checks nor reserves: the channel fills on its own limits, and the desk books the fill afterwards.`,
    bookOffOver: (g: string) => ` A fill with ${g} would take a line over.`,
    place: 'Place and reserve',
    fillsWith: (g: string) => `Fills with ${g}`,
    eachTightest: 'Each counterparty that could fill it, at its tightest line',
    workingsFor: (g: string) => `Workings: how each number is calculated, for ${g}`,
    at: (dates: string, rates: string) => `${dates} at ${rates}`,
    send: 'Send and reserve',
    psr: 'Pre-settlement risk',
    pillarWhy: (to: string) => `This hedge matures in the ${to} pillar, so it counts there and in every shorter one. Each line caps the risk still open at that point; it is the same amount against each line, not added up.`,
    sr: 'Settlement risk',
    notional: 'Gross notional on 360T, dealt today',
    unit: 'USD mio',
    of: (a: string, l: string) => `${a} of ${l}`,
    overBy: (x: string) => `over by ${x}`,
    srNone: (g: string) => `none with ${g}.`,
    viaCls: 'This hedge settles through CLS.',
    viaCash: 'An NDF pays one net amount.',
    workings: 'Workings: how each number is calculated',
    figures: (g: string) => `Figures: where ${g}'s lines stand today`,
    figHead: ['USD mio', 'Credit line', 'Earlier days', 'Initial today', 'Today’s fills', 'Reserved', 'This hedge', 'Headroom after'],
    psrRow: (k: string) => `PSR ${k}`,
    srRow: (k: string) => `SR ${k}`,
    notionalRow: 'Notional 360T',
    sent: 'Sent hedges',
    sentHead: ['Hedge', 'Status', 'Exposure, USD'],
    status: { IN_FLIGHT: 'In flight', FILLED: 'Filled', REJECTED: 'Rejected', UNFILLED: 'Not filled', EXPIRED: 'Lapsed', SETTLED: 'Settled' },
    mio: 'mio',
    fill: 'Fill',
    reject: 'Reject',
    noMatch: 'No match',
    workingsBtn: 'Workings',
    valued: (id: string) => `${id}, valued today`,
    market: 'Market data: change a rate and open hedges are revalued',
    marketHint: 'Spot and swap points set the rates of new hedges and the market value of filled ones. Raise a spot rate and watch the bars above move.',
    points: 'Swap points, pips',
    spot: 'Spot',
    usdRate: 'USD rate, %',
    lines: 'Limit management: lines keyed in by a trader, add-ons and the counterparty list',
    linesHint: 'The department splits each counterparty’s limit. A trader keys the day’s lines in here, and every change is recorded below. Exposure is measured gross at this stage, so both kinds of netting start switched off.',
    psrLine: (p: string) => `PSR ${p}`,
    srLine: 'SR per day',
    notionalLine: '360T notional per day',
    notionalHead: 'Notional 360T',
    noLp: 'no LP there',
    closeOut: 'Close-out netting',
    payNet: 'Payment netting',
    addOn: 'Add-on, %',
    warnAt: 'Warn when a line is this full, %',
    offset: 'Keep the add-on in full when the market value is negative: max(market value, 0) + add-on. This is the Basel standard method. Unticked, the limit system’s method applies: max(market value + add-on, 0).',
    changes: 'Changes recorded',
    noChanges: 'No line has been changed.',
    changeHead: ['Date', 'Banking group', 'Line', 'From', 'To'],
    parties: 'Counterparty list',
    partiesHint: 'Each LP on a channel maps to a counterparty, and each counterparty to the banking group (root parent) that holds the lines. An LP taken off the list is sent no hedge. On a channel that names the counterparty after the trade the desk cannot choose, so the list does not apply there.',
    partyHead: ['LP on the channel', 'Channel', 'Banking group', 'On the list'],
    books: 'Channels that name the counterparty after the trade',
    booksHint:
      'An order there is checked against every counterparty switched on at the channel, and reserved on each. The desk cannot keep one counterparty out from its own side. Switching one off means whoever administers credit at the channel sets its limit there to zero; a tick removed below stands for that having been done. With the check off, the desk relies on the channel’s limits alone and books fills afterwards.',
    bookCheck: 'Check and reserve on every counterparty before placing an order',
    bookParties: 'Switched on at the channel',
    errors: {
      USE_SWAP_OR_FORWARD: (p: string) => `${p} is deliverable: use a swap or forward.`,
      NDF_ONLY: (p: string) => `${p} trades as an NDF only.`,
      TENOR: () => 'This tenor is not available for this product.',
      AMOUNT: () => 'Enter an amount.',
      TOO_LARGE: (_p: string, max: string) => `A hedge here can be up to USD 50 mio, which is ${max} mio. Enter that or less, or enter a larger order as several hedges.`,
      NO_TOM_NEXT: () => 'Tom-next does not exist today: tomorrow is already the spot date.',
      NOT_CLS_PAIR: (p: string) => `${p} cannot settle through CLS.`,
      BOOK_PRODUCT: () => 'This channel takes one product here: NDFs on EBS Market, swaps on LSEG Forwards Matching.',
      BOOK_EMPTY: () => 'No counterparty is switched on at this channel.',
      LP_OFF_LIST: () => 'This LP is off the counterparty list, so no hedge is sent to it. The list is under Limit management below.',
    } as Record<TicketError, (pair: string, max: string) => string>,
  },
  zh: {
    product: '產品',
    pair: '貨幣對',
    direction: '方向',
    amount: (ccy: string) => `${ccy} 百萬`,
    tenor: '期限',
    settlement: '結算方式',
    standard: (s: string) => `預設${s ? `：${s}` : ''}`,
    sendTo: '送往',
    orBook: '或掛到場地',
    lpGroup: 'LP。打勾代表有足夠額度做這筆對沖。',
    bookGroup: '成交後才披露對手的場地。打勾代表場地上每個對手都有足夠額度。',
    hasRoom: '，額度足夠',
    noRoom: '，額度不足',
    offList: '，不在交易對手清單上',
    idle: (g: string) => `下面是 ${g}現在的額度。輸入金額，看這筆對沖要用多少、放不放得下。`,
    idleBook: (ch: string) => `下面是 ${ch} 上每個對手現在的額度。輸入金額，看這張訂單在每個對手那裡放不放得下。`,
    fits: '額度足夠',
    blocked: '額度不足',
    adds: (psr: string, sr: string | null, g: string) => `${g}的交割前風險增加 ${psr} 百萬美元${sr ? `，結算風險每日最多增加 ${sr} 百萬美元` : ''}。`,
    psrOver: (k: string, a: string, l: string) => `${k} 期限檔的交割前風險將達 ${a}，額度只有 ${l}。`,
    srOver: (d: string, a: string, l: string) => `${d} 的結算風險將達 ${a}，額度只有 ${l}。`,
    notionalOver: (a: string, l: string) => `今日在 360T 的名義金額總額將達 ${a}，額度只有 ${l}。`,
    warned: (what: string, used: string, level: number) => `預警：${what}將用到 ${used}%，超過預警線 ${level}%。`,
    warnPsr: (k: string) => `${k} 檔的交割前額度`,
    warnSr: (d: string) => `${d} 的結算額度`,
    warnNotional: '360T 的名義金額額度',
    warnNote: (level: number) => `「!」代表這條額度已用到預警線 ${level}% 或以上。`,
    onlyReservation: '這筆單獨放得進。但另一筆已經送出、還沒有結果，它的額度先留著。那一筆被拒絕的話，這筆就放得進。',
    bookFits: '每個對手都放得下',
    bookBlocked: (g: string) => `${g}的額度不夠`,
    bookWhy: (ch: string, n: number) => `${ch} 成交後才披露對手，交易台不能選對手。這張單可能和 ${n} 個對手之中任何一個成交，所以每一個都要檢查並預佔。`,
    bookCap: (ccy: string, x: string, g: string) => `每個對手都放得下的最大金額是 ${ccy} ${x} 百萬。要掛更大的單，要由管理場地額度的人在場地上停用 ${g}。`,
    bookCapNone: (g: string) => `只要 ${g}在場地上還開通，任何金額都放不下。交易台不能單獨擋住一個對手。`,
    bookHeld: '這張單單獨放得下。但另一張訂單或對沖還沒有結果，它的額度先留著；不論它在哪個渠道，佔的都是同一條額度。',
    bookOff: (ch: string) => `${ch} 的檢查已關掉。交易台不檢查、不預佔：場地按它自己的限額成交，成交後才記帳。`,
    bookOffOver: (g: string) => `和 ${g}成交會超出額度。`,
    place: '掛單並預佔額度',
    fillsWith: (g: string) => `${g}成交`,
    eachTightest: '每個可能成交的對手，各看最緊的一條額度',
    workingsFor: (g: string) => `計算過程：每個數字怎樣算出來（以 ${g}為例）`,
    at: (dates: string, rates: string) => `${dates}，匯率 ${rates}`,
    send: '送出並預佔額度',
    psr: '交割前風險',
    pillarWhy: (to: string) => `這筆對沖在 ${to} 檔到期，所以計入 ${to} 檔和所有更短的期限檔。每一檔限制的是到那時仍未到期的風險；各檔是同一個金額分別對照，不是加起來。`,
    sr: '結算風險',
    notional: '360T 名義金額總額（當日成交）',
    unit: '百萬美元',
    of: (a: string, l: string) => `${a} / ${l}`,
    overBy: (x: string) => `超出 ${x}`,
    srNone: (g: string) => `${g}沒有。`,
    viaCls: '本筆經 CLS 同步交收。',
    viaCash: 'NDF 只支付一筆差額。',
    workings: '計算過程：每個數字怎樣算出來',
    figures: (g: string) => `數字明細：${g}今日的額度使用情況`,
    figHead: ['百萬美元', '授信額度', '往日交易', '今日初始額度', '今日成交', '預佔', '本筆', '交易後可用額度'],
    psrRow: (k: string) => `交割前 ${k}`,
    srRow: (k: string) => `結算 ${k}`,
    notionalRow: '名義金額 360T',
    sent: '已送出的對沖',
    sentHead: ['對沖', '狀態', '風險敞口（美元）'],
    status: { IN_FLIGHT: '在途', FILLED: '已成交', REJECTED: '已拒絕', UNFILLED: '沒有成交', EXPIRED: '已失效', SETTLED: '已交收' },
    mio: '百萬',
    fill: '成交',
    reject: '拒絕',
    noMatch: '沒有成交',
    workingsBtn: '計算過程',
    valued: (id: string) => `${id}，按今日市場重估`,
    market: '市場數據：改動匯率，未到期的對沖即時重估',
    marketHint: '即期和掉期點決定新對沖的成交匯率，以及已成交對沖的市值。調高一個即期匯率，上面的額度條就會變動。',
    points: '掉期點（點）',
    spot: '即期',
    usdRate: '美元利率 %',
    lines: '額度管理：交易員每日維護的額度、附加因子和交易對手清單',
    linesHint: '各對手的額度由部門切分，交易員每日在這裡輸入。每次改動都記錄在下面。現階段按未淨額計，所以兩種淨額結算預設都是關的。',
    psrLine: (p: string) => `交割前 ${p}`,
    srLine: '結算（每日）',
    notionalLine: '360T 名義金額（每日）',
    notionalHead: '名義金額 360T',
    noLp: '沒有 LP',
    closeOut: '終止淨額結算',
    payNet: '支付淨額結算',
    addOn: '附加因子 %',
    warnAt: '預警線：額度用到這個百分比就提示',
    offset: '市值為負時保留全部附加金額：max(市值, 0) + 附加金額。這是巴塞爾的標準方法。不勾選就用額度系統的做法：max(市值 + 附加金額, 0)。',
    changes: '變更記錄',
    noChanges: '沒有改過任何額度。',
    changeHead: ['日期', '銀行集團', '額度', '原來', '改為'],
    parties: '交易對手清單',
    partiesHint: '渠道上的每個 LP 對應一個交易對手，每個交易對手對應持有額度的銀行集團（root parent）。從清單剔除的 LP 不會收到對沖。事後披露的場地上交易台不能選對手，所以這張清單在那裡不適用。',
    partyHead: ['渠道上的 LP', '渠道', '銀行集團', '在清單上'],
    books: '事後披露的場地',
    booksHint: '掛到這類場地的訂單，會對場地上每個開通的對手檢查並預佔。交易台不能從自己這邊單獨擋住一個對手。停用對手，是管理場地額度的人在場地上把它的限額設為零；下面取消勾選，代表他們已經改了。關掉檢查的話，交易台只靠場地的限額，成交後才記帳。',
    bookCheck: '掛單前對每個對手檢查並預佔',
    bookParties: '在場地上開通的對手',
    errors: {
      USE_SWAP_OR_FORWARD: (p: string) => `${p} 可交割：請用掉期或遠期。`,
      NDF_ONLY: (p: string) => `${p} 只能做 NDF。`,
      TENOR: () => '這個產品沒有這個期限。',
      AMOUNT: () => '請輸入金額。',
      TOO_LARGE: (_p: string, max: string) => `本程式每筆對沖最多 5,000 萬美元，即 ${max} 百萬。請輸入這個數或以下；較大的單分成幾筆輸入。`,
      NO_TOM_NEXT: () => '今日沒有 T/N：明日已經是即期交割日。',
      NOT_CLS_PAIR: (p: string) => `${p} 不能經 CLS 交收。`,
      BOOK_PRODUCT: () => '這個場地在本程式只做一種產品：EBS Market 做 NDF，LSEG Forwards Matching 做掉期。',
      BOOK_EMPTY: () => '這個場地上沒有開通的對手。',
      LP_OFF_LIST: () => '這個 LP 不在交易對手清單上，不能向它送出對沖。清單在下面的「額度管理」裡。',
    } as Record<TicketError, (pair: string, max: string) => string>,
  },
};

function withProduct(t: Ticket, product: Product): Ticket {
  const pair = product === 'NDF' ? 'USDTWD' : PAIRS[t.pair].deliverable ? t.pair : 'EURUSD';
  const tenors = product === 'SWAP' ? SWAP_TENORS : OUTRIGHT_TENORS;
  return { ...t, product, pair, tenor: tenors.includes(t.tenor) ? t.tenor : '3M', settlement: 'AUTO' };
}

/** The largest amount one ticket may carry, in the pair's base currency: 'EUR 42.9'. */
const largestTicket = (ctx: Ctx, pair: PairId) => {
  const base = PAIRS[pair].base;
  return `${base} ${num(Math.floor(MAX_AMOUNT_USD / usdPerUnit(ctx.market, base) / 1e5) / 10, 1)}`;
};

const lpLabel = (s: AppState, lpId: string, lang: Lang) => {
  const lp = s.lps.find((l) => l.id === lpId)!;
  return `${partyName(lp.name, lang)} · ${CHANNELS[lp.channel].label}`;
};

const BOOKS = (Object.keys(CHANNELS) as Channel[]).filter((c) => CHANNELS[c].disclosed === 'AFTER');

/** One credit line as the screen shows it: what is in use, what this hedge adds, what is left. */
interface LineRow {
  key: string;
  label: string;
  line: number;
  board?: BoardRow; // absent for a date only this hedge touches
  used: number; // filled hedges
  reserved: number; // hedges in flight
  hedge: number; // this ticket
  after: number;
  ok: boolean;
  warn: boolean; // within the line, but at or past the warning level
}

interface GroupRows {
  psr: LineRow[];
  sr: LineRow[];
  notional?: LineRow; // gross notional dealt today on 360T, when the group has an LP there
}

/** One counterparty an order on a book could fill with: its lines, and the check once the ticket has an amount. */
type BookView = GroupRows & { group: Group; check?: CheckResult };

function lineRows(warnPct: number, keys: string[], label: (k: string) => string, line: (i: number) => number, b: BoardRow[], c?: CheckRow[]): LineRow[] {
  return keys.map((key, i) => {
    const br = b.find((r) => r.key === key);
    const cr = c?.find((r) => r.key === key);
    const before = br?.used ?? 0;
    const after = cr ? cr.after : before;
    return {
      key,
      label: label(key),
      line: line(i),
      board: br,
      used: (br?.earlier ?? 0) + (br?.today ?? 0),
      reserved: br?.reserved ?? 0,
      hedge: cr ? cr.after - cr.before : 0,
      after,
      ok: cr ? cr.ok : after <= line(i) + 0.5,
      warn: lineStatus(after, line(i), warnPct) === 'WARN',
    };
  });
}

export function Simulator({ state, dispatch }: { state: AppState; dispatch: Dispatch<Action> }) {
  const lang = useLang();
  const t = T[lang];
  const ctx = useMemo(() => makeCtx(state), [state.businessDate, state.market, state.addOnPct, state.offsetNegativeMv]);
  const [ticket, setTicket] = useState(DEFAULT_TICKET);
  const [openId, setOpenId] = useState<string | null>(null);

  // With no amount there is no hedge to check yet. A ticket of one unit still says what else is wrong with it,
  // who could fill it and which pillars it would count in; it is never checked or sent.
  const blank = !(ticket.amount > 0);
  const trades = candidates(ctx, state, blank ? { ...ticket, amount: 1 } : ticket);
  const idle = blank && !('error' in trades);
  // On a book the desk cannot choose the counterparty: the order is checked against everyone who could fill it.
  const book = bookOf(state, ticket);
  const checks = 'error' in trades || idle ? [] : trades.map((x) => checkTrade(ctx, state, x));
  /** Send what is on the ticket, then clear its amount: the lines go back to what is in use and reserved. */
  const send = (a: Action) => {
    dispatch(a);
    setTicket({ ...ticket, amount: 0 });
  };
  /** Whether a ticket changed this way could be sent: true, false with the reason for a screen reader, or null when the ticket itself is wrong. */
  const fits = (to: Partial<Ticket>): { ok: boolean; why: string } | null => {
    const other = candidates(ctx, state, { ...ticket, ...to });
    if ('error' in other) return other.error === 'LP_OFF_LIST' ? { ok: false, why: t.offList } : null;
    const ok = other.every((x) => checkTrade(ctx, state, x).ok);
    return { ok, why: ok ? t.hasRoom : t.noRoom };
  };
  const chip = (key: string, label: string, pressed: boolean, mark: { ok: boolean; why: string } | null, onClick: () => void) => (
    <button key={key} type="button" className="chip" aria-pressed={pressed} onClick={onClick}>
      {mark && (
        <span className={mark.ok ? 'mark-ok' : 'mark-bad'} aria-hidden="true">
          {mark.ok ? '✓' : '✕'}
        </span>
      )}
      {label}
      <span className="sr-only">{mark?.why}</span>
    </button>
  );
  const rowsFor = (group: Group, c?: CheckResult, onNotional = false): GroupRows => {
    const b = board(ctx, state, group.id);
    const srKeys = [...new Set([...b.sr.map((r) => r.key), ...(c?.sr.map((r) => r.key) ?? [])])].sort();
    return {
      psr: lineRows(state.warnPct, [...PILLARS], (k) => k, (i) => group.psrLines[i], b.psr, c?.psr),
      sr: lineRows(state.warnPct, srKeys, (k) => shortDay(k, lang), () => group.srLine, b.sr, c?.sr),
      // Only a hedge sent on 360T counts against this line, so it shows only for an LP there.
      notional: onNotional && b.notional ? lineRows(state.warnPct, [NOTIONAL_CHANNEL], (k) => k, () => group.notionalLine, [b.notional], c?.notional && [c.notional])[0] : undefined,
    };
  };

  const check = checks[0];
  const group = groupOf(state, ticket.lpId);
  const groupName = partyName(group.name, lang);
  const { psr, sr, notional } = rowsFor(group, book ? undefined : check, !book && state.lps.find((l) => l.id === ticket.lpId)!.channel === NOTIONAL_CHANNEL);

  return (
    <>
      <section className="card">
        <TicketRow ticket={ticket} onChange={setTicket} ctx={ctx} />
        <div className="lp-row">
          <span className="label">{t.sendTo}</span>
          <div className="chips" role="group" aria-label={t.lpGroup}>
            {state.lps
              .filter((lp) => CHANNELS[lp.channel].disclosed === 'BEFORE')
              .map((lp) =>
                chip(lp.id, lpLabel(state, lp.id, lang), !book && lp.id === ticket.lpId, fits({ lpId: lp.id, book: undefined }), () => setTicket({ ...ticket, lpId: lp.id, book: undefined })),
              )}
          </div>
        </div>
        <div className="lp-row">
          <span className="label">{t.orBook}</span>
          <div className="chips" role="group" aria-label={t.bookGroup}>
            {BOOKS.map((c) => {
              // Choosing the book also sets the one product this app sends there.
              const to = withProduct({ ...ticket, book: c }, CHANNELS[c].only ?? ticket.product);
              return chip(c, CHANNELS[c].label, book === c, fits(to), () => setTicket(to));
            })}
          </div>
        </div>
      </section>

      <section className="card">
        {book ? (
          <BookPanel
            ctx={ctx}
            state={state}
            ticket={ticket}
            book={book}
            error={'error' in trades ? trades.error : null}
            pillar={'error' in trades ? -1 : valueTrade(ctx, trades[0]).pillar}
            views={'error' in trades ? [] : trades.map((x, i) => ({ group: groupOf(state, x.lpId), check: checks[i], ...rowsFor(groupOf(state, x.lpId), checks[i]) }))}
            send={send}
          />
        ) : (
          <>
            {'error' in trades ? (
              <p className="alert" role="alert">
                {t.errors[trades.error](PAIRS[ticket.pair].label, largestTicket(ctx, ticket.pair))}
              </p>
            ) : idle ? (
              <Idle text={t.idle(groupName)} action={t.send} />
            ) : (
              <Verdict trade={check.trade} check={check} warnPct={state.warnPct} onSend={() => send({ type: 'SEND', ticket })} />
            )}

            <LineBars title={t.psr} group={groupName} rows={psr} legend withHedge={!!check} />
            {check && PILLARS[check.risk.pillar] && <p className="quiet pillar-why">{t.pillarWhy(PILLARS[check.risk.pillar])}</p>}
            {sr.length > 0 ? (
              <LineBars title={t.sr} group={groupName} rows={sr} />
            ) : (
              <p className="quiet">
                <strong>{t.sr}</strong>
                {lang === 'zh' ? '：' : ': '}
                {t.srNone(groupName)} {check?.trade.settlement === 'CLS' && t.viaCls}
                {check?.trade.settlement === 'CASH' && t.viaCash}
              </p>
            )}
            {notional && <LineBars title={t.notional} group={groupName} rows={[notional]} />}
            {[...psr, ...sr, ...(notional ? [notional] : [])].some((r) => r.ok && r.warn) && <p className="quiet pillar-why">{t.warnNote(state.warnPct)}</p>}

            {check && (
              <details className="more">
                <summary>{t.workings}</summary>
                <Workings ctx={ctx} trade={check.trade} risk={check.risk} measured={check.after} group={group} isNew />
              </details>
            )}
            <details className="more">
              <summary>{t.figures(groupName)}</summary>
              <FiguresTable psr={psr} sr={sr} notional={notional} />
            </details>
          </>
        )}
      </section>

      <SentHedges ctx={ctx} state={state} dispatch={dispatch} openId={openId} onOpen={setOpenId} />

      <section className="settings">
        <MarketEditor state={state} dispatch={dispatch} />
        <LinesEditor state={state} dispatch={dispatch} />
        <BookEditor state={state} dispatch={dispatch} />
      </section>
    </>
  );
}

// ------------------------------------------------------------------ ticket
function TicketRow({ ticket, onChange, ctx }: { ticket: Ticket; onChange: (t: Ticket) => void; ctx: Ctx }) {
  const lang = useLang();
  const t = T[lang];
  const info = PAIRS[ticket.pair];
  const tenors = ticket.product === 'SWAP' ? SWAP_TENORS : OUTRIGHT_TENORS;
  const pairs = PAIR_IDS.filter((id) => PAIRS[id].deliverable === (ticket.product !== 'NDF'));
  // How a ticket settles does not depend on its amount, which may still be empty.
  const auto = buildTrade(ctx, { ...ticket, amount: 1, settlement: 'AUTO' });
  return (
    <div className="ticket">
      <div className="field">
        <span className="label">{t.product}</span>
        <div className="segmented" role="group" aria-label={t.product}>
          {(['SWAP', 'FORWARD', 'NDF'] as Product[]).map((p) => (
            <button key={p} type="button" aria-pressed={ticket.product === p} onClick={() => onChange(withProduct(ticket, p))}>
              {PRODUCT_LABEL[lang][p]}
            </button>
          ))}
        </div>
      </div>
      <label className="field">
        <span className="label">{t.pair}</span>
        <select value={ticket.pair} onChange={(e) => onChange({ ...ticket, pair: e.target.value as Ticket['pair'], settlement: 'AUTO' })}>
          {pairs.map((id) => (
            <option key={id} value={id}>
              {PAIRS[id].label}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span className="label">{t.direction}</span>
        <select value={ticket.side} onChange={(e) => onChange({ ...ticket, side: e.target.value as Ticket['side'] })}>
          <option value="BUY">{direction({ ...ticket, side: 'BUY' }, lang)}</option>
          <option value="SELL">{direction({ ...ticket, side: 'SELL' }, lang)}</option>
        </select>
      </label>
      <label className="field field-narrow">
        <span className="label">{t.amount(info.base)}</span>
        <NumInput blank label={t.amount(info.base)} value={ticket.amount / M} min={0} onChange={(v) => onChange({ ...ticket, amount: v * M })} />
      </label>
      <label className="field field-narrow">
        <span className="label">{t.tenor}</span>
        <select value={ticket.tenor} onChange={(e) => onChange({ ...ticket, tenor: e.target.value as Tenor, settlement: 'AUTO' })}>
          {tenors.map((x) => (
            <option key={x} value={x}>
              {x}
            </option>
          ))}
        </select>
      </label>
      {ticket.product !== 'NDF' && (
        <label className="field">
          <span className="label">{t.settlement}</span>
          <select value={ticket.settlement} onChange={(e) => onChange({ ...ticket, settlement: e.target.value as Ticket['settlement'] })}>
            <option value="AUTO">{t.standard('error' in auto ? '' : SETTLEMENT_LABEL[lang][auto.settlement])}</option>
            <option value="CLS">{SETTLEMENT_LABEL[lang].CLS}</option>
            <option value="GROSS">{SETTLEMENT_LABEL[lang].GROSS}</option>
          </select>
        </label>
      )}
    </div>
  );
}

// ----------------------------------------------------------------- verdict
/** No amount on the ticket yet: say what the bars below show and what entering one will do. */
function Idle({ text, action }: { text: string; action?: string }) {
  return (
    <div className="verdict-row">
      <p className="verdict-why">{text}</p>
      {action && (
        <button type="button" className="primary" disabled>
          {action}
        </button>
      )}
    </div>
  );
}

function Verdict({ trade, check, warnPct, onSend }: { trade: Trade; check: CheckResult; warnPct: number; onSend: () => void }) {
  const lang = useLang();
  const t = T[lang];
  const far = trade.legs[trade.legs.length - 1];
  const dates = trade.legs.length > 1 ? `${shortDay(trade.legs[0].date, lang)} → ${shortDay(far.date, lang)}` : shortDay(far.date, lang);
  const rates = trade.legs.map((l) => rate(trade.pair, l.rate)).join(' / ');
  const srAdded = Math.max(0, ...check.sr.map((r) => r.after - r.before));
  const g = partyName(check.group.name, lang);
  const psrFail = check.psr.find((r) => !r.ok);
  const srFail = check.sr.find((r) => !r.ok);
  const why = check.ok
    ? t.adds(mio(check.risk.exposure), srAdded > 0.5 ? mio(srAdded) : null, g)
    : psrFail
      ? t.psrOver(psrFail.key, mio(psrFail.after), mio(psrFail.line))
      : srFail
        ? t.srOver(shortDay(srFail.key, lang), mio(srFail.after), mio(srFail.line))
        : t.notionalOver(mio(check.notional!.after), mio(check.notional!.line));
  // Of the lines this hedge adds to, the fullest one that passes the warning level.
  const fullest = [
    ...check.psr.map((r) => ({ r, what: t.warnPsr(r.key) })),
    ...check.sr.map((r) => ({ r, what: t.warnSr(shortDay(r.key, lang)) })),
    ...(check.notional ? [{ r: check.notional, what: t.warnNotional }] : []),
  ]
    .filter(({ r }) => r.after > r.before + 0.5 && lineStatus(r.after, r.line, warnPct) === 'WARN')
    .sort((a, b) => b.r.after / b.r.line - a.r.after / a.r.line)[0];
  return (
    <div className="verdict-row">
      <div>
        <p className="verdict">
          <Status ok={check.ok}>{check.ok ? t.fits : t.blocked}</Status>
        </p>
        <p className="verdict-why">
          {why}
          {check.blockedByReservation && t.onlyReservation}
          {check.ok && fullest && t.warned(fullest.what, num((fullest.r.after / fullest.r.line) * 100, 0), warnPct)}
        </p>
        <p className="quiet">{t.at(dates, rates)}</p>
      </div>
      <button type="button" className="primary" disabled={!check.ok} onClick={onSend}>
        {t.send}
      </button>
    </div>
  );
}

/** Of one counterparty's lines, the one an order presses hardest: the worst breach, or else the least room left
 *  among the lines it adds to. With no amount yet, the least room left among the pillars it would count in. */
function tightest(v: GroupRows, name: string, srRow: (k: string) => string, pillar: number): LineRow {
  const rows = [...v.psr, ...v.sr.map((r) => ({ ...r, label: srRow(r.label) }))];
  const room = (a: LineRow, b: LineRow) => a.line - a.after - (b.line - b.after);
  const over = rows.filter((r) => !r.ok).sort(room)[0];
  const touched = rows.filter((r) => Math.abs(r.hedge) > 0.5).sort(room)[0];
  const r = over ?? touched ?? v.psr.slice(0, pillar + 1).sort(room)[0] ?? v.psr[0];
  return { ...r, key: name, label: `${name} · ${r.label}` };
}

/** An order on a book that names the counterparty after the trade: one check and one reservation for
 *  every counterparty that could fill it. With the check switched off, the channel alone decides. */
function BookPanel(p: {
  ctx: Ctx;
  state: AppState;
  ticket: Ticket;
  book: Channel;
  error: TicketError | null;
  pillar: number;
  views: BookView[];
  send: (a: Action) => void;
}) {
  const lang = useLang();
  const t = T[lang];
  const { ctx, state, ticket } = p;
  if (p.error) {
    return (
      <p className="alert" role="alert">
        {t.errors[p.error](PAIRS[ticket.pair].label, largestTicket(ctx, ticket.pair))}
      </p>
    );
  }
  const channel = CHANNELS[p.book].label;
  const checking = checksBook(state, p.book);
  const name = (g: Group) => partyName(g.name, lang);
  const views = p.views.filter((v): v is BookView & { check: CheckResult } => v.check !== undefined);
  const bars = (
    <LineBars title={t.eachTightest} group={channel} rows={p.views.map((v) => tightest(v, name(v.group), t.srRow, p.pillar))} legend withHedge={views.length > 0} wide />
  );
  if (views.length === 0) {
    return (
      <>
        <Idle text={t.idleBook(channel)} action={checking ? t.place : undefined} />
        {bars}
      </>
    );
  }
  const short = views.filter((v) => !v.check.ok).map((v) => name(v.group)).join(lang === 'zh' ? '、' : ', ');
  const ok = short === '';
  const largest = ok || !checking ? 0 : largestThatFits(ctx, state, ticket);
  const order = views[0].check.trade;
  const focus = views.find((v) => !v.check.ok) ?? views[0];
  return (
    <>
      <div className="verdict-row">
        <div>
          <p className="verdict">
            <Status ok={ok}>{ok ? t.bookFits : t.bookBlocked(short)}</Status>
          </p>
          <p className="verdict-why">
            {checking ? t.bookWhy(channel, views.length) : t.bookOff(channel)}
            {!ok && checking && (largest > 0 ? t.bookCap(PAIRS[ticket.pair].base, mio(largest), short) : t.bookCapNone(short))}
            {!ok && checking && views.every((v) => v.check.ok || v.check.blockedByReservation) && t.bookHeld}
            {!ok && !checking && t.bookOffOver(short)}
          </p>
          <p className="quiet">{t.at(shortDay(order.legs[0].date, lang), rate(order.pair, order.legs[0].rate))}</p>
        </div>
        {checking ? (
          <button type="button" className="primary" disabled={!ok} onClick={() => p.send({ type: 'SEND', ticket })}>
            {t.place}
          </button>
        ) : (
          <div className="verdict-actions">
            {views.map((v) => (
              <button key={v.check.trade.lpId} type="button" className="secondary" onClick={() => p.send({ type: 'BOOK_FILL', ticket, lpId: v.check.trade.lpId })}>
                {t.fillsWith(name(v.group))}
              </button>
            ))}
          </div>
        )}
      </div>

      {bars}

      <details className="more">
        <summary>{t.workingsFor(name(focus.group))}</summary>
        <Workings ctx={ctx} trade={focus.check.trade} risk={focus.check.risk} measured={focus.check.after} group={focus.group} isNew />
      </details>
      {views.map((v) => (
        <details key={v.group.id} className="more">
          <summary>{t.figures(name(v.group))}</summary>
          <FiguresTable psr={v.psr} sr={v.sr} />
        </details>
      ))}
    </>
  );
}

// ------------------------------------------------------------ credit lines
function LineBars({ title, group, rows, legend, withHedge, wide }: { title: string; group: string; rows: LineRow[]; legend?: boolean; withHedge?: boolean; wide?: boolean }) {
  const t = T[useLang()];
  return (
    <div className={wide ? 'lines lines-wide' : 'lines'}>
      <div className="lines-head">
        <h2>
          {title}{' '}
          <span className="quiet-inline">
            · {group} · {t.unit}
          </span>
        </h2>
        {legend && <BarLegend withHedge={withHedge} />}
      </div>
      {rows.map((r) => (
        <div key={r.key} className={Math.abs(r.hedge) < 0.5 && r.after < 0.5 ? 'line-row line-idle' : 'line-row'}>
          <span className="line-label">{r.label}</span>
          <LineBar label={r.label} line={r.line} parts={[r.used, r.reserved, r.hedge]} total={r.after} ok={r.ok} warn={r.warn} />
          <span className="line-figure">
            {!r.ok ? <Status ok={false}>{t.overBy(mio(r.after - r.line))}</Status> : r.warn ? <Status ok warn>{t.of(mio(r.after), mio(r.line))}</Status> : t.of(mio(r.after), mio(r.line))}
          </span>
        </div>
      ))}
    </div>
  );
}

function FiguresTable({ psr, sr, notional }: { psr: LineRow[]; sr: LineRow[]; notional?: LineRow }) {
  const t = T[useLang()];
  const rows = [...psr, ...sr, ...(notional ? [notional] : [])];
  const name = (r: LineRow, i: number) => (i < psr.length ? t.psrRow(r.label) : r === notional ? t.notionalRow : t.srRow(r.label));
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            {t.figHead.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.key} className={i === psr.length || r === notional ? 'group-start' : undefined}>
              <td>{name(r, i)}</td>
              <td>{mio(r.line)}</td>
              <td>{mio(r.board?.earlier ?? 0)}</td>
              <td>{mio(r.board?.initial ?? r.line)}</td>
              <td>{signedMio(r.board?.today ?? 0)}</td>
              <td>{signedMio(r.reserved)}</td>
              <td>{signedMio(r.hedge)}</td>
              <td>{r.after <= r.line + 0.5 ? mio(r.line - r.after) : <Status ok={false}>{t.overBy(mio(r.after - r.line))}</Status>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ------------------------------------------------------------- sent hedges
function SentHedges(p: { ctx: Ctx; state: AppState; dispatch: Dispatch<Action>; openId: string | null; onOpen: (id: string | null) => void }) {
  const lang = useLang();
  const t = T[lang];
  const { ctx, state } = p;
  if (state.trades.length === 0) return null;
  const open = state.trades.find((x) => x.id === p.openId);
  return (
    <section className="card">
      <h2 className="card-title">{t.sent}</h2>
      <div className="table-wrap">
        <table className="table hedges">
          <thead>
            <tr>
              <th />
              {t.sentHead.map((h) => (
                <th key={h}>{h}</th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {[...state.trades].reverse().map((x) => {
              const far = x.legs[x.legs.length - 1];
              const live = x.status === 'FILLED' || x.status === 'IN_FLIGHT';
              const settled = x.status === 'FILLED' && far.date < ctx.t0;
              const r = live && !settled ? valueTrade(ctx, x) : null;
              return (
                <tr key={x.id} className={live && !settled ? undefined : 'muted-row'}>
                  <td>{x.id}</td>
                  <td>
                    {direction(x, lang)} {amt(x.amount / M)} {t.mio} {x.tenor} {x.product === 'SWAP' ? '' : PRODUCT_LABEL[lang][x.product]} · {lpLabel(state, x.lpId, lang)}
                  </td>
                  <td>{settled ? t.status.SETTLED : t.status[x.status]}</td>
                  <td>{r ? `${mio(r.exposure)} ${t.mio}` : '–'}</td>
                  <td>
                    <span className="row-actions">
                      {x.status === 'IN_FLIGHT' && (
                        <>
                          <button type="button" onClick={() => p.dispatch({ type: 'FILL', id: x.id })}>
                            {t.fill}
                          </button>
                          <button type="button" onClick={() => p.dispatch({ type: 'REJECT', id: x.id })}>
                            {x.orderId ? t.noMatch : t.reject}
                          </button>
                        </>
                      )}
                      {r && (
                        <button type="button" className="link" aria-expanded={x.id === p.openId} onClick={() => p.onOpen(x.id === p.openId ? null : x.id)}>
                          {t.workingsBtn}
                        </button>
                      )}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {open && (open.status === 'FILLED' || open.status === 'IN_FLIGHT') && <ExistingWorkings ctx={ctx} state={state} trade={open} />}
    </section>
  );
}

function ExistingWorkings({ ctx, state, trade }: { ctx: Ctx; state: AppState; trade: Trade }) {
  const t = T[useLang()];
  const group = groupOf(state, trade.lpId);
  const { measured } = board(ctx, state, group.id);
  const risk = measured.risks.find((r) => r.trade.id === trade.id) ?? valueTrade(ctx, trade);
  return (
    <div className="detail">
      <p className="quiet">{t.valued(trade.id)}</p>
      <Workings ctx={ctx} trade={trade} risk={risk} measured={measured} group={group} isNew={false} />
    </div>
  );
}

// ---------------------------------------------------------------- settings
function MarketEditor({ state, dispatch }: { state: AppState; dispatch: Dispatch<Action> }) {
  const t = T[useLang()];
  const edit = (change: (d: AppState) => void) => dispatch({ type: 'EDIT', change });
  return (
    <details className="more">
      <summary>{t.market}</summary>
      <p className="quiet hint">{t.marketHint}</p>
      <div className="table-wrap">
        <table className="table edit-table">
          <thead>
            <tr>
              <th>{t.points}</th>
              <th>{t.spot}</th>
              {POINT_TENORS.map((x) => (
                <th key={x}>{x}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PAIR_IDS.map((id) => (
              <tr key={id}>
                <td>{PAIRS[id].label}</td>
                <td>
                  <NumInput label={`${PAIRS[id].label} ${t.spot}`} className="wide" value={state.market.pairs[id].spot} onChange={(v) => v > 0 && edit((d) => void (d.market.pairs[id].spot = v))} />
                </td>
                {POINT_TENORS.map((x) => (
                  <td key={x}>
                    <NumInput label={`${PAIRS[id].label} ${x}`} value={state.market.pairs[id].points[x]} onChange={(v) => edit((d) => void (d.market.pairs[id].points[x] = v))} />
                  </td>
                ))}
              </tr>
            ))}
            <tr className="group-start">
              <td>{t.usdRate}</td>
              <td />
              {POINT_TENORS.map((x) => (
                <td key={x}>
                  {RATE_TENORS.includes(x as RateTenor) && (
                    <NumInput label={`${t.usdRate} ${x}`} value={state.market.usdRates[x as RateTenor]} onChange={(v) => edit((d) => void (d.market.usdRates[x as RateTenor] = v))} />
                  )}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </details>
  );
}

function LinesEditor({ state, dispatch }: { state: AppState; dispatch: Dispatch<Action> }) {
  const lang = useLang();
  const t = T[lang];
  const edit = (change: (d: AppState) => void) => dispatch({ type: 'EDIT', change });
  /** A line keyed in by the trader: the change goes on the record. */
  const setLine = (groupId: string, line: string) => (v: number) => v >= 0 && dispatch({ type: 'SET_LINE', groupId, line, value: v * M });
  const name = (g: Group) => partyName(g.name, lang);
  const groupName = (id: string) => name(state.groups.find((g) => g.id === id)!);
  const lineName = (line: string) => (line === SR_LINE ? t.srLine : line === NOTIONAL_LINE ? t.notionalLine : t.psrLine(line.slice(4)));
  const on360T = (g: Group) => state.lps.some((l) => l.groupId === g.id && l.channel === NOTIONAL_CHANNEL);
  return (
    <details className="more">
      <summary>{t.lines}</summary>
      <p className="quiet hint">{t.linesHint}</p>
      <div className="table-wrap">
        <table className="table edit-table">
          <thead>
            <tr>
              <th>{t.unit}</th>
              {PILLARS.map((p) => (
                <th key={p}>{t.psrLine(p)}</th>
              ))}
              <th>{t.srLine}</th>
              <th>{t.notionalHead}</th>
              <th>{t.closeOut}</th>
              <th>{t.payNet}</th>
            </tr>
          </thead>
          <tbody>
            {state.groups.map((g, gi) => (
              <tr key={g.id}>
                <td>{name(g)}</td>
                {PILLARS.map((p, pi) => (
                  <td key={p}>
                    <NumInput label={`${name(g)} ${t.psrLine(p)}`} value={g.psrLines[pi] / M} min={0} onChange={setLine(g.id, psrLine(pi))} />
                  </td>
                ))}
                <td>
                  <NumInput label={`${name(g)} ${t.srLine}`} value={g.srLine / M} min={0} onChange={setLine(g.id, SR_LINE)} />
                </td>
                <td>
                  {on360T(g) ? (
                    <NumInput label={`${name(g)} ${t.notionalLine}`} value={g.notionalLine / M} min={0} onChange={setLine(g.id, NOTIONAL_LINE)} />
                  ) : (
                    <span className="quiet-inline">{t.noLp}</span>
                  )}
                </td>
                <td>
                  <input type="checkbox" aria-label={`${name(g)} ${t.closeOut}`} checked={g.closeOutNetting} onChange={(e) => edit((d) => void (d.groups[gi].closeOutNetting = e.target.checked))} />
                </td>
                <td>
                  <input type="checkbox" aria-label={`${name(g)} ${t.payNet}`} checked={g.paymentNetting} onChange={(e) => edit((d) => void (d.groups[gi].paymentNetting = e.target.checked))} />
                </td>
              </tr>
            ))}
            <tr className="group-start">
              <td>{t.addOn}</td>
              {PILLARS.map((p, pi) => (
                <td key={p}>
                  <NumInput label={`${t.addOn} ${p}`} value={state.addOnPct[pi]} min={0} onChange={(v) => v >= 0 && edit((d) => void (d.addOnPct[pi] = v))} />
                </td>
              ))}
              <td colSpan={4} />
            </tr>
          </tbody>
        </table>
      </div>
      <label className="setting setting-number">
        <NumInput label={t.warnAt} value={state.warnPct} min={0} onChange={(v) => v >= 0 && v <= 100 && edit((d) => void (d.warnPct = v))} />
        <span>{t.warnAt}</span>
      </label>
      <label className="setting">
        <input type="checkbox" checked={!state.offsetNegativeMv} onChange={(e) => edit((d) => void (d.offsetNegativeMv = !e.target.checked))} />
        <span>{t.offset}</span>
      </label>

      <h3 className="sub-title">{t.changes}</h3>
      {state.limitLog.length === 0 ? (
        <p className="quiet">{t.noChanges}</p>
      ) : (
        <div className="table-wrap">
          <table className="table records">
            <thead>
              <tr>
                {t.changeHead.map((h, i) => (
                  <th key={h} className={i > 2 ? 'num' : undefined}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...state.limitLog].reverse().map((c, i) => (
                <tr key={i}>
                  <td>{day(c.date, lang)}</td>
                  <td>{groupName(c.groupId)}</td>
                  <td>{lineName(c.line)}</td>
                  <td className="num">{mio(c.from)}</td>
                  <td className="num">{mio(c.to)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3 className="sub-title">{t.parties}</h3>
      <p className="quiet hint">{t.partiesHint}</p>
      <div className="table-wrap">
        <table className="table records">
          <thead>
            <tr>
              {t.partyHead.map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {state.lps
              .filter((lp) => CHANNELS[lp.channel].disclosed === 'BEFORE')
              .map((lp) => (
                <tr key={lp.id}>
                  <td>{partyName(lp.name, lang)}</td>
                  <td>{CHANNELS[lp.channel].label}</td>
                  <td>{groupName(lp.groupId)}</td>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`${partyName(lp.name, lang)} ${CHANNELS[lp.channel].label} ${t.partyHead[3]}`}
                      checked={!state.blocked.includes(lp.id)}
                      onChange={(e) => dispatch({ type: 'LIST_LP', lpId: lp.id, on: e.target.checked })}
                    />
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function BookEditor({ state, dispatch }: { state: AppState; dispatch: Dispatch<Action> }) {
  const lang = useLang();
  const t = T[lang];
  return (
    <details className="more">
      <summary>{t.books}</summary>
      <p className="quiet hint">{t.booksHint}</p>
      {BOOKS.map((c) => (
        <fieldset key={c} className="book">
          <legend>{CHANNELS[c].label}</legend>
          <label className="setting">
            <input type="checkbox" checked={checksBook(state, c)} onChange={(e) => dispatch({ type: 'SWITCH_BOOK_CHECK', channel: c, on: e.target.checked })} />
            <span>{t.bookCheck}</span>
          </label>
          <div className="book-parties" role="group" aria-label={t.bookParties}>
            <span className="label">{t.bookParties}</span>
            {state.lps
              .filter((lp) => lp.channel === c)
              .map((lp) => (
                <label key={lp.id} className="setting">
                  <input type="checkbox" checked={!state.channelOff.includes(lp.id)} onChange={(e) => dispatch({ type: 'SWITCH_ON_CHANNEL', lpId: lp.id, on: e.target.checked })} />
                  <span>{partyName(lp.name, lang)}</span>
                </label>
              ))}
          </div>
        </fieldset>
      ))}
    </details>
  );
}
