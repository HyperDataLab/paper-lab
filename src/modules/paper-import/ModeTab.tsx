import { Button } from '@/shared/ui/Button';
import type { Mode } from './paperPlaces';
import type { PaperNavigation } from './usePaperNavigation';

/** A tab of the right column: Issues or Citations. */
export function ModeTab({ item, nav }: { item: { id: Mode; label: string }; nav: PaperNavigation }) {
  return (
    <Button
      role="tab"
      aria-selected={nav.mode === item.id && (nav.wide || nav.focus === 'right')}
      onClick={() => nav.openMode(item.id)}
    >
      {item.label}
    </Button>
  );
}
