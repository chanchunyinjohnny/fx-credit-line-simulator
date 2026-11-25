import { mio } from './format';
import { useLang } from './i18n';

const T = {
  en: {
    names: ['In use', 'Reserved', 'This hedge'],
    label: (k: string, a: string, l: string, over: boolean) => `${k}: ${a} of ${l} USD mio${over ? ', over the line' : ''}`,
  },
  zh: {
    names: ['已用', '預佔', '本筆'],
    label: (k: string, a: string, l: string, over: boolean) => `${k}：${a} / ${l} 百萬美元${over ? '，超出額度' : ''}`,
  },
};
const SEGMENTS = ['seg-used', 'seg-reserved', 'seg-hedge'] as const;

/** One credit line as a bar: filled hedges, reservations and, when given, the hedge on the ticket. */
export function LineBar(p: { label: string; line: number; parts: number[]; total: number; ok: boolean; dense?: boolean }) {
  const t = T[useLang()];
  const parts = p.parts.map((v, i) => ({ v, cls: SEGMENTS[i], name: t.names[i] })).filter((x) => x.v > 0.5);
  const total = Math.max(p.total, 0);
  const sum = parts.reduce((s, x) => s + x.v, 0);
  // Netting can make a part negative; the bar then shows the true total.
  const scale = sum > 0 ? total / sum : 0;
  const full = Math.max(p.line, total);
  return (
    <div className={`bar${p.dense ? ' bar-dense' : ''}${p.ok ? '' : ' bar-over'}`} role="img" aria-label={t.label(p.label, mio(total), mio(p.line), !p.ok)}>
      {full > 0 && parts.map((x) => <span key={x.cls} className={`seg ${x.cls}`} style={{ width: `${((x.v * scale) / full) * 100}%` }} title={`${x.name}: ${mio(x.v)}`} />)}
    </div>
  );
}

export function BarLegend({ withHedge }: { withHedge?: boolean }) {
  const t = T[useLang()];
  return (
    <ul className="legend">
      {t.names.slice(0, withHedge ? 3 : 2).map((name, i) => (
        <li key={name}>
          <span className={`seg ${SEGMENTS[i]}`} /> {name}
        </li>
      ))}
    </ul>
  );
}
