import { Button } from '@/shared/ui/Button';
import type { Pane } from './paperPlaces';
import type { PaperNavigation } from './usePaperNavigation';

/** A tab of the centre column: the paper's full text or its summary. */
export function PaneTab({ item, nav }: { item: { id: Pane; label: string }; nav: PaperNavigation }) {
  return (
    <Button
      role="tab"
      aria-selected={nav.pane === item.id && (nav.wide || nav.focus === 'centre')}
      onClick={() => nav.setTab(item.id === 'fulltext' ? 'map' : 'profile')}
    >
      {item.label}
    </Button>
  );
}
