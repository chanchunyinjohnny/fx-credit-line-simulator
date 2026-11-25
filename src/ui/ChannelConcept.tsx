import { BarLegend, LineBar } from './LineBar';
import { useLang } from './i18n';

const M = 1_000_000;
const LINE = 100;
/** Three counterparties with a line of 100 each, and one order that would use 10 of whichever fills it.
 *  Each row is a moment; each cell is [in use, reserved, this order] for one counterparty. */
const ROWS: [number, number, number][][] = [
  [[20, 0, 0], [60, 0, 0], [96, 0, 0]],
  [[20, 0, 10], [60, 0, 10], [96, 0, 10]],
  [[20, 10, 0], [60, 10, 0], [96, 0, 0]],
  [[20, 0, 0], [70, 0, 0], [96, 0, 0]],
];

const T = {
  en: {
    head: 'One order, every counterparty that could fill it',
    lead: 'The desk cannot change who fills an order on such a channel, but an order never fills for more than its own amount. So it reserves that amount on each counterparty that could fill it. No limit held at the channel has to change.',
    setup: `Example: three counterparties on the channel, each with a credit line of ${LINE}. The order would use 10 of the line of whoever fills it.`,
    step: 'Step',
    names: ['Bank X', 'Bank Y', 'Bank Z'],
    line: (n: string) => `${n} · line of ${LINE}`,
    steps: [
      ['Before the order', 'Any of the three could fill it'],
      ['Check the order against each', 'Bank Z has no room, so the whole order is held back. The most that fits is 4'],
      ['Switch Bank Z off at the channel, then place the order', 'Reserved on the two that could still fill it'],
      ['The fill names Bank Y', 'Its reservation becomes usage. Bank X is released'],
    ],
    inUse: (x: number) => `${x} in use`,
    sum: (a: number, b: number, ok: boolean) => `${a} + ${b} = ${a + b}${ok ? '' : `, over ${LINE}`}`,
    reserved: (a: number, b: number) => `${a} in use, ${b} reserved`,
    off: (x: number) => `${x} in use. Switched off`,
    note: 'The counterparty with the tightest line sets how large the order can be. Switching it off at the channel is that channel’s own setting, done by whoever administers credit there, by hand or through the channel’s interface. Keeping within the lines does not depend on it.',
  },
  zh: {
    head: '一張訂單，每個可能成交的對手',
    lead: '在這類場地上，交易台改變不了誰來成交，但一張訂單最多成交它自己的金額。所以在每個可能成交的對手那裡，都預佔這個金額。場地上的限額不用改。',
    setup: `例子：場地上有三個對手，授信額度各 ${LINE}。這張訂單和誰成交，就用掉誰的額度 10。`,
    step: '步驟',
    names: ['甲銀行', '乙銀行', '丙銀行'],
    line: (n: string) => `${n} · 額度 ${LINE}`,
    steps: [
      ['掛單前', '三個對手都可能成交'],
      ['對每個對手檢查這張訂單', '丙銀行放不下，所以整張單不能掛。最多只能掛 4'],
      ['在場地上停用丙銀行，然後掛單', '在仍可能成交的兩個對手那裡預佔'],
      ['成交回報：對手是乙銀行', '它的預佔轉為已用。甲銀行的預佔釋放'],
    ],
    inUse: (x: number) => `已用 ${x}`,
    sum: (a: number, b: number, ok: boolean) => `${a} + ${b} = ${a + b}${ok ? '' : `，超過 ${LINE}`}`,
    reserved: (a: number, b: number) => `已用 ${a}，預佔 ${b}`,
    off: (x: number) => `已用 ${x}。已停用`,
    note: '額度最緊的那個對手，決定訂單能做多大。在場地上停用它是場地自己的設定，由管理場地額度的人做，人手或經場地的介面都可以。不超額並不靠這一步。',
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
                  const off = i >= 2 && k === 2;
                  return (
                    <td key={k} className="concept-bar">
                      <LineBar label={t.names[k]} line={LINE * M} parts={[used * M, reserved * M, order * M]} total={total * M} ok={total <= LINE} />
                      <span>{order ? t.sum(used, order, total <= LINE) : reserved ? t.reserved(used, reserved) : off ? t.off(used) : t.inUse(used)}</span>
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
