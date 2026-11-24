import { useEffect, useReducer, useState } from 'react';
import { nextWeekday } from './engine/calendar';
import { nextPillarStep, rollSummary, type PillarStep, type RollSummary } from './engine/roll';
import { START_DATE as loadDefaultDate } from './engine/defaults';
import { LAST_DATE, loadState, reducer, saveState, type Action } from './engine/state';
import { Design } from './ui/Design';
import { Formulae } from './ui/Formulae';
import { day, mio, partyName, shortDay } from './ui/format';
import { LangProvider, initialLang, saveLang, type Lang } from './ui/i18n';
import { Lines } from './ui/Lines';
import { Simulator } from './ui/Simulator';

const TAB_IDS = ['simulator', 'lines', 'formulae', 'design'] as const;
type TabId = (typeof TAB_IDS)[number];

const T = {
  en: {
    docTitle: 'FX Credit Line Simulator',
    suffix: 'FX HEDGING SIMULATOR',
    tabs: { simulator: 'Simulator', lines: 'Lines', formulae: 'Formulae', design: 'Design' },
    headings: {
      simulator: ['Does this hedge fit the credit lines?', 'Enter a hedge, pick an LP, send it, then fill or reject it.'],
      lines: ['Where every credit line stands', 'Today for each banking group, and settlement risk date by date.'],
      formulae: ['How the numbers are worked out', 'The method, and one swap followed step by step.'],
      design: ['From first draft to proposed flow', 'What a review of the hedging flow changed.'],
    },
    date: 'Business date',
    next: 'Next day',
    jump: 'Jump to',
    go: 'Go',
    reset: 'Reset',
    confirm: 'Clear all hedges and edits?',
    yes: 'Yes, reset',
    cancel: 'Cancel',
    close: 'Close',
    now: (d: string) => `Now ${d}.`,
    nothing: 'No hedges are open, so nothing changed. Send and fill a hedge first; each new day then revalues it and releases payments that have settled.',
    group: (g: string, b: string, a: string, sr: string | null) =>
      `${g}: pre-settlement risk ${b} → ${a} USD mio${sr ? `; ${sr} of settlement risk released as payments settled` : ''}.`,
    lapsed: (n: number) => `${n} hedge${n > 1 ? 's' : ''} still in flight lapsed, and the reservation was released.`,
    steady: 'Prices have not moved, so market values barely change. The add-on steps down only when a hedge drops into a shorter pillar.',
    step: (id: string, from: string, to: string, d: string) => `Next: ${id} moves from the ${from} pillar to ${to} on ${d}. Jump there to see it.`,
    footer: 'Chan Chun Yin Johnny · all data invented · saved in this browser only',
    source: 'Source',
  },
  zh: {
    docTitle: '外匯對沖授信額度模擬',
    suffix: '外匯對沖額度模擬',
    tabs: { simulator: '模擬', lines: '額度', formulae: '公式', design: '流程設計' },
    headings: {
      simulator: ['這筆對沖放得進授信額度嗎？', '輸入一筆對沖，選 LP，送出，再選成交或拒絕。'],
      lines: ['各條授信額度的現況', '今日各銀行集團的額度，以及逐日的結算風險。'],
      formulae: ['數字是怎樣算出來的', '計算方法，加一筆掉期的逐步演算。'],
      design: ['從初稿到建議流程', '檢視對沖流程後改了什麼。'],
    },
    date: '營業日',
    next: '下一營業日',
    jump: '跳至',
    go: '前往',
    reset: '重設',
    confirm: '清除所有對沖和修改？',
    yes: '確定重設',
    cancel: '取消',
    close: '關閉',
    now: (d: string) => `現在是 ${d}。`,
    nothing: '沒有未到期的對沖，所以沒有變化。先送出並成交一筆對沖；之後每過一日，系統會重估這筆對沖，並釋放已交收款項的結算風險。',
    group: (g: string, b: string, a: string, sr: string | null) => `${g}：交割前風險 ${b} → ${a} 百萬美元${sr ? `；款項已交收，釋放結算風險 ${sr}` : ''}。`,
    lapsed: (n: number) => `${n} 筆在途對沖已失效，預佔額度已釋放。`,
    steady: '價格沒有變動，所以市值幾乎不變。附加金額只在對沖跨入更短的期限檔時才下降。',
    step: (id: string, from: string, to: string, d: string) => `下一次：${id} 於 ${d} 由 ${from} 檔降至 ${to} 檔。跳到那天就能看到。`,
    footer: 'Chan Chun Yin Johnny · 所有數據均為虛構 · 只儲存在本瀏覽器',
    source: '原始碼',
  },
} as const;

const tabFromHash = (): TabId => TAB_IDS.find((id) => `#${id}` === window.location.hash) ?? 'simulator';

