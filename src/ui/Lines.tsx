import { useMemo } from 'react';
import { PILLARS } from '../engine/calendar';
import { CHANNELS } from '../engine/channels';
import { board, type BoardRow } from '../engine/lines';
import { makeCtx } from '../engine/risk';
import type { AppState, Group } from '../engine/types';
import { Status } from './bits';
import { day, mio, partyName, shortDay } from './format';
import { useLang } from './i18n';
import { BarLegend, LineBar } from './LineBar';

const T = {
  en: {
    unit: 'USD mio',
    today: 'Today, by banking group',
    todayNote: 'A group has one set of lines, shared by all its LPs and channels. Each cell is pre-settlement risk in use, reservations included, against the line for that pillar.',
    group: 'Banking group and its LPs',
    to: (d: string) => `to ${d}`,
    busiest: 'Settlement, busiest day',
    noLine: 'no line',
    on: (d: string) => `on ${d}`,
    byDate: 'Settlement risk, by date',
    byDateNote: 'What each group is due to pay us on each settlement date, against its daily line.',
    date: 'Settlement date',
    line: (x: string) => `line ${x}`,
    empty: 'Nothing is due outside CLS. Payments through CLS and NDFs carry no settlement risk; a USD/CNH swap or the same-day leg of an overnight swap does.',
    overBy: (x: string) => `over by ${x}`,
  },
  zh: {
    unit: '百萬美元',
    today: '今日各銀行集團的額度',
    todayNote: '每個集團只有一套額度，旗下所有 LP 和渠道共用。每格是該期限檔已用的交割前風險（包括預佔）對比額度。',
    group: '銀行集團及其 LP',
    to: (d: string) => `至 ${d}`,
    busiest: '結算風險，最高一日',
    noLine: '無額度',
    on: (d: string) => `${d}`,
    byDate: '逐日的結算風險',
    byDateNote: '每個交收日各集團應付給我方的金額，對比其每日額度。',
    date: '交收日',
    line: (x: string) => `額度 ${x}`,
    empty: '目前沒有 CLS 以外的未交收款項。經 CLS 交收的款項和 NDF 沒有結算風險；USD/CNH 掉期和隔夜掉期當日那一邊才有。',
    overBy: (x: string) => `超出 ${x}`,
  },
};

/** Used against a line, as a figure with a thin bar under it. */
function Cell({ row, label, noLine, overBy }: { row: BoardRow; label: string; noLine: string; overBy: (x: string) => string }) {
  if (row.line < 0.5 && row.used < 0.5) return <span className="quiet-inline">{noLine}</span>;
  const ok = row.used <= row.line + 0.5;
  return (
    <>
      {ok ? `${mio(row.used)} / ${mio(row.line)}` : <Status ok={false}>{overBy(mio(row.used - row.line))}</Status>}
      <LineBar dense label={label} line={row.line} parts={[row.earlier + row.today, row.reserved]} total={row.used} ok={ok} />
    </>
  );
}

export function Lines({ state }: { state: AppState }) {
  const lang = useLang();
  const t = T[lang];
  const ctx = useMemo(() => makeCtx(state), [state.businessDate, state.market, state.addOnPct, state.offsetNegativeMv]);
  const boards = state.groups.map((g) => ({ g, b: board(ctx, state, g.id) }));
  const name = (g: Group) => partyName(g.name, lang);
  /** 'Bank A London (360T, FXGO) · Bank A Frankfurt (360T)' */
  const lpsOf = (g: Group) => {
    const channels = new Map<string, string[]>();
    for (const lp of state.lps.filter((l) => l.groupId === g.id)) channels.set(lp.name, [...(channels.get(lp.name) ?? []), CHANNELS[lp.channel].label]);
    return [...channels].map(([lp, ch]) => `${partyName(lp, lang)} (${ch.join(', ')})`).join(' · ');
  };
  const dates = [...new Set(boards.flatMap(({ b }) => b.sr.map((r) => r.key)))].sort();

  return (
    <>
      <section className="card">
        <div className="lines-head">
          <h2>
            {t.today} <span className="quiet-inline">· {t.unit}</span>
          </h2>
          <BarLegend />
        </div>
        <p className="quiet hint">{t.todayNote}</p>
        <div className="table-wrap">
          <table className="table overview">
            <thead>
              <tr>
                <th>{t.group}</th>
                {PILLARS.map((p, i) => (
                  <th key={p}>
                    {p}
                    <span className="th-sub">{t.to(shortDay(ctx.pillarEnds[i], lang))}</span>
                  </th>
                ))}
                <th>{t.busiest}</th>
              </tr>
            </thead>
            <tbody>
              {boards.map(({ g, b }) => {
                const peak = b.sr.reduce<BoardRow | null>((m, r) => (!m || r.used > m.used ? r : m), null);
                return (
                  <tr key={g.id}>
                    <td>
                      <strong>{name(g)}</strong>
                      <span className="td-sub">{lpsOf(g)}</span>
                    </td>
                    {b.psr.map((r) => (
                      <td key={r.key}>
                        <Cell row={r} label={`${name(g)} ${r.key}`} noLine={t.noLine} overBy={t.overBy} />
                      </td>
                    ))}
                    <td>
                      {peak ? (
                        <>
                          <Cell row={peak} label={`${name(g)} ${shortDay(peak.key, lang)}`} noLine={t.noLine} overBy={t.overBy} />
                          <span className="td-sub">{t.on(shortDay(peak.key, lang))}</span>
                        </>
                      ) : (
                        `${mio(0)} / ${mio(g.srLine)}`
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <div className="lines-head">
          <h2>
            {t.byDate} <span className="quiet-inline">· {t.unit}</span>
          </h2>
        </div>
        <p className="quiet hint">{t.byDateNote}</p>
        {dates.length === 0 ? (
          <p className="quiet">{t.empty}</p>
        ) : (
          <div className="table-wrap">
            <table className="table overview">
              <thead>
                <tr>
                  <th>{t.date}</th>
                  {boards.map(({ g }) => (
                    <th key={g.id}>
                      {name(g)}
                      <span className="th-sub">{t.line(mio(g.srLine))}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dates.map((d) => (
                  <tr key={d}>
                    <td>{day(d, lang)}</td>
                    {boards.map(({ g, b }) => {
                      const r = b.sr.find((x) => x.key === d);
                      return <td key={g.id}>{r ? <Cell row={r} label={`${name(g)} ${shortDay(d, lang)}`} noLine={t.noLine} overBy={t.overBy} /> : <span className="quiet-inline">–</span>}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
