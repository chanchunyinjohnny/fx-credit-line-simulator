import { FlowDiagram } from './FlowDiagram';
import { useLang } from './i18n';

const T = {
  en: {
    lead: "A desk hedges FX swaps with external LPs on 360T and FXGO. Today each counterparty's limit is cut into fixed slices, one per channel. The proposal holds one credit line per counterparty and checks it before a hedge goes out, whichever channel it uses.",
    draft: 'First draft',
    proposed: 'Proposed',
    found: 'What the review found',
    gap: 'Gap in the first draft',
    fix: 'In the proposal',
    rows: [
      ['The limit had no unit; trade size was deducted', 'Two lines: pre-settlement risk and settlement risk'],
      ['Nothing held the room between check and fill', 'Check and reserve in one step; release on reject or timeout'],
      ['The limit was kept per LP', 'Lines sit on the banking group, across entities and channels'],
      ['Exposure only ever went up', 'Revalued daily; settled payments drop out'],
      ['A trader could edit the limit', 'The credit owner sets lines; the desk reads them'],
      ['Only one LP, up to 50 mio', 'Kept as the scope; split orders would run the flow per child'],
    ],
    scope: 'Scope: trading by request, where the counterparty is known before the trade (FX swap, forward, NDF). An anonymous order book screens credit itself, so it needs a different design.',
    open: 'Open questions for the credit owner',
    questions: [
      'Does settlement risk count what we receive, as assumed, or what we pay?',
      'Is the morning figure what is left after the overnight run, or a fixed slice?',
      'Is the add-on set by remaining maturity, as assumed, or one rate per product family?',
      'With netting and no positive market value, is the net-to-gross ratio 1, as assumed, or 0?',
      'Is an overnight swap between CLS currencies settled gross on both legs or only the same-day leg?',
      'Is the check a hard block, or can a trader proceed with approval?',
      'How long does a reservation live when an LP does not answer?',
    ],
  },
  zh: {
    lead: '交易台透過 360T 和 FXGO 與外部 LP 對沖外匯掉期。現時每個對手的額度按渠道切成固定幾份。建議改為每個對手只有一條授信額度，不論走哪個渠道，對沖送出前都先檢查。',
    draft: '初稿',
    proposed: '建議流程',
    found: '檢視發現',
    gap: '初稿的缺口',
    fix: '建議的做法',
    rows: [
      ['額度沒有量度單位，直接扣交易金額', '兩條額度：交割前風險和結算風險'],
      ['檢查與成交之間沒有保留額度', '檢查和預佔一步完成；被拒或逾時即釋放'],
      ['額度按 LP 記錄', '額度設在銀行集團層面，涵蓋旗下實體和所有渠道'],
      ['風險只增不減', '每日重估；已交收的款項剔除'],
      ['交易員可以改額度', '由授信管理部門設定額度，交易台只能查看'],
      ['只涵蓋單一 LP、5,000 萬以內', '維持這個範圍；拆單時每張子單各自走一次流程'],
    ],
    scope: '適用範圍：詢價交易，成交前已知對手（外匯掉期、遠期、NDF）。匿名訂單簿由場地自行篩選信貸，需要另一套設計。',
    open: '待授信管理部門確認的問題',
    questions: [
      '結算風險是按我方應收計（本程式的假設），還是按應付計？',
      '每朝收到的數字，是隔夜匯總後的餘額，還是固定的一份額度？',
      '附加因子是按剩餘期限設定（本程式的假設），還是每類產品一個比率？',
      '適用淨額結算而沒有任何正市值時，NGR 取 1（本程式的假設）還是 0？',
      'CLS 貨幣之間的隔夜掉期，是兩邊都全額結算，還是只有當日那一邊？',
      '檢查不通過是硬性攔截，還是交易員獲批後可以繼續？',
      'LP 沒有回覆時，預佔額度保留多久？',
    ],
  },
} as const;

export function Design() {
  const t = T[useLang()];
  return (
    <div className="prose">
      <p className="lead">{t.lead}</p>

      <div className="grid-two">
        <section>
          <h2>{t.draft}</h2>
          <FlowDiagram variant="draft" />
        </section>
        <section>
          <h2>{t.proposed}</h2>
          <FlowDiagram variant="proposed" />
        </section>
      </div>

      <h2>{t.found}</h2>
      <div className="table-wrap">
        <table className="table text-table">
          <thead>
            <tr>
              <th>{t.gap}</th>
              <th>{t.fix}</th>
            </tr>
          </thead>
          <tbody>
            {t.rows.map(([gap, fix]) => (
              <tr key={gap}>
                <td>{gap}</td>
                <td>{fix}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="quiet">{t.scope}</p>

      <h2>{t.open}</h2>
      <ol className="plain">
        {t.questions.map((q) => (
          <li key={q}>{q}</li>
        ))}
      </ol>
    </div>
  );
}
