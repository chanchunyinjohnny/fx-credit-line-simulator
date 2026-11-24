import { useMemo, useState, type Dispatch } from 'react';
import { OUTRIGHT_TENORS, PAIRS, PAIR_IDS, PILLARS, SWAP_TENORS } from '../engine/calendar';
import { board, checkTrade, groupOf, type BoardRow, type CheckResult, type CheckRow } from '../engine/lines';
import { makeCtx, valueTrade, type Ctx } from '../engine/risk';
import { buildTrade, type Action } from '../engine/state';
import type { AppState, Group, Product, RateTenor, Tenor, Ticket, Trade } from '../engine/types';
import { NumInput, Status } from './bits';
import { PRODUCT_LABEL, SETTLEMENT_LABEL, amt, direction, mio, rate, shortDay, signedMio } from './format';
import { Workings } from './Workings';

const M = 1_000_000;
const DEFAULT_TICKET: Ticket = { product: 'SWAP', pair: 'EURUSD', side: 'BUY', amount: 20 * M, tenor: '3M', lpId: 'A-LDN-360T', settlement: 'AUTO' };
const POINT_TENORS: Tenor[] = ['ON', 'TN', 'SN', '1W', '1M', '2M', '3M', '6M', '9M', '1Y'];
const RATE_TENORS: RateTenor[] = ['ON', '1W', '1M', '2M', '3M', '6M', '9M', '1Y'];

function withProduct(t: Ticket, product: Product): Ticket {
  const pair = product === 'NDF' ? 'USDTWD' : PAIRS[t.pair].deliverable ? t.pair : 'EURUSD';
  const tenors = product === 'SWAP' ? SWAP_TENORS : OUTRIGHT_TENORS;
  return { ...t, product, pair, tenor: tenors.includes(t.tenor) ? t.tenor : '3M', settlement: 'AUTO' };
}

const lpLabel = (s: AppState, lpId: string) => {
  const lp = s.lps.find((l) => l.id === lpId)!;
  return `${lp.name} · ${lp.channel}`;
};

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

function lineRows(keys: string[], label: (k: string) => string, line: number | ((i: number) => number), b: BoardRow[], c?: CheckRow[]): LineRow[] {
  return keys.map((key, i) => {
    const br = b.find((r) => r.key === key);
    const cr = c?.find((r) => r.key === key);
    const before = br?.used ?? 0;
    const after = cr ? cr.after : before;
    const max = typeof line === 'number' ? line : line(i);
    return {
      key,
      label: label(key),
      line: max,
      board: br,
      used: (br?.earlier ?? 0) + (br?.today ?? 0),
      reserved: br?.reserved ?? 0,
      hedge: after - before,
      after,
      ok: cr ? cr.ok : after <= max + 0.5,
    };
  });
}

