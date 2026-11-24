import type { ReactNode } from 'react';
import { Term } from './bits';

const Changed = ({ children = 'changed' }: { children?: ReactNode }) => <span className="tag">{children}</span>;

export function Design() {
  return (
    <div className="prose">
      <h2>The problem</h2>
      <p>
        A desk hedges FX swap positions with external liquidity providers on request-based channels, here 360T (request for stream) and FXGO
        (request for quote). Each hedge takes credit exposure to the LP. The usual control splits each counterparty's limit into fixed slices,
        one per channel, configured on the channel. A slice sitting unused on one channel cannot be used on another.
      </p>
      <p>
        The idea is to hold one credit line per counterparty in the order management system and check it before a hedge goes out, whichever
        channel it uses. That only works where the counterparty is known before execution, which is true of request-based trading and not of
        an anonymous order book.
      </p>

      <h2>The two flows</h2>
      <div className="grid-two">
        <section>
          <h3>As first drawn</h3>
          <ol className="flow">
            <li>
              <div>
                External hedge?<small>An internal hedge needs no check.</small>
              </div>
            </li>
            <li>
              <div>
                Initial limit check<small>Against a limit record kept per LP.</small>
              </div>
            </li>
            <li>
              <div>Obtain the LPs that have limit</div>
            </li>
            <li>
              <div>Request prices: stream on 360T, quote on FXGO</div>
            </li>
            <li>
              <div>
                Router picks the best single LP<small>No partial fills on either channel.</small>
              </div>
            </li>
            <li>
              <div>
                LP runs its own limit check<small>On failure, take the next best price if still within the slippage limit.</small>
              </div>
            </li>
            <li>
              <div>Fully filled: update the limit record</div>
            </li>
          </ol>
          <p className="note">
            Feeding the record: a daily initial limit per LP from the bank-wide limit system, and manual updates by a trader through a limit
            page.
          </p>
        </section>
        <section>
          <h3>As proposed</h3>
          <ol className="flow">
            <li>
              <div>
                External hedge?<small>An internal hedge uses no credit line.</small>
              </div>
            </li>
            <li>
              <div>
                <Term en="Initial check" zh="初步檢查" /> <Changed />
                <small>
                  For each LP: would this hedge fit its group's pre-settlement pillars and settlement dates? Nothing is held. The strategy can
                  ask this for itself.
                </small>
              </div>
            </li>
            <li>
              <div>Request prices from the LPs that fit</div>
            </li>
            <li>
              <div>
                Router picks the best single LP, then checks again and reserves in one step <Changed>new</Changed>
                <small>The room is held on the LP's group from this moment.</small>
              </div>
            </li>
            <li>
              <div>
                LP runs its own check <Changed />
                <small>Rejected, or no answer in time: release the reservation, then try the next best within slippage.</small>
              </div>
            </li>
            <li>
              <div>
                Filled: the reservation becomes utilisation <Changed />
              </div>
            </li>
            <li>
              <div>
                Each day: revalue open hedges and start from what is left <Changed>new</Changed>
                <small>Settled payments drop out of settlement risk; market value and remaining maturity move pre-settlement risk.</small>
              </div>
            </li>
          </ol>
          <p className="note">
            Feeding the lines: the credit owner sets them per banking group, one per time pillar for pre-settlement risk and one per day for
            settlement risk. The front office can see them and cannot change them.
          </p>
        </section>
      </div>

      <h2>What the review found</h2>
      <div className="table-wrap">
        <table className="table text-table">
          <thead>
            <tr>
              <th>Gap in the first draft</th>
              <th>Why it matters</th>
              <th>In the proposal</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>The limit had no unit. Every example deducted trade size.</td>
              <td>Trade size is not credit exposure. A 20 mio three-month swap carries well under 1 mio of pre-settlement risk, and either nothing or the full amount of settlement risk.</td>
              <td>Two lines, measured separately. A hedge needs room on both.</td>
            </tr>
            <tr>
              <td>Nothing held the room between the check and the fill.</td>
              <td>Two hedges in flight can both pass and both fill. A single queue avoids it only while no two hedges are ever out at once.</td>
              <td>Check and reserve in one step when the LP is picked; release on rejection or timeout.</td>
            </tr>
            <tr>
              <td>The record was kept per LP.</td>
              <td>Credit is granted to the banking group. Two entities of one group, or one LP on two channels, draw on the same line.</td>
              <td>Lines sit on the group; every entity and channel maps to it.</td>
            </tr>
            <tr>
              <td>Exposure only ever went up.</td>
              <td>A fill was the only change drawn. Settlement risk ends when the date passes; pre-settlement risk moves with the market every day.</td>
              <td>Open hedges are revalued daily, and the day starts from what is left.</td>
            </tr>
            <tr>
              <td>A trader could edit the limit record.</td>
              <td>The front office would be setting its own credit limit.</td>
              <td>The credit owner sets lines; the front office reads them.</td>
            </tr>
            <tr>
              <td>Only an LP rejection was drawn as a failure.</td>
              <td>A quote can also time out, or no LP may have room.</td>
              <td>Every exit releases the reservation; a hedge that fits nowhere stays internal.</td>
            </tr>
            <tr>
              <td>Only one LP and up to 50 mio was drawn.</td>
              <td>Over-filling across channels only becomes possible once an order is split.</td>
              <td>Kept as the stated scope. Each child of a split order would run this flow on its own.</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>What it covers, and what it does not</h2>
      <div className="table-wrap">
        <table className="table text-table">
          <thead>
            <tr>
              <th>Way of trading</th>
              <th>Counterparty known</th>
              <th>Fits this flow</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Request for quote or stream: FX swap, forward, NDF</td>
              <td>Before the request</td>
              <td>Yes. The flow is the same for each product; only the exposure calculation differs.</td>
            </tr>
            <tr>
              <td>Disclosed streaming prices</td>
              <td>Before the order, if it names one LP</td>
              <td>In principle, one order per LP. Not built here.</td>
            </tr>
            <tr>
              <td>Anonymous order book</td>
              <td>Only at or after the match</td>
              <td>No. The channel screens credit from limits it holds. Central control would mean resizing those limits, which is a different design.</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>Open questions for the credit owner</h2>
      <ol className="plain">
        <li>Does settlement risk count what we are due to receive, as assumed here, or what we pay?</li>
        <li>Does each morning's figure arrive as what is left after the bank-wide system's end-of-day run, or as a fixed slice with the desk carrying its own open hedges?</li>
        <li>Is the add-on set by remaining maturity, as assumed, or as one rate per product family?</li>
        <li>With close-out netting, when no hedge has a positive market value, is the net-to-gross ratio taken as 1, as assumed, or as 0?</li>
        <li>Is netting applied to the set of hedges counted in each pillar, as assumed?</li>
        <li>For an overnight swap between CLS currencies, is the whole swap treated as settled gross, or only the same-day leg?</li>
        <li>Is the pre-trade check a hard block, or can a trader proceed with approval?</li>
        <li>If a market move takes a line over its limit with no new trade, who is told, and may a hedge that reduces exposure still go out? This build lets it.</li>
        <li>How long does a reservation live when an LP neither fills nor rejects?</li>
        <li>Can the desk hand unused room back during the day, and who records it?</li>
      </ol>
    </div>
  );
}
