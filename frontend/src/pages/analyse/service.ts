// Accès aux données de l'onglet Analyse : API réelle par défaut, maquette si VITE_ANALYSE_MOCK=1.
import { analyseApi, settingsApi } from '../../api/client';
import type { AnalyseContext, AnalyseParams, AnalyseResult, Personne, Settings } from '../../api/types';

export const ANALYSE_MOCK = import.meta.env.VITE_ANALYSE_MOCK === '1';

const mock = () => import('./mock');

export const analyseService = {
  context: (): Promise<AnalyseContext> => (ANALYSE_MOCK ? mock().then((m) => m.mockContext()) : analyseApi.context()),
  run: (p: AnalyseParams): Promise<AnalyseResult> => (ANALYSE_MOCK ? mock().then((m) => m.mockRun(p)) : analyseApi.run(p)),
  confirmAlias: (personneId: string, alias: string): Promise<Personne> =>
    ANALYSE_MOCK ? mock().then((m) => m.mockConfirmAlias(personneId, alias)) : analyseApi.confirmAlias(personneId, alias),
  settings: (): Promise<Settings> => (ANALYSE_MOCK ? mock().then((m) => m.MOCK_SETTINGS) : settingsApi.get()),
};
