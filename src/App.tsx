import { useEffect, useReducer, useState } from 'react';
import { rollSummary, type RollSummary } from './engine/roll';
import { loadState, reducer, saveState } from './engine/state';
import { Design } from './ui/Design';
import { Formulae } from './ui/Formulae';
import { day, mio, partyName } from './ui/format';
import { LangProvider, initialLang, saveLang, type Lang } from './ui/i18n';
import { Simulator } from './ui/Simulator';

const TAB_IDS = ['simulator', 'formulae', 'design'] as const;
type TabId = (typeof TAB_IDS)[number];

const T = {
  en: {
    docTitle: 'FX Credit Line Simulator',
    suffix: 'FX HEDGING SIMULATOR',
    tabs: { simulator: 'Simulator', formulae: 'Formulae', design: 'Design' },
    headings: {
      simulator: ['Does this hedge fit the credit lines?', 'Enter a hedge, pick an LP, send it, then fill or reject it.'],
      formulae: ['How the numbers are worked out', 'The method, and one swap followed step by step.'],
      design: ['From first draft to proposed flow', 'What a review of the hedging flow changed.'],
    },
    date: 'Business date',
    next: 'Next day',
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
    footer: 'Chan Chun Yin Johnny · all data invented · saved in this browser only',
    source: 'Source',
  },
  zh: {
    docTitle: '外匯對沖授信額度模擬',
    suffix: '外匯對沖額度模擬',
    tabs: { simulator: '模擬', formulae: '公式', design: '流程設計' },
    headings: {
      simulator: ['這筆對沖放得進授信額度嗎？', '輸入一筆對沖，選 LP，送出，再選成交或拒絕。'],
      formulae: ['數字是怎樣算出來的', '計算方法，加一筆掉期的逐步演算。'],
      design: ['從初稿到建議流程', '檢視對沖流程後改了什麼。'],
    },
    date: '營業日',
    next: '下一營業日',
    reset: '重設',
    confirm: '清除所有對沖和修改？',
    yes: '確定重設',
    cancel: '取消',
    close: '關閉',
    now: (d: string) => `現在是 ${d}。`,
    nothing: '沒有未到期的對沖，所以沒有變化。先送出並成交一筆對沖；之後每過一日，系統會重估這筆對沖，並釋放已交收款項的結算風險。',
    group: (g: string, b: string, a: string, sr: string | null) => `${g}：交割前風險 ${b} → ${a} 百萬美元${sr ? `；款項已交收，釋放結算風險 ${sr}` : ''}。`,
    lapsed: (n: number) => `${n} 筆在途對沖已失效，預佔額度已釋放。`,
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
  const [note, setNote] = useState<RollSummary | null>(null); // what the last "next day" changed
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
  const nextDay = () => {
    setNote(rollSummary(state, reducer(state, { type: 'NEXT_DAY' })));
    dispatch({ type: 'NEXT_DAY' });
  };

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
            <button type="button" onClick={nextDay}>
              {t.next}
            </button>
            {confirmReset ? (
              <>
                <span className="label">{t.confirm}</span>
                <button
                  type="button"
                  onClick={() => {
                    dispatch({ type: 'RESET' });
                    setNote(null);
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
