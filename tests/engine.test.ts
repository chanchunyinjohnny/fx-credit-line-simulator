import { describe, expect, it } from 'vitest';
import golden from '../src/data/golden.json';
import { PILLARS, pillarEnds, pillarIndex, spotDate, tenorDate, tomDate } from '../src/engine/calendar';
import { defaultState } from '../src/engine/defaults';
import { board, checkTrade } from '../src/engine/lines';
import { dfUsd } from '../src/engine/market';
import { exposureOf, makeCtx, psrByPillar, srByDate, valueLeg, valueTrade, type TradeRisk } from '../src/engine/risk';
import { nextPillarStep, rollSummary } from '../src/engine/roll';
import { buildTrade, candidates, largestThatFits, reducer } from '../src/engine/state';
import type { AppState, PairId, Tenor, Ticket, Trade } from '../src/engine/types';

const FAR_TENORS = ['SN', '1W', '1M', '2M', '3M', '6M', '9M', '1Y'] as const;
const M = 1_000_000;

describe('against QuantLib reference values', () => {
  it('value dates', () => {
    for (const row of golden.dates) {
      const pair = row.pair as PairId;
      const spot = spotDate(row.tradeDate, pair);
      expect([row.pair, row.tradeDate, 'tom', tomDate(row.tradeDate, pair)]).toEqual([row.pair, row.tradeDate, 'tom', row.tom]);
      expect([row.pair, row.tradeDate, 'spot', spot]).toEqual([row.pair, row.tradeDate, 'spot', row.spot]);
      for (const t of FAR_TENORS) {
        expect([row.pair, row.tradeDate, t, tenorDate(spot, t, pair)]).toEqual([row.pair, row.tradeDate, t, row[t]]);
      }
    }
  });

  for (const sc of golden.scenarios) {
    const ctx = makeCtx({ ...defaultState(), businessDate: sc.businessDate });
    it(`forward rates on ${sc.businessDate}`, () => {
      for (const f of sc.forwards) expect(ctx.curve(f.pair as PairId).forward(f.date)).toBeCloseTo(f.forward, 10);
    });
    it(`discount factors on ${sc.businessDate}`, () => {
      for (const d of sc.dfs) expect(dfUsd(ctx.market, ctx.t0, d.date)).toBeCloseTo(d.df, 12);
    });
    it(`leg market values on ${sc.businessDate}`, () => {
      expect(sc.legs.length).toBeGreaterThan(0);
      for (const leg of sc.legs) {
        const mv = valueLeg(ctx, leg.pair as PairId, leg).mv;
        expect(Math.abs(mv - leg.mvUsd)).toBeLessThan(0.01); // within one cent
      }
    });
  }
});

// ------------------------------------------------------------ hand-worked
const ticket = (over: Partial<Ticket> = {}): Ticket => ({
  product: 'SWAP', pair: 'EURUSD', side: 'BUY', amount: 20 * M, tenor: '3M', lpId: 'A-LDN-360T', settlement: 'AUTO', ...over,
});
const deal = (s: AppState, t: Ticket): Trade => {
  const built = buildTrade(makeCtx(s), t);
  if ('error' in built) throw new Error(built.error);
  return built;
};
const risk = (pillar: number, mv: number, addOn: number): TradeRisk =>
  ({ pillar, mv, addOn, exposure: Math.max(mv, 0) + addOn }) as TradeRisk;

describe('time pillars', () => {
  it('a tenor traded from spot falls in the pillar of the same name', () => {
    const s = defaultState();
    const ends = pillarEnds(s.businessDate);
    const pillarOf = (tenor: Tenor) => PILLARS[pillarIndex(ends, deal(s, ticket({ tenor })).legs[1].date)];
    expect((['ON', 'TN', 'SN', '1W', '1M', '2M', '3M', '6M', '9M', '1Y'] as Tenor[]).map(pillarOf)).toEqual(
      ['O/N', '1W', '1W', '1W', '1M', '3M', '3M', '6M', '1Y', '1Y'],
    );
  });
});

