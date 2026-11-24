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
      ['Nothing held the room between check and fill', 'Check and reserve in one step; release when the LP rejects or the venue confirms no trade'],
      ['The limit was kept per LP', 'Lines sit on the banking group, across entities and channels'],
      ['Exposure only ever went up', 'Revalued daily; settled payments drop out'],
      ['A trader could edit the limit', 'The credit owner sets lines; the desk reads them'],
      ['Only one LP, up to 50 mio', 'Kept as the scope; split orders would run the flow per child'],
    ],
    scope: 'Scope: trading by request, where the counterparty is known before the trade (FX swap, forward, NDF). An anonymous order book screens credit itself, so it needs a different design.',
    confirmed: 'Confirmed',
    answers: [
      'The credit owner sets a fixed limit for the desk each day. The desk counts only its own hedges against it.',
      'A failed check blocks the hedge. The system has no exceptions; a trader handles those by hand.',
      'Whether exposure is netted is a setting for each banking group.',
      'A payment due on the day it is dealt always counts in full. A leg that can go through CLS carries no settlement risk.',
    ],
    open: 'Assumed, still to confirm',
    questions: [
      'Settlement risk is counted on the value date only.',
      'The add-on depends on remaining maturity and is the same for every product.',
      'A negative market value does not reduce the add-on.',
      'With no answer from the LP after 5 seconds, the venue is asked. The reservation stays until the venue confirms no trade.',
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
      ['檢查與成交之間沒有保留額度', '檢查和預佔一步完成；LP 拒絕或場地確認沒有成交才釋放'],
      ['額度按 LP 記錄', '額度設在銀行集團層面，涵蓋旗下實體和所有渠道'],
      ['風險只增不減', '每日重估；已交收的款項剔除'],
      ['交易員可以改額度', '由授信管理部門設定額度，交易台只能查看'],
      ['只涵蓋單一 LP、5,000 萬以內', '維持這個範圍；拆單時每張子單各自走一次流程'],
    ],
    scope: '適用範圍：詢價交易，成交前已知對手（外匯掉期、遠期、NDF）。匿名訂單簿由場地自行篩選信貸，需要另一套設計。',
    confirmed: '已確認',
    answers: [
      '授信管理部門每日給交易台一個固定額度。交易台只計自己的對沖。',
      '檢查不通過就攔截。系統內沒有例外，例外由交易員人手處理。',
      '是否按淨額計，每個銀行集團可以設定。',
      '當日交收的款項一律計全額。可以經 CLS 的那一邊沒有結算風險。',
    ],
    open: '假設，仍待確認',
    questions: [
      '結算風險只計交割日當天。',
      '附加因子按剩餘期限分檔，各產品相同。',
      '市值為負時，附加金額不減少。',
      'LP 5 秒內沒有回覆，就向場地查詢。場地確認沒有成交，才釋放預佔額度。',
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

      <h2>{t.confirmed}</h2>
      <ol className="plain">
        {t.answers.map((a) => (
          <li key={a}>{a}</li>
        ))}
      </ol>

      <h2>{t.open}</h2>
      <ol className="plain">
        {t.questions.map((q) => (
          <li key={q}>{q}</li>
        ))}
      </ol>
    </div>
  );
}
