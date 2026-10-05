// Pop-up buttons : Select, MultiSelect, TagsInput.
// Bâtis sur le panneau flottant du kit (Floating) ; liste role="listbox" à élément actif
// (aria-activedescendant). Styles dans Select.css.
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { Field, type FieldChromeProps } from './Field';
import { IconCheck, IconChevronDown, IconSearch } from './Icons';
import { Floating } from './Popover';
import { Pill } from './Status';
import { cx, marginStyle, type Option } from './types';
import './Select.css';

interface SelectBase<T extends string> extends FieldChromeProps {
  data: Option<T>[];
  /** Titre du bouton quand rien n'est sélectionné (ex. « Squad », « Tous »). */
  placeholder?: string;
  /** Champ de recherche en tête du menu (auto si > 10 options). */
  searchable?: boolean;
  /** Ligne « Effacer » en pied de menu / bouton effacer. */
  clearable?: boolean;
  /** Texte quand la recherche ne trouve rien. Défaut « Aucun résultat ». */
  nothingFound?: string;
  /** Largeur minimale du menu (défaut 190 ; filtres 290). */
  menuWidth?: number;
  /** Icône avant le titre du bouton. */
  icon?: ReactNode;
  'aria-label'?: string;
}

/** Normalise pour la recherche : minuscules, sans accents. */
function norm(s: string): string {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

// ------------------------------------------------------------------ Liste du menu

interface ListProps<T extends string> {
  data: Option<T>[];
  isSelected: (v: T) => boolean;
  onPick: (v: T) => void;
  searchable: boolean;
  nothingFound: string;
  /** Valeur active à l'ouverture. */
  initial?: T | null;
  multiple?: boolean;
  /** Pied « Effacer » (affiché seulement s'il est fourni). */
  onClear?: () => void;
  /** Tabulation : fermer le menu. */
  onTab: () => void;
  'aria-label'?: string;
}

function SelectList<T extends string>({
  data,
  isSelected,
  onPick,
  searchable,
  nothingFound,
  initial,
  multiple,
  onClear,
  onTab,
  ...aria
}: ListProps<T>) {
  const listId = useId();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState<T | null>(initial ?? null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const visible = useMemo(() => {
    const q = norm(query.trim());
    if (!q) return data;
    return data.filter((o) => norm(o.label).includes(q) || (o.description != null && norm(o.description).includes(q)));
  }, [data, query]);
  const enabled = visible.filter((o) => !o.disabled);
  // Élément actif : celui choisi s'il reste visible, sinon le premier disponible.
  const current = enabled.find((o) => o.value === active) ?? enabled[0];
  const optId = (v: T) => `${listId}-${data.findIndex((o) => o.value === v)}`;

  useLayoutEffect(() => {
    (searchable ? inputRef.current : listRef.current)?.focus({ preventScroll: true });
  }, [searchable]);

  useEffect(() => {
    if (current) document.getElementById(optId(current.value))?.scrollIntoView({ block: 'nearest' });
    // optId ne dépend que de data et de l'id de liste.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.value]);

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    const i = current ? enabled.indexOf(current) : -1;
    const n = enabled.length;
    let next: number | null = null;
    if (e.key === 'ArrowDown') next = n ? (i + 1) % n : null;
    else if (e.key === 'ArrowUp') next = n ? (i - 1 + n) % n : null;
    else if (e.key === 'Home' && !searchable) next = 0;
    else if (e.key === 'End' && !searchable) next = n - 1;
    else if (e.key === 'PageDown') next = Math.min(n - 1, i + 8);
    else if (e.key === 'PageUp') next = Math.max(0, i - 8);
    else if (e.key === 'Enter' || (e.key === ' ' && !searchable)) {
      e.preventDefault();
      if (current) onPick(current.value);
      return;
    } else if (e.key === 'Tab') {
      onTab();
      return;
    }
    if (next == null || next < 0) return;
    e.preventDefault();
    setActive(enabled[next].value);
  };

  // Regroupement des options consécutives de même groupe.
  const sections: { group?: string; options: Option<T>[] }[] = [];
  for (const o of visible) {
    const last = sections[sections.length - 1];
    if (last && last.group === o.group) last.options.push(o);
    else sections.push({ group: o.group, options: [o] });
  }

  const activeId = current ? optId(current.value) : undefined;
  const renderOption = (o: Option<T>) => {
    const selected = isSelected(o.value);
    return (
      <div
        key={o.value}
        id={optId(o.value)}
        role="option"
        aria-selected={selected}
        aria-disabled={o.disabled || undefined}
        className="ui-select__option"
        data-active={o === current || undefined}
        onMouseDown={(e) => e.preventDefault()}
        onMouseMove={() => !o.disabled && o.value !== active && setActive(o.value)}
        onClick={() => !o.disabled && onPick(o.value)}
      >
        <span className="ui-select__text">
          <span className="ui-select__label">{o.label}</span>
          {o.description && <span className="ui-select__description">{o.description}</span>}
        </span>
        <span className="ui-select__check" aria-hidden>
          {selected && <IconCheck size={13} stroke={2.2} />}
        </span>
      </div>
    );
  };

  return (
    <div className="ui-select__menu" onKeyDown={onKeyDown}>
      {searchable && (
        <div className="ui-input ui-select__search">
          <span className="ui-input__icon">
            <IconSearch size={13} />
          </span>
          <input
            ref={inputRef}
            className="ui-input__control"
            type="text"
            role="combobox"
            aria-expanded
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={activeId}
            aria-label="Rechercher"
            placeholder="Rechercher"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      )}
      <div
        ref={listRef}
        id={listId}
        role="listbox"
        aria-label={aria['aria-label']}
        aria-multiselectable={multiple || undefined}
        aria-activedescendant={searchable ? undefined : activeId}
        tabIndex={searchable ? undefined : -1}
        className="ui-select__list"
      >
        {visible.length === 0 && <div className="ui-select__empty">{nothingFound}</div>}
        {sections.map((s, i) =>
          s.group ? (
            <div key={`${s.group}-${i}`} role="group" aria-labelledby={`${listId}-g${i}`}>
              <div id={`${listId}-g${i}`} className="ui-menu__header">
                {s.group}
              </div>
              {s.options.map(renderOption)}
            </div>
          ) : (
            s.options.map(renderOption)
          ),
        )}
      </div>
      {onClear && (
        <>
          <div role="separator" className="ui-menu__separator" />
          <button type="button" className="ui-select__footer" tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={onClear}>
            Effacer
          </button>
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Pop-up button

interface PopupProps<T extends string> extends SelectBase<T> {
  /** Titre affiché (valeur(s) choisie(s)) ; null = placeholder. */
  title: string | null;
  renderList: (close: () => void, onTab: () => void) => ReactNode;
}

/** Bouton + habillage de champ + menu ; partagé par Select et MultiSelect. */
function PopupSelect<T extends string>(p: PopupProps<T>) {
  const { label, description, error, required, disabled, width, mt, mb, className, style, icon, placeholder, title, menuWidth = 190 } = p;
  const autoId = useId();
  const id = p.id ?? autoId;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const hasLabel = label != null && label !== false;
  const hasError = error != null && error !== false && error !== '';
  const hasChrome = hasLabel || hasError || (description != null && description !== false && description !== '');
  const close = () => {
    ref.current?.focus();
    setOpen(false);
  };
  const ariaLabel = p['aria-label'] && title ? `${p['aria-label']} : ${title}` : p['aria-label'];

  const button = (
    <button
      ref={ref}
      id={id}
      type="button"
      className={cx('ui-popup', !hasChrome && className)}
      data-active={title != null || undefined}
      data-full={hasLabel || width != null || undefined}
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-label={ariaLabel}
      aria-invalid={hasError || undefined}
      aria-describedby={hasChrome ? (hasError ? `${id}-error` : `${id}-description`) : undefined}
      aria-required={required || undefined}
      disabled={disabled}
      style={hasChrome ? undefined : marginStyle({ mt, mb }, width != null ? { width, ...style } : style)}
      onClick={() => setOpen((o) => !o)}
      onKeyDown={(e) => {
        if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !open) {
          e.preventDefault();
          setOpen(true);
        }
      }}
    >
      {icon && <span className="ui-popup__icon">{icon}</span>}
      <span className="ui-popup__title" data-placeholder={title == null || undefined}>
        {title ?? placeholder ?? ''}
      </span>
      <IconChevronDown size={12} stroke={2.2} className="ui-popup__chevron" />
    </button>
  );

  return (
    <>
      {hasChrome ? (
        <Field
          id={id}
          label={label}
          description={description}
          error={error}
          required={required}
          disabled={disabled}
          width={width ?? (hasLabel ? undefined : 'fit-content')}
          mt={mt}
          mb={mb}
          className={className}
          style={style}
        >
          {button}
        </Field>
      ) : (
        button
      )}
      {open && (
        <Floating anchorRef={ref} onClose={() => setOpen(false)} minWidth={menuWidth} matchAnchorWidth padding={5}>
          {p.renderList(close, () => setOpen(false))}
        </Floating>
      )}
    </>
  );
}

// ------------------------------------------------------------------ Select

export interface SelectProps<T extends string> extends SelectBase<T> {
  value: T | null;
  onChange: (value: T | null) => void;
}

/**
 * Pop-up button + menu (§7) : quand une valeur est choisie, son libellé remplace le titre et
 * le bouton est teinté bleu (filtre actif). Coche sur l'élément sélectionné.
 */
export function Select<T extends string>(props: SelectProps<T>) {
  const { value, onChange, data, searchable, clearable, nothingFound = 'Aucun résultat' } = props;
  const selected = data.find((o) => o.value === value);
  return (
    <PopupSelect
      {...props}
      title={selected?.label ?? null}
      renderList={(close, onTab) => (
        <SelectList
          data={data}
          aria-label={props['aria-label'] ?? (typeof props.label === 'string' ? props.label : props.placeholder)}
          isSelected={(v) => v === value}
          initial={value}
          searchable={searchable ?? data.length > 10}
          nothingFound={nothingFound}
          onTab={onTab}
          onPick={(v) => {
            close();
            if (v !== value) onChange(v);
          }}
          onClear={
            clearable && value != null
              ? () => {
                  close();
                  onChange(null);
                }
              : undefined
          }
        />
      )}
    />
  );
}

// ------------------------------------------------------------------ MultiSelect

export interface MultiSelectProps<T extends string> extends SelectBase<T> {
  value: T[];
  onChange: (value: T[]) => void;
  /** Titre du bouton avec N valeurs : défaut « <1er libellé> +N-1 ». */
  summarize?: (selected: Option<T>[]) => string;
}

/** Comme Select, menu à coches multiples ; le menu reste ouvert pendant la sélection. */
export function MultiSelect<T extends string>(props: MultiSelectProps<T>) {
  const { value, onChange, data, searchable, clearable, summarize, nothingFound = 'Aucun résultat' } = props;
  const selected = data.filter((o) => value.includes(o.value));
  const title = selected.length
    ? summarize
      ? summarize(selected)
      : selected.length === 1
        ? selected[0].label
        : `${selected[0].label} +${selected.length - 1}`
    : null;
  return (
    <PopupSelect
      {...props}
      title={title}
      renderList={(close, onTab) => (
        <SelectList
          data={data}
          multiple
          aria-label={props['aria-label'] ?? (typeof props.label === 'string' ? props.label : props.placeholder)}
          isSelected={(v) => value.includes(v)}
          initial={value[0] ?? null}
          searchable={searchable ?? data.length > 10}
          nothingFound={nothingFound}
          onTab={onTab}
          onPick={(v) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v])}
          onClear={
            clearable && value.length
              ? () => {
                  close();
                  onChange([]);
                }
              : undefined
          }
        />
      )}
    />
  );
}

// ------------------------------------------------------------------ TagsInput

export interface TagsInputProps extends FieldChromeProps {
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  /** Séparateurs qui valident la saisie (Entrée valide toujours). Défaut [',']. */
  splitChars?: string[];
  /** Filtre/normalise les valeurs saisies ; renvoie null pour rejeter. */
  parse?: (raw: string) => string | null;
  /** Afficher les valeurs en pastilles supprimables (défaut true). */
  showTags?: boolean;
  'aria-label'?: string;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Saisie de valeurs multiples (pastilles supprimables + champ). */
export function TagsInput(props: TagsInputProps) {
  const { value, onChange, placeholder, splitChars = [','], parse, showTags = true, disabled, error } = props;
  const autoId = useId();
  const id = props.id ?? autoId;
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const splitter = useMemo(() => new RegExp(`[${splitChars.map(escapeRe).join('')}\\n\\r\\t]`), [splitChars]);
  const hasError = error != null && error !== false && error !== '';
  const hasDesc = !hasError && props.description != null && props.description !== false && props.description !== '';

  /** Ajoute les morceaux valides ; renvoie ceux rejetés par `parse`. */
  const commit = (parts: string[]): string[] => {
    const next = [...value];
    const rejected: string[] = [];
    for (const raw of parts) {
      const t = raw.trim();
      if (!t) continue;
      const v = parse ? parse(t) : t;
      if (v == null) rejected.push(t);
      else if (!next.includes(v)) next.push(v);
    }
    if (next.length !== value.length) onChange(next);
    return rejected;
  };

  const onInput = (raw: string) => {
    if (!splitter.test(raw)) {
      setText(raw);
      return;
    }
    // Un séparateur saisi valide tout ce qui le précède ; le reste demeure dans le champ.
    const parts = raw.split(splitter);
    const rest = parts.pop() ?? '';
    const rejected = commit(parts);
    setText(rejected.length ? [...rejected, rest].join(splitChars[0] ?? ',') : rest);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (text.trim()) setText(commit([text]).join(splitChars[0] ?? ','));
    } else if (e.key === 'Backspace' && !text && value.length && !e.currentTarget.selectionStart) {
      onChange(value.slice(0, -1));
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData.getData('text');
    if (!splitter.test(pasted)) return;
    e.preventDefault();
    const rejected = commit((text + pasted).split(splitter));
    setText(rejected.join(splitChars[0] ?? ','));
  };

  return (
    <Field
      id={id}
      label={props.label}
      description={props.description}
      error={error}
      required={props.required}
      disabled={disabled}
      width={props.width}
      mt={props.mt}
      mb={props.mb}
      className={props.className}
      style={props.style}
    >
      <div
        className="ui-input ui-tags"
        data-invalid={hasError || undefined}
        data-disabled={disabled || undefined}
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) {
            e.preventDefault();
            inputRef.current?.focus();
          }
        }}
      >
        {showTags &&
          value.map((v) => (
            <Pill key={v} onRemove={disabled ? undefined : () => onChange(value.filter((x) => x !== v))}>
              {v}
            </Pill>
          ))}
        <input
          ref={inputRef}
          id={id}
          className="ui-input__control ui-tags__control"
          value={text}
          placeholder={value.length && showTags ? undefined : placeholder}
          disabled={disabled}
          aria-label={props['aria-label']}
          aria-invalid={hasError || undefined}
          aria-describedby={hasError ? `${id}-error` : hasDesc ? `${id}-description` : undefined}
          onChange={(e) => onInput(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onBlur={() => {
            if (text.trim()) setText(commit([text]).join(splitChars[0] ?? ','));
          }}
        />
      </div>
    </Field>
  );
}
