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
      'Is settlement risk counted on the value date only, as assumed, or from when our payment can no longer be cancelled until receipt is confirmed?',
      'Is the morning figure what is left after the overnight run, or a fixed slice? Where a screen shows both an available and an allowed limit, which one does the check use?',
      'Is the add-on set by remaining maturity, as assumed, or one rate per product family?',
      'The standard method keeps the add-on in full when the market value is negative. Does the bank-wide system let a negative value reduce it?',
      'Is utilisation always measured gross, as assumed, or net where a netting agreement exists?',
      'Is an overnight swap between CLS currencies settled gross on both legs or only the same-day leg?',
      'A failed check blocks the hedge here. Who approves an exception, and is it recorded before the hedge is sent?',
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
      '結算風險是只計在交割日當天（本程式的假設），還是由付款不能撤回起計至確認收款？',
      '每朝收到的數字，是隔夜匯總後的餘額，還是固定的一份額度？畫面同時有「可用額度」和「允許額度」時，檢查用哪一個？',
      '附加因子是按剩餘期限設定（本程式的假設），還是每類產品一個比率？',
      '標準方法在市值為負時保留全部附加金額。全行的額度系統是否容許負市值減少附加金額？',
      '額度使用量是否一律按未淨額的風險敞口計（本程式的假設），還是有淨額結算協議時按淨額計？',
      'CLS 貨幣之間的隔夜掉期，是兩邊都全額結算，還是只有當日那一邊？',
      '本程式在檢查不通過時直接攔截。例外由誰審批？是否在對沖送出前記錄？',
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
