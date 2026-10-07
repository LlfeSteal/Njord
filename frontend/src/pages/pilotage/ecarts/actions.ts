// Export « actions à envoyer » de la page Écarts (DECISIONS n° 15) : pour chaque ressource, les
// corrections d'imputation à faire semaine par semaine, en Markdown prêt à copier dans un message.
import type { EcartRow } from '../../../api/types';
import { fmtHours, fmtHoursSigned } from '../../../lib/format';
import { cmp } from './model';

export interface ActionsContext {
  /** « S36 → S40 ». */
  periode: string;
  plan: string;
  realise: string;
  /** Libellés des filtres actifs (mêmes que les puces de la page). */
  filtres: string[];
  recherche?: string;
  weekLabel: (w: string) => string;
}

export interface ActionsExport {
  markdown: string;
  personnes: number;
  semaines: number;
}

/**
 * Tuples à régulariser : hors conformes, et hors lignes non nominatives (réserves, PO, RTE : pas de
 * personne à qui écrire). Un hors plan n'a pas de fiche mais c'est une personne qui a imputé.
 */
export const aRegulariser = (rows: EcartRow[]) =>
  rows.filter((e) => e.flag !== 'conforme' && (!!e.personne_id || e.confidence === 'none'));

/** Correction d'un tuple, ou null si elle s'arrondit à 0 (« CT −10 h », « CT +20 h »). */
function action(e: EcartRow): string | null {
  if (e.flag === 'hors_plan') return `${e.ct} ${fmtHours(e.reel)} imputées hors plan (à vérifier)`;
  const h = fmtHoursSigned(e.prevu - e.reel);
  return h === fmtHoursSigned(0) ? null : `${e.ct} ${h}`;
}

/**
 * « imputé sur B au lieu de A » pour les erreurs de CT de la semaine : A = CT planifiés liés à B et en
 * écart (un CT resté conforme n'a reçu qu'une part du transfert, comme dans l'anomalie).
 */
function notes(week: EcartRow[]): string[] {
  const out: string[] = [];
  for (const b of week) {
    if (b.flag !== 'erreur_ct' || b.prevu !== 0) continue;
    const a = week.filter((e) => e.prevu > 0 && e.cts_lies.includes(b.ct)).map((e) => e.ct);
    const au = a.length ? a : b.cts_lies;
    if (au.length) out.push(`imputé sur ${b.ct} au lieu de ${au.join(', ')}`);
  }
  return out;
}

/**
 * Markdown des actions : une section par ressource (triée par nom), une ligne par semaine en écart
 * (CT triés par code), puis le glossaire des CT cités. Heures = prévu − réel : « − » à retirer de ce CT,
 * « + » à y ajouter ; les heures hors plan sont à vérifier, sans signe.
 */
export function actionsMarkdown(rows: EcartRow[], ctx: ActionsContext): ActionsExport {
  const parRessource = new Map<string, { nom: string; squad: string; semaines: Map<string, EcartRow[]> }>();
  const cts = new Map<string, string>();
  for (const e of aRegulariser(rows)) {
    if (!action(e)) continue;
    const nom = e.ressource_label || e.ressource;
    let r = parRessource.get(e.ressource);
    if (!r) {
      r = { nom, squad: e.squad_nom, semaines: new Map() };
      parRessource.set(e.ressource, r);
    }
    if (!r.squad && e.squad_nom) r.squad = e.squad_nom;
    r.semaines.set(e.semaine, [...(r.semaines.get(e.semaine) ?? []), e]);
    if (!cts.has(e.ct) || (!cts.get(e.ct) && e.ct_libelle)) cts.set(e.ct, e.ct_libelle);
  }

  const lines = [`# Régularisation des imputations — ${ctx.periode}`, ''];
  const contexte = [`Plan : ${ctx.plan}`, `Réalisé : ${ctx.realise}`];
  if (ctx.filtres.length) contexte.push(`Filtres : ${ctx.filtres.join(', ')}`);
  if (ctx.recherche) contexte.push(`Recherche : « ${ctx.recherche} »`);
  lines.push(contexte.join(' · '));
  lines.push('Les heures sont la correction à faire : « − » à retirer de ce CT, « + » à ajouter sur ce CT.');

  let semaines = 0;
  const ressources = [...parRessource.values()].sort((a, b) => cmp(a.nom, b.nom));
  for (const r of ressources) {
    lines.push('', `## ${r.nom}${r.squad ? ` — ${r.squad}` : ''}`, '');
    // ⚫ Absence = aucune heure sur toute la période : dit une fois, pas à chaque semaine.
    const absent = [...r.semaines.values()].some((week) => week.some((e) => e.flag === 'absence'));
    if (absent) lines.push('Rien imputé sur la période.', '');
    for (const [w, week] of [...r.semaines.entries()].sort(([a], [b]) => cmp(a, b))) {
      week.sort((a, b) => cmp(a.ct, b.ct));
      const n = notes(week);
      lines.push(`- **${ctx.weekLabel(w)}** : ${week.map(action).join(' · ')}${n.length ? ` — ${n.join(' ; ')}` : ''}`);
      semaines += 1;
    }
  }
  if (ressources.length === 0) lines.push('', 'Aucun écart à régulariser.');
  else {
    lines.push('', '---', '', 'CT cités :', '');
    for (const [ct, libelle] of [...cts.entries()].sort(([a], [b]) => cmp(a, b)))
      lines.push(`- ${ct}${libelle ? ` — ${libelle}` : ''}`);
  }
  return { markdown: lines.join('\n') + '\n', personnes: ressources.length, semaines };
}