describe('pre-settlement risk', () => {
  it('a new 3M swap: zero market value, add-on on the far leg notional', () => {
    const s = defaultState();
    const r = valueTrade(makeCtx(s), deal(s, ticket()));
    expect(r.mv).toBeCloseTo(0, 6);
    expect(r.notionalUsd).toBeCloseTo(20 * M * 1.165, 6); // EUR 20m at spot
    expect(PILLARS[r.pillar]).toBe('3M');
    expect(r.addOn).toBeCloseTo(23.3 * M * 0.02, 6); // 2.0% for the 3M pillar
    expect(r.exposure).toBeCloseTo(466_000, 6);
  });

  it('a maturity beyond the longest pillar still counts, in the longest pillar', () => {
    const s = defaultState();
    const t = deal(s, ticket({ tenor: '1Y' }));
    const late = { ...t, legs: [t.legs[0], { ...t.legs[1], date: '2028-06-30' }] };
    expect(PILLARS[valueTrade(makeCtx(s), late).pillar]).toBe('1Y');
  });

  it('a negative market value does not reduce the add-on, unless the offset variant is switched on', () => {
    expect(exposureOf(250, 300, false)).toBe(550);
    expect(exposureOf(-100, 300, false)).toBe(300); // standard: the add-on is kept in full
    expect(exposureOf(-100, 300, true)).toBe(200); // variant: the negative value offsets it
    expect(exposureOf(-500, 300, true)).toBe(0);

    const s = { ...defaultState(), offsetNegativeMv: true };
    const t = deal(s, ticket());
    const cheap = { ...t, legs: [t.legs[0], { ...t.legs[1], rate: t.legs[1].rate - 0.01 }] }; // we sell EUR 1 cent too low
    const standard = valueTrade(makeCtx(defaultState()), cheap);
    const variant = valueTrade(makeCtx(s), cheap);
    expect(standard.mv).toBeLessThan(0);
    expect(standard.exposure).toBeCloseTo(standard.addOn, 6);
    expect(variant.exposure).toBeCloseTo(standard.addOn + standard.mv, 6);
  });

  it('a trade counts in its own pillar and every shorter one', () => {
    const agg = psrByPillar([risk(3, 0, 300), risk(1, 0, 50)], false);
    expect(agg.map((a) => a.exposure)).toEqual([350, 350, 300, 300, 0, 0]);
  });

  it('without netting, exposures add up trade by trade', () => {
    const agg = psrByPillar([risk(0, 100, 50), risk(0, -80, 30)], false);
    expect(agg[0].exposure).toBe(180); // (100 + 50) + (0 + 30)
  });

  it('with netting, market values offset and the add-on is scaled by the net-to-gross ratio', () => {
    const [a] = psrByPillar([risk(0, 100, 50), risk(0, -80, 30)], true);
    expect(a.ngr).toBeCloseTo(0.2, 12); // max(20,0) / 100
    expect(a.addOnNet).toBeCloseTo((0.4 + 0.6 * 0.2) * 80, 12); // 41.6
    expect(a.exposure).toBeCloseTo(20 + 41.6, 12); // max(20, 0) + net add-on
  });

  it('with netting and no positive market value, the full add-on is kept', () => {
    const [a] = psrByPillar([risk(0, -10, 50), risk(0, -5, 30)], true);
    expect(a.ngr).toBe(1);
    expect(a.exposure).toBe(80); // max(-15, 0) + 80
    expect(psrByPillar([risk(0, -10, 50), risk(0, -5, 30)], true, true)[0].exposure).toBe(65); // variant: max(-15 + 80, 0)
  });
});

