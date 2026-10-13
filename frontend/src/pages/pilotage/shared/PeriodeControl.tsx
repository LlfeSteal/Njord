// Filtre d'année des vues temporelles (DECISIONS n° 24) : « Période  Tout · 2026 · 2027 » dans la barre d'outils de
// la Vue d'ensemble, du Budget et des Prévisions (même choix partagé). Contrôle segmenté jusqu'à 5 options, menu
// au-delà. Exporte aussi la mention « Toutes années » (chiffres qui ne dépendent pas du filtre) et l'erreur de calcul.
import { SegmentedControl, Select, Spinner } from '../../../ui';
import ErrorAlert from '../../../components/ErrorAlert';
import type { UsePrevisions } from './usePrevisions';
import './pilotage.css';

const TOUT = '0';

/** Au-delà de 5 options (Tout + 4 années), un menu remplace le contrôle segmenté. */
const MAX_SEGMENTS = 5;

export default function PeriodeControl({ prev }: { prev: UsePrevisions }) {
  const { annee, annees, setAnnee, isFetching } = prev;
  // Aucune enveloppe (aucune année proposée) : rien à filtrer.
  if (annees.length === 0) return null;
  const data = [{ value: TOUT, label: 'Tout' }, ...annees.map((y) => ({ value: String(y), label: String(y) }))];
  const value = String(annee);
  const pick = (v: string | null) => setAnnee(v ? Number(v) : 0);
  return (
    <span className="pil-periode">
      {isFetching && <Spinner size={12} label="Calcul de l’année en cours" />}
      <span className="pil-periode__label" aria-hidden>
        Période
      </span>
      {data.length <= MAX_SEGMENTS ? (
        <SegmentedControl aria-label="Période" data={data} value={value} onChange={pick} equal={false} />
      ) : (
        <Select aria-label="Période" data={data} value={value} onChange={pick} menuWidth={140} />
      )}
    </span>
  );
}

/** Mention discrète « Toutes années » sur un chiffre qui ne dépend pas du filtre (natures, classification, MO). */
export function AllYearsNote({ annee, title }: { annee: number; title?: string }) {
  if (annee <= 0) return null;
  return (
    <span className="pil-allyears" title={title ?? 'Ce chiffre ne dépend pas du filtre d’année : il porte sur toutes les années'}>
      Toutes années
    </span>
  );
}

/** Échec du calcul de l'année choisie (les autres chiffres de la page restent affichés). */
export function PrevisionsError({ prev }: { prev: UsePrevisions }) {
  if (!prev.error) return null;
  return <ErrorAlert error={prev.error} title={`Échec du calcul des prévisions de ${prev.annee}`} />;
}
