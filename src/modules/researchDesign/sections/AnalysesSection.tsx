import { useState } from 'react';
import { checkPlan } from '@/core/researchDesign/draft/checkPlan';
import { addAnalysis, editAnalysis, removeAnalysis } from '@/core/researchDesign/draft/planOps';
import type { Draft, DraftAnalysis } from '@/core/researchDesign/draft/schema';
import type { DraftResult } from '@/core/researchDesign/draft/ops';
import { ResearchDesignConflictError } from '@/shared/storage/errors';
import { Badge } from '@/shared/ui/Badge';
import { Button } from '@/shared/ui/Button';
import { Card } from '@/shared/ui/Card';
import { Dialog } from '@/shared/ui/Dialog';
import { useResearchDesign } from '../ResearchDesignProvider';
import { SectionSuggest } from '../evidence/SectionSuggest';
import { AnalysisDialog } from '../analyses/AnalysisDialog';
import { ChainLine } from '../analyses/ChainLine';
import {
  capitaliseFirst,
  correctionWords,
  methodWords,
  missingPolicyWords,
  planFlagText,
} from '../analyses/planText';

export default function AnalysesSection() {
  const state = useResearchDesign();
  const [editor, setEditor] = useState<{ hypothesis: string | null; item?: DraftAnalysis } | null>(null);
  const [deleting, setDeleting] = useState<DraftAnalysis | null>(null);
  const [error, setError] = useState('');
  if (state.loading) return <p>Đang tải…</p>;
  if (state.error) return <p>Không tải được statistical analysis.</p>;
  const { draft } = state.design;
  const flags = checkPlan(draft);
  const change = async (op: (d: Draft) => DraftResult) => {
    try {
      await state.update((record) => {
        const result = op(record.draft);
        if (!result.ok) throw new Error(result.error);
        return { ...record, draft: result.doc };
      });
      setError('');
      return true;
    } catch (failure) {
      if (failure instanceof ResearchDesignConflictError) {
        void state.reload().catch(() => undefined);
        setError(
          'Dữ liệu vừa thay đổi ở nơi khác nên chưa lưu được. Đã cập nhật bản mới nhất, vui lòng thử lại.',
        );
      } else setError('Không thể lưu thay đổi. Vui lòng kiểm tra nội dung và liên kết.');
      return false;
    }
  };
  function renderAnalysis(a: DraftAnalysis) {
    return (
      <div key={a.id}>
        <p>
          {a.id} {a.method ? capitaliseFirst(methodWords(a.method)) : 'Chưa chọn phương pháp'}{' '}
          {flags.some((f) => f.rule === 'AN-07' && f.subject === a.id) && (
            <Badge tone="warning">SRD chưa hỗ trợ</Badge>
          )}
        </p>
        <p>
          Variable:{' '}
          {a.variables
            .map((id) => `${id} ${draft.variables.find((v) => v.id === id)?.name ?? ''}`.trim())
            .join(', ') || 'chưa chọn'}
        </p>
        <p>
          So sánh:{' '}
          {a.conditions
            .map((id) => `${id} ${draft.conditions.find((c) => c.id === id)?.name ?? ''}`.trim())
            .join(' → ') || 'chưa chọn'}
        </p>
        <p>
          α = {a.alpha} · hiệu chỉnh: {correctionWords(a.correction)} · thiếu dữ liệu:{' '}
          {missingPolicyWords(a.missingPolicy)}
        </p>
        {Object.entries(a.parameters).map(([k, v]) => (
          <p key={k}>
            {k} = {String(v)}
          </p>
        ))}{' '}
        {a.assumptions.map((s, i) => (
          <p key={i}>{s}</p>
        ))}
        {flags
          .filter((f) => f.subject === a.id)
          .map((f, i) => (
            <p key={i}>
              {f.level === 'warning' && <Badge tone="warning">Cần xem lại</Badge>} {planFlagText(f, draft)}
            </p>
          ))}
        <Button variant="ghost" onClick={() => setEditor({ hypothesis: a.hypothesis, item: a })}>
          Sửa
        </Button>
        <Button variant="ghost" onClick={() => setDeleting(a)}>
          Xoá
        </Button>
      </div>
    );
  }
  return (
    <>
      <p>Khai báo trước phép kiểm định cho từng hypothesis.</p>
      <SectionSuggest state={state} target="analyses" />
      {error && <p role="alert">{error}</p>}
      {!draft.hypotheses.length && (
        <p>Chưa có hypothesis nào. Thêm hypothesis ở tab Research questions và hypotheses.</p>
      )}
      {[...draft.hypotheses]
        .sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }))
        .map((h) => (
          <Card key={h.id}>
            <h3>
              {h.id} {h.statement}
            </h3>
            <ChainLine draft={draft} hypothesisId={h.id} />
            {draft.analyses.filter((a) => a.hypothesis === h.id).map(renderAnalysis)}
            <Button onClick={() => setEditor({ hypothesis: h.id })}>Thêm phân tích</Button>
          </Card>
        ))}
      <Card>
        <h3>Không gắn hypothesis</h3>
        {draft.analyses
          .filter((a) => !draft.hypotheses.some((h) => h.id === a.hypothesis))
          .map(renderAnalysis)}
        <Button onClick={() => setEditor({ hypothesis: null })}>Thêm phân tích</Button>
      </Card>
      {editor && (
        <AnalysisDialog
          draft={draft}
          hypothesis={editor.hypothesis}
          item={editor.item}
          close={() => setEditor(null)}
          save={(value) =>
            change((d) => (editor.item ? editAnalysis(d, editor.item.id, value) : addAnalysis(d, value)))
          }
        />
      )}
      {deleting && (
        <Dialog title="Xoá phân tích" description={`Xoá ${deleting.id}?`} onClose={() => setDeleting(null)}>
          <Button onClick={() => setDeleting(null)}>Hủy</Button>
          <Button
            variant="danger"
            onClick={() =>
              void change((d) => removeAnalysis(d, deleting.id)).then((ok) => {
                if (ok) setDeleting(null);
              })
            }
          >
            Xoá
          </Button>
        </Dialog>
      )}
    </>
  );
}