export function App() {
  const [state, dispatch] = useReducer(reducer, undefined, loadState);
  const [tab, setTab] = useState<TabId>(tabFromHash);
  const [lang, setLang] = useState<Lang>(initialLang);
  const [confirmReset, setConfirmReset] = useState(false);
  const [note, setNote] = useState<(RollSummary & { step: PillarStep | null }) | null>(null); // what the last change of date did
  const [jumpTo, setJumpTo] = useState(() => nextWeekday(state.businessDate));
  const t = T[lang];

  useEffect(() => saveState(state), [state]);
  useEffect(() => {
    saveLang(lang);
    document.title = t.docTitle;
  }, [lang, t.docTitle]);
  useEffect(() => {
    const onHash = () => setTab(tabFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const go = (id: TabId) => {
    window.history.replaceState(null, '', `#${id}`);
    setTab(id);
  };
  /** Move the business date and say what that changed. */
  const move = (action: Action) => {
    const after = reducer(state, action);
    if (after === state) return;
    setNote({ ...rollSummary(state, after), step: nextPillarStep(after) });
    setJumpTo((d) => (d > after.businessDate ? d : nextWeekday(after.businessDate)));
    dispatch(action);
  };
  const canJump = /^\d{4}-\d{2}-\d{2}$/.test(jumpTo) && jumpTo > state.businessDate && jumpTo <= LAST_DATE;

  return (
    <LangProvider value={lang}>
      <div className="app">
        <header className="topbar">
          <div className="brand">
            <span className="wordmark">Credit Line</span>
            <span className="brand-divider" aria-hidden="true" />
            <span className="brand-suffix">{t.suffix}</span>
          </div>
          <nav className="tabs">
            {TAB_IDS.map((id) => (
              <button key={id} type="button" aria-pressed={tab === id} onClick={() => go(id)}>
                {t.tabs[id]}
              </button>
            ))}
          </nav>
          <div className="controls">
            <span className="label">{t.date}</span>
            <span className="date">{day(state.businessDate, lang)}</span>
            <button type="button" onClick={() => move({ type: 'NEXT_DAY' })}>
              {t.next}
            </button>
            <label className="jump">
              <span className="label">{t.jump}</span>
              <input type="date" value={jumpTo} min={nextWeekday(state.businessDate)} max={LAST_DATE} onChange={(e) => setJumpTo(e.target.value)} />
            </label>
            <button type="button" disabled={!canJump} onClick={() => move({ type: 'GO_TO', date: jumpTo })}>
              {t.go}
            </button>
            {confirmReset ? (
              <>
                <span className="label">{t.confirm}</span>
                <button
                  type="button"
                  onClick={() => {
                    dispatch({ type: 'RESET' });
                    setNote(null);
                    setJumpTo(nextWeekday(loadDefaultDate));
                    setConfirmReset(false);
                  }}
                >
                  {t.yes}
                </button>
                <button type="button" onClick={() => setConfirmReset(false)}>
                  {t.cancel}
                </button>
              </>
            ) : (
              <button type="button" onClick={() => setConfirmReset(true)}>
                {t.reset}
              </button>
            )}
            <div className="lang" role="group" aria-label="Language / 語言">
              <button type="button" aria-pressed={lang === 'en'} onClick={() => setLang('en')}>
                EN
              </button>
              <span aria-hidden="true" />
              <button type="button" lang="zh-Hant" aria-pressed={lang === 'zh'} onClick={() => setLang('zh')}>
                中文
              </button>
            </div>
          </div>
        </header>

        <main className="main">
          {note && (
            <div className="day-note" role="status">
              <div>
                <strong>{t.now(day(note.date, lang))}</strong>
                {note.groups.length === 0 && note.lapsed === 0 && <p>{t.nothing}</p>}
                {note.groups.map((g) => (
                  <p key={g.id}>{t.group(partyName(g.name, lang), mio(g.psrBefore), mio(g.psrAfter), g.srReleased > 0.5 ? mio(g.srReleased) : null)}</p>
                ))}
                {note.lapsed > 0 && <p>{t.lapsed(note.lapsed)}</p>}
                {note.groups.length > 0 && note.groups.every((g) => Math.abs(g.psrAfter - g.psrBefore) < 0.05 * g.psrBefore) && <p>{t.steady}</p>}
                {note.step && <p>{t.step(note.step.id, note.step.from, note.step.to, shortDay(note.step.date, lang))}</p>}
              </div>
              <button type="button" className="link" onClick={() => setNote(null)}>
                {t.close}
              </button>
            </div>
          )}
          <div className="heading">
            <h1>{t.headings[tab][0]}</h1>
            <p className="subheading">{t.headings[tab][1]}</p>
          </div>
          {tab === 'simulator' && <Simulator state={state} dispatch={dispatch} />}
          {tab === 'lines' && <Lines state={state} />}
          {tab === 'formulae' && <Formulae />}
          {tab === 'design' && <Design />}
        </main>

        <footer className="footer">
          <span>{t.footer}</span>
          <a href="https://github.com/chanchunyinjohnny/fx-credit-line-simulator">{t.source}</a>
        </footer>
      </div>
    </LangProvider>
  );
}
