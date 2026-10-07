// Liste des versions de plan de charge — cycle de vie géré par VersionsPanel.
// Colonnes timeline (DECISIONS n° 13) : date d'effet et fenêtre « en vigueur » de chaque version.
import { useNavigate } from 'react-router-dom';
import VersionsPanel, { type VersionColumn } from '../../components/VersionsPanel';
import { fmtWindow, isReplaced, usePlanTimeline, windowOf } from '../../components/lifecycle/usePlanTimeline';
import { Text } from '../../ui';
import { fmtDate } from '../../lib/format';

export default function PlanVersionsList() {
  const navigate = useNavigate();
  const timeline = usePlanTimeline();

  const columns: VersionColumn[] = [
    { header: "Date d'effet", render: (v) => (v.date_effet ? fmtDate(v.date_effet) : '—') },
    {
      header: 'En vigueur',
      render: (v) => {
        if (v.statut === 'purgee') return '—';
        const w = windowOf(timeline.data, v.id);
        if (!w) return timeline.isLoading ? '…' : '—';
        return isReplaced(w) ? (
          <Text as="span" tone="secondary" title="Ne fait référence sur aucun jour : remplacée par une version plus récente.">
            Remplacée
          </Text>
        ) : (
          fmtWindow(w)
        );
      },
    },
  ];

  return (
    <VersionsPanel
      kind="plan"
      title="Versions du plan de charge"
      back={{ to: '/plan', label: 'Plan de charge' }}
      onOpen={(v) => navigate(`/plan/${v.id}`)}
      extraColumns={columns}
      emptyHelp="Importez un plan de charge (.xlsx). Chaque version remplace les précédentes à partir de sa date d'effet : l'analyse croise la timeline de toutes les versions."
    />
  );
}
