import { useMemo, useState, type Dispatch } from 'react';
import { OUTRIGHT_TENORS, PAIRS, PAIR_IDS, PILLARS, SWAP_TENORS } from '../engine/calendar';
import { board, checkTrade, groupOf, type BoardRow, type CheckResult, type CheckRow } from '../engine/lines';
import { makeCtx, valueTrade, type Ctx } from '../engine/risk';
import { buildTrade, type Action } from '../engine/state';
import type { AppState, Product, RateTenor, Tenor, Ticket, Trade } from '../engine/types';
import { NumInput, Section, Status, Term } from './bits';
import { PRODUCT_LABEL, SETTLEMENT_LABEL, amt, day, direction, mio, pct, rate, shortDay, signedMio } from './format';
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

/** The first line a check fails on, in words. */
function blocker(c: CheckResult) {
  const psr = c.psr.find((r) => !r.ok);
  if (psr) return `PSR ${psr.key}`;
  const sr = c.sr.find((r) => !r.ok);
  return sr ? `SR ${shortDay(sr.key)}` : '';
}

export function Simulator({ state, dispatch }: { state: AppState; dispatch: Dispatch<Action> }) {
  const ctx = useMemo(() => makeCtx(state), [state.businessDate, state.market, state.addOnPct]);
  const [ticket, setTicket] = useState(DEFAULT_TICKET);
  const [boardGroupId, setBoardGroupId] = useState(() => groupOf(state, DEFAULT_TICKET.lpId).id);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const built = buildTrade(ctx, ticket);
  const check = 'error' in built ? null : checkTrade(ctx, state, built);
  // Initial check: the same hedge tried against every LP.
  const perLp = state.lps.map((lp) => {
    const b = buildTrade(ctx, { ...ticket, lpId: lp.id });
    return { lp, check: 'error' in b ? null : checkTrade(ctx, state, b) };
  });
  const pickLp = (lpId: string) => {
    setTicket({ ...ticket, lpId });
    setBoardGroupId(groupOf(state, lpId).id);
  };
  const selected = state.trades.find((t) => t.id === selectedId);

  return (
    <>
      <div className="grid-ticket">
        <Section title="Hedge ticket" zh="對沖交易單">
          <TicketForm ticket={ticket} onChange={setTicket} ctx={ctx} />
          <h3 className="sub-title">
            <Term en="Initial check" zh="初步檢查" />: which LPs have room for this hedge
          </h3>
          <div className="table-wrap">
            <table className="table pick-table">
              <thead>
                <tr>
                  <th>LP</th>
                  <th>Channel</th>
                  <th>Lines held by</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {perLp.map(({ lp, check: c }) => (
                  <tr key={lp.id} data-selected={lp.id === ticket.lpId}>
                    <td>
                      <button type="button" className="row-pick" aria-pressed={lp.id === ticket.lpId} onClick={() => pickLp(lp.id)}>
                        {lp.name}
                      </button>
                    </td>
                    <td>{lp.channel}</td>
                    <td>{state.groups.find((g) => g.id === lp.groupId)!.name}</td>
                    <td>{c ? <Status ok={c.ok}>{c.ok ? 'Fits' : `No room: ${blocker(c)}`}</Status> : '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <Section title="Pre-trade check" zh="交易前檢查" unit="USD mio">
          {'error' in built ? (
            <p className="alert" role="alert">
              {built.error}
            </p>
          ) : (
            <CheckPanel ctx={ctx} trade={built} check={check!} lpLabel={lpLabel(state, built.lpId)} onSend={() => dispatch({ type: 'SEND', ticket })} />
          )}
        </Section>
      </div>

      <BoardPanel ctx={ctx} state={state} groupId={boardGroupId} onGroup={setBoardGroupId} />

      <Section title="Hedges" zh="對沖交易記錄" unit="Select a row to see its workings today">
        <Blotter ctx={ctx} state={state} dispatch={dispatch} selectedId={selectedId} onSelect={setSelectedId} />
        {selected && (
          <div className="detail">
            <h3 className="sub-title">
              {selected.id}: {direction(selected)} {amt(selected.amount)}, valued on {day(ctx.t0)}
            </h3>
            <ExistingWorkings ctx={ctx} state={state} trade={selected} />
          </div>
        )}
      </Section>

      <div className="grid-settings">
        <MarketEditor state={state} dispatch={dispatch} />
        <LinesEditor state={state} dispatch={dispatch} />
      </div>
    </>
  );
}

const lpLabel = (s: AppState, lpId: string) => {
  const lp = s.lps.find((l) => l.id === lpId)!;
  return `${lp.name} on ${lp.channel}`;
};

// ------------------------------------------------------------------ ticket
function TicketForm({ ticket, onChange, ctx }: { ticket: Ticket; onChange: (t: Ticket) => void; ctx: Ctx }) {
  const info = PAIRS[ticket.pair];
  const tenors = ticket.product === 'SWAP' ? SWAP_TENORS : OUTRIGHT_TENORS;
  const pairs = PAIR_IDS.filter((id) => PAIRS[id].deliverable === (ticket.product !== 'NDF'));
  const built = buildTrade(ctx, { ...ticket, settlement: 'AUTO' });
  const standard = 'error' in built ? '' : ` (${SETTLEMENT_LABEL[built.settlement]})`;
  return (
    <div className="form">
      <div className="field field-wide">
        <span className="label">
          <Term en="Product" zh="產品" />
        </span>
        <div className="segmented" role="group" aria-label="Product">
          {(['SWAP', 'FORWARD', 'NDF'] as Product[]).map((p) => (
            <button key={p} type="button" aria-pressed={ticket.product === p} onClick={() => onChange(withProduct(ticket, p))}>
              {PRODUCT_LABEL[p]}
            </button>
          ))}
        </div>
      </div>
      <label className="field">
        <span className="label">
          <Term en="Pair" zh="貨幣對" />
        </span>
        <select value={ticket.pair} onChange={(e) => onChange({ ...ticket, pair: e.target.value as Ticket['pair'], settlement: 'AUTO' })}>
          {pairs.map((id) => (
            <option key={id} value={id}>
              {PAIRS[id].label}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span className="label">
          <Term en="Direction" zh="方向" />
        </span>
        <select value={ticket.side} onChange={(e) => onChange({ ...ticket, side: e.target.value as Ticket['side'] })}>
          <option value="BUY">{direction({ ...ticket, side: 'BUY' })}</option>
          <option value="SELL">{direction({ ...ticket, side: 'SELL' })}</option>
        </select>
      </label>
      <label className="field">
        <span className="label">
          <Term en={`Amount, ${info.base} mio`} zh="金額" />
        </span>
        <NumInput label={`Amount in ${info.base} millions`} value={ticket.amount / M} min={0} onChange={(v) => onChange({ ...ticket, amount: v * M })} />
      </label>
      <label className="field">
        <span className="label">
          <Term en="Tenor" zh="期限" />
        </span>
        <select value={ticket.tenor} onChange={(e) => onChange({ ...ticket, tenor: e.target.value as Tenor, settlement: 'AUTO' })}>
          {tenors.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </label>
      {ticket.product !== 'NDF' && (
        <label className="field field-wide">
          <span className="label">
            <Term en="Settlement" zh="結算方式" />
          </span>
          <select value={ticket.settlement} onChange={(e) => onChange({ ...ticket, settlement: e.target.value as Ticket['settlement'] })}>
            <option value="AUTO">Standard for this hedge{standard}</option>
            <option value="CLS">{SETTLEMENT_LABEL.CLS}</option>
            <option value="GROSS">{SETTLEMENT_LABEL.GROSS}</option>
          </select>
        </label>
      )}
    </div>
  );
}

// ------------------------------------------------------------------- check
function CheckTable({ rows, first, label }: { rows: CheckRow[]; first: string; label: (key: string) => string }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>{first}</th>
            <th>Before</th>
            <th>This hedge</th>
            <th>After</th>
            <th>Line</th>
            <th>Headroom after</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className={Math.abs(r.after - r.before) < 0.5 ? 'muted-row' : undefined}>
              <td>{label(r.key)}</td>
              <td>{mio(r.before)}</td>
              <td>{signedMio(r.after - r.before)}</td>
              <td>{mio(r.after)}</td>
              <td>{mio(r.line)}</td>
              <td>{r.ok ? mio(r.line - r.after) : <Status ok={false}>Over by {mio(r.after - r.line)}</Status>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CheckPanel(p: { ctx: Ctx; trade: Trade; check: CheckResult; lpLabel: string; onSend: () => void }) {
  const { trade, check } = p;
  const info = PAIRS[trade.pair];
  const far = trade.legs[trade.legs.length - 1];
  return (
    <>
      <p className="verdict">
        <Status ok={check.ok}>{check.ok ? 'Fits both credit lines' : `Blocked: ${blocker(check)} would exceed its line`}</Status>
      </p>
      {check.blockedByReservation && (
        <p className="alert">
          Blocked only by a reservation. Without the hedge in flight this one would pass, and both could then fill and take {check.group.name}{' '}
          over its line.
        </p>
      )}
      <p className="summary">
        {direction(trade)} {amt(trade.amount)} against {info.quote} with {p.lpLabel}.{' '}
        {trade.legs.length > 1 && (
          <>
            Near {shortDay(trade.legs[0].date)} at {rate(trade.pair, trade.legs[0].rate)}, far {shortDay(far.date)} at {rate(trade.pair, far.rate)}.
          </>
        )}
        {trade.legs.length === 1 && (
          <>
            Value date {shortDay(far.date)} at {rate(trade.pair, far.rate)}.
          </>
        )}{' '}
        Settlement: {SETTLEMENT_LABEL[trade.settlement]}.
      </p>

      <h3 className="sub-title">
        <Term en="Pre-settlement risk" zh="交割前風險" /> of {check.group.name}, by time pillar
      </h3>
      <CheckTable rows={check.psr} first="Pillar" label={(k) => k} />

      <h3 className="sub-title">
        <Term en="Settlement risk" zh="結算風險" /> of {check.group.name}, by settlement date
      </h3>
      {check.sr.length > 0 ? (
        <CheckTable rows={check.sr} first="Date" label={day} />
      ) : (
        <p className="note">Nothing settles gross with this group, so no settlement risk.</p>
      )}

      <div className="actions">
        <button type="button" className="primary" disabled={!check.ok} onClick={p.onSend}>
          Send to LP and reserve
        </button>
        <span className="note">
          Sending holds this room as a <Term en="reservation" zh="額度預佔" /> until the LP fills or rejects.
        </span>
      </div>

      <h3 className="sub-title">
        <Term en="Workings" zh="計算過程" />: open a step to see its formula with the numbers
      </h3>
      <Workings ctx={p.ctx} trade={trade} risk={check.risk} measured={check.after} group={check.group} isNew />
    </>
  );
}

function ExistingWorkings({ ctx, state, trade }: { ctx: Ctx; state: AppState; trade: Trade }) {
  const group = groupOf(state, trade.lpId);
  const live = trade.status === 'FILLED' || trade.status === 'IN_FLIGHT';
  if (!live) return <p className="note">This hedge was {trade.status === 'REJECTED' ? 'rejected' : 'left to lapse'}; it uses no credit line.</p>;
  const { measured } = board(ctx, state, group.id);
  const risk = measured.risks.find((r) => r.trade.id === trade.id) ?? valueTrade(ctx, trade);
  return <Workings ctx={ctx} trade={trade} risk={risk} measured={measured} group={group} isNew={false} />;
}

// ------------------------------------------------------- credit line board
function UseBar({ row, what }: { row: BoardRow; what: string }) {
  const parts = (
    [
      ['Earlier days', row.earlier, 'seg-earlier'],
      ['Today’s fills', row.today, 'seg-today'],
      ['Reserved', row.reserved, 'seg-reserved'],
    ] as const
  ).filter(([, v]) => v > 0.5);
  const used = Math.max(row.used, 0);
  const sum = parts.reduce((s, [, v]) => s + v, 0);
  // A part can be negative when netting lets a new hedge reduce exposure; the bar then shows the true total.
  const scale = sum > 0 ? used / sum : 0;
  const full = Math.max(row.line, used);
  const over = used > row.line + 0.5;
  const share = (v: number) => (row.line > 0 ? ` (${pct((v / row.line) * 100, 0)} of the line)` : '');
  return (
    <div
      className={over ? 'bar bar-over' : 'bar'}
      role="img"
      aria-label={`${what}: USD ${amt(used)} used of a line of ${amt(row.line)}${over ? ', over the line' : ''}`}
    >
      {full > 0 &&
        parts.map(([name, v, cls]) => (
          <span key={name} className={`seg ${cls}`} style={{ width: `${((v * scale) / full) * 100}%` }} title={`${name}: USD ${amt(v)}${share(v)}`} />
        ))}
    </div>
  );
}

function BoardTable({ rows, first, label }: { rows: BoardRow[]; first: string; label: (key: string) => string }) {
  return (
    <div className="table-wrap">
      <table className="table board-table">
        <thead>
          <tr>
            <th>{first}</th>
            <th className="bar-col">Use of the line</th>
            <th>Credit line</th>
            <th>Earlier days</th>
            <th>Initial today</th>
            <th>Today’s fills</th>
            <th>Reserved</th>
            <th>Headroom</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td>{label(r.key)}</td>
              <td className="bar-col">
                <UseBar row={r} what={label(r.key)} />
              </td>
              <td>{mio(r.line)}</td>
              <td>{mio(r.earlier)}</td>
              <td>{mio(r.initial)}</td>
              <td>{signedMio(r.today)}</td>
              <td>{signedMio(r.reserved)}</td>
              <td>{r.headroom >= -0.5 ? mio(r.headroom) : <Status ok={false}>Over by {mio(-r.headroom)}</Status>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BoardPanel({ ctx, state, groupId, onGroup }: { ctx: Ctx; state: AppState; groupId: string; onGroup: (id: string) => void }) {
  const group = state.groups.find((g) => g.id === groupId) ?? state.groups[0];
  const b = board(ctx, state, group.id);
  const lps = state.lps.filter((l) => l.groupId === group.id);
  return (
    <Section title="Credit line board" zh="授信額度一覽" unit="USD mio">
      <div className="board-head">
        <div className="segmented" role="group" aria-label="Banking group">
          {state.groups.map((g) => (
            <button key={g.id} type="button" aria-pressed={g.id === group.id} onClick={() => onGroup(g.id)}>
              {g.name}
            </button>
          ))}
        </div>
        <ul className="legend" aria-label="Bar legend">
          <li>
            <span className="seg seg-earlier" /> Earlier days
          </li>
          <li>
            <span className="seg seg-today" /> Today’s fills
          </li>
          <li>
            <span className="seg seg-reserved" /> Reserved
          </li>
        </ul>
      </div>
      <p className="note">
        One set of lines for the whole group, shared by {lps.map((l) => `${l.name} on ${l.channel}`).join(', ')}. Close-out netting:{' '}
        {group.closeOutNetting ? 'yes' : 'no'}. Payment netting: {group.paymentNetting ? 'yes' : 'no'}. Initial today = credit line − earlier
        days; headroom = initial today − today’s fills − reserved.
      </p>
      <h3 className="sub-title">
        <Term en="Pre-settlement risk" zh="交割前風險" /> by <Term en="time pillar" zh="期限檔" />
      </h3>
      <BoardTable rows={b.psr} first="Pillar" label={(k) => k} />
      <h3 className="sub-title">
        <Term en="Settlement risk" zh="結算風險" /> by settlement date
      </h3>
      {b.sr.length > 0 ? (
        <BoardTable rows={b.sr} first="Date" label={day} />
      ) : (
        <p className="note">No gross-settled payments are outstanding with this group. The daily line is USD {mio(group.srLine)} mio.</p>
      )}
    </Section>
  );
}

// ----------------------------------------------------------------- blotter
const STATUS_LABEL = { IN_FLIGHT: 'In flight 在途', FILLED: 'Filled 已成交', REJECTED: 'Rejected 已拒絕', EXPIRED: 'Lapsed 已失效' } as const;

function Blotter(p: { ctx: Ctx; state: AppState; dispatch: Dispatch<Action>; selectedId: string | null; onSelect: (id: string | null) => void }) {
  const { ctx, state } = p;
  if (state.trades.length === 0) return <p className="note">No hedges yet. Fill in the ticket above and send one.</p>;
  return (
    <div className="table-wrap">
      <table className="table pick-table">
        <thead>
          <tr>
            <th>Hedge</th>
            <th>Status</th>
            <th>Product</th>
            <th>Direction</th>
            <th>Amount</th>
            <th>Near</th>
            <th>Far</th>
            <th>LP</th>
            <th>Settlement</th>
            <th>Market value, USD</th>
            <th>Own exposure, USD</th>
            <th>LP’s answer</th>
          </tr>
        </thead>
        <tbody>
          {[...state.trades].reverse().map((t) => {
            const far = t.legs[t.legs.length - 1];
            const live = t.status === 'FILLED' || t.status === 'IN_FLIGHT';
            const settled = t.status === 'FILLED' && far.date < ctx.t0;
            const r = live && !settled ? valueTrade(ctx, t) : null;
            return (
              <tr key={t.id} data-selected={t.id === p.selectedId} className={live && !settled ? undefined : 'muted-row'}>
                <td>
                  <button type="button" className="row-pick" aria-pressed={t.id === p.selectedId} onClick={() => p.onSelect(t.id === p.selectedId ? null : t.id)}>
                    {t.id}
                  </button>
                </td>
                <td>{settled ? 'Settled 已交收' : STATUS_LABEL[t.status]}</td>
                <td>
                  {PRODUCT_LABEL[t.product]} {PAIRS[t.pair].label} {t.tenor}
                </td>
                <td>{direction(t)}</td>
                <td>{amt(t.amount)}</td>
                <td>{t.legs.length > 1 ? shortDay(t.legs[0].date) : '–'}</td>
                <td>{shortDay(far.date)}</td>
                <td>{lpLabel(state, t.lpId)}</td>
                <td>{SETTLEMENT_LABEL[t.settlement]}</td>
                <td>{r ? amt(r.mv) : '–'}</td>
                <td>{r ? amt(r.exposure) : '–'}</td>
                <td>
                  {t.status === 'IN_FLIGHT' ? (
                    <span className="row-actions">
                      <button type="button" onClick={() => p.dispatch({ type: 'FILL', id: t.id })}>
                        Fill
                      </button>
                      <button type="button" onClick={() => p.dispatch({ type: 'REJECT', id: t.id })}>
                        Reject
                      </button>
                    </span>
                  ) : (
                    '–'
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------- settings
function MarketEditor({ state, dispatch }: { state: AppState; dispatch: Dispatch<Action> }) {
  const edit = (change: (d: AppState) => void) => dispatch({ type: 'EDIT', change });
  return (
    <details className="panel">
      <summary>
        <Term en="Market data" zh="市場數據" /> <span className="unit">illustrative levels, edit any cell</span>
      </summary>
      <div className="table-wrap">
        <table className="table edit-table">
          <thead>
            <tr>
              <th>Pair</th>
              <th>Spot</th>
              {POINT_TENORS.map((t) => (
                <th key={t}>{t} pips</th>
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
          </tbody>
        </table>
      </div>
      <div className="table-wrap">
        <table className="table edit-table">
          <thead>
            <tr>
              <th>USD interest rate, %</th>
              {RATE_TENORS.map((t) => (
                <th key={t}>{t}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Simple, Act/360</td>
              {RATE_TENORS.map((t) => (
                <td key={t}>
                  <NumInput label={`USD ${t} rate`} value={state.market.usdRates[t]} onChange={(v) => edit((d) => void (d.market.usdRates[t] = v))} />
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <p className="note">Swap points are from spot to each tenor, except O/N and T/N, which cover the single day before spot.</p>
    </details>
  );
}

function LinesEditor({ state, dispatch }: { state: AppState; dispatch: Dispatch<Action> }) {
  const edit = (change: (d: AppState) => void) => dispatch({ type: 'EDIT', change });
  return (
    <details className="panel">
      <summary>
        <Term en="Credit lines and add-ons" zh="授信額度與附加因子" /> <span className="unit">set by the credit owner, not the trader</span>
      </summary>
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
            <tr>
              <td>Add-on, % of notional</td>
              {PILLARS.map((p, pi) => (
                <td key={p}>
                  <NumInput label={`Add-on ${p}`} value={state.addOnPct[pi]} min={0} onChange={(v) => v >= 0 && edit((d) => void (d.addOnPct[pi] = v))} />
                </td>
              ))}
              <td colSpan={3} className="note-cell">
                by the pillar a hedge matures in
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </details>
  );
}
