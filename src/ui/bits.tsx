import { useEffect, useState, type ReactNode } from 'react';

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
