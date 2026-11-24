import { useMemo } from 'react';
import golden from '../data/golden.json';
import { PAIRS, PILLARS, spotDate, tenorDate, tomDate } from '../engine/calendar';
import { defaultState } from '../engine/defaults';
import { board, checkTrade } from '../engine/lines';
import { dfUsd } from '../engine/market';
import { makeCtx, srByDate, valueLeg } from '../engine/risk';
import { buildTrade, reducer } from '../engine/state';
import type { PairId, Ticket, Trade } from '../engine/types';
import { Calc, Term } from './bits';
import { amt, day, num, pct, rate, shortDay, signedAmt } from './format';
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
  let dateCases = 0;
  let dateDiffs = 0;
  for (const row of golden.dates as Record<string, string>[]) {
    const pair = row.pair as PairId;
    const spot = spotDate(row.tradeDate, pair);
    const mine: Record<string, string> = { tom: tomDate(row.tradeDate, pair), spot };
    for (const t of FAR_TENORS) mine[t] = tenorDate(spot, t, pair);
    for (const key of Object.keys(mine)) {
      dateCases++;
      if (mine[key] !== row[key]) dateDiffs++;
    }
  }
  const out = { dateCases, dateDiffs, fwdCases: 0, fwdMax: 0, dfCases: 0, dfMax: 0, legCases: 0, legMax: 0 };
  const sample: { pair: PairId; base: number; rate: number; date: string; mine: number; theirs: number }[] = [];
  golden.scenarios.forEach((sc, i) => {
    const ctx = makeCtx({ ...defaultState(), businessDate: sc.businessDate });
    for (const f of sc.forwards) {
      out.fwdCases++;
      out.fwdMax = Math.max(out.fwdMax, Math.abs(ctx.curve(f.pair as PairId).forward(f.date) - f.forward));
    }
    for (const d of sc.dfs) {
      out.dfCases++;
      out.dfMax = Math.max(out.dfMax, Math.abs(dfUsd(ctx.market, ctx.t0, d.date) - d.df));
    }
    for (const leg of sc.legs) {
      const mine = valueLeg(ctx, leg.pair as PairId, leg).mv;
      out.legCases++;
      out.legMax = Math.max(out.legMax, Math.abs(mine - leg.mvUsd));
      if (i === 1 && sample.length < 6 && leg.date > sc.businessDate) sample.push({ ...leg, pair: leg.pair as PairId, mine, theirs: leg.mvUsd });
    }
  });
  return { ...out, sample, sampleDate: golden.scenarios[1].businessDate, version: golden.generatedWith };
}

const tiny = (x: number, unit = '') => (x < 1e-9 ? 'none' : `${unit}${x.toExponential(1)}`);

