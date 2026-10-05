// Maquette locale de l'API Analyse : activée UNIQUEMENT si VITE_ANALYSE_MOCK=1 (voir service.ts).
// Mini-moteur déterministe : les écarts sont recalculés selon la plage de semaines et le toggle
// « inactifs » afin que le tableau de bord, les filtres et le drill-down soient cohérents.
import type {
  AnalyseContext,
  AnalyseParams,
  AnalyseResult,
  BudgetCT,
  Confidence,
  Correspondance,
  EcartRow,
  Flag,
  Personne,
  Settings,
  Version,
  WeekInfo,
} from '../../api/types';

const SEUIL_SUR = 15;
const SEUIL_SOUS = -30;

const v = (p: Partial<Version> & Pick<Version, 'id' | 'kind' | 'intitule' | 'statut'>): Version => ({
  importee_le: '2026-09-01T08:00:00Z',
  importeur: 'local',
  archivee_le: null,
  purgee_le: null,
  nb_lignes: 0,
  nb_warn: 0,
  nb_drop: 0,
  periode_debut: '2026-08-31',
  periode_fin: '2026-12-31',
  source_format: 'demo',
  filename: p.intitule + '.xlsx',
  ...p,
});

const PLAN_VERSIONS: Version[] = [
  v({ id: 'plan-3', kind: 'plan', intitule: 'PDC T4 2026 v3', statut: 'active', nb_lignes: 214, nb_warn: 6, importee_le: '2026-09-28T09:12:00Z', layout: 'A' }),
  v({ id: 'plan-2', kind: 'plan', intitule: 'PDC T4 2026 v2', statut: 'archivee', nb_lignes: 205, nb_warn: 9, archivee_le: '2026-09-28T09:12:00Z', layout: 'A' }),
  v({ id: 'plan-1', kind: 'plan', intitule: 'PDC brouillon', statut: 'purgee', purgee_le: '2026-09-20T10:00:00Z' }),
];

const REALISE_VERSIONS: Version[] = [
  v({ id: 'real-2', kind: 'realise', intitule: 'Réalisé au 04/10/2026', statut: 'active', nb_lignes: 1840, nb_warn: 12, nb_drop: 3, periode_debut: '2026-08-31', periode_fin: '2026-10-04', montant_total_eur: 412_380 }),
  v({ id: 'real-1', kind: 'realise', intitule: 'Réalisé au 27/09/2026', statut: 'archivee', nb_lignes: 1502, archivee_le: '2026-10-05T07:30:00Z', periode_debut: '2026-08-31', periode_fin: '2026-09-27', montant_total_eur: 331_900 }),
];

const WEEKS: WeekInfo[] = [
  { week: '2026-W36', debut: '2026-08-31', fin: '2026-09-06', jours_ouvres: 5, verrouillee: false },
  { week: '2026-W37', debut: '2026-09-07', fin: '2026-09-13', jours_ouvres: 5, verrouillee: false },
  { week: '2026-W38', debut: '2026-09-14', fin: '2026-09-20', jours_ouvres: 5, verrouillee: false },
  { week: '2026-W39', debut: '2026-09-21', fin: '2026-09-27', jours_ouvres: 5, verrouillee: false },
  { week: '2026-W40', debut: '2026-09-28', fin: '2026-10-04', jours_ouvres: 5, verrouillee: false },
  { week: '2026-W41', debut: '2026-10-05', fin: '2026-10-11', jours_ouvres: 5, verrouillee: false },
];

const CTS: Record<string, string> = {
  Y99F90001: 'Refonte portail client',
  Y99F90002: 'Migration socle data',
  Y99F90003: 'Maintenance applicative',
  Y99F90004: 'Audit cybersécurité',
  Y99F900010: 'Provisions programme',
};

const SQUADS: Record<string, string> = {
  'sq-alpha': 'Squad Alpha',
  'sq-beta': 'Squad Beta',
  'sq-gamma': 'Squad Gamma',
};

interface MockPerson {
  id: string | null;
  ressource: string;
  label: string;
  nomRealise: string;
  confidence: Confidence;
  inactive?: boolean;
  squad: string | null;
}

