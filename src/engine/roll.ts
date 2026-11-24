import { board, type BoardRow } from './lines';
import { makeCtx } from './risk';
import type { AppState, ISODate } from './types';

/** What moving to the next business day changed, for the note shown afterwards. */
export interface RollSummary {
  date: ISODate;
  lapsed: number; // hedges still in flight that were left to lapse
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
  return { date: after.businessDate, lapsed: before.trades.filter((t) => t.status === 'IN_FLIGHT').length, groups };
}
