import { ChannelConcept } from './ChannelConcept';
import { ChannelFlow, FlowDiagram, flowTitle, type FlowKind } from './FlowDiagram';
import { useLang } from './i18n';

/** The two kinds of channel and the flows that belong to each. */
const KINDS: { key: 'pre' | 'post'; flows: FlowKind[] }[] = [
  { key: 'pre', flows: ['send', 'callback'] },
  { key: 'post', flows: ['channel'] },
];

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
    kindsLead: 'One thing separates them: whether the desk learns the counterparty before the trade is final, or after.',
    kindNames: { pre: 'Disclosed before the trade', post: 'Disclosed after the trade' },
    kindRows: [
      ['The desk learns the counterparty', 'Before the trade is final: when it sends, or when the channel asks', 'From the fill report'],
      ['What the desk checks before the order goes out', 'That one counterparty', 'Every counterparty that could fill the order'],
      ['How room is taken on the line', 'Reserved with that counterparty', 'Reserved with each of them; after the fill, kept only with the one that filled'],
      ['Channels', 'Request for quote and streams. An order book that asks before the trade is final', 'An order book that names the counterparty afterwards'],
    ],
    kindsWhere: {
      send: 'Request for quote or stream: 360T, FXGO.',
      callback: 'An order book that names the counterparty and asks.',
      channel: 'An order book that names the counterparty afterwards: EBS Market.',
    },
    legend: 'The shaded step is where the desk decides on the credit line. It is the same check in all three.',
    canHead: 'Disclosed after the trade: what the desk can and cannot do',
    can: 'Can',
    canList: [
      'Keep every counterparty within its line, without changing any limit held at the channel. The order is reserved on each counterparty that could fill it before it goes out.',
      'Reserve what the order would really use: its own tenor and direction, netted like any other hedge.',
      'Book the fill on the same line as every other hedge, and release the rest, as soon as the fill names the counterparty.',
    ],
    cannot: 'Cannot',
    cannotList: [
      'Choose the counterparty, or refuse a single trade.',
      'Place an order larger than the tightest line allows. One counterparty short of room cuts the whole order; once its line is full, no order can go to the channel.',
      'Leave the other lines free while an order is open. Each of them carries the reservation until the order is done.',
      'Keep one counterparty out on its own. The desk can only cut the order or stop sending orders to the whole channel. Excluding one counterparty means setting its limit at the channel to zero, which is done by whoever administers credit there.',
    ],
    switchText:
      'Each such channel has a switch. On, the desk checks and reserves as above. Off, it relies on the limits held at the channel and books fills afterwards: a line can then be exceeded, and the desk learns of it after the trade.',
    ledger: 'Every fill lands on the same line. At any moment: credit line = in use + reserved + headroom.',
    scope: 'Scope: FX swap, forward and NDF. A channel reached through a prime broker or clearing house faces that one counterparty, so it has one line of its own.',
    premise: 'The premise',
    premiseText:
      'The desk asks the credit owner for a fixed limit each day, counted only against its own hedges. The condition is that the desk keeps its own part within that limit. This design is how it does so.',
    confirmed: 'Confirmed',
    answers: [
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
      'An order on a channel that discloses after the trade could fill with any counterparty switched on there, for its whole amount. It is reserved on each of them.',
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
    kindsLead: '分界只有一個：交易台在成交前知道對手，還是成交後才知道。',
    kindNames: { pre: '事前披露', post: '事後披露' },
    kindRows: [
      ['交易台何時知道對手', '成交前：送出時，或場地來問時', '成交後：從成交回報'],
      ['送出前檢查誰', '這一個對手', '每個可能成交的對手'],
      ['額度怎樣佔用', '在這個對手那裡預佔', '在每一個那裡預佔；成交後只留成交的那一個'],
      ['渠道', '詢價和持續報價。成交前會來問的訂單簿', '成交後才披露對手的訂單簿'],
    ],
    kindsWhere: {
      send: '詢價和持續報價：360T、FXGO。',
      callback: '撮合後披露對手、並來問的訂單簿。',
      channel: '成交後才披露對手的訂單簿：EBS Market。',
    },
    legend: '有底色的一步，是交易台決定額度夠不夠的地方。三個流程用的是同一個檢查。',
    canHead: '事後披露的渠道：做得到和做不到的',
    can: '做得到',
    canList: [
      '每個對手都不會超額，而且不用改動場地上的限額。訂單掛出去之前，已經在每個可能成交的對手那裡預佔。',
      '預佔得剛剛好：按這張訂單自己的期限和方向計，和其他對沖一樣計淨額。',
      '成交回報一披露對手，就記在同一條額度上，其餘對手的預佔即時釋放。',
    ],
    cannot: '做不到',
    cannotList: [
      '選擇對手，或者拒絕個別成交。',
      '掛出大過最緊那條額度容得下的單。一個對手額度不夠，整張單都要縮小；它的額度用完，這個場地就一張單也掛不了。',
      '掛單期間不佔其他對手的額度。訂單未完結，每個可能成交的對手都留著這份預佔。',
      '單獨擋住一個對手。交易台只能縮小訂單，或者整個場地停止下單。要排除一個對手，只能在場地上把它的限額設為零，這要由管理場地額度的人做。',
    ],
    switchText: '每個這類場地有一個開關。開：照上面的做法，掛單前檢查並預佔。關：只靠場地上的限額，成交後才記帳；額度可能被超出，而且交易台事後才知道。',
    ledger: '每筆成交都記在同一條額度上。任何時刻：授信額度 = 已用 + 預佔 + 可用額度。',
    scope: '適用範圍：外匯掉期、遠期和 NDF。經主經紀商或清算所交易的渠道，對手只有那一家，另有一條自己的額度。',
    premise: '前提',
    premiseText: '交易台向授信管理部門要求每日一個固定額度，只計交易台自己的對沖。條件是交易台能管好自己的這一部分。這個設計就是為了做到這一點。',
    confirmed: '已確認',
    answers: [
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
      '掛到事後披露場地的訂單，可能和場地上任何一個開通的對手成交，而且是整張單。所以在每一個那裡都預佔。',
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
      <div className="table-wrap">
        <table className="table text-table kinds-table">
          <thead>
            <tr>
              <th />
              <th>{t.kindNames.pre}</th>
              <th>{t.kindNames.post}</th>
            </tr>
          </thead>
          <tbody>
            {t.kindRows.map(([what, pre, post]) => (
              <tr key={what}>
                <th scope="row">{what}</th>
                <td>{pre}</td>
                <td>{post}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="kinds">
        {KINDS.map(({ key, flows }) => (
          <section key={key} className={flows.length > 1 ? 'kind kind-wide' : 'kind'}>
            <h3>{t.kindNames[key]}</h3>
            <div className="kind-flows">
              {flows.map((flow) => (
                <div key={flow}>
                  <h4>{flowTitle(lang, flow)}</h4>
                  <p className="quiet">{t.kindsWhere[flow]}</p>
                  <ChannelFlow kind={flow} />
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
      <p className="quiet">{t.legend}</p>
      <p>{t.ledger}</p>

      <ChannelConcept />

      <h3>{t.canHead}</h3>
      <div className="grid-two can-cannot">
        <section>
          <h4>{t.can}</h4>
          <ul>
            {t.canList.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </section>
        <section>
          <h4>{t.cannot}</h4>
          <ul>
            {t.cannotList.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </section>
      </div>
      <p>{t.switchText}</p>
      <p className="quiet">{t.scope}</p>

      <h2>{t.premise}</h2>
      <p>{t.premiseText}</p>

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
