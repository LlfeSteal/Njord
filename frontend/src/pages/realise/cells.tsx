// Cellules de la table des écritures : texte long tronqué et code avec libellé en bulle (une ligne).
import { Text, Tooltip } from '../../ui';

/** Texte tronqué sur une ligne, complet en bulle. */
export function TruncatedText({ value, maw }: { value: string; maw: number }) {
  if (!value) return <>—</>;
  return (
    <Tooltip label={value} maxWidth={420} delay={300}>
      <Text as="span" truncate style={{ display: 'block', maxWidth: maw }}>
        {value}
      </Text>
    </Tooltip>
  );
}

/** Code avec son libellé en bulle. */
export function CodeCell({ code, label }: { code: string; label: string }) {
  if (!code) return <>—</>;
  return (
    <Tooltip label={label} maxWidth={420} delay={300} disabled={!label}>
      <span>{code}</span>
    </Tooltip>
  );
}
