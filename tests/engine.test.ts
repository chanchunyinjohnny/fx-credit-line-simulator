import { describe, expect, it } from 'vitest';
import golden from '../src/data/golden.json';
import { PILLARS, pillarEnds, pillarIndex, spotDate, tenorDate, tomDate } from '../src/engine/calendar';
import { defaultState } from '../src/engine/defaults';
import { board, checkTrade } from '../src/engine/lines';
import { dfUsd } from '../src/engine/market';
import { makeCtx, psrByPillar, srByDate, valueLeg, valueTrade, type TradeRisk } from '../src/engine/risk';
import { rollSummary } from '../src/engine/roll';
import { buildTrade, reducer } from '../src/engine/state';
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
  ({ pillar, mv, addOn, exposure: Math.max(mv + addOn, 0) }) as TradeRisk;

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

  it('a negative market value offsets the add-on, floored at zero', () => {
    expect(risk(3, -100, 300).exposure).toBe(200);
    expect(risk(3, -500, 300).exposure).toBe(0);
  });

  it('a trade counts in its own pillar and every shorter one', () => {
    const agg = psrByPillar([risk(3, 0, 300), risk(1, 0, 50)], false);
    expect(agg.map((a) => a.exposure)).toEqual([350, 350, 300, 300, 0, 0]);
  });

  it('without netting, exposures add up trade by trade', () => {
    const agg = psrByPillar([risk(0, 100, 50), risk(0, -80, 30)], false);
    expect(agg[0].exposure).toBe(150); // max(150,0) + max(-50,0)
  });

  it('with netting, market values offset and the add-on is scaled by the net-to-gross ratio', () => {
    const [a] = psrByPillar([risk(0, 100, 50), risk(0, -80, 30)], true);
    expect(a.ngr).toBeCloseTo(0.2, 12); // max(20,0) / 100
    expect(a.addOnNet).toBeCloseTo((0.4 + 0.6 * 0.2) * 80, 12); // 41.6
    expect(a.exposure).toBeCloseTo(20 + 41.6, 12);
  });

  it('with netting and no positive market value, the full add-on is kept', () => {
    const [a] = psrByPillar([risk(0, -10, 50), risk(0, -5, 30)], true);
    expect(a.ngr).toBe(1);
    expect(a.exposure).toBe(65); // max(-15 + 80, 0)
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

  it('an overnight swap cannot use CLS, so it carries settlement risk', () => {
    expect(deal(s, ticket({ tenor: 'ON' })).settlement).toBe('GROSS');
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

  it('refuses tickets outside the flow', () => {
    const ctx = makeCtx(defaultState());
    expect(buildTrade(ctx, ticket({ amount: 60 * M }))).toHaveProperty('error');
    expect(buildTrade(ctx, ticket({ product: 'NDF' }))).toHaveProperty('error');
    expect(buildTrade(ctx, ticket({ pair: 'USDCNH', settlement: 'CLS' }))).toHaveProperty('error');
    expect(buildTrade(ctx, ticket({ tenor: 'ON', settlement: 'CLS' }))).toHaveProperty('error');
  });
});
