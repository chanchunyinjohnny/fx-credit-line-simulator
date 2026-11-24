const New = () => <span className="tag">new</span>;

export function Design() {
  return (
    <div className="prose">
      <p className="lead">
        A desk hedges FX swaps with external LPs on 360T and FXGO. Today each counterparty's limit is cut into fixed slices, one per channel. The
        proposal holds one credit line per counterparty and checks it before a hedge goes out, whichever channel it uses.
      </p>

      <div className="grid-two">
        <section>
          <h2>First draft</h2>
          <ol className="flow">
            <li>External hedge?</li>
            <li>Check the limit kept for each LP</li>
            <li>Ask the LPs that have limit for prices</li>
            <li>Pick the best single LP</li>
            <li>LP runs its own check; if it fails, next best</li>
            <li>Filled: take the amount off the limit</li>
          </ol>
        </section>
        <section>
          <h2>Proposed</h2>
          <ol className="flow">
            <li>External hedge?</li>
            <li>Initial check on both risk measures, per banking group</li>
            <li>Ask the LPs that fit for prices</li>
            <li>
              Pick the best single LP, then check again and reserve <New />
            </li>
            <li>LP runs its own check; rejected or timed out: release, next best</li>
            <li>Filled: the reservation becomes use of the line</li>
            <li>
              Each day: revalue open hedges and start from what is left <New />
            </li>
          </ol>
        </section>
      </div>

      <h2>What the review found</h2>
      <div className="table-wrap">
        <table className="table text-table">
          <thead>
            <tr>
              <th>Gap in the first draft</th>
              <th>In the proposal</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>The limit had no unit; trade size was deducted</td>
              <td>Two lines: pre-settlement risk and settlement risk</td>
            </tr>
            <tr>
              <td>Nothing held the room between check and fill</td>
              <td>Check and reserve in one step; release on reject or timeout</td>
            </tr>
            <tr>
              <td>The limit was kept per LP</td>
              <td>Lines sit on the banking group, across entities and channels</td>
            </tr>
            <tr>
              <td>Exposure only ever went up</td>
              <td>Revalued daily; settled payments drop out</td>
            </tr>
            <tr>
              <td>A trader could edit the limit</td>
              <td>The credit owner sets lines; the desk reads them</td>
            </tr>
            <tr>
              <td>Only one LP, up to 50 mio</td>
              <td>Kept as the scope; split orders would run the flow per child</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="quiet">
        Scope: trading by request, where the counterparty is known before the trade (FX swap, forward, NDF). An anonymous order book screens
        credit itself, so it needs a different design.
      </p>

      <h2>Open questions for the credit owner</h2>
      <ol className="plain">
        <li>Does settlement risk count what we receive, as assumed, or what we pay?</li>
        <li>Is the morning figure what is left after the overnight run, or a fixed slice?</li>
        <li>Is the add-on set by remaining maturity, as assumed, or one rate per product family?</li>
        <li>With netting and no positive market value, is the net-to-gross ratio 1, as assumed, or 0?</li>
        <li>Is an overnight swap between CLS currencies settled gross on both legs or only the same-day leg?</li>
        <li>Is the check a hard block, or can a trader proceed with approval?</li>
        <li>How long does a reservation live when an LP does not answer?</li>
      </ol>
    </div>
  );
}
