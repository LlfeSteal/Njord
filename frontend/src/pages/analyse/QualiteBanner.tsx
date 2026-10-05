// Bannière des contrôles qualité métier (§10), repliable, détails dépliables par règle.
import { useState } from 'react';
import { Banner, Button, Collapse, Group, Pill, Stack, Text } from '../../ui';
import type { QualiteWarning } from '../../api/types';

function WarningItem({ w }: { w: QualiteWarning }) {
  const [open, setOpen] = useState(false);
  const hasDetails = w.details.length > 0;
  return (
    <div>
      <Group gap={8} wrap={false} align="start">
        <Pill>{w.regle > 0 ? `Règle ${w.regle}` : 'Contrôle'}</Pill>
        <Text tone="primary" style={{ flex: 1 }}>
          {w.message}{' '}
          <Text as="span" weight={600} tabular>
            ({w.count})
          </Text>
        </Text>
        {hasDetails && (
          <Button variant="plain" size="sm" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            {open ? 'Masquer' : `Détails (${w.details.length})`}
          </Button>
        )}
      </Group>
      {hasDetails && (
        <Collapse opened={open}>
          <ul className="analyse-details">
            {w.details.slice(0, 50).map((d, i) => (
              <li key={i}>{d}</li>
            ))}
            {w.details.length > 50 && <li>… {w.details.length - 50} de plus</li>}
          </ul>
        </Collapse>
      )}
    </div>
  );
}

export default function QualiteBanner({ qualite }: { qualite: QualiteWarning[] }) {
  const [open, setOpen] = useState(true);
  if (!qualite.length) return null;
  const total = qualite.reduce((s, w) => s + w.count, 0);
  return (
    <Banner
      tone="warning"
      title={`Contrôles qualité : ${qualite.length} avertissement${qualite.length > 1 ? 's' : ''} (${total} occurrence${total > 1 ? 's' : ''})`}
      action={
        <Button variant="plain" size="sm" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? 'Replier' : 'Déplier'}
        </Button>
      }
    >
      <Collapse opened={open}>
        <Stack gap={6} mt={4}>
          {qualite.map((w) => (
            <WarningItem key={w.code + w.regle} w={w} />
          ))}
        </Stack>
      </Collapse>
    </Banner>
  );
}
