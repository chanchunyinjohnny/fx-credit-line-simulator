import { useEffect, useState, type ReactNode } from 'react';

/** A pass, warning or fail state: always an icon and words, never colour alone. */
export function Status({ ok, warn, children }: { ok: boolean; warn?: boolean; children: ReactNode }) {
  return (
    <span className={!ok ? 'status status-bad' : warn ? 'status status-warn' : 'status status-ok'}>
      <span aria-hidden="true">{!ok ? '✕' : warn ? '!' : '✓'}</span> {children}
    </span>
  );
}

/** One line of arithmetic. */
export const Calc = ({ children }: { children: ReactNode }) => <div className="calc">{children}</div>;

/** A number field that can be cleared while typing; reports only valid numbers.
 *  With `blank`, an empty field is a value of its own: zero shows as empty, and clearing the field reports zero. */
export function NumInput(p: { value: number; onChange: (v: number) => void; step?: number; min?: number; label: string; className?: string; blank?: boolean }) {
  const show = (v: number) => (p.blank && v === 0 ? '' : String(v));
  const [text, setText] = useState(show(p.value));
  useEffect(() => {
    setText((t) => (Number(t) === p.value ? t : show(p.value)));
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
      // A value the app adjusted, such as a limit capped by the room left, shows as stored once the field is left.
      onBlur={() => setText(show(p.value))}
      onChange={(e) => {
        setText(e.target.value);
        const v = e.target.valueAsNumber;
        if (Number.isFinite(v)) p.onChange(v);
        else if (p.blank) p.onChange(0);
      }}
    />
  );
}
