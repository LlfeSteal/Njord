// Cases et interrupteurs : Checkbox, Switch, SegmentedControl, ToggleGroup.
// Contrôles natifs (input) habillés, ou role="radio" avec tabindex mobile. Styles dans Choice.css.
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { IconCheck } from './Icons';
import { Pill } from './Status';
import { cx, marginStyle, type BaseProps, type Option } from './types';
import './Choice.css';

export interface CheckboxProps extends BaseProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: ReactNode;
  description?: ReactNode;
  indeterminate?: boolean;
  disabled?: boolean;
  'aria-label'?: string;
}

/** Case 16 px, rayon 5 ; cochée = bleu + coche blanche ; état mixte = tiret. */
export function Checkbox({ checked, onChange, label, description, indeterminate, disabled, mt, mb, className, style, ...rest }: CheckboxProps) {
  const ref = useRef<HTMLInputElement>(null);
  const descId = useId();
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = !!indeterminate;
  }, [indeterminate]);
  return (
    <label
      className={cx('ui-check', className)}
      data-disabled={disabled || undefined}
      data-bare={label == null || undefined}
      style={marginStyle({ mt, mb }, style)}
    >
      <span className="ui-check__box">
        <input
          ref={ref}
          className="ui-check__input"
          type="checkbox"
          checked={checked}
          disabled={disabled}
          aria-label={rest['aria-label']}
          aria-describedby={description ? descId : undefined}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="ui-check__mark" aria-hidden>
          {indeterminate ? <span className="ui-check__dash" /> : <IconCheck size={12} stroke={3} />}
        </span>
      </span>
      {(label != null || description != null) && (
        <span className="ui-choice__text">
          {label != null && <span className="ui-choice__label">{label}</span>}
          {description != null && (
            <span className="ui-choice__description" id={descId}>
              {description}
            </span>
          )}
        </span>
      )}
    </label>
  );
}

export interface SwitchProps extends BaseProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Libellé à droite de l'interrupteur. */
  label?: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  'aria-label'?: string;
}

/** Interrupteur HIG 38 × 22 (vert quand actif), role="switch". */
export function Switch({ checked, onChange, label, description, disabled, mt, mb, className, style, ...rest }: SwitchProps) {
  const descId = useId();
  return (
    <label className={cx('ui-switch', className)} data-disabled={disabled || undefined} style={marginStyle({ mt, mb }, style)}>
      <input
        className="ui-switch__input"
        type="checkbox"
        role="switch"
        checked={checked}
        aria-checked={checked}
        disabled={disabled}
        aria-label={rest['aria-label']}
        aria-describedby={description ? descId : undefined}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="ui-switch__track" aria-hidden>
        <span className="ui-switch__knob" />
      </span>
      {(label != null || description != null) && (
        <span className="ui-choice__text">
          {label != null && <span className="ui-choice__label">{label}</span>}
          {description != null && (
            <span className="ui-choice__description" id={descId}>
              {description}
            </span>
          )}
        </span>
      )}
    </label>
  );
}

export interface SegmentOption<T extends string = string> extends Option<T> {
  /** Icône avant le libellé. */
  icon?: ReactNode;
  /** Compteur après le libellé (rendu en Pill). */
  count?: number;
}

export interface SegmentedControlProps<T extends string> extends BaseProps {
  value: T;
  onChange: (value: T) => void;
  data: SegmentOption<T>[];
  /** Obligatoire : nom du groupe (radiogroup). */
  'aria-label': string;
  /** Segments de largeur égale (défaut true) ; false = largeur au contenu. */
  equal?: boolean;
  /** md 24 px (défaut) · lg 28 px (navigation principale). */
  size?: 'md' | 'lg';
  fullWidth?: boolean;
}

/** Contenu d'un segment : icône, libellé, compteur. */
function SegmentContent({ o }: { o: SegmentOption }) {
  return (
    <>
      {o.icon}
      <span className="ui-seg__label">{o.label}</span>
      {o.count != null && <Pill>{o.count}</Pill>}
    </>
  );
}

