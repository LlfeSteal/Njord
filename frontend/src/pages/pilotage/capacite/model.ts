// Page Capacité : agrégation des écarts de l'analyse courante par squad et par semaine (DECISIONS n° 11).
// Calcul pur, sans appel API : Σ prévu = capacité planifiée, Σ réel (hors plan compris), utilisation = réel ÷ prévu.
// Semaine non couverte par le plan de charge (DECISIONS n° 13) : pas d'écart, cellule « non couvert ».
import type { EcartRow, Squad, WeekInfo } from '../../../api/types';

/** Libellé de la ligne des écarts sans squad. */
export const SANS_SQUAD = 'Sans squad';

export interface CapaciteCell {
  prevu: number;
  reel: number;
  /** Réel des tuples hors plan (inclus dans `reel`). */
  horsPlan: number;
  /** Réel ÷ prévu en % ; null si rien n'est prévu. */
  utilisation: number | null;
  /** Semaine couverte par aucune version du plan (jamais vrai pour un total de période). */
  nonCouvert?: boolean;
}

export interface CapaciteRow extends CapaciteCell {
  /** Id du squad ; null = « Sans squad ». */
  id: string | null;
  nom: string;
  /** Profondeur dans la hiérarchie (0 = racine). */
  depth: number;
  /** Personnes distinctes (ressources ayant une fiche). */
  personnes: number;
  /** Une cellule par semaine de la période, dans l'ordre de `meta.weeks`. */
  weeks: CapaciteCell[];
}

export interface Capacite {
  rows: CapaciteRow[];
  /** Total de la période (chaque écart compté une fois, pas la somme des lignes). */
  total: CapaciteRow;
}

/** Sommes en cours d'agrégation. */
interface Acc {
  prevu: number;
  reel: number;
  horsPlan: number;
  personnes: Set<string>;
  weeks: { prevu: number; reel: number; horsPlan: number }[];
}

const round2 = (v: number) => Math.round(v * 100) / 100;

const newAcc = (n: number): Acc => ({
  prevu: 0,
  reel: 0,
  horsPlan: 0,
  personnes: new Set(),
  weeks: Array.from({ length: n }, () => ({ prevu: 0, reel: 0, horsPlan: 0 })),
});

function add(acc: Acc, e: EcartRow, wi: number | undefined) {
  const hp = e.flag === 'hors_plan' ? e.reel : 0;
  acc.prevu += e.prevu;
  acc.reel += e.reel;
  acc.horsPlan += hp;
  if (e.personne_id) acc.personnes.add(e.personne_id);
  if (wi == null) return;
  const w = acc.weeks[wi];
  w.prevu += e.prevu;
  w.reel += e.reel;
  w.horsPlan += hp;
}

function cell(prevu: number, reel: number, horsPlan: number): CapaciteCell {
  const p = round2(prevu);
  const r = round2(reel);
  return { prevu: p, reel: r, horsPlan: round2(horsPlan), utilisation: p > 0 ? (r / p) * 100 : null };
}

function toRow(acc: Acc, id: string | null, nom: string, depth: number, uncovered: boolean[]): CapaciteRow {
  return {
    ...cell(acc.prevu, acc.reel, acc.horsPlan),
    id,
    nom,
    depth,
    personnes: acc.personnes.size,
    weeks: acc.weeks.map((w, i) => {
      const c = cell(w.prevu, w.reel, w.horsPlan);
      return uncovered[i] ? { ...c, nonCouvert: true } : c;
    }),
  };
}

const byName = (a: string, b: string) => a.localeCompare(b, 'fr', { numeric: true, sensitivity: 'base' });

/** Lignes prises en compte : celles des KPI (inactifs exclus sauf `include_inactive`). */
export const capaciteRows = (ecarts: EcartRow[], includeInactive: boolean) =>
  ecarts.filter((e) => !e.inactive || includeInactive);

/**
 * Capacité par squad (le plus interne de l'écart) et par semaine. Un parent agrège ses propres écarts
 * et ceux de tous ses descendants ; seuls les squads ayant des écarts (eux ou leurs descendants) sont listés,
 * parents par nom puis leurs enfants par nom (indentés), « Sans squad » en dernier.
 * `squads` = référentiel (pour la parenté) ; un squad absent du référentiel est traité comme une racine.
 * `weeks` = semaines de la période (`meta.weeks`) ; `couverture === 'aucune'` → cellules `nonCouvert`.
 */
