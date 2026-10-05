// Hooks de mise en page de la boîte des anomalies.
import { useCallback, useLayoutEffect, useState, useSyncExternalStore, type RefObject } from 'react';

/** Correspondance d'une media query, à jour des changements de taille. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (cb: () => void) => {
      const m = window.matchMedia(query);
      m.addEventListener('change', cb);
      return () => m.removeEventListener('change', cb);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/**
 * Hauteur disponible sous l'élément jusqu'au bas de la fenêtre (marge `gap`) :
 * la liste et le détail défilent seuls, comme dans Mail. Recalculée à chaque rendu
 * (la barre d'outils peut changer de hauteur) et au redimensionnement.
 */
export function useFillHeight(ref: RefObject<HTMLElement>, enabled: boolean, gap = 16): number | undefined {
  const [height, setHeight] = useState<number>();
  const measure = useCallback(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    const h = Math.max(320, Math.floor(window.innerHeight - el.getBoundingClientRect().top - gap));
    setHeight((prev) => (prev === h ? prev : h));
  }, [ref, enabled, gap]);
  useLayoutEffect(measure);
  useLayoutEffect(() => {
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [measure]);
  return enabled ? height : undefined;
}