export function Simulator({ state, dispatch }: { state: AppState; dispatch: Dispatch<Action> }) {
  const ctx = useMemo(() => makeCtx(state), [state.businessDate, state.market, state.addOnPct]);
  const [ticket, setTicket] = useState(DEFAULT_TICKET);
  const [openId, setOpenId] = useState<string | null>(null);

  const built = buildTrade(ctx, ticket);
  const trade = 'error' in built ? null : built;
  const check = trade ? checkTrade(ctx, state, trade) : null;
  const group = groupOf(state, ticket.lpId);
  const b = board(ctx, state, group.id);
  const fits = (lpId: string) => {
    const t = buildTrade(ctx, { ...ticket, lpId });
    return 'error' in t ? null : checkTrade(ctx, state, t).ok;
  };

  const psr = lineRows([...PILLARS], (k) => k, (i) => group.psrLines[i], b.psr, check?.psr);
  const srKeys = [...new Set([...b.sr.map((r) => r.key), ...(check?.sr.map((r) => r.key) ?? [])])].sort();
  const sr = lineRows(srKeys, shortDay, group.srLine, b.sr, check?.sr);

  return (
    <>
      <section className="card">
        <TicketRow ticket={ticket} onChange={setTicket} ctx={ctx} />
        <div className="lp-row">
          <span className="label">Send to</span>
          <div className="chips" role="group" aria-label="Liquidity provider. A tick means it has room for this hedge.">
            {state.lps.map((lp) => {
              const ok = fits(lp.id);
              return (
                <button key={lp.id} type="button" className="chip" aria-pressed={lp.id === ticket.lpId} onClick={() => setTicket({ ...ticket, lpId: lp.id })}>
                  {ok !== null && (
                    <span className={ok ? 'mark-ok' : 'mark-bad'} aria-hidden="true">
                      {ok ? '✓' : '✕'}
                    </span>
                  )}
                  {lp.name} · {lp.channel}
                  <span className="sr-only">{ok === null ? '' : ok ? ', has room' : ', no room'}</span>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <section className="card">
        {'error' in built ? (
          <p className="alert" role="alert">
            {built.error}
          </p>
        ) : (
          <Verdict trade={trade!} check={check!} onSend={() => dispatch({ type: 'SEND', ticket })} />
        )}

        <LineBars title="Pre-settlement risk" zh="交割前風險" group={group} rows={psr} legend />
        {sr.length > 0 ? (
          <LineBars title="Settlement risk" zh="結算風險" group={group} rows={sr} />
        ) : (
          <p className="quiet">
            <strong>Settlement risk</strong> <span className="zh" lang="zh-Hant">結算風險</span>: none with {group.name}.{' '}
            {trade?.settlement === 'CLS' && 'This hedge settles through CLS.'}
            {trade?.settlement === 'CASH' && 'An NDF pays one net amount.'}
          </p>
        )}

        {check && trade && (
          <details className="more">
            <summary>Workings: how each number is calculated</summary>
            <Workings ctx={ctx} trade={trade} risk={check.risk} measured={check.after} group={check.group} isNew />
          </details>
        )}
        <details className="more">
          <summary>Figures: where {group.name}'s lines stand today</summary>
          <FiguresTable psr={psr} sr={sr} />
        </details>
      </section>

      <SentHedges ctx={ctx} state={state} dispatch={dispatch} openId={openId} onOpen={setOpenId} />

      <section className="settings">
        <MarketEditor state={state} dispatch={dispatch} />
        <LinesEditor state={state} dispatch={dispatch} />
      </section>
    </>
  );
}

// ------------------------------------------------------------------ ticket
function TicketRow({ ticket, onChange, ctx }: { ticket: Ticket; onChange: (t: Ticket) => void; ctx: Ctx }) {
  const info = PAIRS[ticket.pair];
  const tenors = ticket.product === 'SWAP' ? SWAP_TENORS : OUTRIGHT_TENORS;
  const pairs = PAIR_IDS.filter((id) => PAIRS[id].deliverable === (ticket.product !== 'NDF'));
  const auto = buildTrade(ctx, { ...ticket, settlement: 'AUTO' });
  return (
    <div className="ticket">
      <div className="field">
        <span className="label">Product</span>
        <div className="segmented" role="group" aria-label="Product">
          {(['SWAP', 'FORWARD', 'NDF'] as Product[]).map((p) => (
            <button key={p} type="button" aria-pressed={ticket.product === p} onClick={() => onChange(withProduct(ticket, p))}>
              {PRODUCT_LABEL[p]}
            </button>
          ))}
        </div>
      </div>
      <label className="field">
        <span className="label">Pair</span>
        <select value={ticket.pair} onChange={(e) => onChange({ ...ticket, pair: e.target.value as Ticket['pair'], settlement: 'AUTO' })}>
          {pairs.map((id) => (
            <option key={id} value={id}>
              {PAIRS[id].label}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span className="label">Direction</span>
        <select value={ticket.side} onChange={(e) => onChange({ ...ticket, side: e.target.value as Ticket['side'] })}>
          <option value="BUY">{direction({ ...ticket, side: 'BUY' })}</option>
          <option value="SELL">{direction({ ...ticket, side: 'SELL' })}</option>
        </select>
      </label>
      <label className="field field-narrow">
        <span className="label">{info.base} mio</span>
        <NumInput label={`Amount in ${info.base} millions`} value={ticket.amount / M} min={0} onChange={(v) => onChange({ ...ticket, amount: v * M })} />
      </label>
      <label className="field field-narrow">
        <span className="label">Tenor</span>
        <select value={ticket.tenor} onChange={(e) => onChange({ ...ticket, tenor: e.target.value as Tenor, settlement: 'AUTO' })}>
          {tenors.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </label>
      {ticket.product !== 'NDF' && (
        <label className="field">
          <span className="label">Settlement</span>
          <select value={ticket.settlement} onChange={(e) => onChange({ ...ticket, settlement: e.target.value as Ticket['settlement'] })}>
            <option value="AUTO">Standard{'error' in auto ? '' : `: ${SETTLEMENT_LABEL[auto.settlement]}`}</option>
            <option value="CLS">{SETTLEMENT_LABEL.CLS}</option>
            <option value="GROSS">{SETTLEMENT_LABEL.GROSS}</option>
          </select>
        </label>
      )}
    </div>
  );
}

// ----------------------------------------------------------------- verdict
/** Why the check failed, in one sentence. */
function reason(c: CheckResult) {
  const p = c.psr.find((r) => !r.ok);
  if (p) return `Pre-settlement risk at ${p.key} would reach ${mio(p.after)} against a line of ${mio(p.line)}.`;
  const s = c.sr.find((r) => !r.ok)!;
  return `Settlement risk on ${shortDay(s.key)} would reach ${mio(s.after)} against a line of ${mio(s.line)}.`;
}

function Verdict({ trade, check, onSend }: { trade: Trade; check: CheckResult; onSend: () => void }) {
  const far = trade.legs[trade.legs.length - 1];
  const dates = trade.legs.length > 1 ? `${shortDay(trade.legs[0].date)} → ${shortDay(far.date)}` : shortDay(far.date);
  const rates = trade.legs.map((l) => rate(trade.pair, l.rate)).join(' / ');
  const srAdded = Math.max(0, ...check.sr.map((r) => r.after - r.before));
  return (
    <div className="verdict-row">
      <div>
        <p className="verdict">
          <Status ok={check.ok}>{check.ok ? 'Fits' : 'Blocked'}</Status>
        </p>
        <p className="verdict-why">
          {check.ok ? `Adds USD ${mio(check.risk.exposure)} mio of pre-settlement risk${srAdded > 0.5 ? ` and up to ${mio(srAdded)} mio of settlement risk a day` : ''} to ${check.group.name}.` : reason(check)}
          {check.blockedByReservation && ' It would fit without the hedge in flight: the reservation is what stops both from filling.'}
        </p>
        <p className="quiet">
          {dates} at {rates}
        </p>
      </div>
      <button type="button" className="primary" disabled={!check.ok} onClick={onSend}>
        Send and reserve
      </button>
    </div>
  );
}

// ------------------------------------------------------------ credit lines
function Bar({ row }: { row: LineRow }) {
  const parts = (
    [
      ['In use', row.used, 'seg-used'],
      ['Reserved', row.reserved, 'seg-reserved'],
      ['This hedge', row.hedge, 'seg-hedge'],
    ] as const
  ).filter(([, v]) => v > 0.5);
  const total = Math.max(row.after, 0);
  const sum = parts.reduce((s, [, v]) => s + v, 0);
  // Netting can make a part negative; the bar then shows the true total.
  const scale = sum > 0 ? total / sum : 0;
  const full = Math.max(row.line, total);
  return (
    <div className={row.ok ? 'bar' : 'bar bar-over'} role="img" aria-label={`${row.label}: ${mio(total)} of ${mio(row.line)} USD mio${row.ok ? '' : ', over the line'}`}>
      {full > 0 && parts.map(([name, v, cls]) => <span key={name} className={`seg ${cls}`} style={{ width: `${((v * scale) / full) * 100}%` }} title={`${name}: USD ${mio(v)} mio`} />)}
    </div>
  );
}

function LineBars({ title, zh, group, rows, legend }: { title: string; zh: string; group: Group; rows: LineRow[]; legend?: boolean }) {
  return (
    <div className="lines">
      <div className="lines-head">
        <h2>
          {title} <span className="zh" lang="zh-Hant">{zh}</span> <span className="quiet-inline">· {group.name} · USD mio</span>
        </h2>
        {legend && (
          <ul className="legend" aria-label="Bar legend">
            <li>
              <span className="seg seg-used" /> In use
            </li>
            <li>
              <span className="seg seg-reserved" /> Reserved
            </li>
            <li>
              <span className="seg seg-hedge" /> This hedge
            </li>
          </ul>
        )}
      </div>
      {rows.map((r) => (
        <div key={r.key} className={Math.abs(r.hedge) < 0.5 && r.after < 0.5 ? 'line-row line-idle' : 'line-row'}>
          <span className="line-label">{r.label}</span>
          <Bar row={r} />
          <span className="line-figure">{r.ok ? `${mio(r.after)} of ${mio(r.line)}` : <Status ok={false}>over by {mio(r.after - r.line)}</Status>}</span>
        </div>
      ))}
    </div>
  );
}

function FiguresTable({ psr, sr }: { psr: LineRow[]; sr: LineRow[] }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>USD mio</th>
            <th>Credit line</th>
            <th>Earlier days</th>
            <th>Initial today</th>
            <th>Today’s fills</th>
            <th>Reserved</th>
            <th>This hedge</th>
            <th>Headroom after</th>
          </tr>
        </thead>
        <tbody>
          {[...psr, ...sr].map((r, i) => (
            <tr key={r.key} className={i === psr.length ? 'group-start' : undefined}>
              <td>{i < psr.length ? `PSR ${r.label}` : `SR ${r.label}`}</td>
              <td>{mio(r.line)}</td>
              <td>{mio(r.board?.earlier ?? 0)}</td>
              <td>{mio(r.board?.initial ?? r.line)}</td>
              <td>{signedMio(r.board?.today ?? 0)}</td>
              <td>{signedMio(r.reserved)}</td>
              <td>{signedMio(r.hedge)}</td>
              <td>{r.after <= r.line + 0.5 ? mio(r.line - r.after) : <Status ok={false}>over by {mio(r.after - r.line)}</Status>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ------------------------------------------------------------- sent hedges
const STATUS_LABEL = { IN_FLIGHT: 'In flight', FILLED: 'Filled', REJECTED: 'Rejected', EXPIRED: 'Lapsed' } as const;

function SentHedges(p: { ctx: Ctx; state: AppState; dispatch: Dispatch<Action>; openId: string | null; onOpen: (id: string | null) => void }) {
  const { ctx, state } = p;
  if (state.trades.length === 0) return null;
  const open = state.trades.find((t) => t.id === p.openId);
  return (
    <section className="card">
      <h2 className="card-title">Sent hedges</h2>
      <div className="table-wrap">
        <table className="table hedges">
          <thead>
            <tr>
              <th />
              <th>Hedge</th>
              <th>Status</th>
              <th>Exposure, USD</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {[...state.trades].reverse().map((t) => {
              const far = t.legs[t.legs.length - 1];
              const live = t.status === 'FILLED' || t.status === 'IN_FLIGHT';
              const settled = t.status === 'FILLED' && far.date < ctx.t0;
              const r = live && !settled ? valueTrade(ctx, t) : null;
              return (
                <tr key={t.id} className={live && !settled ? undefined : 'muted-row'}>
                  <td>{t.id}</td>
                  <td>
                    {direction(t)} {amt(t.amount / M)} mio {t.tenor} {t.product === 'SWAP' ? '' : PRODUCT_LABEL[t.product].toLowerCase()} · {lpLabel(state, t.lpId)}
                  </td>
                  <td>{settled ? 'Settled' : STATUS_LABEL[t.status]}</td>
                  <td>{r ? `${mio(r.exposure)} mio` : '–'}</td>
                  <td>
                    <span className="row-actions">
                      {t.status === 'IN_FLIGHT' && (
                        <>
                          <button type="button" onClick={() => p.dispatch({ type: 'FILL', id: t.id })}>
                            Fill
                          </button>
                          <button type="button" onClick={() => p.dispatch({ type: 'REJECT', id: t.id })}>
                            Reject
                          </button>
                        </>
                      )}
                      {r && (
                        <button type="button" className="link" aria-expanded={t.id === p.openId} onClick={() => p.onOpen(t.id === p.openId ? null : t.id)}>
                          Workings
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
  const group = groupOf(state, trade.lpId);
  const { measured } = board(ctx, state, group.id);
  const risk = measured.risks.find((r) => r.trade.id === trade.id) ?? valueTrade(ctx, trade);
  return (
    <div className="detail">
      <p className="quiet">{trade.id}, valued today</p>
      <Workings ctx={ctx} trade={trade} risk={risk} measured={measured} group={group} isNew={false} />
    </div>
  );
}

// ---------------------------------------------------------------- settings
function MarketEditor({ state, dispatch }: { state: AppState; dispatch: Dispatch<Action> }) {
  const edit = (change: (d: AppState) => void) => dispatch({ type: 'EDIT', change });
  return (
    <details className="more">
      <summary>Market data</summary>
      <div className="table-wrap">
        <table className="table edit-table">
          <thead>
            <tr>
              <th>Swap points, pips</th>
              <th>Spot</th>
              {POINT_TENORS.map((t) => (
                <th key={t}>{t}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PAIR_IDS.map((id) => (
              <tr key={id}>
                <td>{PAIRS[id].label}</td>
                <td>
                  <NumInput label={`${PAIRS[id].label} spot`} className="wide" value={state.market.pairs[id].spot} onChange={(v) => v > 0 && edit((d) => void (d.market.pairs[id].spot = v))} />
                </td>
                {POINT_TENORS.map((t) => (
                  <td key={t}>
                    <NumInput label={`${PAIRS[id].label} ${t} points`} value={state.market.pairs[id].points[t]} onChange={(v) => edit((d) => void (d.market.pairs[id].points[t] = v))} />
                  </td>
                ))}
              </tr>
            ))}
            <tr className="group-start">
              <td>USD rate, %</td>
              <td />
              {POINT_TENORS.map((t) => (
                <td key={t}>
                  {RATE_TENORS.includes(t as RateTenor) && (
                    <NumInput label={`USD ${t} rate`} value={state.market.usdRates[t as RateTenor]} onChange={(v) => edit((d) => void (d.market.usdRates[t as RateTenor] = v))} />
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
  const edit = (change: (d: AppState) => void) => dispatch({ type: 'EDIT', change });
  return (
    <details className="more">
      <summary>Credit lines and add-ons</summary>
      <div className="table-wrap">
        <table className="table edit-table">
          <thead>
            <tr>
              <th>USD mio</th>
              {PILLARS.map((p) => (
                <th key={p}>PSR {p}</th>
              ))}
              <th>SR per day</th>
              <th>Close-out netting</th>
              <th>Payment netting</th>
            </tr>
          </thead>
          <tbody>
            {state.groups.map((g, gi) => (
              <tr key={g.id}>
                <td>{g.name}</td>
                {PILLARS.map((p, pi) => (
                  <td key={p}>
                    <NumInput label={`${g.name} PSR line ${p}`} value={g.psrLines[pi] / M} min={0} onChange={(v) => v >= 0 && edit((d) => void (d.groups[gi].psrLines[pi] = v * M))} />
                  </td>
                ))}
                <td>
                  <NumInput label={`${g.name} SR line`} value={g.srLine / M} min={0} onChange={(v) => v >= 0 && edit((d) => void (d.groups[gi].srLine = v * M))} />
                </td>
                <td>
                  <input type="checkbox" aria-label={`${g.name} close-out netting`} checked={g.closeOutNetting} onChange={(e) => edit((d) => void (d.groups[gi].closeOutNetting = e.target.checked))} />
                </td>
                <td>
                  <input type="checkbox" aria-label={`${g.name} payment netting`} checked={g.paymentNetting} onChange={(e) => edit((d) => void (d.groups[gi].paymentNetting = e.target.checked))} />
                </td>
              </tr>
            ))}
            <tr className="group-start">
              <td>Add-on, %</td>
              {PILLARS.map((p, pi) => (
                <td key={p}>
                  <NumInput label={`Add-on ${p}`} value={state.addOnPct[pi]} min={0} onChange={(v) => v >= 0 && edit((d) => void (d.addOnPct[pi] = v))} />
                </td>
              ))}
              <td colSpan={3} />
            </tr>
          </tbody>
        </table>
      </div>
    </details>
  );
}
