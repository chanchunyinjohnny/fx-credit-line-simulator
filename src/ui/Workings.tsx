import type { ReactNode } from 'react';
import { PAIRS, PILLARS, daysBetween, spotDate, tomDate } from '../engine/calendar';
import type { Measured } from '../engine/lines';
import { usdPerUnit, usdRate, type FxCurve } from '../engine/market';
import type { Ctx, TradeRisk } from '../engine/risk';
import type { Group, ISODate, PairId, Trade } from '../engine/types';
import { Calc, Term } from './bits';
import { amt, day, num, pct, pips, rate, shortDay, signedAmt } from './format';

interface Props {
  ctx: Ctx;
  trade: Trade;
  risk: TradeRisk;
  measured: Measured; // the group's trades, including this one
  group: Group;
  isNew: boolean; // a ticket not yet sent: rates are today's, so their build-up can be shown
  openAll?: boolean;
}

function Step(p: { title: string; zh: string; result: ReactNode; open?: boolean; children: ReactNode }) {
  return (
    <li>
      <details open={p.open}>
        <summary>
          <span className="step-title">
            <Term en={p.title} zh={p.zh} />
          </span>
          <span className="step-result">{p.result}</span>
        </summary>
        <div className="step-body">{p.children}</div>
      </details>
    </li>
  );
}

/** How today's outright rate for one date is put together. */
function RateBuild({ ctx, pair, date, curve }: { ctx: Ctx; pair: PairId; date: ISODate; curve: FxCurve }) {
  const { spot: s, points } = ctx.market.pairs[pair];
  const pip = PAIRS[pair].pip;
  const f = curve.forward(date);
  if (date === curve.spot) return <Calc>{shortDay(date)} is the spot date: rate = spot = {rate(pair, s)}</Calc>;
  if (date < curve.spot) {
    const isTom = date === curve.tom;
    return (
      <Calc>
        {shortDay(date)} is {isTom ? 'tomorrow' : 'today'}, before spot, so points are taken off: {rate(pair, s)}
        {curve.tom < curve.spot && <> − {num(points.TN, 2)} (T/N)</>}
        {!isTom && <> − {num(points.ON, 2)} (O/N)</>} pips = {rate(pair, f)}
      </Calc>
    );
  }
  const i = Math.max(1, curve.nodes.findIndex((n) => n.date >= date));
  const a = curve.nodes[i - 1];
  const b = curve.nodes[i];
  const exact = b.date === date;
  return (
    <>
      {exact ? (
        <Calc>
          Swap points to {shortDay(date)}: the {b.tenor} quote, {pips(pair, b.points)} pips
        </Calc>
      ) : (
        <Calc>
          Swap points to {shortDay(date)}: between {a.tenor === 'SPOT' ? 'spot' : a.tenor} ({shortDay(a.date)}, {pips(pair, a.points)}) and{' '}
          {b.tenor} ({shortDay(b.date)}, {pips(pair, b.points)}), {daysBetween(a.date, date)} of {daysBetween(a.date, b.date)} days along ={' '}
          {pips(pair, f - s)} pips
        </Calc>
      )}
      <Calc>
        Rate = spot + points = {rate(pair, s)} + {pips(pair, f - s)} × {pip} = {rate(pair, f)}
      </Calc>
    </>
  );
}

/** The interest rate in the other currency that the swap points imply. */
function ImpliedRate({ ctx, trade, curve }: { ctx: Ctx; trade: Trade; curve: FxCurve }) {
  const info = PAIRS[trade.pair];
  const far = trade.legs[trade.legs.length - 1];
  const startDate = trade.legs.length > 1 ? trade.legs[0].date : curve.spot;
  const startRate = trade.legs.length > 1 ? trade.legs[0].rate : ctx.market.pairs[trade.pair].spot;
  const days = daysBetween(startDate, far.date);
  if (days <= 0) return null;
  const t = days / 360;
  const rUsd = usdRate(ctx.market, days) / 100;
  const usdIsQuote = info.quote === 'USD';
  const other = usdIsQuote ? info.base : info.quote;
  // Covered interest parity: far / near = (1 + r_quote t) / (1 + r_base t)
  const ratio = far.rate / startRate;
  const rOther = usdIsQuote ? ((1 + rUsd * t) / ratio - 1) / t : ((1 + rUsd * t) * ratio - 1) / t;
  return (
    <div className="aside-note">
      <p>
        <strong>What the points mean.</strong> Swapping {info.base} for {info.quote} for {days} days is lending one currency and borrowing the
        other, so the far rate differs from the near rate by the interest-rate gap (covered interest parity{' '}
        <span className="zh" lang="zh-Hant">拋補利率平價</span>):
      </p>
      <Calc>
        far ÷ near = (1 + r<sub>{info.quote}</sub> × t) ÷ (1 + r<sub>{info.base}</sub> × t), with t = {days}/360
      </Calc>
      <Calc>
        {rate(trade.pair, far.rate)} ÷ {rate(trade.pair, startRate)} = {ratio.toFixed(6)}; with USD at {pct(rUsd * 100)} this implies {other} at{' '}
        {pct(rOther * 100)}
      </Calc>
    </div>
  );
}

