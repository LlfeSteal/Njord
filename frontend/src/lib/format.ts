// Formatage fr-FR partagé.
const nf1 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1, minimumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });
const eur = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const eur2 = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 });

export const fmtNumber = (v: number | null | undefined) => (v == null ? '—' : nf2.format(v));
/** Heures : « 37,5 h ». */
export const fmtHours = (v: number | null | undefined) => (v == null ? '—' : `${nf1.format(v)} h`);
/** Heures signées : « +12,5 h » / « −4 h ». */
export const fmtHoursSigned = (v: number | null | undefined) =>
  v == null ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${nf1.format(Math.abs(v))} h`;
/** Euros sans centimes : « 12 345 € » ; precise=true pour les centimes. */
export const fmtEur = (v: number | null | undefined, precise = false) =>
  v == null ? '—' : (precise ? eur2 : eur).format(v);
/** Pourcentage déjà en 0..100 : « 85,3 % ». */
export const fmtPct = (v: number | null | undefined) => (v == null ? '—' : `${nf1.format(v)} %`);
/** Ratio 0..1 → « 85,3 % ». */
export const fmtRatio = (v: number | null | undefined) => (v == null ? '—' : `${nf1.format(v * 100)} %`);
/** "2026-09-01" → « 01/09/2026 ». */
export const fmtDate = (d: string | null | undefined) => {
  if (!d) return '—';
  const [y, m, day] = d.slice(0, 10).split('-');
  return y && m && day ? `${day}/${m}/${y}` : d;
};
/** Horodatage ISO → « 05/10/2026 14:32 ». */
export const fmtDateTime = (iso: string | null | undefined) => {
  if (!iso) return '—';
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return iso;
  return t.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
};
/** "2026-W37" → « S37 2026 ». */
export const fmtWeek = (w: string | null | undefined) => {
  if (!w) return '—';
  const m = /^(\d{4})-W(\d{2})$/.exec(w);
  return m ? `S${m[2]} ${m[1]}` : w;
};
export const fmtPeriod = (from?: string, to?: string) =>
  from || to ? `${fmtDate(from)} → ${fmtDate(to)}` : '—';
