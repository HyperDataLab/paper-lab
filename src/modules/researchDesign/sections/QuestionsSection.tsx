import { useState } from 'react';
import { checkDesign } from '@/core/researchDesign/draft/checkDesign';
import { Link } from 'react-router-dom';
import { users } from '@/core/researchDesign/draft/measureOps';
import {
  addQuestion,
  editQuestion,
  removeQuestion,
  addHypothesis,
  editHypothesis,
  removeHypothesis,
} from '@/core/researchDesign/draft/ops';
import type { Draft, DraftQuestion, DraftHypothesis } from '@/core/researchDesign/draft/schema';
import { ResearchDesignConflictError } from '@/shared/storage/errors';
import { Button } from '@/shared/ui/Button';
import { Card } from '@/shared/ui/Card';
import { Badge } from '@/shared/ui/Badge';
import { Dialog } from '@/shared/ui/Dialog';
import { Empty, Loading } from '@/shared/ui/StateNote';
import { useToast } from '@/shared/ui/toastContext';
import { useResearchDesign } from '../ResearchDesignProvider';
import { SectionSuggest } from '../evidence/SectionSuggest';
import { QuestionEditor, HypothesisEditor } from '../questions/Editors';
import { kinds, claimLabel } from '../questions/view';
import { ChainLine } from '../analyses/ChainLine';
import { flagText } from '../design/flagText';
import type { DraftResult } from '@/core/researchDesign/draft/ops';
import { confirmCopiedHypothesis } from '@/core/autoresearch/copy';

type Editor =
  | { type: 'question'; item?: DraftQuestion }
  | { type: 'hypothesis'; item?: DraftHypothesis; question: string | null };
type Deletion = { type: 'question' | 'hypothesis'; id: string };

