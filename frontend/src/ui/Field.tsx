// Champs de saisie : Field, TextInput, NumberInput, Textarea, SearchField, DateInput.
// Les callbacks reçoivent la VALEUR (pas l'événement). Styles dans Field.css.
// Ids : `id` fourni ou useId ; description et erreur reliées au contrôle par aria-describedby.
import { useId, useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { IconCalendar, IconClear, IconSearch } from './Icons';
import { cx, marginStyle, type BaseProps } from './types';
import './Field.css';

export interface FieldChromeProps extends BaseProps {
  /** Libellé 12/500 secondaire au-dessus du champ. */
  label?: ReactNode;
  /** Aide 12 px secondaire sous le champ. */
  description?: ReactNode;
  /** Message d'erreur 12 px rouge (remplace la description, met le champ en erreur). */
  error?: ReactNode;
  required?: boolean;
  disabled?: boolean;
  /** Largeur du champ (px ou CSS) ; défaut 100 % du conteneur. */
  width?: number | string;
  id?: string;
}

export interface FieldProps extends FieldChromeProps {
  /** Le contrôle ; reçoit l'id du libellé via `htmlFor`. */
  children: ReactNode;
}

/** Ids dérivés d'un champ : contrôle, aide, erreur. */
function fieldIds(id: string, description?: ReactNode, error?: ReactNode) {
  const hasError = error != null && error !== false && error !== '';
  const hasDesc = !hasError && description != null && description !== false && description !== '';
  return {
    id,
    descId: `${id}-description`,
    errId: `${id}-error`,
    hasError,
    hasDesc,
    describedBy: hasError ? `${id}-error` : hasDesc ? `${id}-description` : undefined,
  };
}

/** Habillage libellé / description / erreur autour d'un contrôle quelconque. */
export function Field({ label, description, error, required, disabled, width, id, mt, mb, className, style, children }: FieldProps) {
  const autoId = useId();
  const ids = fieldIds(id ?? autoId, description, error);
  return (
    <div
      className={cx('ui-field', className)}
      data-disabled={disabled || undefined}
      style={marginStyle({ mt, mb }, width != null ? { width, ...style } : style)}
    >
      {label != null && label !== false && (
        <label className="ui-field__label" htmlFor={ids.id}>
          {label}
          {required && (
            <span className="ui-field__required" aria-hidden>
              {' '}
              *
            </span>
          )}
        </label>
      )}
      {children}
      {ids.hasError ? (
        <div className="ui-field__error" id={ids.errId}>
          {error}
        </div>
      ) : (
        ids.hasDesc && (
          <div className="ui-field__description" id={ids.descId}>
            {description}
          </div>
        )
      )}
    </div>
  );
}

/** Props de chrome à transmettre à Field depuis un contrôle. */
function chrome(p: FieldChromeProps, id: string): FieldChromeProps {
  return {
    label: p.label,
    description: p.description,
    error: p.error,
    required: p.required,
    disabled: p.disabled,
    width: p.width,
    mt: p.mt,
    mb: p.mb,
    className: p.className,
    style: p.style,
    id,
  };
}

/** Attributs ARIA communs des contrôles habillés. */
function controlAria(p: FieldChromeProps, id: string) {
  const ids = fieldIds(id, p.description, p.error);
  return {
    id,
    'aria-invalid': ids.hasError || undefined,
    'aria-describedby': ids.describedBy,
    'aria-required': p.required || undefined,
  };
}

/** Bouton « effacer » circulaire (cercle plein tertiaire, croix couleur carte). */
function ClearButton({ onClick, label = 'Effacer' }: { onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      className="ui-input__clear"
      aria-label={label}
      title={label}
      tabIndex={-1}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      <IconClear size={14} />
    </button>
  );
}

export interface TextInputProps extends FieldChromeProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: 'text' | 'email' | 'password' | 'url';
  /** Icône à gauche dans le champ. */
  icon?: ReactNode;
  /** Élément à droite dans le champ (ex. bouton). */
  rightSection?: ReactNode;
  autoFocus?: boolean;
  maxLength?: number;
  /** Attribut autocomplete de l'<input> (ex. « off », « email »). */
  autoComplete?: string;
  onBlur?: () => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  'aria-label'?: string;
}

export function TextInput(props: TextInputProps) {
  const { value, onChange, placeholder, type = 'text', icon, rightSection, autoFocus, maxLength, autoComplete, onBlur, onKeyDown, disabled } = props;
  const autoId = useId();
  const id = props.id ?? autoId;
  return (
    <Field {...chrome(props, id)}>
      <div className="ui-input" data-invalid={props.error ? true : undefined} data-disabled={disabled || undefined}>
        {icon && <span className="ui-input__icon">{icon}</span>}
        <input
          {...controlAria(props, id)}
          className="ui-input__control"
          type={type}
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          autoFocus={autoFocus}
          data-autofocus={autoFocus || undefined}
          maxLength={maxLength}
          autoComplete={autoComplete}
          aria-label={props['aria-label']}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          onKeyDown={onKeyDown}
        />
        {rightSection && <span className="ui-input__right">{rightSection}</span>}
      </div>
    </Field>
  );
}

