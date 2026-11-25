import { LineBar } from './LineBar';
import { useLang } from './i18n';

const M = 1_000_000;
const LINE = 100;
/** One credit line of 100 and a largest trade of 10: the first fill, its top-up, then the line running out. */
const ROWS = [
  { used: 0, held: 10 },
  { used: 10, held: 0 },
  { used: 10, held: 10 },
  { used: 95, held: 5 },
  { used: 100, held: 0 },
];

const T = {
  en: {
    head: 'The channel limit is the largest trade',
    lead: 'The limit the desk sets on the channel is the most the channel can fill with one counterparty before the desk tops it up. Topped up after every fill, that is the largest single trade. The room held on the credit line is what that one trade would use.',
    setup: `Example: a credit line of ${LINE} with one counterparty. The desk lets a trade on the channel use up to 10 of it.`,
    cols: ['Step', `Credit line of ${LINE}`, 'In use', 'Held = channel limit', 'Headroom'],
    steps: [
      ['Start', 'Hold 10, then set the channel limit to 10'],
      ['The channel fills a trade of 10', 'The held room becomes usage. The channel limit is now 0'],
      ['The desk tops up', 'Holds 10 more out of headroom and sets the limit back to 10'],
      ['Later, with 95 in use', 'Only 5 is left to hold, so the largest trade is now 5'],
      ['With 100 in use', 'The limit is 0. The channel no longer fills with this counterparty'],
    ],
    note: 'Here a trade of 10 uses 10 of the line. In practice the channel limit is a trade amount and the credit line is a risk amount: room used = trade amount × add-on %. With an add-on of 1%, the trade that uses 10 of the line is a trade of 1,000. The Formulae view works one through.',
  },
  zh: {
    head: '場地限額就是一筆最多做多大',
    lead: '交易台在場地上對一個對手設的限額，是交易台補回之前，場地最多可以和這個對手成交多少。每筆成交後都補回，這就是一筆最多做多大。場地切片就是這一筆會用掉的額度。',
    setup: `例子：一個對手的授信額度是 ${LINE}。交易台容許場地上的一筆成交最多用掉 10。`,
    cols: ['步驟', `授信額度 ${LINE}`, '已用', '場地切片 = 場地限額', '可用額度'],
    steps: [
      ['開始', '先預留 10，再把場地限額設為 10'],
      ['場地成交一筆 10', '切片轉為已用。場地限額變成 0'],
      ['交易台補回', '從可用額度再預留 10，限額設回 10'],
      ['之後，已用 95', '只剩 5 可以預留，最大一筆變成 5'],
      ['已用 100', '限額是 0，場地不再和這個對手成交'],
    ],
    note: '這裡一筆 10 的成交用掉額度 10。實際上場地限額是交易金額，授信額度是風險金額：用掉的額度 = 交易金額 × 附加因子。附加因子 1% 時，用掉額度 10 的那一筆，交易金額是 1,000。公式頁有一個完整的例子。',
  },
} as const;

const KEYS = [null, null, 'seg-used', 'seg-allocated', 'seg-headroom'] as const;

/** Why the room held for a channel stays the size of one trade: it moves along the line as fills are booked. */
export function ChannelConcept() {
  const t = T[useLang()];
  return (
    <>
      <h3>{t.head}</h3>
      <p>{t.lead}</p>
      <p>{t.setup}</p>
      <div className="table-wrap">
        <table className="table concept">
          <thead>
            <tr>
              {t.cols.map((c, i) => (
                <th key={c}>
                  {KEYS[i] && <span className={`seg ${KEYS[i]}`} aria-hidden="true" />}
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r, i) => (
              <tr key={i}>
                <td>
                  <strong>
                    {i + 1}. {t.steps[i][0]}
                  </strong>
                  <span>{t.steps[i][1]}</span>
                </td>
                <td className="concept-bar">
                  <LineBar label={t.steps[i][0]} line={LINE * M} parts={[r.used * M, 0, r.held * M, 0]} total={(r.used + r.held) * M} ok />
                </td>
                <td>{r.used}</td>
                <td>{r.held}</td>
                <td>{LINE - r.used - r.held}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="quiet">{t.note}</p>
    </>
  );
}
