import { useMemo, useState, type Dispatch } from 'react';
import { OUTRIGHT_TENORS, PAIRS, PAIR_IDS, PILLARS, SWAP_TENORS } from '../engine/calendar';
import { CHANNELS } from '../engine/channels';
import { board, channelFill, checkTrade, groupOf, type BoardRow, type ChannelFill, type CheckResult, type CheckRow } from '../engine/lines';
import { makeCtx, valueTrade, type Ctx } from '../engine/risk';
import { buildFor, buildTrade, channelOf, type Action, type TicketError } from '../engine/state';
import type { AppState, Group, Lp, Product, RateTenor, Tenor, Ticket, Trade } from '../engine/types';
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
    matchedOn: 'Or matched on',
    lpGroup: 'Liquidity provider. A tick means it has room for this hedge.',
    channelGroup: 'Counterparty on a channel that discloses after the trade. A tick means its limit covers this order.',
    hasRoom: ', has room',
    noRoom: ', no room',
    fits: 'Fits',
    blocked: 'Blocked',
    adds: (psr: string, sr: string | null, g: string) =>
      `Adds USD ${psr} mio of pre-settlement risk${sr ? ` and up to ${sr} mio of settlement risk a day` : ''} to ${g}.`,
    psrOver: (k: string, a: string, l: string) => `Pre-settlement risk at ${k} would reach ${a} against a line of ${l}.`,
    srOver: (d: string, a: string, l: string) => `Settlement risk on ${d} would reach ${a} against a line of ${l}.`,
    onlyReservation: ' It would fit without the hedge in flight: the reservation is what stops both from filling.',
    onlyAllocation: ' It would fit without the room held for a channel. Lower that channel limit to free it.',
    chFull: 'The channel fills it',
    chPart: (x: string) => `The channel fills only USD ${x} mio`,
    chNone: 'The channel does not fill it',
    chWhy: (ch: string, g: string, left: string) => `${ch} checks credit at the match and does not ask the desk. It can fill up to USD ${left} mio with ${g} now.`,
    chBooks: (x: string) => ` The fill is booked as USD ${x} mio in use.`,
    chTopUp: ' The desk then holds room again and tops the channel up.',
    chTopUpPart: (x: string) => ` The line has room to top the channel up to USD ${x} mio only.`,
    chTopUpNone: ' The line then has no room left, so the channel is not topped up and stops filling.',
    chFill: 'Channel fills',
    at: (dates: string, rates: string) => `${dates} at ${rates}`,
    send: 'Send and reserve',
    psr: 'Pre-settlement risk',
    sr: 'Settlement risk',
    unit: 'USD mio',
    of: (a: string, l: string) => `${a} of ${l}`,
    overBy: (x: string) => `over by ${x}`,
    srNone: (g: string) => `none with ${g}.`,
    viaCls: 'This hedge settles through CLS.',
    viaCash: 'An NDF pays one net amount.',
    workings: 'Workings: how each number is calculated',
    figures: (g: string) => `Figures: where ${g}'s lines stand today`,
    figHead: ['USD mio', 'Credit line', 'Earlier days', 'Initial today', 'Today’s fills', 'Reserved', 'Held for a channel', 'This hedge', 'Headroom after'],
    psrRow: (k: string) => `PSR ${k}`,
    srRow: (k: string) => `SR ${k}`,
    sent: 'Sent hedges',
    sentHead: ['Hedge', 'Status', 'Exposure, USD'],
    status: { IN_FLIGHT: 'In flight', FILLED: 'Filled', REJECTED: 'Rejected', EXPIRED: 'Lapsed', SETTLED: 'Settled' },
    mio: 'mio',
    fill: 'Fill',
    reject: 'Reject',
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
    limits: 'Room held for a channel that discloses after the trade',
    limitsHint:
      'The largest trade the channel may fill with a group without asking the desk. The desk holds room for that trade on the credit line first, then sets the limit on the channel. After each fill it holds room again and sets the limit back. As the line fills the limit shrinks, and at zero the channel stops filling with that group.',
    limitsHead: ['Channel and group', 'Largest trade', 'Channel limit now', 'Filled today', 'Held on the credit line'],
    limitFor: (ch: string, g: string) => `Largest trade on ${ch} with ${g}`,
    heldIs: (left: string, pct: string, held: string, pillar: string) => `${left} × ${pct}% = ${held}, on ${pillar} and shorter`,
    errors: {
      USE_SWAP_OR_FORWARD: (p: string) => `${p} is deliverable: use a swap or forward.`,
      NDF_ONLY: (p: string) => `${p} trades as an NDF only.`,
      TENOR: () => 'This tenor is not available for this product.',
      AMOUNT: () => 'Enter an amount.',
      TOO_LARGE: () => 'This flow covers hedges up to USD 50 mio with one LP. Enter a larger order as several hedges.',
      NO_TOM_NEXT: () => 'Tom-next does not exist today: tomorrow is already the spot date.',
      NOT_CLS_PAIR: (p: string) => `${p} cannot settle through CLS.`,
      CHANNEL_ORDER: () => 'This channel takes one order here: USD/TWD NDF, 1M.',
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
    matchedOn: '或在場地撮合',
    lpGroup: 'LP。打勾代表有足夠額度做這筆對沖。',
    channelGroup: '事後披露的場地上的對手。打勾代表場地限額足夠成交整張訂單。',
    hasRoom: '，額度足夠',
    noRoom: '，額度不足',
    fits: '額度足夠',
    blocked: '額度不足',
    adds: (psr: string, sr: string | null, g: string) => `${g}的交割前風險增加 ${psr} 百萬美元${sr ? `，結算風險每日最多增加 ${sr} 百萬美元` : ''}。`,
    psrOver: (k: string, a: string, l: string) => `${k} 期限檔的交割前風險將達 ${a}，額度只有 ${l}。`,
    srOver: (d: string, a: string, l: string) => `${d} 的結算風險將達 ${a}，額度只有 ${l}。`,
    onlyReservation: '若沒有在途的那一筆，這筆本來放得進：正是預佔擋住了兩筆同時成交。',
    onlyAllocation: '若沒有場地切片，這筆本來放得進。調低場地限額就能騰出額度。',
    chFull: '場地會成交',
    chPart: (x: string) => `場地只成交 ${x} 百萬美元`,
    chNone: '場地不會成交',
    chWhy: (ch: string, g: string, left: string) => `${ch} 在撮合時自己檢查額度，不會問交易台。它現在最多可以和 ${g}成交 ${left} 百萬美元。`,
    chBooks: (x: string) => `成交後 ${x} 百萬美元記入已用。`,
    chTopUp: '交易台隨即再預留額度，補回場地切片。',
    chTopUpPart: (x: string) => `額度只夠把場地切片補回到 ${x} 百萬美元。`,
    chTopUpNone: '之後額度沒有空間，不再補回，場地不會再成交。',
    chFill: '場地成交',
    at: (dates: string, rates: string) => `${dates}，匯率 ${rates}`,
    send: '送出並預佔額度',
    psr: '交割前風險',
    sr: '結算風險',
    unit: '百萬美元',
    of: (a: string, l: string) => `${a} / ${l}`,
    overBy: (x: string) => `超出 ${x}`,
    srNone: (g: string) => `${g}沒有。`,
    viaCls: '本筆經 CLS 同步交收。',
    viaCash: 'NDF 只支付一筆差額。',
    workings: '計算過程：每個數字怎樣算出來',
    figures: (g: string) => `數字明細：${g}今日的額度使用情況`,
    figHead: ['百萬美元', '授信額度', '往日交易', '今日初始額度', '今日成交', '預佔', '場地切片', '本筆', '交易後可用額度'],
    psrRow: (k: string) => `交割前 ${k}`,
    srRow: (k: string) => `結算 ${k}`,
    sent: '已送出的對沖',
    sentHead: ['對沖', '狀態', '風險敞口（美元）'],
    status: { IN_FLIGHT: '在途', FILLED: '已成交', REJECTED: '已拒絕', EXPIRED: '已失效', SETTLED: '已交收' },
    mio: '百萬',
    fill: '成交',
    reject: '拒絕',
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
    limits: '場地切片：為事後披露的場地預留的額度',
    limitsHint: '最大一筆：場地不用問交易台，一筆最多可以和一個集團成交多少。交易台先在授信額度上預留這一筆要用的額度，再設場地限額。每次成交後再預留，把限額設回來。額度越滿，限額越小；到零時，場地不再和這個集團成交。',
    limitsHead: ['場地和集團', '最大一筆', '現在的場地限額', '今日已成交', '授信額度上預留'],
    limitFor: (ch: string, g: string) => `${ch} 對 ${g}的最大一筆`,
    heldIs: (left: string, pct: string, held: string, pillar: string) => `${left} × ${pct}% = ${held}，佔 ${pillar} 及更短的期限檔`,
    errors: {
      USE_SWAP_OR_FORWARD: (p: string) => `${p} 可交割：請用掉期或遠期。`,
      NDF_ONLY: (p: string) => `${p} 只能做 NDF。`,
      TENOR: () => '這個產品沒有這個期限。',
      AMOUNT: () => '請輸入金額。',
      TOO_LARGE: () => '本流程只涵蓋單一 LP、5,000 萬美元以內的對沖。較大的單請分成幾筆輸入。',
      NO_TOM_NEXT: () => '今日沒有 T/N：明日已經是即期交割日。',
      NOT_CLS_PAIR: (p: string) => `${p} 不能經 CLS 交收。`,
      CHANNEL_ORDER: () => '這個場地在本程式只接受一種訂單：USD/TWD NDF，1M。',
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

/** One credit line as the screen shows it: what is in use, what this hedge adds, what is left. */
interface LineRow {
  key: string;
  label: string;
  line: number;
  board?: BoardRow; // absent for a date only this hedge touches
  used: number; // filled hedges
  reserved: number; // hedges in flight
  allocated: number; // held for channels, once this ticket is counted
  hedge: number; // this ticket
  after: number;
  ok: boolean;
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
      allocated: cr ? cr.held : (br?.allocated ?? 0),
      hedge: cr ? cr.hedge : 0,
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

  const built = buildFor(ctx, state, ticket);
  const order = 'error' in built ? null : built;
  // A channel that checks credit itself fills against its own limit; every other hedge is checked here first.
  const byChannel = channelOf(state, ticket.lpId).checkedBy === 'CHANNEL';
  const fill = order && byChannel ? channelFill(ctx, state, order) : null;
  const check = order && !byChannel ? checkTrade(ctx, state, order) : null;
  const trade = fill ? fill.trade : order;
  const group = groupOf(state, ticket.lpId);
  const groupName = partyName(group.name, lang);
  const b = board(ctx, state, group.id);
  const fits = (lp: Lp) => {
    const other = buildFor(ctx, state, { ...ticket, lpId: lp.id });
    if ('error' in other) return null;
    if (CHANNELS[lp.channel].checkedBy === 'OMS') return checkTrade(ctx, state, other).ok;
    const f = channelFill(ctx, state, other);
    return f.fillUsd >= f.sizeUsd - 0.5;
  };
  const chips = (lps: Lp[]) =>
    lps.map((lp) => {
      const ok = fits(lp);
      return (
        <button key={lp.id} type="button" className="chip" aria-pressed={lp.id === ticket.lpId} onClick={() => setTicket({ ...ticket, lpId: lp.id })}>
          {ok !== null && (
            <span className={ok ? 'mark-ok' : 'mark-bad'} aria-hidden="true">
              {ok ? '✓' : '✕'}
            </span>
          )}
          {lpLabel(state, lp.id, lang)}
          <span className="sr-only">{ok === null ? '' : ok ? t.hasRoom : t.noRoom}</span>
        </button>
      );
    });
  const checkedHere = (lp: Lp) => CHANNELS[lp.channel].checkedBy === 'OMS';

  const result = fill ?? check;
  const psr = lineRows([...PILLARS], (k) => k, (i) => group.psrLines[i], b.psr, result?.psr);
  const srKeys = [...new Set([...b.sr.map((r) => r.key), ...(result?.sr.map((r) => r.key) ?? [])])].sort();
  const sr = lineRows(srKeys, (k) => shortDay(k, lang), () => group.srLine, b.sr, result?.sr);

  return (
    <>
      <section className="card">
        <TicketRow ticket={ticket} onChange={setTicket} ctx={ctx} />
        <div className="lp-row">
          <span className="label">{t.sendTo}</span>
          <div className="chips" role="group" aria-label={t.lpGroup}>
            {chips(state.lps.filter(checkedHere))}
          </div>
        </div>
        <div className="lp-row">
          <span className="label">{t.matchedOn}</span>
          <div className="chips" role="group" aria-label={t.channelGroup}>
            {chips(state.lps.filter((lp) => !checkedHere(lp)))}
          </div>
        </div>
      </section>

      <section className="card">
        {'error' in built ? (
          <p className="alert" role="alert">
            {t.errors[built.error](PAIRS[ticket.pair].label)}
          </p>
        ) : fill ? (
          <ChannelVerdict order={order!} fill={fill} channel={channelOf(state, ticket.lpId).label} onFill={() => dispatch({ type: 'CHANNEL_FILL', ticket })} />
        ) : (
          <Verdict trade={order!} check={check!} onSend={() => dispatch({ type: 'SEND', ticket })} />
        )}

        <LineBars title={t.psr} group={groupName} rows={psr} legend />
        {sr.length > 0 ? (
          <LineBars title={t.sr} group={groupName} rows={sr} />
        ) : (
          <p className="quiet">
            <strong>{t.sr}</strong>
            {lang === 'zh' ? '：' : ': '}
            {t.srNone(groupName)} {trade?.settlement === 'CLS' && t.viaCls}
            {trade?.settlement === 'CASH' && t.viaCash}
          </p>
        )}

        {result && trade && (
          <details className="more">
            <summary>{t.workings}</summary>
            <Workings ctx={ctx} trade={trade} risk={result.risk!} measured={result.after} group={group} isNew held={psr.map((r) => r.allocated)} />
          </details>
        )}
        <details className="more">
          <summary>{t.figures(groupName)}</summary>
          <FiguresTable psr={psr} sr={sr} />
        </details>
      </section>

      <SentHedges ctx={ctx} state={state} dispatch={dispatch} openId={openId} onOpen={setOpenId} />

      <section className="settings">
        <MarketEditor state={state} dispatch={dispatch} />
        <LinesEditor state={state} dispatch={dispatch} />
        <ChannelLimitsEditor ctx={ctx} state={state} dispatch={dispatch} />
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
          {check.blockedByAllocation && !check.blockedByReservation && t.onlyAllocation}
        </p>
        <p className="quiet">{t.at(dates, rates)}</p>
      </div>
      <button type="button" className="primary" disabled={!check.ok} onClick={onSend}>
        {t.send}
      </button>
    </div>
  );
}

/** An order on a channel that checks credit itself: the channel decides, the desk books the fill. */
function ChannelVerdict({ order, fill, channel, onFill }: { order: Trade; fill: ChannelFill; channel: string; onFill: () => void }) {
  const lang = useLang();
  const t = T[lang];
  const g = partyName(fill.group.name, lang);
  const full = fill.fillUsd >= fill.sizeUsd - 0.5;
  return (
    <div className="verdict-row">
      <div>
        <p className="verdict">
          <Status ok={full}>{full ? t.chFull : fill.trade ? t.chPart(mio(fill.fillUsd)) : t.chNone}</Status>
        </p>
        <p className="verdict-why">
          {t.chWhy(channel, g, mio(fill.available))}
          {fill.risk && t.chBooks(mio(fill.risk.exposure))}
          {fill.risk && (fill.availableAfter >= fill.keepUsd - 0.5 ? t.chTopUp : fill.availableAfter > 0.5 ? t.chTopUpPart(mio(fill.availableAfter)) : t.chTopUpNone)}
        </p>
        <p className="quiet">{t.at(shortDay(order.legs[0].date, lang), rate(order.pair, order.legs[0].rate))}</p>
      </div>
      <button type="button" className="primary" disabled={!fill.trade} onClick={onFill}>
        {t.chFill}
      </button>
    </div>
  );
}

// ------------------------------------------------------------ credit lines
function LineBars({ title, group, rows, legend }: { title: string; group: string; rows: LineRow[]; legend?: boolean }) {
  const t = T[useLang()];
  return (
    <div className="lines">
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
          <LineBar label={r.label} line={r.line} parts={[r.used, r.reserved, r.allocated, r.hedge]} total={r.after} ok={r.ok} />
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
              <td>{mio(r.allocated)}</td>
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
                            {t.reject}
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
  const { measured, psr } = board(ctx, state, group.id);
  const risk = measured.risks.find((r) => r.trade.id === trade.id) ?? valueTrade(ctx, trade);
  return (
    <div className="detail">
      <p className="quiet">{t.valued(trade.id)}</p>
      <Workings ctx={ctx} trade={trade} risk={risk} measured={measured} group={group} isNew={false} held={psr.map((r) => r.allocated)} />
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

function ChannelLimitsEditor({ ctx, state, dispatch }: { ctx: Ctx; state: AppState; dispatch: Dispatch<Action> }) {
  const lang = useLang();
  const t = T[lang];
  return (
    <details className="more">
      <summary>{t.limits}</summary>
      <p className="quiet hint">{t.limitsHint}</p>
      <div className="table-wrap">
        <table className="table edit-table">
          <thead>
            <tr>
              {t.limitsHead.map((h, i) => (
                <th key={h}>{i === 0 ? h : `${h} · ${t.unit}`}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {state.groups.flatMap((g) =>
              board(ctx, state, g.id).allocations.map((a) => {
                const name = t.limitFor(CHANNELS[a.buffer.channel].label, partyName(g.name, lang));
                return (
                  <tr key={a.buffer.channel + g.id}>
                    <td>
                      {CHANNELS[a.buffer.channel].label} · {partyName(g.name, lang)}
                    </td>
                    <td>
                      <NumInput
                        label={name}
                        className="wide"
                        value={a.buffer.keepUsd / M}
                        min={0}
                        onChange={(v) => dispatch({ type: 'SET_CHANNEL_BUFFER', channel: a.buffer.channel, groupId: g.id, keepUsd: v * M })}
                      />
                    </td>
                    <td>{mio(a.available)}</td>
                    <td>{mio(a.filled)}</td>
                    <td>{t.heldIs(mio(a.available), String(a.addOnPct), mio(a.held), PILLARS[a.pillar])}</td>
                  </tr>
                );
              }),
            )}
          </tbody>
        </table>
      </div>
    </details>
  );
}