export default function QuestionsSection() {
  const state = useResearchDesign();
  const toast = useToast();
  const [editor, setEditor] = useState<Editor | null>(null);
  const [deletion, setDeletion] = useState<Deletion | null>(null);
  if (state.loading) return <Loading />;
  if (state.error) return <Empty title="Không tải được research questions và hypotheses." />;
  const { draft } = state.design;
  const change = async (fn: (draft: Draft) => DraftResult) => {
    try {
      await state.update((record) => {
        const next = fn(record.draft);
        if (!next.ok) throw new Error(next.error);
        return { ...record, draft: next.doc };
      });
      return true;
    } catch (error) {
      if (error instanceof ResearchDesignConflictError) {
        // Two saves in a row lost to another writer: show the stored record before the person tries again.
        void state.reload().catch(() => undefined);
        toast(
          'Dữ liệu vừa thay đổi ở nơi khác nên chưa lưu được. Đã cập nhật bản mới nhất, vui lòng thử lại.',
        );
      } else toast('Không thể lưu thay đổi. Vui lòng kiểm tra nội dung và liên kết.');
      return false;
    }
  };
  const flags = checkDesign(draft, state.bank);
  const rows = (hypotheses: DraftHypothesis[]) =>
    hypotheses.map((h) => {
      return (
        <section key={h.id}>
          <p>
            {h.id} · {h.statement} · {kinds[h.kind]}
          </p>
          {h.autoresearch?.status === 'candidate' && (
            <>
              <Badge tone="warning">Ứng viên từ AutoResearch</Badge>
              <Button
                variant="ghost"
                onClick={() =>
                  void change((draft) => ({
                    ok: true,
                    doc: confirmCopiedHypothesis(draft, h.id),
                  }))
                }
              >
                Xác nhận hypothesis
              </Button>
            </>
          )}
          {h.autoresearch?.primary && <Badge tone="accent">Primary hypothesis</Badge>}
          <p>{claimLabel(h.claim, state.bank?.collections['claim-types'] ?? [])}</p>
          <ChainLine draft={draft} hypothesisId={h.id} />
          {flags
            .filter((f) => f.subject === h.id)
            .map((f, i) => (
              <p key={`${f.rule}-${i}`}>Cần xem lại · {flagText(f, draft, state.bank)}</p>
            ))}
          <Button
            variant="ghost"
            onClick={() => setEditor({ type: 'hypothesis', item: h, question: h.question })}
          >
            Sửa
          </Button>
          <Button variant="ghost" onClick={() => setDeletion({ type: 'hypothesis', id: h.id })}>
            Xoá
          </Button>
        </section>
      );
    });
  const unattached = draft.hypotheses.filter(
    (h) => !h.question || !draft.questions.some((q) => q.id === h.question),
  );
  const references = deletion?.type === 'hypothesis' ? users(draft, deletion.id) : [];
  const count =
    deletion?.type === 'question' ? draft.hypotheses.filter((h) => h.question === deletion.id).length : 0;
  return (
    <>
      <h3>Research questions và hypotheses</h3>
      <p>Mỗi research question và hypothesis có mã ổn định, nối với research gap tìm được.</p>
      <SectionSuggest state={state} target="hypotheses" />
      <Button variant="primary" onClick={() => setEditor({ type: 'question' })}>
        Thêm research question
      </Button>
      {draft.questions.length === 0 && (
        <Empty
          title="Chưa có research question nào."
          hint="Bắt đầu bằng research question mà nghiên cứu này trả lời."
        />
      )}
      {[...draft.questions]
        .sort((a, b) => Number(a.id.slice(2)) - Number(b.id.slice(2)))
        .map((q) => (
          <Card key={q.id}>
            <p>
              {q.id} · {q.text}
            </p>
            <p>Research gap: {q.gap || 'Chưa ghi research gap'}</p>
            {q.papers.map((id) => (
              <p key={id}>
                {(() => {
                  const paper = state.project.papers.find((p) => p.key === id);
                  const title =
                    state.papers.papers.find((p) => p.id === id)?.title ?? 'Bài báo không còn trong dự án';
                  return paper?.source.kind === 'paper' ? (
                    <Link to={`/papers/${paper.source.paperId}`}>{title}</Link>
                  ) : (
                    title
                  );
                })()}
              </p>
            ))}
            <Button variant="ghost" onClick={() => setEditor({ type: 'question', item: q })}>
              Sửa
            </Button>
            <Button variant="ghost" onClick={() => setDeletion({ type: 'question', id: q.id })}>
              Xoá
            </Button>
            <Button variant="ghost" onClick={() => setEditor({ type: 'hypothesis', question: q.id })}>
              Thêm hypothesis
            </Button>
            {rows(draft.hypotheses.filter((h) => h.question === q.id))}
          </Card>
        ))}
      {unattached.length > 0 && (
        <Card>
          <h3>Chưa gắn research question</h3>
          {rows(unattached)}
        </Card>
      )}
      {editor?.type === 'question' && (
        <QuestionEditor
          initial={editor.item}
          papers={state.papers.papers}
          close={() => setEditor(null)}
          save={(v) => change((d) => (editor.item ? editQuestion(d, editor.item.id, v) : addQuestion(d, v)))}
        />
      )}
      {editor?.type === 'hypothesis' && (
        <HypothesisEditor
          initial={editor.item}
          question={editor.question}
          draft={draft}
          bank={state.bank}
          close={() => setEditor(null)}
          save={(v) =>
            change((d) => (editor.item ? editHypothesis(d, editor.item.id, v) : addHypothesis(d, v)))
          }
        />
      )}
      {deletion && (
        <Dialog
          title={deletion.type === 'question' ? 'Xoá research question' : 'Xoá hypothesis'}
          description={
            references.length
              ? `${deletion.id} đang được dùng bởi ${references.join(', ')}. Gỡ liên kết trước khi xoá.`
              : count
                ? `research question này còn ${count} ${count === 1 ? 'hypothesis' : 'hypotheses'}. Chuyển hoặc xoá các hypotheses trước.`
                : `Xoá ${deletion.id}?`
          }
          onClose={() => setDeletion(null)}
        >
          <Button onClick={() => setDeletion(null)}>Hủy</Button>
          {!count && !references.length && (
            <Button
              variant="danger"
              onClick={() =>
                void change((d) =>
                  deletion.type === 'question'
                    ? removeQuestion(d, deletion.id)
                    : removeHypothesis(d, deletion.id),
                ).then((ok) => {
                  if (ok) setDeletion(null);
                })
              }
            >
              Xoá
            </Button>
          )}
        </Dialog>
      )}
    </>
  );
}
