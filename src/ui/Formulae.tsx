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
import { Workings } from './Workings';

const M = 1_000_000;
const FAR_TENORS = ['SN', '1W', '1M', '2M', '3M', '6M', '9M', '1Y'] as const;
const EXAMPLE: Ticket = { product: 'SWAP', pair: 'EURUSD', side: 'BUY', amount: 20 * M, tenor: '3M', lpId: 'A-LDN-360T', settlement: 'AUTO' };
const LATER_SPOT = 1.1767; // 1% above the starting 1.1650

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

function Method({ title, zh, children }: { title: string; zh: string; children: ReactNode }) {
  return (
    <div className="method-row">
      <h3>
        {title}
        <span className="zh" lang="zh-Hant">{zh}</span>
      </h3>
      <div>{children}</div>
    </div>
  );
}

export function Formulae() {
  const ex = useMemo(buildExample, []);
  const cmp = useMemo(compareWithQuantLib, []);
  const [near, far] = ex.trade.legs;
  const total = cmp.dates.cases + cmp.rates.cases + cmp.dfs.cases + cmp.legs.cases;
  const allMatch = cmp.dates.worst === 0 && cmp.rates.worst < 1e-9 && cmp.dfs.worst < 1e-9 && cmp.legs.worst < 0.01;

  return (
    <div className="prose">
      <h2>One swap, three numbers</h2>
      <p>Buy and sell back EUR {amt(EXAMPLE.amount / M)} mio against USD, spot to three months. Trade size is not the risk.</p>
      <div className="stats">
        <div className="stat">
          <span className="stat-label">Trade size</span>
          <span className="stat-value">{mio(ex.check.risk.notionalUsd)}</span>
          <span className="stat-note">Exchanged, not at risk</span>
        </div>
        <div className="stat">
          <span className="stat-label">Pre-settlement risk</span>
          <span className="stat-value">{mio(ex.check.risk.exposure)}</span>
          <span className="stat-note">Cost to replace it if the counterparty fails first</span>
        </div>
        <div className="stat">
          <span className="stat-label">Settlement risk</span>
          <span className="stat-value">0</span>
          <span className="stat-note">Through CLS. Settled gross: {mio(ex.ifGross.get(near.date)!.exposure)} on each value date</span>
        </div>
      </div>
      <p className="quiet">USD mio. So each counterparty has two credit lines, and a hedge needs room on both.</p>

      <h2>The method</h2>
      <div className="method">
        <Method title="Rates" zh="匯率">
          <p>A swap is priced as spot plus swap points. The points are the interest-rate gap between the two currencies, not a view on spot.</p>
          <Calc>rate for a date = spot + swap points to that date</Calc>
          <Calc>
            far ÷ near = (1 + r<sub>quote</sub> × t) ÷ (1 + r<sub>base</sub> × t)
          </Calc>
        </Method>
        <Method title="Market value" zh="市值">
          <p>What the hedge is worth today. Zero when dealt; it moves with rates and with time.</p>
          <Calc>leg value = amount × (today's rate − dealt rate) × USD discount factor</Calc>
        </Method>
        <Method title="Pre-settlement risk" zh="交割前風險">
          <p>
            Today's value plus an add-on for how far it could still move. A swap counts on its far leg. A hedge counts in the pillar it matures
            in and in every shorter one.
          </p>
          <Calc>exposure = max(market value + notional × add-on %, 0)</Calc>
          <Calc>with close-out netting: max(Σ market value + (0.4 + 0.6 × NGR) × Σ add-on, 0)</Calc>
          <Calc>NGR = max(Σ market value, 0) ÷ Σ max(market value, 0)</Calc>
        </Method>
        <Method title="Settlement risk" zh="結算風險">
          <p>What we are due to receive on a settlement day: lost if we pay and are not paid. Zero through CLS and for NDFs.</p>
          <Calc>exposure on a date = amounts receivable that day, in USD at spot</Calc>
        </Method>
        <Method title="The check" zh="交易前檢查">
          <p>A hedge goes out only if every pillar and date stays within its line. Sending reserves the room until the LP fills or rejects.</p>
          <Calc>headroom = credit line − earlier days − today's fills − reservations</Calc>
        </Method>
      </div>

      <h2>The same swap, step by step</h2>
      <h3>The day it is dealt, {day(ex.s0.businessDate)}</h3>
      <Workings ctx={ex.ctx0} trade={ex.trade} risk={ex.check.risk} measured={ex.check.after} group={ex.check.group} isNew />
      <h3>A week later, spot up 1% to {rate('EURUSD', LATER_SPOT)}</h3>
      <p>
        We sell EUR on the far leg at {rate('EURUSD', far.rate)}, now below the market. The market value is USD {signedAmt(ex.risk1.mv)}, which
        offsets part of the add-on: exposure falls from {amt(ex.check.risk.exposure)} to {amt(ex.risk1.exposure)}. Dealt the other way round it
        would have risen to {amt(Math.max(-ex.risk1.mv + ex.risk1.addOn, 0))}.
      </p>
      <Workings ctx={ex.ctx1} trade={ex.filled} risk={ex.risk1} measured={ex.measured1} group={ex.check.group} isNew={false} />

      <h2>Checked against QuantLib</h2>
      <p>
        The app calculates everything itself. As a check, {cmp.version} computed {amt(total)} reference values and the app{' '}
        {allMatch ? 'reproduces all of them' : 'does not reproduce all of them'}, recomputed in your browser just now.
      </p>
      <div className="table-wrap">
        <table className="table compact">
          <thead>
            <tr>
              <th>Compared</th>
              <th>Cases</th>
              <th>Largest difference</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Value dates</td>
              <td>{cmp.dates.cases}</td>
              <td>{cmp.dates.worst === 0 ? 'none' : `${cmp.dates.worst} dates`}</td>
            </tr>
            <tr>
              <td>Outright rates</td>
              <td>{cmp.rates.cases}</td>
              <td>{cmp.rates.worst < 1e-9 ? 'none' : cmp.rates.worst.toExponential(1)}</td>
            </tr>
            <tr>
              <td>Discount factors</td>
              <td>{cmp.dfs.cases}</td>
              <td>{cmp.dfs.worst < 1e-9 ? 'none' : cmp.dfs.worst.toExponential(1)}</td>
            </tr>
            <tr>
              <td>Market values</td>
              <td>{cmp.legs.cases}</td>
              <td>{cmp.legs.worst < 0.01 ? 'under USD 0.01' : `USD ${cmp.legs.worst.toFixed(2)}`}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <details className="more">
        <summary>Limits and sources</summary>
        <ul>
          <li>Pre-settlement and settlement risk are credit rules, not pricing. They are tested against hand-worked cases, not a library.</li>
          <li>QuantLib has no Hong Kong or Taiwan lunar holidays after 2026, so USD/CNH and USD/TWD dates in 2027 ignore them.</li>
          <li>Net-to-gross ratio and add-on netting: Basel II framework, Annex 4 (current exposure method).</li>
          <li>Settlement risk as the amount bought: Basel Committee guidance on FX settlement risk (2013).</li>
          <li>Payment-versus-payment and eligible currencies: CLS Group.</li>
        </ul>
      </details>
    </div>
  );
}