/** Contrôle segmenté à curseur glissant (§7) : navigation, sous-onglets, choix exclusifs. */
export function SegmentedControl<T extends string>({
  value,
  onChange,
  data,
  equal = true,
  size = 'md',
  fullWidth,
  mt,
  mb,
  className,
  style,
  ...rest
}: SegmentedControlProps<T>) {
  const shellRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const index = data.findIndex((o) => o.value === value);
  // Largeurs libres : position et largeur du curseur mesurées sur le segment actif.
  const [measure, setMeasure] = useState<{ left: number; width: number } | null>(null);
  const [animate, setAnimate] = useState(false);

  useLayoutEffect(() => {
    if (equal) return;
    const shell = shellRef.current;
    if (!shell) return;
    const update = () => {
      const el = itemRefs.current[index];
      setMeasure(el ? { left: el.offsetLeft, width: el.offsetWidth } : null);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(shell);
    itemRefs.current.forEach((el) => el && ro.observe(el));
    return () => ro.disconnect();
  }, [equal, index, data.length]);

  // Pas d'animation au premier placement (le curseur ne doit pas glisser depuis la gauche).
  useEffect(() => {
    if (equal || measure == null || animate) return;
    const raf = requestAnimationFrame(() => setAnimate(true));
    return () => cancelAnimationFrame(raf);
  }, [equal, measure, animate]);

  const move = (from: number, dir: 1 | -1 | 'first' | 'last') => {
    const n = data.length;
    const enabled = (i: number) => !data[i]?.disabled;
    let i = from;
    if (dir === 'first' || dir === 'last') {
      i = dir === 'first' ? 0 : n - 1;
      const step = dir === 'first' ? 1 : -1;
      while (i >= 0 && i < n && !enabled(i)) i += step;
    } else {
      for (let k = 0; k < n; k++) {
        i = (i + dir + n) % n;
        if (enabled(i)) break;
      }
    }
    if (i < 0 || i >= n || !enabled(i)) return;
    onChange(data[i].value);
    itemRefs.current[i]?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const from = index < 0 ? 0 : index;
    const keys: Record<string, 1 | -1 | 'first' | 'last'> = {
      ArrowRight: 1,
      ArrowDown: 1,
      ArrowLeft: -1,
      ArrowUp: -1,
      Home: 'first',
      End: 'last',
    };
    const dir = keys[e.key];
    if (dir == null) return;
    e.preventDefault();
    move(from, dir);
  };

  let thumb: CSSProperties | undefined;
  if (index >= 0) {
    thumb = equal
      ? { width: `calc((100% - 4px) / ${data.length})`, transform: `translateX(${index * 100}%)` }
      : measure
        ? { left: 0, width: measure.width, transform: `translateX(${measure.left}px)` }
        : undefined;
  }
  // Tabindex mobile : le segment actif (ou le premier) est le seul arrêt de tabulation.
  const tabStop = index >= 0 ? index : Math.max(0, data.findIndex((o) => !o.disabled));

  return (
    <div
      ref={shellRef}
      role="radiogroup"
      aria-label={rest['aria-label']}
      className={cx('ui-seg', className)}
      data-equal={equal || undefined}
      data-size={size}
      data-full={fullWidth || undefined}
      data-animate={equal || animate || undefined}
      style={marginStyle({ mt, mb }, style)}
      onKeyDown={onKeyDown}
    >
      {thumb && <span className="ui-seg__thumb" style={thumb} aria-hidden />}
      {data.map((o, i) => (
        <button
          key={o.value}
          ref={(el) => {
            itemRefs.current[i] = el;
          }}
          type="button"
          role="radio"
          className="ui-seg__item"
          aria-checked={i === index}
          disabled={o.disabled}
          tabIndex={i === tabStop ? 0 : -1}
          title={o.description}
          onClick={() => onChange(o.value)}
        >
          <SegmentContent o={o} />
        </button>
      ))}
    </div>
  );
}

export interface ToggleGroupProps<T extends string> extends BaseProps {
  /** Valeurs actives. */
  value: T[];
  onChange: (value: T[]) => void;
  data: SegmentOption<T>[];
  'aria-label': string;
}

/** Groupe de bascules indépendantes (aria-pressed), même coque que le contrôle segmenté. */
export function ToggleGroup<T extends string>({ value, onChange, data, mt, mb, className, style, ...rest }: ToggleGroupProps<T>) {
  return (
    <div role="group" aria-label={rest['aria-label']} className={cx('ui-seg ui-toggles', className)} style={marginStyle({ mt, mb }, style)}>
      {data.map((o) => {
        const on = value.includes(o.value);
        return (
          <button
            key={o.value}
            type="button"
            className="ui-seg__item"
            aria-pressed={on}
            disabled={o.disabled}
            title={o.description}
            onClick={() => onChange(on ? value.filter((v) => v !== o.value) : [...value, o.value])}
          >
            <SegmentContent o={o} />
          </button>
        );
      })}
    </div>
  );
}