const PEOPLE: MockPerson[] = [
  { id: 'p-1', ressource: 'R_001', label: 'Claire DURAND', nomRealise: 'DURAND Claire M.', confidence: 'matricule', squad: 'sq-alpha' },
  { id: 'p-2', ressource: 'R_002', label: 'Marc LEROY', nomRealise: 'LEROY Marc M.', confidence: 'alias', squad: 'sq-alpha' },
  { id: 'p-3', ressource: 'R_003', label: 'Sophie MARTIN', nomRealise: 'MARTIN Sophie', confidence: 'fuzzy', squad: 'sq-beta' },
  { id: 'p-4', ressource: 'R_004', label: 'Paul BERNARD', nomRealise: '', confidence: 'plan', inactive: true, squad: 'sq-beta' },
  { id: 'p-5', ressource: 'RES_ext_01', label: 'Julie NGUYEN', nomRealise: 'NGUYEN Julie M.', confidence: 'matricule', squad: 'sq-gamma' },
  { id: 'p-6', ressource: 'R_005', label: 'Thomas PETIT', nomRealise: 'PETIT Thomas M.', confidence: 'matricule', squad: 'sq-gamma' },
  { id: 'p-7', ressource: 'DURANDC', label: 'Cédric DURAND', nomRealise: '', confidence: 'plan', squad: 'sq-alpha' },
  { id: 'p-8', ressource: 'R_006', label: 'Hugo GARCIA', nomRealise: 'GARCIA HUGO', confidence: 'fuzzy', squad: 'sq-beta' },
  { id: 'p-9', ressource: '2GI_ROUX', label: 'Emma ROUX', nomRealise: 'ROUX Emma M.', confidence: 'alias', inactive: true, squad: 'sq-gamma' },
  // Hors plan : écritures réalisées non rapprochées.
  { id: null, ressource: 'MOREAU Lucas M.', label: 'MOREAU Lucas M.', nomRealise: 'MOREAU Lucas M.', confidence: 'none', squad: null },
  { id: null, ressource: 'FAURE Inès', label: 'FAURE Inès', nomRealise: 'FAURE Inès', confidence: 'none', squad: null },
];

/** Affectations : prévu/réel par semaine (W36..W41). */
interface Assignment {
  person: number;
  ct: string;
  prevu: number[];
  reel: number[];
  warn?: number[]; // indices de semaines dont une écriture est en warn
}

const ASSIGNMENTS: Assignment[] = [
  { person: 0, ct: 'Y99F90001', prevu: [25, 25, 25, 25, 25, 25], reel: [24, 26, 23.5, 25, 27, 0] },
  { person: 0, ct: 'Y99F90003', prevu: [6.3, 6.3, 6.3, 6.3, 6.3, 6.3], reel: [7, 5, 6, 8, 0, 0] },
  { person: 1, ct: 'Y99F90001', prevu: [31.3, 31.3, 31.3, 31.3, 31.3, 31.3], reel: [30, 49, 52.5, 31, 29, 0] },
  { person: 1, ct: 'Y99F90004', prevu: [0, 0, 0, 0, 0, 0], reel: [0, 0, 4, 6, 0, 0] },
  { person: 2, ct: 'Y99F90002', prevu: [31.3, 31.3, 31.3, 31.3, 31.3, 31.3], reel: [30, 28, 0, 0, 32, 0], warn: [1] },
  { person: 3, ct: 'Y99F90002', prevu: [12.5, 12.5, 12.5, 12.5, 12.5, 12.5], reel: [0, 0, 0, 0, 0, 0] },
  { person: 4, ct: 'Y99F90002', prevu: [25, 25, 25, 25, 25, 25], reel: [44, 46.5, 41, 38, 45, 0] },
  { person: 4, ct: 'Y99F90004', prevu: [6.3, 6.3, 6.3, 6.3, 6.3, 6.3], reel: [6, 6, 7, 5, 6, 0] },
  { person: 5, ct: 'Y99F90003', prevu: [37.5, 37.5, 37.5, 37.5, 37.5, 37.5], reel: [5, 4, 36, 2, 0, 0] },
  { person: 6, ct: 'Y99F90001', prevu: [15.6, 15.6, 15.6, 15.6, 15.6, 15.6], reel: [0, 0, 0, 0, 0, 0] },
  { person: 7, ct: 'Y99F90003', prevu: [21.9, 21.9, 21.9, 21.9, 21.9, 21.9], reel: [22, 20, 24, 21, 19, 0] },
  { person: 8, ct: 'Y99F90004', prevu: [12.5, 12.5, 12.5, 12.5, 12.5, 12.5], reel: [12, 30, 11, 13, 12, 0] },
  { person: 9, ct: 'Y99F90002', prevu: [0, 0, 0, 0, 0, 0], reel: [16, 18, 0, 22, 14, 0] },
  { person: 10, ct: 'Y99F900010', prevu: [0, 0, 0, 0, 0, 0], reel: [0, 8, 0, 7.5, 0, 0], warn: [1] },
];

