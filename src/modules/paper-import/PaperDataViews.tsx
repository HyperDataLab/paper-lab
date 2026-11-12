import { useState } from 'react';
import type { Paper } from '@/core/schemas';
import { PaperContribution } from './PaperContribution';
import { PaperDataTable } from './PaperDataTable';
import { Button } from '@/shared/ui/Button';
import { Tabs } from '@/shared/ui/Tabs';

export function PaperDataViews({
  paper,
  onLocation,
}: {
  paper: Paper;
  onLocation: (location: { paragraphId: string; start: number; end: number }) => void;
}) {
  const [view, setView] = useState<'columns' | 'contribution'>('columns');
  return (
    <>
      <Tabs label="Data table views">
        <Button role="tab" aria-selected={view === 'columns'} onClick={() => setView('columns')}>
          Columns
        </Button>
        <Button role="tab" aria-selected={view === 'contribution'} onClick={() => setView('contribution')}>
          Contribution graph
        </Button>
      </Tabs>
      {view === 'columns' ? (
        <PaperDataTable paper={paper} />
      ) : (
        <PaperContribution paper={paper} onLocation={onLocation} />
      )}
    </>
  );
}
