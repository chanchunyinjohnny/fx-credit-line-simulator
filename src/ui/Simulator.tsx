import { useMemo, useState, type Dispatch } from 'react';
import { OUTRIGHT_TENORS, PAIRS, PAIR_IDS, PILLARS, SWAP_TENORS } from '../engine/calendar';
import { CHANNELS, checksBook } from '../engine/channels';
import { board, checkTrade, groupOf, type BoardRow, type CheckResult, type CheckRow } from '../engine/lines';
import { makeCtx, valueTrade, type Ctx } from '../engine/risk';
import { bookOf, buildTrade, candidates, largestThatFits, type Action, type TicketError } from '../engine/state';
import type { AppState, Channel, Group, Product, RateTenor, Tenor, Ticket, Trade } from '../engine/types';
import { NumInput, Status } from './bits';
import { PRODUCT_LABEL, SETTLEMENT_LABEL, amt, direction, mio, partyName, rate, shortDay, signedMio } from './format';
import { useLang, type Lang } from './i18n';
import { BarLegend, LineBar } from './LineBar';
import { Workings } from './Workings';

const M = 1_000_000;
const DEFAULT_TICKET: Ticket = { product: 'SWAP', pair: 'EURUSD', side: 'BUY', amount: 20 * M, tenor: '3M', lpId: 'A-LDN-360T', settlement: 'AUTO' };
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
    fits: 'Fits',
    blocked: 'Blocked',
    adds: (psr: string, sr: string | null, g: string) =>
      `Adds USD ${psr} mio of pre-settlement risk${sr ? ` and up to ${sr} mio of settlement risk a day` : ''} to ${g}.`,
    psrOver: (k: string, a: string, l: string) => `Pre-settlement risk at ${k} would reach ${a} against a line of ${l}.`,
    srOver: (d: string, a: string, l: string) => `Settlement risk on ${d} would reach ${a} against a line of ${l}.`,
    onlyReservation: ' On its own this hedge would fit. Another hedge has been sent and has no answer yet, so its room is still held. If that one is rejected, this one fits.',
    bookFits: 'Every counterparty has room',
    bookBlocked: (g: string) => `No room with ${g}`,
    bookWhy: (ch: string, n: number) =>
      `${ch} names the counterparty only after the trade, and the desk cannot choose it. The order could fill with any of ${n} counterparties, so it is checked against each and reserved on each.`,
    bookCap: (ccy: string, x: string, g: string) => ` The largest order all of them have room for is ${ccy} ${x} mio. A larger one needs ${g} switched off at the channel, which only its credit administrator can do.`,
    bookCapNone: (g: string) => ` No size fits while ${g} is switched on at the channel. The desk cannot keep one counterparty out on its own.`,
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
    lines: 'Credit lines and add-ons, set by the credit owner',
    psrLine: (p: string) => `PSR ${p}`,
    srLine: 'SR per day',
    closeOut: 'Close-out netting',
    payNet: 'Payment netting',
    addOn: 'Add-on, %',
    offset: 'Let a negative market value reduce the add-on. This is an internal variant; the standard method keeps the add-on in full.',
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
      TOO_LARGE: () => 'This flow covers hedges up to USD 50 mio with one LP. Enter a larger order as several hedges.',
      NO_TOM_NEXT: () => 'Tom-next does not exist today: tomorrow is already the spot date.',
      NOT_CLS_PAIR: (p: string) => `${p} cannot settle through CLS.`,
      BOOK_PRODUCT: () => 'This channel takes NDFs only here.',
      BOOK_EMPTY: () => 'No counterparty is switched on at this channel.',
    } as Record<TicketError, (pair: string) => string>,
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
    fits: '額度足夠',
    blocked: '額度不足',
    adds: (psr: string, sr: string | null, g: string) => `${g}的交割前風險增加 ${psr} 百萬美元${sr ? `，結算風險每日最多增加 ${sr} 百萬美元` : ''}。`,
    psrOver: (k: string, a: string, l: string) => `${k} 期限檔的交割前風險將達 ${a}，額度只有 ${l}。`,
    srOver: (d: string, a: string, l: string) => `${d} 的結算風險將達 ${a}，額度只有 ${l}。`,
    onlyReservation: '這筆單獨放得進。但另一筆已經送出、還沒有結果，它的額度先留著。那一筆被拒絕的話，這筆就放得進。',
    bookFits: '每個對手都放得下',
    bookBlocked: (g: string) => `${g}的額度不夠`,
    bookWhy: (ch: string, n: number) => `${ch} 成交後才披露對手，交易台不能選對手。這張單可能和 ${n} 個對手之中任何一個成交，所以每一個都要檢查並預佔。`,
    bookCap: (ccy: string, x: string, g: string) => `每個對手都放得下的最大金額是 ${ccy} ${x} 百萬。要掛更大的單，要由管理場地額度的人在場地上停用 ${g}。`,
    bookCapNone: (g: string) => `只要 ${g}在場地上還開通，任何金額都放不下。交易台不能單獨擋住一個對手。`,
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
    lines: '授信額度與附加因子（由授信管理部門設定）',
    psrLine: (p: string) => `交割前 ${p}`,
    srLine: '結算（每日）',
    closeOut: '終止淨額結算',
    payNet: '支付淨額結算',
    addOn: '附加因子 %',
    offset: '負市值可減少附加金額。這是內部做法；標準方法保留全部附加金額。',
    books: '事後披露的場地',
    booksHint: '掛到這類場地的訂單，會對場地上每個開通的對手檢查並預佔。交易台不能從自己這邊單獨擋住一個對手。停用對手，是管理場地額度的人在場地上把它的限額設為零；下面取消勾選，代表他們已經改了。關掉檢查的話，交易台只靠場地的限額，成交後才記帳。',
    bookCheck: '掛單前對每個對手檢查並預佔',
    bookParties: '在場地上開通的對手',
    errors: {
      USE_SWAP_OR_FORWARD: (p: string) => `${p} 可交割：請用掉期或遠期。`,
      NDF_ONLY: (p: string) => `${p} 只能做 NDF。`,
      TENOR: () => '這個產品沒有這個期限。',
      AMOUNT: () => '請輸入金額。',
      TOO_LARGE: () => '本流程只涵蓋單一 LP、5,000 萬美元以內的對沖。較大的單請分成幾筆輸入。',
      NO_TOM_NEXT: () => '今日沒有 T/N：明日已經是即期交割日。',
      NOT_CLS_PAIR: (p: string) => `${p} 不能經 CLS 交收。`,
      BOOK_PRODUCT: () => '這個場地在本程式只做 NDF。',
      BOOK_EMPTY: () => '這個場地上沒有開通的對手。',
    } as Record<TicketError, (pair: string) => string>,
  },
};

