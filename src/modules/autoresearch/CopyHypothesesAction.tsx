import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { currentArtifact } from '@/core/autoresearch/artifacts';
import { copyHypotheses } from '@/core/autoresearch/copy';
import type { Run } from '@/core/autoresearch/record';
import { useResearchDesign } from '@/modules/researchDesign';
import { Button } from '@/shared/ui/Button';

export function CopyHypothesesAction({ run }: { run: Run }) {
  const design = useResearchDesign();
  const [params] = useSearchParams();
  const [copied, setCopied] = useState('');
  const [busy, setBusy] = useState(false);
  if (design.loading || design.error || currentArtifact(run, 'S8')?.status !== 'accepted') return null;
  const destination = new URLSearchParams(params);
  destination.delete('ar');
  destination.set('design', 'questions');
  const copy = async () => {
    setBusy(true);
    try {
      const stored = await design.update((record) => ({
        ...record,
        draft: copyHypotheses(record.draft, run),
      }));
      setCopied(
        stored.draft.hypotheses.some((h) => h.autoresearch?.runId === run.id)
          ? 'Đã chép hypotheses dưới dạng ứng viên.'
          : 'Các hypotheses đã có trong Research design.',
      );
    } catch {
      setCopied('Không thể chép hypotheses. Vui lòng thử lại.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button disabled={busy} onClick={() => void copy()}>
        Chép hypotheses vào Research design
      </Button>
      {copied && (
        <p role="status">
          {copied} <Link to={`?${destination}`}>Mở Research questions và hypotheses</Link>
        </p>
      )}
    </>
  );
}
