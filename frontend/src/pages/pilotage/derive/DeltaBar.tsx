// Barre divergente d'une ligne de la dérive : centrée sur 0, échelle commune (max |Δ| du tableau).
// Hausse = --danger vers la droite, baisse = --accent vers la gauche ; le signe du Δ voisin porte
// la même information sans couleur. La bulle donne les chiffres exacts (aussi présents dans la ligne).
import type { CSSProperties, ReactNode } from 'react';
import { Tooltip } from '../../../ui';

export interface DeltaBarProps {
  delta: number;
  /** Max |Δ| du tableau (> 0), commun à toutes les lignes. */
  scale: number;
  tip: ReactNode;
}

export default function DeltaBar({ delta, scale, tip }: DeltaBarProps) {
  const half = scale > 0 ? Math.min(1, Math.abs(delta) / scale) * 50 : 0;
  // 2 px au moins pour qu'une petite variation reste visible.
  const style: CSSProperties = { width: `max(2px, ${half}%)` };
  return (
    <Tooltip label={tip} placement="top">
      <span className="derive-bar" aria-hidden>
        {Math.abs(delta) >= 0.005 && <span className="derive-bar__fill" data-dir={delta > 0 ? 'up' : 'down'} style={style} />}
      </span>
    </Tooltip>
  );
}
