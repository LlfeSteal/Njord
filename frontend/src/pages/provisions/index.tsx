// Module Provisions — monté sur /provisions/* (voir docs/ARCHITECTURE.md, DECISIONS n° 16).
// /provisions = version courante (active), /provisions/:id = version de l'historique, /provisions/versions = gestion.
import { Navigate, Route, Routes } from 'react-router-dom';
import CurrentVersion from '../../components/lifecycle/CurrentVersion';
import ProvisionsDetail from './ProvisionsDetail';
import ProvisionsList from './ProvisionsList';
import { PROVISIONS_HELP } from './help';

export default function ProvisionsModule() {
  return (
    <Routes>
      <Route
        index
        element={
          <CurrentVersion kind="provision" title="Provisions" emptyHelp={PROVISIONS_HELP}>
            {(id) => <ProvisionsDetail versionId={id} />}
          </CurrentVersion>
        }
      />
      <Route path="versions" element={<ProvisionsList />} />
      <Route path=":versionId" element={<ProvisionsDetail />} />
      <Route path="*" element={<Navigate to="/provisions" replace />} />
    </Routes>
  );
}