function withProduct(t: Ticket, product: Product): Ticket {
  const pair = product === 'NDF' ? 'USDTWD' : PAIRS[t.pair].deliverable ? t.pair : 'EURUSD';
  const tenors = product === 'SWAP' ? SWAP_TENORS : OUTRIGHT_TENORS;
  return { ...t, product, pair, tenor: tenors.includes(t.tenor) ? t.tenor : '3M', settlement: 'AUTO' };
}

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
}

interface GroupRows {
  psr: LineRow[];
  sr: LineRow[];
}

function lineRows(keys: string[], label: (k: string) => string, line: (i: number) => number, b: BoardRow[], c?: CheckRow[]): LineRow[] {
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
    };
  });
}

export function Simulator({ state, dispatch }: { state: AppState; dispatch: Dispatch<Action> }) {
  const lang = useLang();
  const t = T[lang];
  const ctx = useMemo(() => makeCtx(state), [state.businessDate, state.market, state.addOnPct, state.offsetNegativeMv]);
  const [ticket, setTicket] = useState(DEFAULT_TICKET);
  const [openId, setOpenId] = useState<string | null>(null);

  const trades = candidates(ctx, state, ticket);
  // On a book the desk cannot choose the counterparty: the order is checked against everyone who could fill it.
  const book = bookOf(state, ticket);
  const checks = 'error' in trades ? [] : trades.map((x) => checkTrade(ctx, state, x));
  const fits = (to: Partial<Ticket>) => {
    const other = candidates(ctx, state, { ...ticket, ...to });
    return 'error' in other ? null : other.every((x) => checkTrade(ctx, state, x).ok);
  };
  const chip = (key: string, label: string, pressed: boolean, ok: boolean | null, onClick: () => void) => (
    <button key={key} type="button" className="chip" aria-pressed={pressed} onClick={onClick}>
      {ok !== null && (
        <span className={ok ? 'mark-ok' : 'mark-bad'} aria-hidden="true">
          {ok ? '✓' : '✕'}
        </span>
      )}
      {label}
      <span className="sr-only">{ok === null ? '' : ok ? t.hasRoom : t.noRoom}</span>
    </button>
  );
  const rowsFor = (group: Group, c?: CheckResult): GroupRows => {
    const b = board(ctx, state, group.id);
    const srKeys = [...new Set([...b.sr.map((r) => r.key), ...(c?.sr.map((r) => r.key) ?? [])])].sort();
    return {
      psr: lineRows([...PILLARS], (k) => k, (i) => group.psrLines[i], b.psr, c?.psr),
      sr: lineRows(srKeys, (k) => shortDay(k, lang), () => group.srLine, b.sr, c?.sr),
    };
  };

  const check = checks[0];
  const group = groupOf(state, ticket.lpId);
  const groupName = partyName(group.name, lang);
  const { psr, sr } = rowsFor(group, book ? undefined : check);

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
            views={checks.map((c) => ({ check: c, ...rowsFor(c.group, c) }))}
            dispatch={dispatch}
          />
        ) : (
          <>
            {'error' in trades ? (
              <p className="alert" role="alert">
                {t.errors[trades.error](PAIRS[ticket.pair].label)}
              </p>
            ) : (
              <Verdict trade={check.trade} check={check} onSend={() => dispatch({ type: 'SEND', ticket })} />
            )}

            <LineBars title={t.psr} group={groupName} rows={psr} legend />
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

            {check && (
              <details className="more">
                <summary>{t.workings}</summary>
                <Workings ctx={ctx} trade={check.trade} risk={check.risk} measured={check.after} group={group} isNew />
              </details>
            )}
            <details className="more">
              <summary>{t.figures(groupName)}</summary>
              <FiguresTable psr={psr} sr={sr} />
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
  const auto = buildTrade(ctx, { ...ticket, settlement: 'AUTO' });
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
        <NumInput label={t.amount(info.base)} value={ticket.amount / M} min={0} onChange={(v) => onChange({ ...ticket, amount: v * M })} />
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
function Verdict({ trade, check, onSend }: { trade: Trade; check: CheckResult; onSend: () => void }) {
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
      : t.srOver(shortDay(srFail!.key, lang), mio(srFail!.after), mio(srFail!.line));
  return (
    <div className="verdict-row">
      <div>
        <p className="verdict">
          <Status ok={check.ok}>{check.ok ? t.fits : t.blocked}</Status>
        </p>
        <p className="verdict-why">
          {why}
          {check.blockedByReservation && t.onlyReservation}
        </p>
        <p className="quiet">{t.at(dates, rates)}</p>
      </div>
      <button type="button" className="primary" disabled={!check.ok} onClick={onSend}>
        {t.send}
      </button>
    </div>
  );
}

/** Of one counterparty's lines, the one this order presses hardest: the worst breach, or else the least room left. */
function tightest(rows: LineRow[], name: string): LineRow {
  const over = rows.filter((r) => !r.ok).sort((a, b) => b.after - b.line - (a.after - a.line))[0];
  const touched = rows.filter((r) => Math.abs(r.hedge) > 0.5).sort((a, b) => a.line - a.after - (b.line - b.after))[0];
  const r = over ?? touched ?? rows[0];
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
  views: ({ check: CheckResult } & GroupRows)[];
  dispatch: Dispatch<Action>;
}) {
  const lang = useLang();
  const t = T[lang];
  const { ctx, state, ticket, views } = p;
  if (p.error) {
    return (
      <p className="alert" role="alert">
        {t.errors[p.error](PAIRS[ticket.pair].label)}
      </p>
    );
  }
  const channel = CHANNELS[p.book].label;
  const checking = checksBook(state, p.book);
  const name = (c: CheckResult) => partyName(c.group.name, lang);
  const short = views.filter((v) => !v.check.ok).map((v) => name(v.check)).join(lang === 'zh' ? '、' : ', ');
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
            {!ok && !checking && t.bookOffOver(short)}
          </p>
          <p className="quiet">{t.at(shortDay(order.legs[0].date, lang), rate(order.pair, order.legs[0].rate))}</p>
        </div>
        {checking ? (
          <button type="button" className="primary" disabled={!ok} onClick={() => p.dispatch({ type: 'SEND', ticket })}>
            {t.place}
          </button>
        ) : (
          <div className="verdict-actions">
            {views.map((v) => (
              <button key={v.check.trade.lpId} type="button" className="secondary" onClick={() => p.dispatch({ type: 'BOOK_FILL', ticket, lpId: v.check.trade.lpId })}>
                {t.fillsWith(name(v.check))}
              </button>
            ))}
          </div>
        )}
      </div>

      <LineBars title={t.eachTightest} group={channel} rows={views.map((v) => tightest([...v.psr, ...v.sr], name(v.check)))} legend wide />

      <details className="more">
        <summary>{t.workingsFor(name(focus.check))}</summary>
        <Workings ctx={ctx} trade={focus.check.trade} risk={focus.check.risk} measured={focus.check.after} group={focus.check.group} isNew />
      </details>
      {views.map((v) => (
        <details key={v.check.group.id} className="more">
          <summary>{t.figures(name(v.check))}</summary>
          <FiguresTable psr={v.psr} sr={v.sr} />
        </details>
      ))}
    </>
  );
}