describe('settlement risk', () => {
  const s = defaultState();
  const ctx = makeCtx(s);
  const cnh = (side: 'BUY' | 'SELL', id: string) => ({ ...deal(s, ticket({ pair: 'USDCNH', side, lpId: 'E-360T' })), id });

  it('counts what we receive on each date, at spot, for a trade settled gross', () => {
    const t = cnh('BUY', 'x'); // buy USD 20m near, sell USD 20m far
    const days = srByDate(ctx, [t], false);
    expect(t.settlement).toBe('GROSS'); // CNH is not a CLS currency
    expect(days.get(t.legs[0].date)!.exposure).toBeCloseTo(20 * M, 6); // receive USD 20m
    expect(days.get(t.legs[1].date)!.exposure).toBeCloseTo((20 * M * t.legs[1].rate) / 7.1, 6); // receive CNH
  });

  it('adds receivables gross, or offsets same-currency flows with payment netting', () => {
    const pair = [cnh('BUY', 'x'), cnh('SELL', 'y')];
    const near = pair[0].legs[0].date;
    expect(srByDate(ctx, pair, false).get(near)!.exposure).toBeCloseTo(40 * M, 6);
    expect(srByDate(ctx, pair, true).get(near)!.exposure).toBeCloseTo(0, 6);
  });

  it('is zero for CLS and cash-settled trades', () => {
    const eur = deal(s, ticket());
    const ndf = deal(s, ticket({ product: 'NDF', pair: 'USDTWD', tenor: '3M' }));
    expect([eur.settlement, ndf.settlement]).toEqual(['CLS', 'CASH']);
    expect(srByDate(ctx, [eur, ndf], false).size).toBe(0);
  });

  it('counts the same-day leg of an overnight swap in full and nothing for the leg that goes through CLS', () => {
    const on = deal(s, ticket({ tenor: 'ON' })); // buy EUR 20m today, sell it back tomorrow
    expect(on.settlement).toBe('CLS');
    const days = srByDate(ctx, [on], false);
    expect([...days.keys()]).toEqual([s.businessDate]);
    expect(days.get(s.businessDate)!.exposure).toBeCloseTo(20 * M * s.market.pairs.EURUSD.spot, 6);
    // The day after, the leg left has been in CLS since it was dealt.
    expect(srByDate({ ...ctx, t0: on.legs[1].date }, [on], false).size).toBe(0);
  });
});

