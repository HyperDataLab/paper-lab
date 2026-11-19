import type { LabKgError } from '@/shared/labKg/client';
import { Button } from '@/shared/ui/Button';

export function ErrorNote({ error, onRetry }: { error: LabKgError; onRetry?: () => void }) {
  return (
    <div role="alert">
      {error.message}{' '}
      {onRetry && (
        <Button size="sm" variant="ghost" onClick={onRetry}>
          Thử lại
        </Button>
      )}
      {error.detail && (
        <details>
          <summary>Chi tiết kỹ thuật</summary>
          {error.detail}
        </details>
      )}
    </div>
  );
}