// État mutable de la maquette : alias confirmés (personne_id).
const confirmed = new Set<string>();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const r1 = (x: number) => Math.round(x * 10) / 10;

function confidenceOf(p: MockPerson): Confidence {
  return p.id && confirmed.has(p.id) && p.confidence === 'fuzzy' ? 'alias' : p.confidence;
}

export async function mockContext(): Promise<AnalyseContext> {
  await sleep(150);
  return {
    plan_versions: PLAN_VERSIONS,
    realise_versions: REALISE_VERSIONS,
    default_plan_id: 'plan-3',
    default_realise_id: 'real-2',
    default_week_from: '2026-W36',
    default_week_to: '2026-W40',
    weeks: WEEKS,
    message: '',
  };
}

export const MOCK_SETTINGS: Settings = {
  seuil_sur_imputation_h: SEUIL_SUR,
  seuil_sous_imputation_h: -SEUIL_SOUS,
  seuil_ct_risque_eur: 10_000,
  seuil_non_securise_pct: 15,
  purge_delai_jours: 30,
  seuil_quantite_semaine_h: 200,
  seuil_fuzzy_count: 1,
  seuil_ecart_tg_eur: 5_000,
  diviseur_hors_plan_h: 12,
  semaines_verrouillees: [51, 52],
  jours_feries: ['2026-11-11', '2026-12-25'],
  mo_types: ["MAIN D'OEUVRE SUR SITE", 'CAPACITE SUR SITE'],
  securise: ["MAIN D'OEUVRE SUR SITE", 'CAPACITE SUR SITE', 'FRAIS ACHATS CAPACITE SUR SITE', 'FRAIS DE MISSION'],
  non_securise: ['PROVISIONS POUR ALEAS', 'Stockage'],
};

const BUDGET: BudgetCT[] = [
  { ct: 'Y99F90001', ct_libelle: CTS.Y99F90001, securise: 48_200, non_securise: 3_100, non_classe: 1_250, pct_securite: null, pps_plan: 96_000, heures_mo: 512.5, cout_mo_eur: 41_300, risque: false },
  { ct: 'Y99F90002', ct_libelle: CTS.Y99F90002, securise: 61_750, non_securise: 18_540, non_classe: 4_800, pct_securite: null, pps_plan: 120_000, heures_mo: 690, cout_mo_eur: 55_100, risque: true },
  { ct: 'Y99F90003', ct_libelle: CTS.Y99F90003, securise: 22_400, non_securise: 0, non_classe: 650, pct_securite: null, pps_plan: 40_000, heures_mo: 344, cout_mo_eur: 27_500, risque: false },
  { ct: 'Y99F90004', ct_libelle: CTS.Y99F90004, securise: 15_900, non_securise: -1_200, non_classe: 0, pct_securite: null, pps_plan: 25_000, heures_mo: 189, cout_mo_eur: 15_100, risque: false },
  { ct: 'Y99F900010', ct_libelle: CTS.Y99F900010, securise: 2_100, non_securise: 12_300, non_classe: 3_900, pct_securite: null, pps_plan: 30_000, heures_mo: 15.5, cout_mo_eur: 1_240, risque: true },
].map((b) => ({ ...b, pct_securite: b.securise + b.non_securise ? (100 * b.securise) / (b.securise + b.non_securise) : null }));

function flagOf(prevu: number, reel: number, horsPlan: boolean, personAbsent: boolean): Flag {
  if (horsPlan) return 'hors_plan';
  if (reel === 0 && prevu > 0 && personAbsent) return 'absence';
  const e = reel - prevu;
  if (e > SEUIL_SUR) return 'sur_imputation';
  if (e < SEUIL_SOUS) return 'sous_imputation';
  return 'conforme';
}

