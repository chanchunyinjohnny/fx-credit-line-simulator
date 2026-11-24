import { useEffect, useReducer, useState } from 'react';
import { loadState, reducer, saveState } from './engine/state';
import { Design } from './ui/Design';
import { Formulae } from './ui/Formulae';
import { Simulator } from './ui/Simulator';
import { day } from './ui/format';

const TABS = [
  { id: 'simulator', en: 'Simulator', zh: '模擬' },
  { id: 'formulae', en: 'Formulae', zh: '公式' },
  { id: 'design', en: 'Design', zh: '流程設計' },
] as const;
type TabId = (typeof TABS)[number]['id'];

const HEADINGS: Record<TabId, { title: string; sub: string }> = {
  simulator: { title: 'Does this hedge fit the credit lines?', sub: 'Enter a hedge, pick an LP, send it, then fill or reject it.' },
  formulae: { title: 'How the numbers are worked out', sub: 'The method, and one swap followed step by step.' },
  design: { title: 'From first draft to proposed flow', sub: 'What a review of the hedging flow changed.' },
};

const tabFromHash = (): TabId => TABS.find((t) => `#${t.id}` === window.location.hash)?.id ?? 'simulator';

export function App() {
  const [state, dispatch] = useReducer(reducer, undefined, loadState);
  const [tab, setTab] = useState<TabId>(tabFromHash);
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => saveState(state), [state]);
  useEffect(() => {
    const onHash = () => setTab(tabFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const go = (id: TabId) => {
    window.history.replaceState(null, '', `#${id}`);
    setTab(id);
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="wordmark">Credit Line</span>
          <span className="brand-divider" aria-hidden="true" />
          <span className="brand-suffix">FX HEDGING SIMULATOR</span>
        </div>
        <nav className="tabs" aria-label="Views">
          {TABS.map((t) => (
            <button key={t.id} type="button" aria-pressed={tab === t.id} onClick={() => go(t.id)}>
              {t.en} <span className="zh" lang="zh-Hant">{t.zh}</span>
            </button>
          ))}
        </nav>
        <div className="controls">
          <span className="label">
            Business date <span className="zh" lang="zh-Hant">營業日</span>
          </span>
          <span className="date">{day(state.businessDate)}</span>
          <button type="button" onClick={() => dispatch({ type: 'NEXT_DAY' })}>
            Next day
          </button>
          {confirmReset ? (
            <>
              <span className="label">Clear all hedges and edits?</span>
              <button
                type="button"
                onClick={() => {
                  dispatch({ type: 'RESET' });
                  setConfirmReset(false);
                }}
              >
                Yes, reset
              </button>
              <button type="button" onClick={() => setConfirmReset(false)}>
                Cancel
              </button>
            </>
          ) : (
            <button type="button" onClick={() => setConfirmReset(true)}>
              Reset
            </button>
          )}
        </div>
      </header>

      <main className="main">
        <div className="heading">
          <h1>{HEADINGS[tab].title}</h1>
          <p className="subheading">{HEADINGS[tab].sub}</p>
        </div>
        {tab === 'simulator' && <Simulator state={state} dispatch={dispatch} />}
        {tab === 'formulae' && <Formulae />}
        {tab === 'design' && <Design />}
      </main>

      <footer className="footer">
        <span>Chan Chun Yin Johnny · all data invented · saved in this browser only</span>
        <a href="https://github.com/chanchunyinjohnny/fx-credit-line-simulator">Source</a>
      </footer>
    </div>
  );
}
