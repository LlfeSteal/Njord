// Synthèse des imputations (page Écarts) : répartition des heures par flag en anneau, et nombre de
// personnes planifiées n'ayant rien imputé sur la période. Suit les filtres de la page, hors filtre flag.
// Pied facultatif : heures imputées hors couverture du plan (non analysées, DECISIONS n° 13).
import type { ReactNode } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip as RTooltip } from 'recharts';
import { Card, Metric } from '../../../ui';
import type { Flag } from '../../../api/types';
import { FLAG_META, FlagGlyph } from '../../../components/badges';
import { fmtHours, fmtPct } from '../../../lib/format';
import { useTokenColors } from '../shared/pilotage';
import type { Synthese, SyntheseFlag } from './model';

const TOKENS = ['--flag-hors-plan', '--flag-sur-imputation', '--flag-sous-imputation', '--flag-conforme', '--card'] as const;
const tokenOf = (f: SyntheseFlag) => `--flag-${f.replace('_', '-')}` as (typeof TOKENS)[number];

/** Libellé de la part : ce que mesurent les heures de chaque flag. */
const PART_HINT: Record<SyntheseFlag, string> = {
  hors_plan: 'heures réelles hors plan',
  sur_imputation: 'heures au-delà du prévu',
  sous_imputation: 'heures manquantes',
  conforme: 'heures réelles conformes',
};

const pct = (v: number, total: number) => (total > 0 ? (v / total) * 100 : 0);

interface Datum {
  flag: SyntheseFlag;
  heures: number;
}

function PartTooltip({ active, payload, total }: { active?: boolean; payload?: readonly { payload?: unknown }[]; total: number }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload as Datum;
  return (
    <div className="pil-tooltip">
      <div className="pil-tooltip__title">{FLAG_META[d.flag].label}</div>
      <div className="pil-tooltip__row">
        <FlagGlyph flag={d.flag} size={12} />
        {PART_HINT[d.flag]}
        <span className="pil-tooltip__value">
          {fmtHours(d.heures)} · {fmtPct(pct(d.heures, total))}
        </span>
      </div>
    </div>
  );
}

export default function SyntheseImputations({
  data,
  selected,
  onSelect,
  footer,
}: {
  data: Synthese;
  /** Mention sous la synthèse (ex. heures non couvertes par le plan) ; rien si vide. */
  footer?: ReactNode;
  /** Flags filtrés sur la page : les autres parts sont estompées. */
  selected: Flag[];
  onSelect: (flag: Flag) => void;
}) {
  const colors = useTokenColors(TOKENS);
  const slices = data.parts.filter((p) => p.heures > 0);
  const dimmed = (f: Flag) => selected.length > 0 && !selected.includes(f);
  const summary = data.parts.map((p) => `${FLAG_META[p.flag].label} ${fmtHours(p.heures)}`).join(', ');

  return (
    <Card className="ecarts-synthese">
      <div className="pil-card-head">
        <h2 className="pil-card-head__title">Synthèse des imputations</h2>
      </div>
      <div className="ecarts-synthese__body">
        <div className="ecarts-synthese__chart">
          {data.total > 0 ? (
            <div className="ecarts-synthese__donut" role="img" aria-label={`Répartition des heures : ${summary}`}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={slices}
                    dataKey="heures"
                    nameKey="flag"
                    innerRadius="64%"
                    outerRadius="100%"
                    startAngle={90}
                    endAngle={-270}
                    stroke={colors['--card']}
                    strokeWidth={2}
                    isAnimationActive={false}
                    onClick={(d: Datum) => onSelect(d.flag)}
                    cursor="pointer"
                  >
                    {slices.map((s) => (
                      <Cell key={s.flag} fill={colors[tokenOf(s.flag)]} fillOpacity={dimmed(s.flag) ? 0.3 : 1} />
                    ))}
                  </Pie>
                  <RTooltip content={<PartTooltip total={data.total} />} isAnimationActive={false} />
                </PieChart>
              </ResponsiveContainer>
              <div className="ecarts-synthese__total" aria-hidden>
                <span className="ecarts-synthese__total-value">{fmtHours(data.total)}</span>
                <span className="ecarts-synthese__total-label">au total</span>
              </div>
            </div>
          ) : (
            <p className="pil-card-head__sub">Aucune heure imputée sur la période.</p>
          )}
          <ul className="ecarts-synthese__legend">
            {data.parts.map((p) => (
              <li key={p.flag}>
                <button
                  type="button"
                  className="ecarts-synthese__item"
                  data-dimmed={dimmed(p.flag) || undefined}
                  aria-pressed={selected.length === 1 && selected[0] === p.flag}
                  title={`Filtrer : ${FLAG_META[p.flag].label}`}
                  onClick={() => onSelect(p.flag)}
                >
                  <FlagGlyph flag={p.flag} size={12} />
                  <span className="ecarts-synthese__item-label">
                    {FLAG_META[p.flag].label}
                    <span className="ecarts-synthese__item-hint">{PART_HINT[p.flag]}</span>
                  </span>
                  <span className="ecarts-synthese__item-value">{fmtHours(p.heures)}</span>
                  <span className="ecarts-synthese__item-pct">{fmtPct(pct(p.heures, data.total))}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
        <button
          type="button"
          className="ecarts-synthese__absents"
          aria-pressed={selected.length === 1 && selected[0] === 'absence'}
          title="Filtrer : Absence totale"
          onClick={() => onSelect('absence')}
        >
          <Metric
            label="Jamais imputé"
            glyph={{ kind: FLAG_META.absence.glyph, tone: 'absence' }}
            value={`${data.jamaisImputes} ${data.jamaisImputes > 1 ? 'personnes' : 'personne'}`}
            sub={`sur ${data.planifiees} planifiée${data.planifiees > 1 ? 's' : ''} · aucune heure sur la période`}
          />
        </button>
      </div>
      {footer && <div className="ecarts-synthese__foot">{footer}</div>}
    </Card>
  );
}