describe('check, reserve, fill', () => {
  // Bank E: 3M line USD 1m. EUR/USD settles through CLS, so only PSR is in play.
  // EUR 20m -> 23.3m x 2% = 466,000. EUR 25m -> 582,500. Together 1,048,500 > 1m.
  const first = ticket({ lpId: 'E-360T', amount: 20 * M });
  const second = ticket({ lpId: 'E-FXGO', amount: 25 * M }); // same group, other channel

  it('reserves on send, blocks a second hedge, and frees the room on reject', () => {
    let s = reducer(defaultState(), { type: 'SEND', ticket: first });
    expect(s.trades.map((t) => t.status)).toEqual(['IN_FLIGHT']);
    expect(board(makeCtx(s), s, 'E').psr[3]).toMatchObject({ earlier: 0, today: 0 });
    expect(board(makeCtx(s), s, 'E').psr[3].reserved).toBeCloseTo(466_000, 6);

    const check = checkTrade(makeCtx(s), s, deal(s, second));
    expect(check.psr[3].after).toBeCloseTo(1_048_500, 6);
    expect(check.ok).toBe(false);
    expect(check.blockedByReservation).toBe(true); // on its own it would fit
    expect(reducer(s, { type: 'SEND', ticket: second }).trades).toHaveLength(1); // not sent

    s = reducer(s, { type: 'REJECT', id: 'H1' });
    expect(board(makeCtx(s), s, 'E').psr[3].reserved).toBe(0);
    expect(reducer(s, { type: 'SEND', ticket: second }).trades).toHaveLength(2);
  });

  it('a fill turns the reservation into utilisation, and the next day it counts as earlier', () => {
    let s = reducer(defaultState(), { type: 'SEND', ticket: first });
    s = reducer(s, { type: 'FILL', id: 'H1' });
    expect(board(makeCtx(s), s, 'E').psr[3].today).toBeCloseTo(466_000, 6);
    s = reducer(s, { type: 'NEXT_DAY' });
    const row = board(makeCtx(s), s, 'E').psr[3];
    expect(s.businessDate).toBe('2026-12-01');
    expect(row.today).toBe(0);
    expect(row.earlier).toBeGreaterThan(0);
    expect(row.initial).toBeCloseTo(row.line - row.earlier, 6);
  });

  it('a hedge still in flight lapses overnight', () => {
    let s = reducer(defaultState(), { type: 'SEND', ticket: first });
    s = reducer(s, { type: 'NEXT_DAY' });
    expect(s.trades[0].status).toBe('EXPIRED');
    expect(board(makeCtx(s), s, 'E').psr.every((r) => r.used === 0)).toBe(true);
  });

  it('settlement risk blocks a gross-settled hedge that pre-settlement risk would allow', () => {
    // Bank E: SR line USD 20m a day. USD/CNH 25m: add-on 2% = 500,000 fits the 1m PSR line.
    const s = defaultState();
    const check = checkTrade(makeCtx(s), s, deal(s, ticket({ pair: 'USDCNH', amount: 25 * M, lpId: 'E-360T' })));
    expect(check.psr.every((r) => r.ok)).toBe(true);
    expect(check.sr.map((r) => r.ok)).toEqual([false, false]);
    expect(check.ok).toBe(false);
  });

  it('settlement risk falls away once the value date has passed', () => {
    let s = reducer(defaultState(), { type: 'SEND', ticket: ticket({ pair: 'USDCNH', amount: 15 * M, lpId: 'E-360T' }) });
    s = reducer(s, { type: 'FILL', id: 'H1' });
    const [near, far] = s.trades[0].legs.map((l) => l.date);
    expect(board(makeCtx(s), s, 'E').sr.map((r) => r.key)).toEqual([near, far]);
    while (s.businessDate <= near) s = reducer(s, { type: 'NEXT_DAY' });
    expect(board(makeCtx(s), s, 'E').sr.map((r) => r.key)).toEqual([far]);
  });

  it('summarises what a new day changed', () => {
    const empty = defaultState();
    expect(rollSummary(empty, reducer(empty, { type: 'NEXT_DAY' }))).toMatchObject({ date: '2026-12-01', lapsed: 0, groups: [] });

    let s = reducer(defaultState(), { type: 'SEND', ticket: ticket({ pair: 'USDCNH', amount: 15 * M, lpId: 'E-360T' }) });
    s = reducer(s, { type: 'FILL', id: 'H1' });
    s = reducer(s, { type: 'SEND', ticket: first }); // left in flight
    for (let i = 0; i < 2; i++) s = reducer(s, { type: 'NEXT_DAY' }); // now 2 Dec, the near value date
    const sum = rollSummary(s, reducer(s, { type: 'NEXT_DAY' }));
    expect(sum.groups).toHaveLength(1);
    expect(sum.groups[0].id).toBe('E');
    expect(sum.groups[0].srReleased).toBeCloseTo(15 * M, 6); // the near-leg receivable has settled
    expect(sum.groups[0].psrAfter).toBeGreaterThan(0);
    expect(rollSummary(reducer(defaultState(), { type: 'SEND', ticket: first }), defaultState()).lapsed).toBe(1);
  });

  it('jumps to a later date, where the hedge has dropped into a shorter pillar', () => {
    let s = reducer(defaultState(), { type: 'SEND', ticket: first }); // EUR 20m, 3M, far leg 2 Mar 2027
    s = reducer(s, { type: 'FILL', id: 'H1' });
    expect(nextPillarStep(s)).toMatchObject({ id: 'H1', from: '3M', to: '1M' });

    // Day by day nothing visible happens: same pillar, same add-on, prices unchanged.
    const aWeekOn = reducer(s, { type: 'GO_TO', date: '2026-12-07' });
    expect(PILLARS[valueTrade(makeCtx(aWeekOn), aWeekOn.trades[0]).pillar]).toBe('3M');

    const step = nextPillarStep(s)!;
    const later = reducer(s, { type: 'GO_TO', date: step.date });
    const r = valueTrade(makeCtx(later), later.trades[0]);
    expect(PILLARS[r.pillar]).toBe('1M');
    expect(r.addOnPct).toBe(1); // was 2% in the 3M pillar
    expect(board(makeCtx(later), later, 'E').psr[3].used).toBe(0); // the 3M line is free again
  });

  it('only moves forward, and lands on a weekday', () => {
    const s = defaultState();
    expect(reducer(s, { type: 'GO_TO', date: '2026-12-05' }).businessDate).toBe('2026-12-07'); // Saturday -> Monday
    expect(reducer(s, { type: 'GO_TO', date: '2026-11-27' })).toBe(s);
    expect(reducer(s, { type: 'GO_TO', date: '2031-01-01' })).toBe(s);
    expect(reducer(s, { type: 'GO_TO', date: 'tomorrow' })).toBe(s);
  });

  it('refuses tickets outside the flow', () => {
    const ctx = makeCtx(defaultState());
    expect(buildTrade(ctx, ticket({ amount: 60 * M }))).toHaveProperty('error');
    expect(buildTrade(ctx, ticket({ product: 'NDF' }))).toHaveProperty('error');
    expect(buildTrade(ctx, ticket({ pair: 'USDCNH', settlement: 'CLS' }))).toHaveProperty('error');
  });
});