export interface NumberInputProps extends FieldChromeProps {
  /** null = champ vide. */
  value: number | null;
  onChange: (value: number | null) => void;
  min?: number;
  max?: number;
  step?: number;
  /** Unité affichée à droite (ex. « h », « jours », « % »). */
  suffix?: string;
  placeholder?: string;
  /** Focus à l'ouverture (pose aussi data-autofocus, lu par Modal). */
  autoFocus?: boolean;
  'aria-label'?: string;
}

/** Champ numérique sans flèches natives ; la valeur est bornée par min/max à la sortie du champ. */
export function NumberInput(props: NumberInputProps) {
  const { value, onChange, min, max, step, suffix, placeholder, disabled, autoFocus } = props;
  const autoId = useId();
  const id = props.id ?? autoId;
  return (
    <Field {...chrome(props, id)}>
      <div className="ui-input" data-invalid={props.error ? true : undefined} data-disabled={disabled || undefined}>
        <input
          {...controlAria(props, id)}
          className="ui-input__control ui-input__control--number"
          type="number"
          inputMode="decimal"
          value={value ?? ''}
          min={min}
          max={max}
          step={step ?? 'any'}
          placeholder={placeholder}
          disabled={disabled}
          autoFocus={autoFocus}
          data-autofocus={autoFocus || undefined}
          aria-label={props['aria-label']}
          onChange={(e) => {
            const n = e.target.valueAsNumber;
            onChange(e.target.value === '' || Number.isNaN(n) ? null : n);
          }}
          onBlur={() => {
            if (value == null) return;
            if (min != null && value < min) onChange(min);
            else if (max != null && value > max) onChange(max);
          }}
          onWheel={(e) => e.currentTarget.blur()}
        />
        {suffix && (
          <span className="ui-input__suffix" aria-hidden>
            {suffix}
          </span>
        )}
      </div>
    </Field>
  );
}

export interface TextareaProps extends FieldChromeProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Défaut 3. */
  rows?: number;
  autosize?: boolean;
  /** Focus à l'ouverture (pose aussi data-autofocus, lu par Modal). */
  autoFocus?: boolean;
  'aria-label'?: string;
}

/** Zone de texte ; `autosize` ajuste la hauteur au contenu (au moins `rows` lignes). */
export function Textarea(props: TextareaProps) {
  const { value, onChange, placeholder, rows = 3, autosize, disabled, autoFocus } = props;
  const autoId = useId();
  const id = props.id ?? autoId;
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!autosize || !el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [autosize, value]);

  return (
    <Field {...chrome(props, id)}>
      <textarea
        {...controlAria(props, id)}
        ref={ref}
        className="ui-textarea"
        data-invalid={props.error ? true : undefined}
        data-autosize={autosize || undefined}
        value={value}
        rows={rows}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        data-autofocus={autoFocus || undefined}
        aria-label={props['aria-label']}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}

export interface SearchFieldProps extends BaseProps {
  value: string;
  onChange: (value: string) => void;
  /** Défaut « Rechercher ». */
  placeholder?: string;
  /** Défaut 240. */
  width?: number | string;
  autoFocus?: boolean;
  'aria-label'?: string;
}

/** Champ de recherche : loupe + bouton effacer circulaire (§7). Échap efface. */
export function SearchField({ value, onChange, placeholder = 'Rechercher', width = 240, autoFocus, mt, mb, className, style, ...rest }: SearchFieldProps) {
  const ref = useRef<HTMLInputElement>(null);
  const clear = () => {
    onChange('');
    ref.current?.focus();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape' && value) {
      // Le premier Échap efface sans fermer le dialogue ou le menu parent.
      e.preventDefault();
      e.stopPropagation();
      onChange('');
    }
  };
  return (
    <div className={cx('ui-input ui-search', className)} style={marginStyle({ mt, mb }, { width, ...style })}>
      <span className="ui-input__icon">
        <IconSearch size={14} />
      </span>
      <input
        ref={ref}
        className="ui-input__control"
        type="search"
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        data-autofocus={autoFocus || undefined}
        aria-label={rest['aria-label'] ?? placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
      />
      {value && <ClearButton onClick={clear} label="Effacer la recherche" />}
    </div>
  );
}

export interface DateInputProps extends FieldChromeProps {
  /** Date ISO « YYYY-MM-DD », '' = vide. */
  value: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
  clearable?: boolean;
  'aria-label'?: string;
}

/** Sélecteur de date natif (type=date) habillé. */
export function DateInput(props: DateInputProps) {
  const { value, onChange, min, max, clearable, disabled } = props;
  const autoId = useId();
  const id = props.id ?? autoId;
  const ref = useRef<HTMLInputElement>(null);
  return (
    <Field {...chrome(props, id)}>
      <div
        className="ui-input ui-date"
        data-invalid={props.error ? true : undefined}
        data-disabled={disabled || undefined}
        data-empty={!value || undefined}
      >
        <span className="ui-input__icon">
          <IconCalendar size={14} />
        </span>
        <input
          {...controlAria(props, id)}
          ref={ref}
          className="ui-input__control"
          type="date"
          value={value}
          min={min}
          max={max}
          disabled={disabled}
          aria-label={props['aria-label']}
          onChange={(e) => onChange(e.target.value)}
        />
        {clearable && value && !disabled && (
          <ClearButton
            label="Effacer la date"
            onClick={() => {
              onChange('');
              ref.current?.focus();
            }}
          />
        )}
      </div>
    </Field>
  );
}
