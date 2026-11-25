import { ChannelFlow, FlowDiagram, flowTitle, type FlowKind } from './FlowDiagram';
import { useLang } from './i18n';

const KINDS: FlowKind[] = ['send', 'callback', 'channel'];

const T = {
  en: {
    lead: "A desk hedges FX swaps, forwards and NDFs with external LPs on several channels. Today each counterparty's limit is cut into fixed slices, one per channel. The proposal holds one credit line per counterparty and keeps every hedge on it, whichever channel it uses.",
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
    kinds: 'Two kinds of channel',
    kindsLead: 'What decides the design is who can say no before the trade is final.',
    kindsWhere: {
      send: 'Request for quote or stream: 360T, FXGO.',
      callback: 'An order book that asks before the trade is final.',
      channel: 'An order book that fills on limits it holds: EBS Market.',
    },
    legend: 'The shaded step is where the desk decides on the credit line.',
    ledger: 'Every fill lands on the same line. At any moment: credit line = in use + reserved + held for channels + headroom.',
    scope: 'Scope: FX swap, forward and NDF. A channel reached through a prime broker or clearing house faces that one counterparty, so it has one line of its own.',
    confirmed: 'Confirmed',
    answers: [
      'The credit owner sets a fixed limit for the desk each day. The desk counts only its own hedges against it.',
      'A failed check blocks the hedge. The system has no exceptions; a trader handles those by hand.',
      'Whether exposure is netted is a setting for each banking group.',
      'A payment due on the day it is dealt always counts in full. A leg that can go through CLS carries no settlement risk.',
    ],
    open: 'Assumed, still to confirm',
    questions: [
      'Settlement risk is counted on the value date only. This is the common convention, though supervisors say it can understate.',
      'The add-on depends on remaining maturity and is the same for every product.',
      'A negative market value does not reduce the add-on.',
      'With no answer from the LP after 5 seconds, the venue is asked. The reservation stays until the venue confirms no trade.',
      'Room held for a channel is the limit left times the add-on of the longest order sent there. The limit is recomputed each morning.',
    ],
  },
  zh: {
    lead: '交易台經多個渠道與外部 LP 對沖外匯掉期、遠期和 NDF。現時每個對手的額度按渠道切成固定幾份。建議改為每個對手只有一條授信額度，不論走哪個渠道，每筆對沖都記在這一條額度上。',
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
    kinds: '兩類渠道',
    kindsLead: '設計只取決於一件事：成交前誰可以說「不」。',
    kindsWhere: {
      send: '詢價和持續報價：360T、FXGO。',
      callback: '成交前會來問的訂單簿。',
      channel: '按自己持有的限額成交的訂單簿：EBS Market。',
    },
    legend: '有底色的一步，是交易台決定額度夠不夠的地方。',
    ledger: '每筆成交都記在同一條額度上。任何時刻：授信額度 = 已用 + 預佔 + 場地切片 + 可用額度。',
    scope: '適用範圍：外匯掉期、遠期和 NDF。經主經紀商或清算所交易的渠道，對手只有那一家，另有一條自己的額度。',
    confirmed: '已確認',
    answers: [
      '授信管理部門每日給交易台一個固定額度。交易台只計自己的對沖。',
      '檢查不通過就攔截。系統內沒有例外，例外由交易員人手處理。',
      '是否按淨額計，每個銀行集團可以設定。',
      '當日交收的款項一律計全額。可以經 CLS 的那一邊沒有結算風險。',
    ],
    open: '假設，仍待確認',
    questions: [
      '結算風險只計交割日當天。這是行業慣例，但監管認為會低估。',
      '附加因子按剩餘期限分檔，各產品相同。',
      '市值為負時，附加金額不減少。',
      'LP 5 秒內沒有回覆，就向場地查詢。場地確認沒有成交，才釋放預佔額度。',
      '場地切片 = 場地尚餘限額 × 送往該場地最長期限訂單的附加因子。限額每朝重算。',
    ],
  },
} as const;

export function Design() {
  const lang = useLang();
  const t = T[lang];
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

      <h2>{t.kinds}</h2>
      <p>{t.kindsLead}</p>
      <div className="grid-three">
        {KINDS.map((kind) => (
          <section key={kind}>
            <h3>{flowTitle(lang, kind)}</h3>
            <p className="quiet">{t.kindsWhere[kind]}</p>
            <ChannelFlow kind={kind} />
          </section>
        ))}
      </div>
      <p className="quiet">{t.legend}</p>
      <p>{t.ledger}</p>
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
