# FX Credit Line Simulator

A browser-only simulator of counterparty credit lines for FX hedges: FX swap, outright forward and NDF.

**Live:** https://chanchunyinjohnny.github.io/fx-credit-line-simulator/

Enter a hedge, see what it would use of each credit line and why, then send it, fill it or reject it. Every number opens to show its formula with the actual figures substituted.

All counterparties, credit lines, add-ons and prices are invented.

## What it shows

- **Two measures, not one limit.** Pre-settlement risk (the cost of replacing a hedge if the counterparty defaults before it settles) and settlement risk (what we would lose if we paid on a settlement day and were not paid). A 20 mio three-month swap uses well under 1 mio of the first, and either nothing or the full amount of the second.
- **Time pillars.** Pre-settlement lines are set per maturity pillar. A hedge counts in the pillar it matures in and in every shorter one.
- **Check, reserve, fill.** A hedge is checked before it goes out. Sending it reserves the room; a fill turns the reservation into utilisation; a rejection releases it. Without the reservation, two hedges in flight could both pass and both fill.
- **Lines sit on the banking group.** Two entities of one group, or one LP reached on two channels, draw on the same lines.
- **Time passing.** "Next day" revalues open hedges, drops settled payments out of settlement risk, and shows what the new day starts with.

## The three views

| View | What it is for |
| --- | --- |
| Simulator | A ticket, the LPs marked by whether they have room, one verdict, and bars showing each credit line. Workings, figures, market data and credit lines open on demand |
| Formulae | The method on one page, one swap followed step by step, and the comparison with QuantLib |
| Design | The hedging flow as first drawn and as proposed, what the review found, and the open questions |

## Method

| Quantity | Rule |
| --- | --- |
| Outright rate | spot + swap points, interpolated linearly by calendar days between quoted tenors |
| Market value of a leg | amount × (today's rate for its date − dealt rate) × USD discount factor |
| Exposure of one hedge | max(market value + notional × add-on %, 0), on the far leg's notional and maturity for a swap |
| Pre-settlement risk, no netting | sum of each hedge's exposure, per pillar |
| Pre-settlement risk, close-out netting | max(Σ market value + net add-on, 0), with net add-on = (0.4 + 0.6 × NGR) × gross add-on |
| Settlement risk on a date | everything due to be received that day, in USD at spot; zero for payment-versus-payment (CLS) and for NDFs |
| Headroom | credit line − earlier days' hedges − today's fills − reservations |

## How the numbers are checked

The app computes everything itself, in `src/engine/`. As an independent check, `oracle/generate.py` computes the same cases with [QuantLib](https://www.quantlib.org/) and writes them to `src/data/golden.json`; the tests require the engine to reproduce them.

| Compared | Cases | QuantLib's part |
| --- | --- | --- |
| Value dates (tomorrow, spot, eight tenors) | 550 | holiday calendars and tenor date arithmetic |
| Outright rates | 225 | dates only; the interpolation is written twice, in TypeScript and in Python |
| USD discount factors | 47 | none; written twice |
| Market value of single legs | 34 | FX forward pricing engine with two discount curves |

Pre-settlement and settlement risk are credit policy rather than pricing, so no library computes them. They are tested against cases worked by hand in `tests/engine.test.ts`.

## Run it

```sh
npm install
npm run dev      # local server
npm test         # 28 tests
npm run build    # static site in dist/
npm run oracle   # regenerate the QuantLib reference values (needs uv)
```

No server and no accounts: state is kept in the browser's local storage, and Reset clears it.

## Scope and limits

- Request-based trading only (request for quote or stream), where the counterparty is known before execution. Anonymous order books are out of scope: there the venue screens credit from limits it holds.
- One LP per hedge, up to USD 50 mio. Split orders are not modelled.
- Standard tenors from overnight to one year. Forward-forward swaps and NDF fixing dates are not modelled.
- QuantLib 1.44 carries no lunar holidays for Hong Kong or Taiwan after 2026, so USD/CNH and USD/TWD value dates in 2027 ignore them.
- Market data is an editable snapshot of illustrative levels, not a feed.

## Sources

- Basel Committee on Banking Supervision, Basel II framework, Annex 4: the current exposure method and the net-to-gross ratio.
- Basel Committee on Banking Supervision, *Supervisory guidance for managing risks associated with the settlement of foreign exchange transactions* (2013).
- CLS Group: payment-versus-payment settlement and eligible currencies.
- Global Foreign Exchange Committee, FX Global Code.

Designed and built by Chan Chun Yin Johnny.
