# FX Credit Line Simulator

A browser-only simulator of counterparty credit lines for FX hedges: FX swap, outright forward and NDF.

**Live:** https://chanchunyinjohnny.github.io/fx-credit-line-simulator/

Enter a hedge, see what it would use of each credit line and why, then send it, fill it or reject it. Every number opens to show its formula with the actual figures substituted.

All counterparties, credit lines, add-ons and prices are invented. The interface comes in English and Traditional Chinese; switch with EN / 中文 at the top right.

## What it shows

- **Two measures, not one limit.** Pre-settlement risk (the cost of replacing a hedge if the counterparty defaults before it settles) and settlement risk (what we would lose if we paid on a settlement day and were not paid). A 20 mio three-month swap uses well under 1 mio of the first, and either nothing or the full amount of the second.
- **Time pillars.** Pre-settlement lines are set per maturity pillar. A hedge counts in the pillar it matures in and in every shorter one.
- **Check, reserve, fill.** A hedge is checked before it goes out. Sending it reserves the room; a fill turns the reservation into utilisation; a rejection releases it. Without the reservation, two hedges in flight could both pass and both fill.
- **Lines sit on the banking group.** Two entities of one group, or one LP reached on two channels, draw on the same lines.
- **A channel that checks credit itself.** An order book that matches first and names the counterparty afterwards cannot be checked trade by trade, but it fills only within the limit the desk has set there. That limit is the largest trade the desk allows. The desk holds the room that trade would use on the credit line first, then sets the limit. A fill turns that room into utilisation, on the same line as every other hedge, and the desk tops the room up again from headroom. As the line fills the limit shrinks; at zero the channel stops filling with that counterparty. The Design view draws this on one line of 100 and lists what the desk can and cannot do on such a channel.
- **Time passing.** "Next day", or a jump to any later date, revalues open hedges, drops settled payments out of settlement risk, and says what changed. With prices unchanged, exposure moves only when a hedge drops into a shorter pillar; the note says when that will be.

## The four views

| View | What it is for |
| --- | --- |
| Simulator | A ticket, the LPs marked by whether they have room, one verdict, and bars showing each credit line. Workings, figures, market data, credit lines and the room held for a channel open on demand |
| Lines | Every banking group's lines today, pillar by pillar, and settlement risk date by date |
| Formulae | The method on one page, then one swap and one fill on a channel followed step by step |
| Design | Flowcharts of the hedging flow as first drawn and as proposed, what the review found, a short flow for each way a hedge is checked, and the open questions |

Design notes, in Chinese: [DESIGN.zh.md](DESIGN.zh.md) explains how the design was derived, one question at a time, and lists every assumption the program makes with its status: verified against a public source, a simplification, invented, or still to be confirmed.

## Method

| Quantity | Rule |
| --- | --- |
| Outright rate | spot + swap points, interpolated linearly by calendar days between quoted tenors |
| Market value of a leg | amount × (today's rate for its date − dealt rate) × USD discount factor |
| Exposure of one hedge | max(market value, 0) + notional × add-on %, on the far leg's notional and maturity for a swap. A setting switches to an internal variant in which a negative value reduces the add-on |
| Pre-settlement risk, no netting | sum of each hedge's exposure, per pillar |
| Pre-settlement risk, close-out netting | max(Σ market value, 0) + net add-on, with net add-on = (0.4 + 0.6 × NGR) × gross add-on |
| Settlement risk on a date | everything due to be received that day, in USD at spot; zero for payment-versus-payment (CLS) and for NDFs. A payment due on the day it is dealt always counts in full |
| Headroom | credit line − earlier days' hedges − today's fills − reservations − room held for channels |
| Channel limit | min(largest trade the desk allows there, free room on the line ÷ add-on %) |
| Room held for a channel | channel limit × add-on % of the longest order sent there, on that pillar and every shorter one |

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
npm test         # 37 tests
npm run build    # static site in dist/
npm run oracle   # regenerate the QuantLib reference values (needs uv)
```

No server and no accounts: state is kept in the browser's local storage, and Reset clears it.

## Scope and limits

- Two kinds of channel: one where the desk knows the counterparty and checks before the trade is final (request for quote or stream), and one that fills on limits it holds (an order book, here taking a single order type, a 1M USD/TWD NDF). An order book that asks the desk after a match uses the first flow and is not modelled separately. Channels reached through a prime broker or clearing house are out of scope.
- One LP per hedge, up to USD 50 mio. Split orders are not modelled.
- Standard tenors from overnight to one year. Forward-forward swaps and NDF fixing dates are not modelled.
- QuantLib 1.44 carries no lunar holidays for Hong Kong or Taiwan after 2026, so USD/CNH and USD/TWD value dates in 2027 ignore them.
- Market data is an editable snapshot of illustrative levels, not a feed.

## Sources

- Basel Committee on Banking Supervision, Basel II framework, Annex 4: the current exposure method and the net-to-gross ratio.
- Basel Committee on Banking Supervision, *Supervisory guidance for managing risks associated with the settlement of foreign exchange transactions* (2013).
- CLS Group: payment-versus-payment settlement and eligible currencies.
- EBS Dealing Rules (EBS Market appendix) and CME's EBS credit overview: credit screened at the match from limits held on the platform, the counterparty named after the trade, limits reset each trading day.
- Global Foreign Exchange Committee, FX Global Code.

Designed and built by Chan Chun Yin Johnny.
