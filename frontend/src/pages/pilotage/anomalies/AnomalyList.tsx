// Liste maître façon Mail : groupes par catégorie, une ligne compacte par anomalie, navigation clavier.
import { useEffect, useId, useRef, type KeyboardEvent } from 'react';
import { StatusGlyph } from '../../../ui';
import type { Anomalie, AnomalieCategorie } from '../../../api/types';
import { FlagGlyph } from '../../../components/badges';
import { CATEGORIE_LABEL, GRAVITE_GLYPH, GRAVITE_LABEL, subline } from './meta';

/** Glyphe d'une anomalie : flag pour un écart, sinon gravité. */
export function AnomalyGlyph({ a, size }: { a: Anomalie; size?: number }) {
  if (a.categorie === 'ecart' && a.flag) return <FlagGlyph flag={a.flag} size={size} />;
  const g = GRAVITE_GLYPH[a.gravite];
  return <StatusGlyph kind={g.kind} tone={g.tone} size={size} label={`Gravité ${GRAVITE_LABEL[a.gravite].toLowerCase()}`} />;
}

export interface AnomalyGroup {
  categorie: AnomalieCategorie;
  items: Anomalie[];
}

interface Props {
  groups: AnomalyGroup[];
  /** Ordre de navigation (groupes aplatis). */
  flat: Anomalie[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  /** Vue mixte : les anomalies déjà traitées ou ignorées sont estompées. */
  dimDone: boolean;
}

export default function AnomalyList({ groups, flat, selectedKey, onSelect, dimDone }: Props) {
  const baseId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const index = flat.findIndex((a) => a.key === selectedKey);
  const optionId = (i: number) => `${baseId}-o${i}`;

  // L'élément sélectionné reste visible (clavier, sélection suivante après une action).
  useEffect(() => {
    if (index < 0) return;
    document.getElementById(optionId(index))?.scrollIntoView({ block: 'nearest' });
    // optionId dépend seulement de baseId (stable).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey || flat.length === 0) return;
    let next = -1;
    if (e.key === 'ArrowDown') next = Math.min(flat.length - 1, index + 1);
    else if (e.key === 'ArrowUp') next = Math.max(0, index < 0 ? 0 : index - 1);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = flat.length - 1;
    if (next < 0) return;
    e.preventDefault();
    if (next !== index) onSelect(flat[next].key);
  };

  let i = -1;
  return (
    <div
      ref={listRef}
      className="anom-list"
      role="listbox"
      aria-label="Anomalies"
      tabIndex={0}
      aria-activedescendant={index >= 0 ? optionId(index) : undefined}
      onKeyDown={onKeyDown}
    >
      {groups.map((g) => (
        <div key={g.categorie} role="group" aria-labelledby={`${baseId}-${g.categorie}`}>
          <div className="anom-group" id={`${baseId}-${g.categorie}`}>
            <span>{CATEGORIE_LABEL[g.categorie]}</span>
            <span className="anom-group__count">{g.items.length}</span>
          </div>
          {g.items.map((a) => {
            i += 1;
            const selected = a.key === selectedKey;
            return (
              <div
                key={a.key}
                id={optionId(i)}
                role="option"
                aria-selected={selected}
                className="anom-row"
                data-selected={selected || undefined}
                data-done={(dimDone && a.statut !== 'a_traiter') || undefined}
                onClick={() => {
                  listRef.current?.focus({ preventScroll: true });
                  onSelect(a.key);
                }}
              >
                <span className="anom-row__glyph">
                  <AnomalyGlyph a={a} />
                </span>
                <span className="anom-row__body">
                  <span className="anom-row__title">{a.titre}</span>
                  <span className="anom-row__sub">{subline(a)}</span>
                </span>
                {a.suivi?.obsolete && (
                  <span className="anom-row__mark" title="Les chiffres ont changé depuis le traitement">
                    Modifiée
                  </span>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
