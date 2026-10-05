// Bannière des contrôles qualité métier (§10), repliable, détails dépliables par règle.
import { useState } from 'react';
import { Alert, Anchor, Badge, Collapse, Group, List, Stack, Text } from '@mantine/core';
import { IconAlertTriangle } from '@tabler/icons-react';
import type { QualiteWarning } from '../../api/types';

function WarningItem({ w }: { w: QualiteWarning }) {
  const [open, setOpen] = useState(false);
  const hasDetails = w.details.length > 0;
  return (
    <div>
      <Group gap="xs" wrap="nowrap" align="flex-start">
        <Badge size="sm" variant="light" color="yellow" style={{ flexShrink: 0 }}>
          {w.regle > 0 ? `Règle ${w.regle}` : 'Contrôle'}
        </Badge>
        <Text size="sm" style={{ flex: 1 }}>
          {w.message}{' '}
          <Text span fw={600}>
            ({w.count})
          </Text>
        </Text>
        {hasDetails && (
          <Anchor component="button" type="button" size="xs" onClick={() => setOpen((o) => !o)} aria-expanded={open} style={{ flexShrink: 0 }}>
            {open ? 'Masquer' : `Détails (${w.details.length})`}
          </Anchor>
        )}
      </Group>
      {hasDetails && (
        <Collapse in={open}>
          <List size="xs" ml="xl" mt={4} spacing={2} c="dimmed">
            {w.details.slice(0, 50).map((d, i) => (
              <List.Item key={i}>{d}</List.Item>
            ))}
            {w.details.length > 50 && <List.Item>… {w.details.length - 50} de plus</List.Item>}
          </List>
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
    <Alert
      color="yellow"
      variant="light"
      icon={<IconAlertTriangle size={18} />}
      title={
        <Group gap="sm">
          <span>
            Contrôles qualité : {qualite.length} avertissement{qualite.length > 1 ? 's' : ''} ({total} occurrence{total > 1 ? 's' : ''})
          </span>
          <Anchor component="button" type="button" size="sm" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            {open ? 'Replier' : 'Déplier'}
          </Anchor>
        </Group>
      }
    >
      <Collapse in={open}>
        <Stack gap={6}>
          {qualite.map((w) => (
            <WarningItem key={w.code + w.regle} w={w} />
          ))}
        </Stack>
      </Collapse>
    </Alert>
  );
}
