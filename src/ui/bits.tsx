import { useEffect, useState, type ReactNode } from 'react';

/** An English term with its Chinese equivalent beside it. */
export function Term({ en, zh }: { en: string; zh: string }) {
  return (
    <>
      {en} <span className="zh" lang="zh-Hant">{zh}</span>
    </>
  );
}

export function Section(p: { title: string; zh?: string; unit?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={p.className}>
      <div className="section-heading">
        <h2 className="section-title">{p.zh ? <Term en={p.title} zh={p.zh} /> : p.title}</h2>
        {p.unit && <span className="unit">{p.unit}</span>}
      </div>
      {p.children}
    </section>
  );
}

/** A pass or fail state: always an icon and words, never colour alone. */
export function Status({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <span className={ok ? 'status status-ok' : 'status status-bad'}>
      <span aria-hidden="true">{ok ? '✓' : '✕'}</span> {children}
    </span>
  );
}

/** One line of arithmetic. */
export const Calc = ({ children }: { children: ReactNode }) => <div className="calc">{children}</div>;

/** A number field that can be cleared while typing; reports only valid numbers. */
export function NumInput(p: { value: number; onChange: (v: number) => void; step?: number; min?: number; label: string; className?: string }) {
  const [text, setText] = useState(String(p.value));
  useEffect(() => {
    setText((t) => (Number(t) === p.value ? t : String(p.value)));
  }, [p.value]);
  return (
    <input
      type="number"
      inputMode="decimal"
      className={p.className}
      aria-label={p.label}
      value={text}
      step={p.step ?? 'any'}
      min={p.min}
      onChange={(e) => {
        setText(e.target.value);
        const v = e.target.valueAsNumber;
        if (Number.isFinite(v)) p.onChange(v);
      }}
    />
  );
}
