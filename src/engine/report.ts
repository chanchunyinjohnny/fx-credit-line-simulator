import { CHANNELS } from './channels';
import { board, lineStatus, type BoardRow, type LineStatus } from './lines';
import { makeCtx } from './risk';
import type { AppState } from './types';

/** One credit line as the end-of-day report states it. */
export interface ReportRow {
  group: string;
  measure: 'Pre-settlement risk' | 'Settlement risk' | 'Gross notional';
  key: string; // time pillar, settlement date or channel
  line: number;
  used: number; // filled hedges
  reserved: number; // hedges still in flight
  headroom: number;
  status: LineStatus;
}

/** Where every line of every group stands on the business date. */
export function reportRows(s: AppState): ReportRow[] {
  const ctx = makeCtx(s);
  return s.groups.flatMap((g) => {
    const b = board(ctx, s, g.id);
    const row = (measure: ReportRow['measure'], r: BoardRow): ReportRow => ({
      group: g.name,
      measure,
      key: r.key,
      line: r.line,
      used: r.earlier + r.today,
      reserved: r.reserved,
      headroom: r.headroom,
      status: lineStatus(r.used, r.line, s.warnPct),
    });
    return [
      ...b.psr.map((r) => row('Pre-settlement risk', r)),
      ...b.sr.map((r) => row('Settlement risk', r)),
      ...(b.notional ? [row('Gross notional', b.notional)] : []),
    ];
  });
}

const cell = (x: string | number) => {
  const text = typeof x === 'number' ? String(Math.round(x)) : x;
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};
const table = (head: string[], rows: (string | number)[][]) => [head, ...rows].map((r) => r.map(cell).join(','));

/** The end-of-day report as a CSV file: where each line stands, the lines changed today and the hedges dealt today. */
export function dayReportCsv(s: AppState): string {
  const groupName = (id: string) => s.groups.find((g) => g.id === id)?.name ?? id;
  const lp = (id: string) => s.lps.find((l) => l.id === id)!;
  const lines = reportRows(s).map((r) => [
    r.group,
    r.measure,
    r.key,
    r.line,
    r.used,
    r.reserved,
    r.headroom,
    r.line > 0 ? (((r.used + r.reserved) / r.line) * 100).toFixed(1) : '',
    r.status,
  ]);
  const changes = s.limitLog.filter((c) => c.date === s.businessDate).map((c) => [groupName(c.groupId), c.line, c.from, c.to]);
  const hedges = s.trades
    .filter((t) => t.tradeDate === s.businessDate)
    .map((t) => [t.id, lp(t.lpId).name, CHANNELS[lp(t.lpId).channel].label, t.product, t.pair, t.side, t.amount, t.tenor, t.status]);
  return [
    `End-of-day report,${s.businessDate}`,
    `Warning level (% of a line),${s.warnPct}`,
    '',
    'Credit lines',
    ...table(['Banking group', 'Measure', 'Pillar date or channel', 'Line (USD)', 'In use (USD)', 'Reserved (USD)', 'Headroom (USD)', 'In use and reserved (%)', 'Status'], lines),
    '',
    'Lines changed today',
    ...table(['Banking group', 'Line', 'From (USD)', 'To (USD)'], changes),
    '',
    'Hedges dealt today',
    ...table(['Hedge', 'Counterparty', 'Channel', 'Product', 'Pair', 'Side', 'Amount', 'Tenor', 'Status'], hedges),
    '',
  ].join('\n');
}
