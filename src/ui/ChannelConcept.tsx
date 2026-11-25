import { BarLegend, LineBar } from './LineBar';
import { useLang } from './i18n';

const M = 1_000_000;
const LINE = 100;
/** Three counterparties with a line of 100 each, and one order: first sized to use 10 of whoever fills it, then cut to 4.
 *  Each row is a moment; each cell is [in use, reserved, this order] for one counterparty. */
const ROWS: [number, number, number][][] = [
  [[20, 0, 0], [60, 0, 0], [96, 0, 0]],
  [[20, 0, 10], [60, 0, 10], [96, 0, 10]],
  [[20, 4, 0], [60, 4, 0], [96, 4, 0]],
  [[20, 0, 0], [64, 0, 0], [96, 0, 0]],
];

const T = {
  en: {
    head: 'One order, every counterparty that could fill it',
    lead: 'The desk cannot change who fills an order on such a channel, but an order never fills for more than its own amount. So it reserves that amount on each counterparty that could fill it. No limit held at the channel has to change.',
    setup: `Example: three counterparties on the channel, each with a credit line of ${LINE}. An order uses the line of whoever fills it.`,
    step: 'Step',
    names: ['Bank X', 'Bank Y', 'Bank Z'],
    line: (n: string) => `${n} · line of ${LINE}`,
    steps: [
      ['Before the order', 'Any of the three could fill it'],
      ['Check an order that would use 10', 'Bank Z has no room, so the whole order is held back'],
      ['Cut the order to 4, then place it', 'Reserved on all three'],
      ['The fill names Bank Y', 'Its reservation becomes usage. Banks X and Z are released'],
    ],
    inUse: (x: number) => `${x} in use`,
    sum: (a: number, b: number, ok: boolean) => `${a} + ${b} = ${a + b}${ok ? '' : `, over ${LINE}`}`,
    reserved: (a: number, b: number) => `${a} in use, ${b} reserved`,
    note: 'The counterparty with the tightest line sets how large the order can be. Once Bank Z’s line is full, no order can be placed on the channel at all. The desk cannot keep one counterparty out from its own side: it can only cut the order, or stop sending orders to the whole channel. Excluding Bank Z alone means setting its limit at the channel to zero, and that is done by whoever administers credit there.',
  },
  zh: {
    head: '一張訂單，每個可能成交的對手',
    lead: '在這類場地上，交易台改變不了誰來成交，但一張訂單最多成交它自己的金額。所以在每個可能成交的對手那裡，都預佔這個金額。場地上的限額不用改。',
    setup: `例子：場地上有三個對手，授信額度各 ${LINE}。一張訂單和誰成交，就用掉誰的額度。`,
    step: '步驟',
    names: ['甲銀行', '乙銀行', '丙銀行'],
    line: (n: string) => `${n} · 額度 ${LINE}`,
    steps: [
      ['掛單前', '三個對手都可能成交'],
      ['檢查一張要用 10 的訂單', '丙銀行放不下，所以整張單不能掛'],
      ['把訂單縮小到 4，然後掛單', '在三個對手那裡各預佔 4'],
      ['成交回報：對手是乙銀行', '它的預佔轉為已用。甲、丙銀行的預佔釋放'],
    ],
    inUse: (x: number) => `已用 ${x}`,
    sum: (a: number, b: number, ok: boolean) => `${a} + ${b} = ${a + b}${ok ? '' : `，超過 ${LINE}`}`,
    reserved: (a: number, b: number) => `已用 ${a}，預佔 ${b}`,
    note: '額度最緊的那個對手，決定訂單能做多大。丙銀行的額度用完時，這個場地就一張單也掛不了。交易台不能從自己這邊單獨擋住一個對手：它只能縮小訂單，或者整個場地停止下單。要單獨排除丙銀行，只能在場地上把它的限額設為零，這要由管理場地額度的人做。',
  },
} as const;

/** Why an order on a book is reserved on several lines at once, and what the fill does to each. */
export function ChannelConcept() {
  const t = T[useLang()];
  return (
    <>
      <h3>{t.head}</h3>
      <p>{t.lead}</p>
      <p>{t.setup}</p>
      <BarLegend withHedge />
      <div className="table-wrap">
        <table className="table concept">
          <thead>
            <tr>
              <th>{t.step}</th>
              {t.names.map((n) => (
                <th key={n}>{t.line(n)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((cells, i) => (
              <tr key={i}>
                <td>
                  <strong>
                    {i + 1}. {t.steps[i][0]}
                  </strong>
                  <span>{t.steps[i][1]}</span>
                </td>
                {cells.map(([used, reserved, order], k) => {
                  const total = used + reserved + order;
                  return (
                    <td key={k} className="concept-bar">
                      <LineBar label={t.names[k]} line={LINE * M} parts={[used * M, reserved * M, order * M]} total={total * M} ok={total <= LINE} />
                      <span>{order ? t.sum(used, order, total <= LINE) : reserved ? t.reserved(used, reserved) : t.inUse(used)}</span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="quiet">{t.note}</p>
    </>
  );
}
