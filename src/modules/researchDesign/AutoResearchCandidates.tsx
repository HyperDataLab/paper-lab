import { useState } from 'react';
import { confirmDesignCandidate } from '@/core/researchDesign/draft/designCandidates';
import type { DesignCandidate } from '@/core/researchDesign/draft/schema';
import { Badge } from '@/shared/ui/Badge';
import { Button } from '@/shared/ui/Button';
import { Card } from '@/shared/ui/Card';
import { useResearchDesign } from './ResearchDesignProvider';

export function AutoResearchCandidates({ section }: { section: string }) {
  const state = useResearchDesign();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (state.loading || state.error) return null;
  const proposal = state.design.draft.autoresearchDesign;
  const rows = proposal?.candidates.filter((row) => row.section === section) ?? [];
  if (!proposal || !rows.length) return null;
  const { context } = proposal;
  const confirm = async (row: DesignCandidate) => {
    setBusy(true);
    setError('');
    try {
      await state.update((record) => ({
        ...record,
        draft: confirmDesignCandidate(record.draft, context.designHash, row.id),
      }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <h3>Ứng viên từ AutoResearch</h3>
      {section === 'design' && (
        <>
          <p>{context.rationale}</p>
          <p>Ước tính compute · {context.compute.estimate}</p>
          <p>Ngân sách compute · {context.compute.budget}</p>
          {context.baselines.map((row, i) => (
            <p key={i}>
              Baseline · {row.name} · {row.why} {row.citeKey}
            </p>
          ))}
          {context.methods.map((row, i) => (
            <p key={i}>
              Method · {row.name} · {row.hypothesisIds.join(', ')}
            </p>
          ))}
          {context.ablations.map((row, i) => (
            <p key={i}>
              Ablation · {row.name} · {row.removes} · {row.hypothesisId}
            </p>
          ))}
        </>
      )}
      {section === 'measurement' &&
        context.licenses.map(({ datasetId, license }) => (
          <p key={datasetId}>
            {datasetId} · Giấy phép · {license}
          </p>
        ))}
      <ul>
        {rows.map((row) => (
          <li key={row.id}>
            {row.label}{' '}
            {row.status === 'candidate' ? (
              <Button
                size="sm"
                aria-label={`Xác nhận ${row.label}`}
                disabled={busy}
                onClick={() => void confirm(row)}
              >
                Xác nhận
              </Button>
            ) : (
              <Badge tone="success">Đã xác nhận</Badge>
            )}
          </li>
        ))}
      </ul>
      {error && (
        <div role="alert">
          Không lưu được xác nhận. Vui lòng thử lại.
          <details>
            <summary>Chi tiết kỹ thuật</summary>
            {error}
          </details>
        </div>
      )}
    </Card>
  );
}
