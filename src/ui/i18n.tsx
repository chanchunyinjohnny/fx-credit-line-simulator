import { createContext, useContext } from 'react';

/** The interface comes in two complete versions; nothing mixes the two. */
export type Lang = 'en' | 'zh';

const LangContext = createContext<Lang>('en');
export const LangProvider = LangContext.Provider;
export const useLang = () => useContext(LangContext);

const KEY = 'fx-credit-line-simulator/lang';

export function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'en' || saved === 'zh') return saved;
  } catch {
    // Storage unavailable: fall through to the browser's language.
  }
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

export function saveLang(lang: Lang) {
  document.documentElement.lang = lang === 'zh' ? 'zh-Hant' : 'en';
  try {
    localStorage.setItem(KEY, lang);
  } catch {
    // Not kept, but the session still works.
  }
}
