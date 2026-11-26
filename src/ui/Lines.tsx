import { useMemo } from 'react';
import { PILLARS } from '../engine/calendar';
import { CHANNELS } from '../engine/channels';
import { board, lineStatus, type BoardRow } from '../engine/lines';
import { dayReportCsv } from '../engine/report';
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
    todayNote: 'A group has one set of lines, shared by all its LPs and channels. Each cell is what is in use, reservations included, against the line.',
    warnNote: (level: number) => `! marks a line at or past the warning level of ${level}%. ✕ marks a line that is over.`,
    group: 'Banking group and its LPs',
    to: (d: string) => `to ${d}`,
    busiest: 'Settlement, busiest day',
    notional: 'Gross notional on 360T, dealt today',
    notionalNote: 'What the desk has dealt with each group on 360T today, buys and sells added, against its line for the day. The count starts from zero each day.',
    channel: 'Channel',
    noLp: 'no LP there',
    noLine: 'no line',
    on: (d: string) => `on ${d}`,
    byDate: 'Settlement risk, by date',
    byDateNote: 'What each group is due to pay us on each settlement date, against its daily line.',
    date: 'Settlement date',
    line: (x: string) => `line ${x}`,
    empty: 'Nothing is due outside CLS. Payments through CLS and NDFs carry no settlement risk; a USD/CNH swap or the same-day leg of an overnight swap does.',
    overBy: (x: string) => `over by ${x}`,
    report: 'End-of-day report',
    reportNote: 'Where every line stands, the lines changed today and the hedges dealt today, as one file.',
    download: 'Download the report (CSV)',
  },
  zh: {
    unit: '百萬美元',
    today: '今日各銀行集團的額度',
    todayNote: '每個集團只有一套額度，旗下所有 LP 和渠道共用。每格是已用的金額（包括預佔）對比額度。',
    warnNote: (level: number) => `「!」代表已用到預警線 ${level}% 或以上；「✕」代表已超出額度。`,
    group: '銀行集團及其 LP',
    to: (d: string) => `至 ${d}`,
    busiest: '結算風險，最高一日',
    notional: '360T 名義金額總額（當日成交）',
    notionalNote: '今日在 360T 與各集團成交的名義金額，買賣相加，對比當日的額度。每日從零開始。',
    channel: '渠道',
    noLp: '沒有 LP',
    noLine: '無額度',
    on: (d: string) => `${d}`,
    byDate: '逐日的結算風險',
    byDateNote: '每個交收日各集團應付給我方的金額，對比其每日額度。',
    date: '交收日',
    line: (x: string) => `額度 ${x}`,
    empty: '目前沒有 CLS 以外的未交收款項。經 CLS 交收的款項和 NDF 沒有結算風險；USD/CNH 掉期和隔夜掉期當日那一邊才有。',
    overBy: (x: string) => `超出 ${x}`,
    report: '日終報表',
    reportNote: '各條額度的使用情況、當日改過的額度和當日的對沖，合成一個檔案。',
    download: '下載報表（CSV）',
  },
};

/** Used against a line, as a figure with a thin bar under it. */
function Cell({ row, label, noLine, overBy, warnPct }: { row: BoardRow; label: string; noLine: string; overBy: (x: string) => string; warnPct: number }) {
  if (row.line < 0.5 && row.used < 0.5) return <span className="quiet-inline">{noLine}</span>;
  const status = lineStatus(row.used, row.line, warnPct);
  const figure = `${mio(row.used)} / ${mio(row.line)}`;
  return (
    <>
      {status === 'OVER' ? <Status ok={false}>{overBy(mio(row.used - row.line))}</Status> : status === 'WARN' ? <Status ok warn>{figure}</Status> : figure}
      <LineBar dense label={label} line={row.line} parts={[row.earlier + row.today, row.reserved]} total={row.used} ok={status !== 'OVER'} warn={status === 'WARN'} />
    </>
  );
}

/** Hand the end-of-day report to the browser as a file. */
function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
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
        <p className="quiet hint">
          {t.todayNote} {t.warnNote(state.warnPct)}
        </p>
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
                        <Cell row={r} label={`${name(g)} ${r.key}`} noLine={t.noLine} overBy={t.overBy} warnPct={state.warnPct} />
                      </td>
                    ))}
                    <td>
                      {peak ? (
                        <>
                          <Cell row={peak} label={`${name(g)} ${shortDay(peak.key, lang)}`} noLine={t.noLine} overBy={t.overBy} warnPct={state.warnPct} />
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
                      return (
                        <td key={g.id}>
                          {r ? <Cell row={r} label={`${name(g)} ${shortDay(d, lang)}`} noLine={t.noLine} overBy={t.overBy} warnPct={state.warnPct} /> : <span className="quiet-inline">–</span>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <div className="lines-head">
          <h2>
            {t.notional} <span className="quiet-inline">· {t.unit}</span>
          </h2>
        </div>
        <p className="quiet hint">{t.notionalNote}</p>
        <div className="table-wrap">
          <table className="table overview">
            <thead>
              <tr>
                <th>{t.channel}</th>
                {boards.map(({ g }) => (
                  <th key={g.id}>
                    {name(g)}
                    <span className="th-sub">{g.notionalLine > 0.5 ? t.line(mio(g.notionalLine)) : ' '}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>360T</td>
                {boards.map(({ g, b }) => (
                  <td key={g.id}>
                    {b.notional ? (
                      <Cell row={b.notional} label={`${name(g)} ${t.notional}`} noLine={t.noLine} overBy={t.overBy} warnPct={state.warnPct} />
                    ) : (
                      <span className="quiet-inline">{t.noLp}</span>
                    )}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="card report">
        <div>
          <h2 className="card-title">{t.report}</h2>
          <p className="quiet">{t.reportNote}</p>
        </div>
        <button type="button" className="secondary" onClick={() => download(`credit-lines-${state.businessDate}.csv`, dayReportCsv(state))}>
          {t.download}
        </button>
      </section>
    </>
  );
}
