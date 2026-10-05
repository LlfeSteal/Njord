// Hooks utilitaires (remplacent @mantine/hooks) + apparence.
// CONTRAT FIGÉ (signatures) — implémentation : agent Kit 2.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

/** Valeur retardée de `ms` millisecondes (usage : `const [q] = useDebouncedValue(search, 300)`). */
export function useDebouncedValue<T>(value: T, ms: number): [T] {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return [v];
}

// ------------------------------------------------------------------ localStorage

/** Événement interne : synchronise les instances d'une même clé dans l'onglet courant. */
const LOCAL_EVENT = 'njord:local-storage';

interface LocalDetail {
  key: string;
  value: unknown;
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw == null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

/** État persisté en localStorage (JSON), tolérant aux erreurs d'accès / de parsing. */
export function useLocalStorage<T>({ key, defaultValue }: { key: string; defaultValue: T }): [T, (v: T | ((prev: T) => T)) => void] {
  const [state, setState] = useState(() => ({ key, value: readJson(key, defaultValue) }));
  // Changement de clé : relecture pendant le rendu (pas d'effet ni de rendu intermédiaire).
  let current = state;
  if (state.key !== key) {
    current = { key, value: readJson(key, defaultValue) };
    setState(current);
  }
  const value = current.value;

  const valueRef = useRef(value);
  const defaultRef = useRef(defaultValue);
  useEffect(() => {
    valueRef.current = value;
    defaultRef.current = defaultValue;
  });

  // Synchronisation : autres onglets (`storage`) et autres instances de l'onglet (événement interne).
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === key) setState({ key, value: readJson(key, defaultRef.current) });
    };
    const onLocal = (e: Event) => {
      const d = (e as CustomEvent<LocalDetail>).detail;
      if (d.key === key && d.value !== valueRef.current) setState({ key, value: d.value as T });
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener(LOCAL_EVENT, onLocal);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(LOCAL_EVENT, onLocal);
    };
  }, [key]);

  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      const v = typeof next === 'function' ? (next as (prev: T) => T)(valueRef.current) : next;
      valueRef.current = v;
      setState({ key, value: v });
      try {
        window.localStorage.setItem(key, JSON.stringify(v));
      } catch {
        // Stockage indisponible (navigation privée, quota) : l'état reste en mémoire.
      }
      window.dispatchEvent(new CustomEvent<LocalDetail>(LOCAL_EVENT, { detail: { key, value: v } }));
    },
    [key],
  );

  return [value, set];
}

// ------------------------------------------------------------------ Apparence

export type Appearance = 'auto' | 'light' | 'dark';

/** Clé lue telle quelle (valeur brute, pas JSON) par le script inline d'index.html. */
const APPEARANCE_KEY = 'njord.appearance';
/** Couleurs de la barre du navigateur (<meta name="theme-color">), cf. index.html et §10. */
const THEME_COLOR = { light: '#f5f5f7', dark: '#000000' } as const;

interface AppearanceState {
  appearance: Appearance;
  resolved: 'light' | 'dark';
}

const darkQuery = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

function readAppearance(): Appearance {
  try {
    const v = window.localStorage.getItem(APPEARANCE_KEY);
    if (v === 'light' || v === 'dark' || v === 'auto') return v;
  } catch {
    // Stockage indisponible : automatique.
  }
  return 'auto';
}

function resolve(a: Appearance): 'light' | 'dark' {
  if (a !== 'auto') return a;
  return darkQuery?.matches ? 'dark' : 'light';
}

/** Applique le thème au document : data-theme sur <html> et méta theme-color. */
function applyAppearance({ appearance, resolved }: AppearanceState) {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', resolved);
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((m) => {
    // En automatique, chaque méta garde la couleur de son média ; sinon toutes prennent le thème forcé.
    const scheme = appearance === 'auto' ? (m.media.includes('dark') ? 'dark' : 'light') : resolved;
    m.content = THEME_COLOR[scheme];
  });
}

// Store module partagé : toutes les instances de useAppearance voient la même valeur.
let appearanceState: AppearanceState = (() => {
  const appearance = typeof window !== 'undefined' ? readAppearance() : 'auto';
  return { appearance, resolved: resolve(appearance) };
})();
applyAppearance(appearanceState);

const appearanceListeners = new Set<() => void>();

function updateAppearance(appearance: Appearance) {
  const resolved = resolve(appearance);
  if (appearance === appearanceState.appearance && resolved === appearanceState.resolved) return;
  appearanceState = { appearance, resolved };
  applyAppearance(appearanceState);
  appearanceListeners.forEach((l) => l());
}

function setAppearance(a: Appearance) {
  try {
    window.localStorage.setItem(APPEARANCE_KEY, a);
  } catch {
    // Stockage indisponible : le choix vaut pour la session.
  }
  updateAppearance(a);
}

const onSchemeChange = () => {
  if (appearanceState.appearance === 'auto') updateAppearance('auto');
};
const onAppearanceStorage = (e: StorageEvent) => {
  if (e.key === APPEARANCE_KEY) updateAppearance(readAppearance());
};

function subscribeAppearance(l: () => void) {
  if (appearanceListeners.size === 0) {
    darkQuery?.addEventListener('change', onSchemeChange);
    window.addEventListener('storage', onAppearanceStorage);
    // Le système a pu changer pendant qu'aucune instance n'écoutait.
    onSchemeChange();
  }
  appearanceListeners.add(l);
  return () => {
    appearanceListeners.delete(l);
    if (appearanceListeners.size === 0) {
      darkQuery?.removeEventListener('change', onSchemeChange);
      window.removeEventListener('storage', onAppearanceStorage);
    }
  };
}
const getAppearance = () => appearanceState;

/**
 * Apparence choisie (persistée sous `njord.appearance`) et thème résolu.
 * Pose `data-theme` sur <html> ; en `auto`, suit `prefers-color-scheme` en direct.
 * État PARTAGÉ entre toutes les instances (store module + useSyncExternalStore) : un changement
 * dans la barre d'outils met à jour les graphiques. Valeur brute (pas JSON) sous `njord.appearance`.
 */
export function useAppearance(): {
  appearance: Appearance;
  setAppearance: (a: Appearance) => void;
  resolved: 'light' | 'dark';
} {
  const { appearance, resolved } = useSyncExternalStore(subscribeAppearance, getAppearance, getAppearance);
  return { appearance, setAppearance, resolved };
}