// ------------------------------------------------------------ credit lines
function LineBars({ title, group, rows, legend, wide }: { title: string; group: string; rows: LineRow[]; legend?: boolean; wide?: boolean }) {
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
        {legend && <BarLegend withHedge />}
      </div>
      {rows.map((r) => (
        <div key={r.key} className={Math.abs(r.hedge) < 0.5 && r.after < 0.5 ? 'line-row line-idle' : 'line-row'}>
          <span className="line-label">{r.label}</span>
          <LineBar label={r.label} line={r.line} parts={[r.used, r.reserved, r.hedge]} total={r.after} ok={r.ok} />
          <span className="line-figure">{r.ok ? t.of(mio(r.after), mio(r.line)) : <Status ok={false}>{t.overBy(mio(r.after - r.line))}</Status>}</span>
        </div>
      ))}
    </div>
  );
}

function FiguresTable({ psr, sr }: { psr: LineRow[]; sr: LineRow[] }) {
  const t = T[useLang()];
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
          {[...psr, ...sr].map((r, i) => (
            <tr key={r.key} className={i === psr.length ? 'group-start' : undefined}>
              <td>{i < psr.length ? t.psrRow(r.label) : t.srRow(r.label)}</td>
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
  const name = (g: Group) => partyName(g.name, lang);
  return (
    <details className="more">
      <summary>{t.lines}</summary>
      <div className="table-wrap">
        <table className="table edit-table">
          <thead>
            <tr>
              <th>{t.unit}</th>
              {PILLARS.map((p) => (
                <th key={p}>{t.psrLine(p)}</th>
              ))}
              <th>{t.srLine}</th>
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
                    <NumInput label={`${name(g)} ${t.psrLine(p)}`} value={g.psrLines[pi] / M} min={0} onChange={(v) => v >= 0 && edit((d) => void (d.groups[gi].psrLines[pi] = v * M))} />
                  </td>
                ))}
                <td>
                  <NumInput label={`${name(g)} ${t.srLine}`} value={g.srLine / M} min={0} onChange={(v) => v >= 0 && edit((d) => void (d.groups[gi].srLine = v * M))} />
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
              <td colSpan={3} />
            </tr>
          </tbody>
        </table>
      </div>
      <label className="setting">
        <input type="checkbox" checked={state.offsetNegativeMv ?? false} onChange={(e) => edit((d) => void (d.offsetNegativeMv = e.target.checked))} />
        <span>{t.offset}</span>
      </label>
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