export async function mockRun(p: AnalyseParams): Promise<AnalyseResult> {
  await sleep(450);
  const planV = PLAN_VERSIONS.find((x) => x.id === (p.plan_version_id ?? 'plan-3')) ?? null;
  const realV = REALISE_VERSIONS.find((x) => x.id === (p.realise_version_id ?? 'real-2')) ?? null;
  const from = p.week_from ?? '2026-W36';
  const to = p.week_to ?? '2026-W40';
  const includeInactive = !!p.include_inactive;
  const idx = WEEKS.map((w, i) => ({ w, i })).filter(({ w }) => w.week >= from && w.week <= to);
  // Le réalisé archivé s'arrête en W39.
  const maxIdx = realV?.id === 'real-1' ? 3 : 4;

  // Σ réel par personne sur la période (règle ⚫).
  const sumReel = new Map<number, number>();
  for (const a of ASSIGNMENTS)
    for (const { i } of idx) sumReel.set(a.person, (sumReel.get(a.person) ?? 0) + (i <= maxIdx ? a.reel[i] : 0));

  const ecarts: EcartRow[] = [];
  for (const a of ASSIGNMENTS) {
    const person = PEOPLE[a.person];
    const conf = confidenceOf(person);
    for (const { w, i } of idx) {
      const prevu = a.prevu[i];
      const reel = i <= maxIdx ? a.reel[i] : 0;
      if (prevu === 0 && reel === 0) continue;
      const horsPlan = conf === 'none' || w.verrouillee;
      const flag = flagOf(prevu, reel, horsPlan, (sumReel.get(a.person) ?? 0) === 0);
      ecarts.push({
        personne_id: person.id,
        ressource: person.ressource,
        ressource_label: person.label,
        ct: a.ct,
        ct_libelle: CTS[a.ct],
        semaine: w.week,
        prevu,
        reel,
        ecart: r1(reel - prevu),
        flag,
        confidence: conf,
        inactive: !!person.inactive,
        squad_id: person.squad,
        squad_nom: person.squad ? SQUADS[person.squad] : '',
        warn: !!a.warn?.includes(i),
      });
    }
  }

  const count = (f: Flag) => ecarts.filter((e) => e.flag === f).length;
  const compares = ecarts.filter((e) => e.flag !== 'hors_plan' && (includeInactive || !e.inactive));
  const nbConf = compares.filter((e) => e.flag === 'conforme').length;
  const heuresHP = ecarts.filter((e) => e.flag === 'hors_plan').reduce((s, e) => s + e.reel, 0);
  const planned = new Set(ecarts.filter((e) => e.prevu > 0 && (includeInactive || !e.inactive)).map((e) => e.personne_id));
  const absents = new Set(ecarts.filter((e) => e.flag === 'absence' && planned.has(e.personne_id)).map((e) => e.personne_id));
  const nbSur = count('sur_imputation');
  const nbSous = count('sous_imputation');
  const nbAbs = count('absence');
  const pts = { sur: 2 * nbSur, sous: nbSous, abs: 2 * nbAbs, hp: Math.floor(heuresHP / 12) };

  const g = BUDGET.reduce(
    (s, b) => ({ securise: s.securise + b.securise, non_securise: s.non_securise + b.non_securise, non_classe: s.non_classe + b.non_classe }),
    { securise: 0, non_securise: 0, non_classe: 0 },
  );
  const denom = g.securise + g.non_securise;
  const pctSec = denom ? (100 * g.securise) / denom : null;
  const pctNon = denom ? (100 * g.non_securise) / denom : null;

  const correspondances: Correspondance[] = PEOPLE.filter((x) => x.nomRealise).map((x) => {
    const rows = ASSIGNMENTS.filter((a) => PEOPLE[a.person] === x);
    const heures = rows.reduce((s, a) => s + a.reel.slice(0, maxIdx + 1).reduce((t, h) => t + h, 0), 0);
    return {
      nom_realise: x.nomRealise,
      nom_normalise: x.nomRealise.toUpperCase().replace(/[^A-ZÀ-Ü ]/g, '').split(' ').filter(Boolean).sort().join(' '),
      personne_id: x.id,
      personne_nom: x.id ? x.label : '',
      ressource: x.id ? x.ressource : '',
      confidence: confidenceOf(x),
      nb_ecritures: Math.max(1, Math.round(heures / 7.5)),
      heures: r1(heures),
    };
  });
  const nbFuzzy = correspondances.filter((c) => c.confidence === 'fuzzy').length;

  return {
    meta: {
      plan_version: planV,
      realise_version: realV,
      archived_warning: planV?.statut === 'archivee' || realV?.statut === 'archivee',
      week_from: from,
      week_to: to,
      weeks: idx.map(({ w }) => w),
      include_inactive: includeInactive,
      generated_at: new Date().toISOString(),
    },
    kpis: {
      taux_conformite: compares.length ? nbConf / compares.length : null,
      nb_tuples_compares: compares.length,
      nb_conformes: nbConf,
      nb_sur_imputation: nbSur,
      nb_sous_imputation: nbSous,
      nb_absence: nbAbs,
      nb_hors_plan: count('hors_plan'),
      points_sur_imputation: pts.sur,
      points_sous_imputation: pts.sous,
      points_absence: pts.abs,
      points_hors_plan: pts.hp,
      points_total: pts.sur + pts.sous + pts.abs + pts.hp,
      heures_hors_plan: r1(heuresHP),
      taux_absence: planned.size ? absents.size / planned.size : null,
      nb_personnes_absentes: absents.size,
      nb_personnes_planifiees: planned.size,
      pct_securise: pctSec,
      nb_ct_risque: BUDGET.filter((b) => b.risque).length,
      total_prevu_h: r1(ecarts.reduce((s, e) => s + e.prevu, 0)),
      total_reel_h: r1(ecarts.reduce((s, e) => s + e.reel, 0)),
    },
    ecarts,
    budget: {
      par_ct: BUDGET,
      global: { ...g, pct_securite: pctSec, pct_non_securise: pctNon },
    },
    alertes: {
      ct_risque: BUDGET.filter((b) => b.risque).map((b) => ({ ct: b.ct, ct_libelle: b.ct_libelle, non_securise: b.non_securise })),
      alerte_globale: (pctNon ?? 0) > 15,
      pct_non_securise: pctNon,
      derive_provision: [
        { ct: 'Y99F900010', row_num: 412, employe_fournisseur: 'FAURE Inès', type: "MAIN D'OEUVRE SUR SITE", date_depense: '2026-09-09', heures: 8, eur: 0 },
        { ct: 'Y99F900010', row_num: 977, employe_fournisseur: 'FAURE Inès', type: "MAIN D'OEUVRE SUR SITE", date_depense: '2026-09-23', heures: 7.5, eur: 0 },
        { ct: 'Y99F90002', row_num: 1033, employe_fournisseur: 'ACME STOCKAGE SAS', type: 'PROVISIONS POUR ALEAS', date_depense: '2026-09-18', heures: 0, eur: 9_800 },
      ],
    },
    qualite: [
      { code: 'ecart_tg', regle: 1, message: 'Σ € réalisé par TG s’écarte du PPS plan au-delà du seuil (5 000 €)', count: 2, details: ['Y99F90002 : 85 090 € réalisé vs 120 000 € PPS', 'Y99F900010 : 18 300 € réalisé vs 30 000 € PPS'] },
      { code: 'quantite_semaine', regle: 2, message: 'Lignes MO avec QUANTITE > 200 h sur une semaine (imputations physiquement impossibles)', count: 1, details: ['Ligne 1188 — 2026-W38 — 240 h'] },
      ...(nbFuzzy > 0
        ? [{ code: 'fuzzy', regle: 3, message: `${nbFuzzy} correspondance(s) approximative(s) : enrichir Personne.alias`, count: nbFuzzy, details: correspondances.filter((c) => c.confidence === 'fuzzy').map((c) => `${c.nom_realise} → ${c.personne_nom}`) }]
        : []),
      { code: 'sans_tg', regle: 4, message: 'Lignes réalisé sans TG exclues de l’analyse', count: 3, details: ['Ligne 88', 'Ligne 1502', 'Ligne 1777'] },
      { code: 'periode_comptable', regle: 5, message: 'Période comptable antérieure de plus de 7 jours à la date de dépense', count: 4, details: ['Ligne 120', 'Ligne 121', 'Ligne 640', 'Ligne 902'] },
      { code: 'plan_repartition', regle: 0, message: 'Σ charge hebdo ≠ charge totale (±0,5 h) : semaines verrouillées ou lignes sans jour ouvré', count: 2, details: ['Ligne plan 37 (R_004)', 'Ligne plan 52 (DURANDC)'] },
    ],
    correspondances,
  };
}

export async function mockConfirmAlias(personne_id: string, alias: string): Promise<Personne> {
  await sleep(250);
  confirmed.add(personne_id);
  const p = PEOPLE.find((x) => x.id === personne_id);
  return {
    id: personne_id,
    display_name: p?.label ?? personne_id,
    nom_normalise: (p?.label ?? '').toUpperCase(),
    statut: 'validee',
    squad_id: p?.squad ?? null,
    matricules: [],
    alias: [{ id: Date.now(), alias, alias_normalise: alias.toUpperCase(), source: 'confirme' }],
    created_at: '2026-09-01T08:00:00Z',
  };
}