export function capacite(rows: EcartRow[], weeks: Pick<WeekInfo, 'week' | 'couverture'>[], squads: Squad[]): Capacite {
  const n = weeks.length;
  const weekIndex = new Map(weeks.map((w, i) => [w.week, i]));
  const uncovered = weeks.map((w) => w.couverture === 'aucune');
  const byId = new Map(squads.map((s) => [s.id, s]));
  const names = new Map<string, string>();
  const accs = new Map<string, Acc>();
  const sans = newAcc(n);
  const total = newAcc(n);
  let hasSans = false;

  // Chaîne « squad puis ses ancêtres », robuste aux cycles et aux parents inconnus.
  const lineage = (id: string) => {
    const out: string[] = [];
    for (let cur: string | null = id; cur && !out.includes(cur); cur = byId.get(cur)?.parent_id ?? null) out.push(cur);
    return out;
  };

  for (const e of rows) {
    const wi = weekIndex.get(e.semaine);
    add(total, e, wi);
    if (!e.squad_id) {
      hasSans = true;
      add(sans, e, wi);
      continue;
    }
    if (!names.has(e.squad_id)) names.set(e.squad_id, e.squad_nom || e.squad_id);
    for (const id of lineage(e.squad_id)) {
      let acc = accs.get(id);
      if (!acc) accs.set(id, (acc = newAcc(n)));
      add(acc, e, wi);
    }
  }

  // Arbre des squads présents : un squad dont le parent n'est pas listé (ou cycle) est une racine.
  const nomOf = (id: string) => byId.get(id)?.nom_canonique || names.get(id) || id;
  const children = new Map<string | null, string[]>();
  for (const id of accs.keys()) {
    const p = byId.get(id)?.parent_id ?? null;
    const parent = p && p !== id && accs.has(p) ? p : null;
    children.set(parent, [...(children.get(parent) ?? []), id]);
  }
  for (const list of children.values()) list.sort((a, b) => byName(nomOf(a), nomOf(b)));

  const out: CapaciteRow[] = [];
  const seen = new Set<string>();
  const walk = (parent: string | null, depth: number) => {
    for (const id of children.get(parent) ?? []) {
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(toRow(accs.get(id)!, id, nomOf(id), depth, uncovered));
      walk(id, depth + 1);
    }
  };
  walk(null, 0);
  // Squads pris dans un cycle de parenté : affichés en racine.
  for (const id of [...accs.keys()].filter((k) => !seen.has(k)).sort((a, b) => byName(nomOf(a), nomOf(b)))) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(toRow(accs.get(id)!, id, nomOf(id), 0, uncovered));
    walk(id, 1);
  }
  if (hasSans) out.push(toRow(sans, null, SANS_SQUAD, 0, uncovered));

  return { rows: out, total: toRow(total, null, 'Total', 0, uncovered) };
}

// ------------------------------------------------------------------ Échelle de la carte de chaleur
/** Écart à 100 % (en points) au-delà duquel on passe au palier suivant ; ≤ 15 = conforme. */
export const HEAT_STEPS = [15, 35, 60] as const;

export type HeatSide = 'sous' | 'sur';

export interface Heat {
  /** Sens de l'écart ; null = conforme (85–115 %), vide ou hors plan. */
  side: HeatSide | null;
  /** Intensité 0 (neutre) à 3 ; 3 = au-delà du dernier seuil, signalé par un glyphe. */
  step: 0 | 1 | 2 | 3;
  /** Réel sans aucune heure prévue. */
  horsPlan: boolean;
  /** Ni prévu ni réel. */
  empty: boolean;
  /** Semaine non couverte par le plan de charge : ni écart ni échelle, hachure neutre. */
  nonCouvert: boolean;
}

/** Position d'une cellule sur l'échelle divergente centrée sur 100 %. */
export function heatOf(c: CapaciteCell): Heat {
  if (c.nonCouvert) return { side: null, step: 0, horsPlan: false, empty: false, nonCouvert: true };
  if (c.utilisation == null) return { side: null, step: 0, horsPlan: c.reel > 0, empty: c.reel <= 0, nonCouvert: false };
  const d = c.utilisation - 100;
  const a = Math.abs(d);
  const step = a <= HEAT_STEPS[0] ? 0 : a <= HEAT_STEPS[1] ? 1 : a <= HEAT_STEPS[2] ? 2 : 3;
  return { side: step === 0 ? null : d < 0 ? 'sous' : 'sur', step, horsPlan: false, empty: false, nonCouvert: false };
}
