// Répartition de l'atterrissage (page Budget, DECISIONS n° 30) : main-d'œuvre cumulée (consommé + plan de charge
// restant), provisions sécurisées et provisions à risque (aléas), en € sur le périmètre des enveloppes.
// Suit le filtre d'année (DECISIONS n° 24) : lue sur la prévision globale de l'année choisie.
// Survol d'une part ou de sa ligne de légende : la part ressort et le centre de l'anneau donne son montant (pas de
// bulle flottante) ; aucune réaction au clic.
import { useState } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts';
import { Card } from '../../../ui';
import type { PrevisionCT } from '../../../api/types';
import { fmtEur, fmtPct } from '../../../lib/format';
import { enAnnee, fmtEurShort, useTokenColors } from '../shared/pilotage';
import './budget.css';

const TOKENS = ['--budget-mo', '--budget-prov-secured', '--budget-prov-risk', '--card'] as const;

type PartKey = 'mo' | 'securisees' | 'aleas';

interface Part {
  key: PartKey;
  label: string;
  hint: string;
  token: (typeof TOKENS)[number];
  eur: number;
}

const pct = (v: number, total: number) => (total > 0 ? (v / total) * 100 : 0);

/** Parts de l'atterrissage : MO = consommé + plan de charge restant ; MO + sécurisées = atterrissage sécurisé (n° 23). */
function partsOf(g: PrevisionCT): Part[] {
  return [
    {
      key: 'mo',
      label: 'Main-d’œuvre',
      hint: 'consommé + plan de charge restant',
      token: '--budget-mo',
      eur: Math.max(0, g.consomme + g.reste_a_faire),
    },
    {
      key: 'securisees',
      label: 'Provisions sécurisées',
      hint: 'dans l’atterrissage',
      token: '--budget-prov-secured',
      eur: Math.max(0, g.provisions_securisees ?? 0),
    },
    {
      key: 'aleas',
      label: 'Provisions à risque',
      hint: 'provisions pour aléas, hors atterrissage',
      token: '--budget-prov-risk',
      eur: Math.max(0, g.provisions_aleas ?? 0),
    },
  ];
}

export default function RepartitionDonut({ g, annee }: { g: PrevisionCT; annee: number }) {
  const colors = useTokenColors(TOKENS);
  const [hover, setHover] = useState<PartKey | null>(null);
  const parts = partsOf(g);
  const total = parts.reduce((s, p) => s + p.eur, 0);
  if (total <= 0) return null;
  const slices = parts.filter((p) => p.eur > 0);
  const [mo, sec, aleas] = parts;
  const summary = parts.map((p) => `${p.label} ${fmtEur(p.eur)}`).join(', ');
  const shown = parts.find((p) => p.key === hover && p.eur > 0) ?? null;
  const dimmed = (k: PartKey) => shown != null && shown.key !== k;

  return (
    <Card>
      <div className="pil-card-head">
        <h2 className="pil-card-head__title">Répartition de l’atterrissage{enAnnee(annee)}</h2>
      </div>
      <p className="pil-card-head__sub">
        Atterrissage sécurisé {fmtEur(mo.eur + sec.eur)} · provisions à risque {fmtEur(aleas.eur)}
      </p>
      <div className="budget-repartition">
        <div className="budget-repartition__donut" role="img" aria-label={`Répartition de l’atterrissage : ${summary}`}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={slices}
                dataKey="eur"
                nameKey="key"
                innerRadius="64%"
                outerRadius="100%"
                startAngle={90}
                endAngle={-270}
                stroke={colors['--card']}
                strokeWidth={2}
                isAnimationActive={false}
                rootTabIndex={-1}
                onMouseEnter={(_: unknown, i: number) => setHover(slices[i]?.key ?? null)}
                onMouseLeave={() => setHover(null)}
              >
                {slices.map((s) => (
                  <Cell key={s.key} fill={colors[s.token]} fillOpacity={dimmed(s.key) ? 0.3 : 1} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <div className="budget-repartition__total" aria-hidden>
            {shown ? (
              <>
                <span className="budget-repartition__total-value">{fmtEurShort(shown.eur)}</span>
                <span className="budget-repartition__total-label">
                  {shown.label} · {fmtPct(pct(shown.eur, total))}
                </span>
              </>
            ) : (
              <>
                <span className="budget-repartition__total-value">{fmtEurShort(total)}</span>
                <span className="budget-repartition__total-label">au total</span>
              </>
            )}
          </div>
        </div>
        <ul className="budget-repartition__legend">
          {parts.map((p) => (
            <li
              key={p.key}
              className="budget-repartition__item"
              data-active={shown?.key === p.key || undefined}
              data-dimmed={dimmed(p.key) || undefined}
              onMouseEnter={() => setHover(p.key)}
              onMouseLeave={() => setHover(null)}
            >
              <span className="budget-repartition__dot" data-kind={p.key} aria-hidden />
              <span className="budget-repartition__item-label">
                {p.label}
                <span className="budget-repartition__item-hint">{p.hint}</span>
              </span>
              <span className="budget-repartition__item-value">{fmtEur(p.eur)}</span>
              <span className="budget-repartition__item-pct">{fmtPct(pct(p.eur, total))}</span>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}