export function Formulae() {
  const ex = useMemo(buildExample, []);
  const cmp = useMemo(compareWithQuantLib, []);
  const [near, far] = ex.trade.legs;
  const mirrorMv = -ex.risk1.mv;

  return (
    <div className="prose">
      <h2>The limit is not the trade size</h2>
      <p>
        A first instinct is to give each counterparty a limit in millions and take the trade size off it. For an FX swap that measures the wrong
        thing. Take one hedge: buy and sell back EUR {amt(EXAMPLE.amount)} against USD, from spot to three months. Three different numbers
        describe what could go wrong.
      </p>
      <div className="table-wrap">
        <table className="table text-table">
          <thead>
            <tr>
              <th>Measure</th>
              <th>Amount, USD</th>
              <th>What it answers</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Trade size</td>
              <td>{amt(ex.check.risk.notionalUsd)}</td>
              <td>Nothing about credit: this much is exchanged, but it is not what is lost if the counterparty fails.</td>
            </tr>
            <tr>
              <td>
                <Term en="Pre-settlement risk" zh="交割前風險" />
              </td>
              <td>{amt(ex.check.risk.exposure)}</td>
              <td>If the counterparty fails before the far leg settles, what would it cost to replace the hedge at market?</td>
            </tr>
            <tr>
              <td>
                <Term en="Settlement risk" zh="結算風險" />, through CLS
              </td>
              <td>0</td>
              <td>On a settlement day, could we pay and not be paid? Not when both payments are tied together.</td>
            </tr>
            <tr>
              <td>
                <Term en="Settlement risk" zh="結算風險" />, settled gross
              </td>
              <td>
                {amt(ex.ifGross.get(near.date)!.exposure)} on {shortDay(near.date)}, {amt(ex.ifGross.get(far.date)!.exposure)} on {shortDay(far.date)}
              </td>
              <td>The same question when each side pays separately: the whole amount we are due to receive that day.</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        So a counterparty needs two credit lines, measured differently, and a hedge may go out only when both have room. The rest of this page
        builds each number.
      </p>

      <h2>
        <Term en="Pricing a swap" zh="外匯掉期定價" />
      </h2>
      <p>
        An FX swap is two exchanges of the same amount in opposite directions: the near leg and the far leg. The market quotes the far leg as a
        distance from spot, in swap points <span className="zh" lang="zh-Hant">掉期點</span>.
      </p>
      <Calc>outright rate for a date = spot + swap points to that date</Calc>
      <Calc>swap points between two quoted tenors: straight line by calendar days</Calc>
      <p>
        The points are not a view on where spot will go. They are the interest-rate gap between the two currencies, because swapping currencies
        for a period is the same as borrowing one and lending the other (covered interest parity{' '}
        <span className="zh" lang="zh-Hant">拋補利率平價</span>):
      </p>
      <Calc>
        far rate ÷ near rate = (1 + r<sub>quote</sub> × t) ÷ (1 + r<sub>base</sub> × t)
      </Calc>
      <h3>Value dates</h3>
      <ul>
        <li>
          Spot is two business days after the trade date. The day in between only has to be a business day for the non-USD currency; the spot
          date must be a business day for both currencies and for USD.
        </li>
        <li>A tenor runs from spot. A month-end spot date maps to the month-end of the target month; otherwise a date that lands on a holiday moves forward, unless that would leave the month.</li>
        <li>Overnight runs from today to the next business day, and tom-next from then to spot. Their points are subtracted from spot.</li>
      </ul>

      <h2>
        <Term en="Market value" zh="市值" />
      </h2>
      <p>
        What a hedge is worth today. Each leg not yet settled is compared with today's rate for the same date, and the difference is brought
        back to today with the USD discount factor.
      </p>
      <Calc>leg value in USD = amount × (today's rate for the date − dealt rate) × discount factor</Calc>
      <Calc>when USD is the base currency, divide by today's rate to turn the gain into USD</Calc>
      <Calc>discount factor = 1 ÷ (1 + USD rate × days ÷ 360)</Calc>
      <p>A hedge dealt at market starts at zero. Its value then moves with spot, with the points, and simply with time.</p>

      <h2>
        <Term en="Pre-settlement risk" zh="交割前風險" />
      </h2>
      <p>
        The cost of replacing a hedge if the counterparty defaults before it settles. Today's replacement cost is the market value. What it
        might be later is unknown, so an <Term en="add-on" zh="附加因子" /> is added: a percentage of notional that grows with the time left.
      </p>
      <Calc>exposure of one hedge = max(market value + notional × add-on %, 0)</Calc>
      <ul>
        <li>The notional is the amount in the base currency, converted to USD at spot.</li>
        <li>For a swap, the notional and the maturity are the far leg's. Once the near leg has settled, a swap is an outright forward.</li>
        <li>A negative market value offsets the add-on: a hedge already out of the money has further to go before the counterparty owes anything.</li>
        <li>A hedge whose last leg settles today has nothing left to replace.</li>
      </ul>
      <h3>
        <Term en="Time pillars" zh="期限檔" />
      </h3>
      <p>
        The line is set per pillar: {PILLARS.join(', ')}. A hedge counts in the pillar its maturity falls in and in every shorter one. A two-month
        swap therefore uses the O/N, 1W, 1M and 3M pillars, and leaves 6M and 1Y untouched. The effect is that each line caps everything that
        runs at least that long, so a credit owner can allow plenty of short-dated business and little long-dated business.
      </p>
      <h3>
        With a <Term en="close-out netting agreement" zh="終止淨額結算協議" />
      </h3>
      <p>
        If the counterparty defaults, all hedges under the agreement collapse into one net amount, so gains and losses offset. The add-on is
        scaled down by how much they offset today, using the net-to-gross ratio (NGR) from the Basel current exposure method.
      </p>
      <Calc>NGR = max(Σ market value, 0) ÷ Σ max(market value, 0)</Calc>
      <Calc>net add-on = (0.4 + 0.6 × NGR) × Σ add-on</Calc>
      <Calc>exposure = max(Σ market value + net add-on, 0)</Calc>
      <p>Without an agreement, each hedge's own exposure is added up.</p>

      <h2>
        <Term en="Settlement risk" zh="結算風險" />
      </h2>
      <p>
        On a settlement day each side pays one currency and receives the other. If we pay and the counterparty does not, we lose the whole
        amount we were due, not just a price move.
      </p>
      <Calc>exposure on a date = everything we are due to receive that day, in USD at spot</Calc>
      <ul>
        <li>One line applies to every date: it caps how much can be at stake on any single day.</li>
        <li>Only principal counts, and amounts are not discounted.</li>
        <li>
          <Term en="Payment-versus-payment" zh="同步交收" /> settlement, such as CLS, releases each payment only if the other arrives. Those hedges
          carry no settlement risk.
        </li>
        <li>An NDF exchanges no principal, only one net USD amount, so it carries none either.</li>
        <li>
          With <Term en="payment netting" zh="支付淨額結算" />, flows in the same currency on the same date offset first. Otherwise every
          receivable is added up.
        </li>
        <li>CLS cannot take a payment due today, so an overnight swap settles gross even between two CLS currencies.</li>
      </ul>

      <h2>
        <Term en="The check" zh="交易前檢查" />
      </h2>
      <Calc>initial limit today = credit line − exposure of hedges from earlier days</Calc>
      <Calc>headroom = initial limit today − today's fills − reservations</Calc>
      <p>
        A hedge passes when, on every pillar and every settlement date, exposure after it is within the line, or it does not increase exposure.
        Sending a hedge to an LP turns the room it needs into a <Term en="reservation" zh="額度預佔" />. A fill turns the reservation into
        utilisation; a rejection, or no answer by the end of the day, releases it. Without that hold, two hedges in flight could each pass the
        check and both fill.
      </p>
      <div className="table-wrap">
        <table className="table text-table">
          <thead>
            <tr>
              <th>Product</th>
              <th>Pre-settlement risk</th>
              <th>Settlement risk</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>FX swap</td>
              <td>Far leg notional, by the far leg's remaining maturity</td>
              <td>Both value dates, unless settled payment-versus-payment</td>
            </tr>
            <tr>
              <td>Outright forward</td>
              <td>Notional, by remaining maturity</td>
              <td>One value date, unless settled payment-versus-payment</td>
            </tr>
            <tr>
              <td>NDF</td>
              <td>Notional, by remaining maturity</td>
              <td>None</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>Worked example, part 1: the day it is dealt</h2>
      <p>
        {day(ex.s0.businessDate)}. Buy and sell back EUR {amt(EXAMPLE.amount)} against USD for three months with Bank A London. Spot is{' '}
        {rate('EURUSD', ex.s0.market.pairs.EURUSD.spot)} and the three-month points are {num(ex.s0.market.pairs.EURUSD.points['3M'], 1)}.
      </p>
      <Workings ctx={ex.ctx0} trade={ex.trade} risk={ex.check.risk} measured={ex.check.after} group={ex.check.group} isNew openAll />

      <h2>Worked example, part 2: a week later, spot 1% higher</h2>
      <p>
        {day(ex.s1.businessDate)}. The near leg has settled. Spot has risen from {rate('EURUSD', ex.s0.market.pairs.EURUSD.spot)} to{' '}
        {rate('EURUSD', LATER_SPOT)}. On the far leg we sell EUR at {rate('EURUSD', far.rate)}, which is now below the market, so the hedge has a
        market value of USD {signedAmt(ex.risk1.mv)}. That offsets part of the add-on of {amt(ex.risk1.addOn)}, and the exposure falls
        to {amt(ex.risk1.exposure)}.
      </p>
      <p>
        Had the hedge been the other way round, the market value would be {signedAmt(mirrorMv)} and the exposure{' '}
        {amt(Math.max(mirrorMv + ex.risk1.addOn, 0))}: the counterparty would owe us, and the line would be fuller without a single new trade.
        This is why the lines are measured again every day.
      </p>
      <Workings ctx={ex.ctx1} trade={ex.filled} risk={ex.risk1} measured={ex.measured1} group={ex.check.group} isNew={false} openAll />

      <h2>Checked against QuantLib</h2>
      <p>
        Every number in this app comes from its own calculation, shown above. As an independent check, the same cases are computed with{' '}
        {cmp.version}, an open-source pricing library, and the app must reproduce them. The comparison below is recomputed in your browser now.
      </p>
      <div className="table-wrap">
        <table className="table text-table">
          <thead>
            <tr>
              <th>What is compared</th>
              <th>Cases</th>
              <th>Largest difference</th>
              <th>QuantLib's part</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Value dates: tomorrow, spot and eight tenors, five pairs, eleven trade dates</td>
              <td>{cmp.dateCases}</td>
              <td>{cmp.dateDiffs === 0 ? 'none' : `${cmp.dateDiffs} dates differ`}</td>
              <td>Holiday calendars and tenor date arithmetic</td>
            </tr>
            <tr>
              <td>Outright rates on three business dates</td>
              <td>{cmp.fwdCases}</td>
              <td>{tiny(cmp.fwdMax)}</td>
              <td>Dates only; the interpolation is written twice, here and in Python</td>
            </tr>
            <tr>
              <td>USD discount factors</td>
              <td>{cmp.dfCases}</td>
              <td>{tiny(cmp.dfMax)}</td>
              <td>None; written twice, here and in Python</td>
            </tr>
            <tr>
              <td>Market value of single legs, deals away from the market</td>
              <td>{cmp.legCases}</td>
              <td>{tiny(cmp.legMax, 'USD ')}</td>
              <td>FX forward pricing engine with two discount curves</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Leg valued on {shortDay(cmp.sampleDate)}</th>
              <th>Dealt rate</th>
              <th>Value date</th>
              <th>This app, USD</th>
              <th>QuantLib, USD</th>
            </tr>
          </thead>
          <tbody>
            {cmp.sample.map((l, i) => (
              <tr key={i}>
                <td>
                  {l.base > 0 ? 'Buy' : 'Sell'} {PAIRS[l.pair].base} {amt(Math.abs(l.base))} {PAIRS[l.pair].label}
                </td>
                <td>{rate(l.pair, l.rate)}</td>
                <td>{shortDay(l.date)}</td>
                <td>{num(l.mine, 2)}</td>
                <td>{num(l.theirs, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="note">
        The pre-settlement and settlement risk rules are credit policy, not pricing, so no library computes them. They are tested against cases
        worked by hand. Limits of the data: QuantLib {cmp.version.replace('QuantLib ', '')} has no lunar holidays for Hong Kong or Taiwan after
        2026, so USD/CNH and USD/TWD dates in 2027 ignore them. NDF fixing dates are not modelled. The add-ons of {ex.s0.addOnPct.map((a) => pct(a, 1)).join(', ')} are
        invented.
      </p>

      <h2>Sources</h2>
      <ul>
        <li>Basel Committee on Banking Supervision, Basel II framework, Annex 4: the current exposure method and the net-to-gross ratio formula.</li>
        <li>Basel Committee on Banking Supervision, Supervisory guidance for managing risks associated with the settlement of foreign exchange transactions (2013): principal risk as the full amount of the currency bought.</li>
        <li>CLS Group: payment-versus-payment settlement and the list of eligible currencies.</li>
        <li>Global Foreign Exchange Committee, FX Global Code: credit monitoring and settlement principles.</li>
        <li>QuantLib, quantlib.org: calendars and the FX forward pricing engine used for the comparison.</li>
      </ul>
    </div>
  );
}
