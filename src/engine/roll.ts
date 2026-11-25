import { PILLARS, nextWeekday, pillarEnds, pillarIndex } from './calendar';
import { board, type BoardRow } from './lines';
import { makeCtx } from './risk';
import type { AppState, Channel, ISODate } from './types';

/** What moving to the next business day changed, for the note shown afterwards. */
export interface RollSummary {
  date: ISODate;
  lapsed: number; // hedges still in flight that were left to lapse
  /** Channel limits cut because the group's lines could no longer hold them. */
  limitCuts: { channel: Channel; groupName: string; from: number; to: number }[];
  groups: {
    id: string;
    name: string;
    psrBefore: number; // largest pillar, filled hedges only
    psrAfter: number;
    srReleased: number; // settlement risk on dates that have now passed
  }[];
}

const filled = (r: BoardRow) => r.earlier + r.today;

export function rollSummary(before: AppState, after: AppState): RollSummary {
  const ctxBefore = makeCtx(before);
  const ctxAfter = makeCtx(after);
  const groups: RollSummary['groups'] = [];
  for (const g of before.groups) {
    const b = board(ctxBefore, before, g.id);
    const a = board(ctxAfter, after, g.id);
    const psrBefore = Math.max(...b.psr.map(filled));
    const psrAfter = Math.max(...a.psr.map(filled));
    const srReleased = b.sr.filter((r) => r.key < after.businessDate).reduce((sum, r) => sum + filled(r), 0);
    if (psrBefore > 0.5 || psrAfter > 0.5 || srReleased > 0.5) groups.push({ id: g.id, name: g.name, psrBefore, psrAfter, srReleased });
  }
  const limitCuts = before.channelLimits.flatMap((l, i) => {
    const to = after.channelLimits[i].limitUsd;
    return to < l.limitUsd ? [{ channel: l.channel, groupName: before.groups.find((g) => g.id === l.groupId)!.name, from: l.limitUsd, to }] : [];
  });
  return { date: after.businessDate, lapsed: before.trades.filter((t) => t.status === 'IN_FLIGHT').length, limitCuts, groups };
}

/** The next time a filled hedge drops into a shorter pillar, which is when its add-on steps down. */
export interface PillarStep {
  id: string;
  from: string;
  to: string;
  date: ISODate;
}

export function nextPillarStep(s: AppState): PillarStep | null {
  const last = PILLARS.length - 1;
  const pillarOn = (date: ISODate, maturity: ISODate) => {
    const i = pillarIndex(pillarEnds(date), maturity);
    return i < 0 ? last : i;
  };
  let best: PillarStep | null = null;
  for (const t of s.trades) {
    const maturity = t.legs[t.legs.length - 1].date;
    if (t.status !== 'FILLED' || maturity <= s.businessDate) continue;
    const now = pillarOn(s.businessDate, maturity);
    for (let d = nextWeekday(s.businessDate); d < maturity && (!best || d < best.date); d = nextWeekday(d)) {
      const then = pillarOn(d, maturity);
      if (then < now) {
        best = { id: t.id, from: PILLARS[now], to: PILLARS[then], date: d };
        break;
      }
    }
  }
  return best;
}
