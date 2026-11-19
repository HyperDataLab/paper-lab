import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { currentArtifact } from '@/core/autoresearch/artifacts';
import { prepareDesignApplication } from '@/core/autoresearch/apply-design';
import type { Run } from '@/core/autoresearch/record';
import { useResearchDesign } from '@/modules/researchDesign';
import { Button } from '@/shared/ui/Button';

export function CopyDesignAction({ run, disabled }: { run: Run; disabled: boolean }) {
  const state = useResearchDesign();
  const [params] = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const artifact = currentArtifact(run, 'S10');
  if (state.loading || state.error || artifact?.status !== 'accepted') return null;
  const target = (section: string) => {
    const next = new URLSearchParams(params);
    next.delete('ar');
    next.set('design', section);
    return `?${next}`;
  };
  const apply = async () => {
    setBusy(true);
    setError('');
    try {
      const change = await prepareDesignApplication(run, state.bank);
      await state.update((record) => {
        if (record.bankRelease !== (state.bank?.release ?? null))
          throw new Error('Writing Bank release changed');
        return { ...record, draft: change(record.draft) };
      });
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button disabled={disabled || busy} onClick={() => void apply()}>
        Áp dụng vào Research design
      </Button>
      {(saved || state.design.draft.autoresearchDesign?.context.designHash === artifact.hash) && (
        <p role="status">
          Xem và xác nhận từng ứng viên trong <Link to={target('design')}>Research design</Link>,{' '}
          <Link to={target('measurement')}>Measurement</Link>,{' '}
          <Link to={target('analyses')}>Statistical analysis</Link> và{' '}
          <Link to={target('runs')}>Ma trận chạy</Link>.
        </p>
      )}
      {error && (
        <div role="alert">
          Chưa áp dụng được thiết kế. Kiểm tra ứng viên và bản Writing Bank của project.
          <details>
            <summary>Chi tiết kỹ thuật</summary>
            {error}
          </details>
        </div>
      )}
    </>
  );
}
