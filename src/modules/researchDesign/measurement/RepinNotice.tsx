import type { BankDoc } from '@/core/researchDesign/bank/snapshot';
import type { DesignFlag } from '@/core/researchDesign/draft/checkDesign';
import { ActionBar } from '@/shared/ui/ActionBar';
import { Button } from '@/shared/ui/Button';
import { Card } from '@/shared/ui/Card';

/** One notice for every reference pinned to an older snapshot that the current snapshot still has. */
export function RepinNotice({
  flags,
  bank,
  onRepin,
}: {
  flags: DesignFlag[];
  bank: BankDoc | null;
  onRepin: (bank: BankDoc) => void;
}) {
  if (!flags.some((flag) => flag.rule === 'DS-05' && flag.reason === 'other_release')) return null;
  return (
    <Card padding="md">
      <ActionBar status={<p>Một số tham chiếu thuộc bản chụp cũ nhưng vẫn có trong bản chụp hiện tại.</p>}>
        {bank && (
          <Button variant="ghost" onClick={() => onRepin(bank)}>
            Ghim lại theo bản chụp hiện tại
          </Button>
        )}
      </ActionBar>
    </Card>
  );
}