describe('a channel that discloses the counterparty after the trade', () => {
  // EBS Market: Banks B, D and E could fill an order. The desk cannot choose among
  // them, so the order is checked against each and reserved on each.
  const order = (over: Partial<Ticket> = {}): Ticket => ({ product: 'NDF', pair: 'USDTWD', side: 'BUY', amount: 20 * M, tenor: '1M', lpId: 'A-LDN-360T', book: 'EBSM', settlement: 'AUTO', ...over });
  const at = (s: AppState, groupId: string, pillar: string) => board(makeCtx(s), s, groupId).psr.find((r) => r.key === pillar)!;
  const statuses = (s: AppState) => s.trades.map((t) => [t.id, t.status]);

  it('reserves on every counterparty that could fill the order', () => {
    const s = reducer(defaultState(), { type: 'SEND', ticket: order() });
    expect(statuses(s)).toEqual([['H1-B', 'IN_FLIGHT'], ['H1-D', 'IN_FLIGHT'], ['H1-E', 'IN_FLIGHT']]);
    expect(s.trades.every((t) => t.orderId === 'H1')).toBe(true);
    // 20m x 1% = 200,000 on each of the three, and nothing on a group that is not on the channel.
    for (const g of ['B', 'D', 'E']) expect(at(s, g, '1M').reserved).toBeCloseTo(200_000, 6);
    expect(at(s, 'A', '1M').used).toBe(0);
  });

  it('a fill books one counterparty and releases the others', () => {
    let s = reducer(defaultState(), { type: 'SEND', ticket: order() });
    s = reducer(s, { type: 'FILL', id: 'H1-D' });
    expect(statuses(s)).toEqual([['H1-B', 'UNFILLED'], ['H1-D', 'FILLED'], ['H1-E', 'UNFILLED']]);
    expect(at(s, 'D', '1M')).toMatchObject({ today: 200_000, reserved: 0, used: 200_000 });
    expect(at(s, 'B', '1M').used).toBe(0);
    expect(at(s, 'E', '1M').used).toBe(0);
  });

  it('an order that finds no match releases every reservation', () => {
    let s = reducer(defaultState(), { type: 'SEND', ticket: order() });
    s = reducer(s, { type: 'REJECT', id: 'H1-B' });
    expect(statuses(s)).toEqual([['H1-B', 'UNFILLED'], ['H1-D', 'UNFILLED'], ['H1-E', 'UNFILLED']]);
    for (const g of ['B', 'D', 'E']) expect(at(s, g, '1M').used).toBe(0);
  });

  it('the tightest line caps the whole order, until that counterparty is switched off on the channel', () => {
    // 6M add-on 3%: 20m uses 600,000. Bank E has a 6M line of 500,000; B and D have more.
    const s0 = defaultState();
    const sixMonths = order({ tenor: '6M' });
    const checks = (candidates(makeCtx(s0), s0, sixMonths) as Trade[]).map((t) => [t.lpId, checkTrade(makeCtx(s0), s0, t).ok]);
    expect(checks).toEqual([['B-EBSM', true], ['D-EBSM', true], ['E-EBSM', false]]);
    expect(reducer(s0, { type: 'SEND', ticket: sixMonths })).toBe(s0);
    // What E's line can take: 500,000 / 3% = 16,666,666, to the thousand below.
    expect(largestThatFits(makeCtx(s0), s0, sixMonths)).toBe(16_666_000);

    const s1 = reducer(s0, { type: 'SWITCH_ON_CHANNEL', lpId: 'E-EBSM', on: false });
    expect(largestThatFits(makeCtx(s1), s1, sixMonths)).toBe(20 * M);
    const s2 = reducer(s1, { type: 'SEND', ticket: sixMonths });
    expect(statuses(s2)).toEqual([['H1-B', 'IN_FLIGHT'], ['H1-D', 'IN_FLIGHT']]);
    expect(at(s2, 'E', '6M').used).toBe(0);
    // Switched back on, it counts again.
    const s3 = reducer(s1, { type: 'SWITCH_ON_CHANNEL', lpId: 'E-EBSM', on: true });
    expect(reducer(s3, { type: 'SEND', ticket: sixMonths })).toBe(s3);
  });

  it('holds the room against a hedge sent to the same counterparty on another channel', () => {
    // Bank E's 1M line is 1,500,000. An order of 50m rests on the book: 500,000 reserved.
    // EUR 40m 1M swap with E on 360T: 46.6m x 1% = 466,000. Two are in flight: 1,432,000 in all.
    const swap = ticket({ lpId: 'E-360T', tenor: '1M', amount: 40 * M });
    let s = reducer(defaultState(), { type: 'SEND', ticket: order({ amount: 50 * M }) });
    s = reducer(s, { type: 'SEND', ticket: swap });
    s = reducer(s, { type: 'SEND', ticket: swap });
    expect(at(s, 'E', '1M').reserved).toBeCloseTo(1_432_000, 6);
    // A third would reach 1,898,000.
    const third = checkTrade(makeCtx(s), s, deal(s, swap));
    expect(third.ok).toBe(false);
    expect(third.blockedByReservation).toBe(true);
    // The order fills with Bank B: E's 500,000 is free again and the third fits, at 1,398,000.
    s = reducer(s, { type: 'FILL', id: 'H1-B' });
    expect(checkTrade(makeCtx(s), s, deal(s, swap)).ok).toBe(true);
  });

  it('with the check switched off, nothing is reserved and a fill can take a line over', () => {
    // 20m of 6M NDF uses 600,000; Bank E's 6M line is 500,000.
    const s0 = reducer(defaultState(), { type: 'SWITCH_BOOK_CHECK', channel: 'EBSM', on: false });
    const sixMonths = order({ tenor: '6M' });
    expect(reducer(s0, { type: 'SEND', ticket: sixMonths })).toBe(s0); // no reservation to make
    const s1 = reducer(s0, { type: 'BOOK_FILL', ticket: sixMonths, lpId: 'E-EBSM' });
    expect(statuses(s1)).toEqual([['H1', 'FILLED']]);
    expect(at(s1, 'E', '6M')).toMatchObject({ used: 600_000, headroom: -100_000 });
    // Switched on, the desk does not book a fill it never reserved for.
    const on = defaultState();
    expect(reducer(on, { type: 'BOOK_FILL', ticket: sixMonths, lpId: 'E-EBSM' })).toBe(on);
  });

  it('takes one product here, needs a counterparty switched on, and lapses overnight like any hedge', () => {
    let s = defaultState();
    expect(candidates(makeCtx(s), s, { ...ticket(), book: 'EBSM' })).toEqual({ error: 'BOOK_PRODUCT' });
    // Naming an LP on the channel does not choose it: the order still goes to the book.
    expect((candidates(makeCtx(s), s, order({ lpId: 'B-EBSM', book: undefined })) as Trade[]).map((t) => t.lpId)).toEqual(['B-EBSM', 'D-EBSM', 'E-EBSM']);
    for (const lpId of ['B-EBSM', 'D-EBSM', 'E-EBSM']) s = reducer(s, { type: 'SWITCH_ON_CHANNEL', lpId, on: false });
    expect(candidates(makeCtx(s), s, order())).toEqual({ error: 'BOOK_EMPTY' });

    let open = reducer(defaultState(), { type: 'SEND', ticket: order() });
    open = reducer(open, { type: 'NEXT_DAY' });
    expect(open.trades.every((t) => t.status === 'EXPIRED')).toBe(true);
  });
});
