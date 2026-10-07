// Aperçu de l'export « actions à envoyer » (DECISIONS n° 15) : Markdown à copier ou télécharger.
import { useRef } from 'react';
import { Button, Modal, toast } from '../../../ui';
import { IconDownload } from '../../../ui/Icons';
import type { ActionsExport } from './actions';

interface Props {
  opened: boolean;
  onClose: () => void;
  data: ActionsExport;
  /** Nom du fichier téléchargé, sans extension. */
  filename: string;
}

function downloadText(text: string, filename: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function ExportActionsModal({ opened, onClose, data, filename }: Props) {
  const pre = useRef<HTMLPreElement>(null);

  // Presse-papiers refusé (contexte non sécurisé, permission) : le texte est sélectionné pour ⌘C.
  const selectText = () => {
    const sel = window.getSelection();
    if (!pre.current || !sel) return;
    const range = document.createRange();
    range.selectNodeContents(pre.current);
    sel.removeAllRanges();
    sel.addRange(range);
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(data.markdown);
      toast({ tone: 'success', title: 'Copié', message: 'Les actions sont dans le presse-papiers.' });
    } catch {
      selectText();
      toast({ tone: 'info', title: 'Copie impossible', message: 'Le texte est sélectionné : copiez-le avec ⌘C / Ctrl+C.' });
    }
  };

  const s = (n: number, sing: string, plur: string) => `${n} ${n > 1 ? plur : sing}`;
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      size="lg"
      title="Actions à envoyer"
      subtitle={`${s(data.personnes, 'personne', 'personnes')} · ${s(data.semaines, 'semaine', 'semaines')} en écart`}
      footer={
        <>
          <Button onClick={onClose}>Fermer</Button>
          <Button icon={<IconDownload size={15} />} onClick={() => downloadText(data.markdown, `${filename}.md`)}>
            Télécharger .md
          </Button>
          <Button variant="primary" onClick={copy}>
            Copier
          </Button>
        </>
      }
    >
      <pre ref={pre} className="ecarts-export" tabIndex={0} aria-label="Markdown des actions">
        {data.markdown}
      </pre>
    </Modal>
  );
}