export function Workings({ ctx, trade, risk, measured, group, isNew, openAll }: Props) {
  const info = PAIRS[trade.pair];
  const curve = ctx.curve(trade.pair);
  const isSwap = trade.legs.length > 1;
  const near = isSwap ? trade.legs[0] : undefined;
  const far = trade.legs[trade.legs.length - 1];
  const spot = spotDate(trade.tradeDate, trade.pair);
  const tom = tomDate(trade.tradeDate, trade.pair);
  const nonUsd = [info.base, info.quote].filter((c) => c !== 'USD').join(' and ');
  const baseUsd = usdPerUnit(ctx.market, info.base);
  const ownPillar = risk.pillar;
  const agg = ownPillar >= 0 ? measured.psr[ownPillar] : undefined;
  const legDates = trade.legs.filter((l) => l.date >= ctx.t0).map((l) => l.date);
  const srDays = trade.settlement === 'GROSS' ? legDates.map((d) => measured.sr.get(d)!).filter(Boolean) : [];
  const who = (id: string) => (id === trade.id ? (isNew ? 'This hedge' : `${id} (this hedge)`) : id);

  return (
    <ol className="steps">
      <Step title="Value dates" zh="交割日" open={openAll} result={isSwap ? `${shortDay(near!.date)} → ${shortDay(far.date)}` : shortDay(far.date)}>
        <p>
          Dealt on {day(trade.tradeDate)}. The spot date is two business days on: {day(spot)}. The day in between only has to be a business day
          for {nonUsd}; the spot date itself must be a business day for {nonUsd} and USD.
        </p>
        {trade.tenor === 'ON' && <p>Overnight swap: the near leg settles today and the far leg on the next business day, {day(tom)}.</p>}
        {trade.tenor === 'TN' && <p>Tom-next swap: the near leg settles tomorrow, {day(tom)}, and the far leg on the spot date.</p>}
        {trade.tenor !== 'ON' && trade.tenor !== 'TN' && (
          <p>
            {isSwap ? 'The near leg settles on the spot date. The far leg settles' : 'The value date is'} {trade.tenor} after spot: {day(far.date)},
            moved to a business day where needed.
          </p>
        )}
      </Step>

      <Step
        title="Rates"
        zh="匯率"
        open={openAll}
        result={isSwap ? `${rate(trade.pair, near!.rate)} / ${rate(trade.pair, far.rate)}` : rate(trade.pair, far.rate)}
      >
        {isNew ? (
          <>
            <p>
              A new hedge is dealt at today's mid rates. Spot {info.label} is {rate(trade.pair, ctx.market.pairs[trade.pair].spot)}.
            </p>
            {trade.legs.map((l) => (
              <RateBuild key={l.date} ctx={ctx} pair={trade.pair} date={l.date} curve={curve} />
            ))}
            <ImpliedRate ctx={ctx} trade={trade} curve={curve} />
          </>
        ) : (
          <p>
            Dealt at {isSwap ? `${rate(trade.pair, near!.rate)} on the near leg and ${rate(trade.pair, far.rate)} on the far leg` : rate(trade.pair, far.rate)}.
            These were fixed when the hedge was sent on {day(trade.tradeDate)}.
          </p>
        )}
      </Step>

      <Step title="Cash flows" zh="現金流" open={openAll} result={trade.product === 'NDF' ? 'Net amount only' : `${trade.legs.length * 2} payments`}>
        {trade.product === 'NDF' ? (
          <p>
            No principal changes hands. On {day(far.date)} the difference between {rate(trade.pair, far.rate)} and the fixing rate, on {info.base}{' '}
            {amt(Math.abs(far.base))}, is paid in USD as one net amount.
          </p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>We receive</th>
                  <th>We pay</th>
                  <th>At rate</th>
                </tr>
              </thead>
              <tbody>
                {trade.legs.map((l) => {
                  const baseFlow = `${info.base} ${amt(Math.abs(l.base))}`;
                  const quoteFlow = `${info.quote} ${amt(Math.abs(l.base * l.rate))}`;
                  return (
                    <tr key={l.date} className={l.date < ctx.t0 ? 'muted-row' : undefined}>
                      <td>
                        {day(l.date)}
                        {l.date < ctx.t0 && ' (settled)'}
                      </td>
                      <td>{l.base > 0 ? baseFlow : quoteFlow}</td>
                      <td>{l.base > 0 ? quoteFlow : baseFlow}</td>
                      <td>{rate(trade.pair, l.rate)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Step>

      <Step title="Market value" zh="市值" open={openAll} result={`USD ${signedAmt(risk.mv)}`}>
        <p>
          What the hedge is worth today: each unsettled leg is revalued at today's rate for its date, and the gain or loss is brought back to
          today at the USD rate.
        </p>
        <Calc>
          leg value = amount × (today's rate − dealt rate){info.quote === 'USD' ? '' : " ÷ today's rate"} × discount factor
        </Calc>
        {risk.legs.length === 0 && <p>Every leg has settled.</p>}
        {risk.legs.map((l) => {
          const n = daysBetween(ctx.t0, l.date);
          return (
            <div key={l.date} className="calc-group">
              <Calc>
                {shortDay(l.date)}: discount factor = 1 ÷ (1 + {pct(usdRate(ctx.market, n), 3)} × {n}/360) = {l.df.toFixed(6)}
              </Calc>
              <Calc>
                {signedAmt(l.base)} × ({rate(trade.pair, l.forward)} − {rate(trade.pair, l.rate)})
                {info.quote === 'USD' ? '' : ` ÷ ${rate(trade.pair, l.forward)}`} × {l.df.toFixed(6)} = USD {signedAmt(l.mv)}
              </Calc>
            </div>
          );
        })}
        {risk.legs.length > 1 && <Calc>Market value = sum of the legs = USD {signedAmt(risk.mv)}</Calc>}
        {isNew && <p className="note">A hedge dealt at today's rates starts at zero. It moves when rates move and as its dates draw nearer.</p>}
      </Step>

      <Step title="Add-on and exposure of this hedge" zh="附加因子與風險敞口" open={openAll} result={`USD ${amt(risk.exposure)}`}>
        {ownPillar < 0 ? (
          <p>The last leg settles today or has settled, so nothing is left to replace: no pre-settlement risk.</p>
        ) : (
          <>
            <p>
              The add-on covers how far the market value could move before the hedge matures. For a swap it is taken on the far leg, because
              once the near leg has settled the swap is an outright forward.
            </p>
            <Calc>
              Notional = {isSwap ? 'far-leg ' : ''}amount at spot = {info.base} {amt(Math.abs(far.base))}
              {info.base === 'USD' ? '' : ` × ${baseUsd.toFixed(info.dp)}`} = USD {amt(risk.notionalUsd)}
            </Calc>
            <Calc>
              Matures {shortDay(risk.maturity)} → {PILLARS[ownPillar]} pillar (maturities up to {shortDay(ctx.pillarEnds[ownPillar])}) → add-on{' '}
              {pct(risk.addOnPct)}
            </Calc>
            <Calc>
              Add-on = {amt(risk.notionalUsd)} × {pct(risk.addOnPct)} = USD {amt(risk.addOn)}
            </Calc>
            <Calc>
              Exposure = max(market value + add-on, 0) = max({signedAmt(risk.mv)} + {amt(risk.addOn)}, 0) = USD {amt(risk.exposure)}
            </Calc>
          </>
        )}
      </Step>

      <Step
        title={`Pre-settlement risk of ${group.name}`}
        zh="交割前風險"
        open={openAll}
        result={agg ? `${PILLARS[ownPillar]}: USD ${amt(agg.exposure)} of ${amt(group.psrLines[ownPillar])}` : 'Unchanged'}
      >
        <p>
          A hedge counts in the pillar its maturity falls in and in every shorter pillar, so a line can cap how much runs beyond each maturity.{' '}
          {group.closeOutNetting
            ? 'This group has a close-out netting agreement: market values offset each other, and the add-on is scaled by how much they offset.'
            : 'This group has no close-out netting agreement: each hedge’s own exposure is added up.'}
        </p>
        {group.closeOutNetting ? (
          <>
            <Calc>NGR = max(Σ market value, 0) ÷ Σ max(market value, 0)</Calc>
            <Calc>net add-on = (0.4 + 0.6 × NGR) × gross add-on</Calc>
            <Calc>exposure = max(Σ market value + net add-on, 0)</Calc>
          </>
        ) : (
          <Calc>exposure = Σ max(market value + add-on, 0), hedge by hedge</Calc>
        )}
        {agg && group.closeOutNetting && (
          <div className="calc-group">
            <Calc>
              {PILLARS[ownPillar]}:{' '}
              {agg.sumPositiveMv > 0
                ? `NGR = max(${signedAmt(agg.sumMv)}, 0) ÷ ${amt(agg.sumPositiveMv)} = ${agg.ngr.toFixed(4)}`
                : 'no hedge has a positive market value, so NGR is taken as 1'}
            </Calc>
            <Calc>
              net add-on = (0.4 + 0.6 × {agg.ngr.toFixed(4)}) × {amt(agg.addOnGross)} = {amt(agg.addOnNet)}
            </Calc>
            <Calc>
              exposure = max({signedAmt(agg.sumMv)} + {amt(agg.addOnNet)}, 0) = USD {amt(agg.exposure)}
            </Calc>
          </div>
        )}
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Pillar</th>
                <th>Hedges counted</th>
                <th>Σ market value</th>
                <th>Gross add-on</th>
                {group.closeOutNetting && <th>NGR</th>}
                {group.closeOutNetting && <th>Net add-on</th>}
                <th>Exposure</th>
                <th>Line</th>
              </tr>
            </thead>
            <tbody>
              {measured.psr.map((a, p) => (
                <tr key={PILLARS[p]} data-selected={p === ownPillar}>
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

      <Step
        title={`Settlement risk of ${group.name}`}
        zh="結算風險"
        open={openAll}
        result={srDays.length ? `USD ${amt(Math.max(...srDays.map((d) => d.exposure)))} at most` : 'None'}
      >
        {trade.settlement === 'CLS' && (
          <p>
            None. This hedge settles through CLS, where each side's payment is released only if the other's is (payment-versus-payment{' '}
            <span className="zh" lang="zh-Hant">同步交收</span>). Nothing can be paid away without being received.
          </p>
        )}
        {trade.settlement === 'CASH' && <p>None. An NDF pays one net amount in USD; no principal is exchanged, so none can be lost in settlement.</p>}
        {trade.settlement === 'GROSS' && srDays.length === 0 && <p>Every leg has settled.</p>}
        {trade.settlement === 'GROSS' && srDays.length > 0 && (
          <>
            <p>
              Settled gross: we pay one currency and separately wait for the other. What we are due to receive on a date is what we would lose if
              we paid and the counterparty did not. Amounts are in USD at spot, not discounted; the same line applies to every date.{' '}
              {group.paymentNetting
                ? 'This group has payment netting: flows in the same currency on the same date offset first.'
                : 'This group has no payment netting: every receivable is added up.'}
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
                          <th>{day(d.date)}</th>
                          <th>Currency</th>
                          <th>Amount</th>
                          <th>USD at spot</th>
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
                  {group.paymentNetting ? (
                    <Calc>
                      Net by currency: {[...net].map(([c, v]) => `${c} ${signedAmt(v)}`).join(', ')}; positive nets add to USD {amt(d.exposure)}
                    </Calc>
                  ) : (
                    <Calc>
                      Receivables:{' '}
                      {d.flows
                        .filter((f) => f.usd > 0)
                        .map((f) => amt(f.usd))
                        .join(' + ')}{' '}
                      = USD {amt(d.exposure)}
                    </Calc>
                  )}
                  <Calc>
                    Against the daily line of USD {amt(group.srLine)}: {d.exposure <= group.srLine ? 'within' : `over by ${amt(d.exposure - group.srLine)}`}
                  </Calc>
                </div>
              );
            })}
          </>
        )}
      </Step>
    </ol>
  );
}
