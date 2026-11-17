import { useState } from 'react';
import { checkDesign } from '@/core/researchDesign/draft/checkDesign';
import { chainOf } from '@/core/researchDesign/draft/checkChain';
import { users } from '@/core/researchDesign/draft/measureOps';
import {
  addQuestion,
  editQuestion,
  removeQuestion,
  addHypothesis,
  editHypothesis,
  removeHypothesis,
  type DraftResult,
} from '@/core/researchDesign/draft/ops';
import type { Draft, DraftQuestion, DraftHypothesis } from '@/core/researchDesign/draft/schema';
import { ResearchDesignConflictError } from '@/shared/storage/researchDesigns';
import { Button } from '@/shared/ui/Button';
import { Card } from '@/shared/ui/Card';
import { Dialog } from '@/shared/ui/Dialog';
import { Empty, Loading } from '@/shared/ui/StateNote';
import { useToast } from '@/shared/ui/toastContext';
import { useResearchDesign } from '../ResearchDesignProvider';
import { QuestionEditor, HypothesisEditor } from '../questions/Editors';
import { kinds, claimLabel } from '../questions/view';

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
  if (state.error) return <Empty title="Không tải được câu hỏi và giả thuyết." />;
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
      const chain = chainOf(draft, h.id);
      return (
        <section key={h.id}>
          <p>
            {h.id} · {h.statement} · {kinds[h.kind]}
          </p>
          <p>{claimLabel(h.claim, state.bank?.collections['claim-types'] ?? [])}</p>
          {chain.dependent.length ? (
            chain.dependent.map(({ variable, metric }, index) => (
              <p key={h.dependent[index]}>
                {h.id} → {variable ? `${variable.id} ${variable.name}` : 'biến phụ thuộc không tồn tại'} →{' '}
                {metric ? `${metric.id} ${metric.key || 'metric chưa có key'}` : 'chưa có metric'}
              </p>
            ))
          ) : (
            <p>{h.id} → chưa gắn biến phụ thuộc</p>
          )}
          {chain.independent.length > 0 && (
            <p>
              Biến độc lập:{' '}
              {chain.independent.map((v) => `${v.id} ${v.name} (${v.levels.join(', ')})`).join(', ')}
            </p>
          )}
          {flags
            .filter((f) => f.subject === h.id)
            .map((f, i) => (
              <p key={`${f.rule}-${i}`}>Cần xem lại · {f.rule}</p>
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
      <h3>Câu hỏi và giả thuyết</h3>
      <p>Câu hỏi nghiên cứu và giả thuyết có mã ổn định, nối với khoảng trống tìm được.</p>
      {/* TODO: Gợi ý từ bảng so sánh is owned by the comparison-table integration. */}
      <Button variant="primary" onClick={() => setEditor({ type: 'question' })}>
        Thêm câu hỏi
      </Button>
      {draft.questions.length === 0 && (
        <Empty title="Chưa có câu hỏi nào." hint="Bắt đầu bằng câu hỏi mà nghiên cứu này trả lời." />
      )}
      {[...draft.questions]
        .sort((a, b) => Number(a.id.slice(2)) - Number(b.id.slice(2)))
        .map((q) => (
          <Card key={q.id}>
            <p>
              {q.id} · {q.text}
            </p>
            <p>Khoảng trống: {q.gap || 'Chưa ghi khoảng trống'}</p>
            {q.papers.map((id) => (
              <p key={id}>
                {state.papers.papers.find((p) => p.id === id)?.title ?? 'Bài báo không còn trong dự án'}
              </p>
            ))}
            <Button variant="ghost" onClick={() => setEditor({ type: 'question', item: q })}>
              Sửa
            </Button>
            <Button variant="ghost" onClick={() => setDeletion({ type: 'question', id: q.id })}>
              Xoá
            </Button>
            <Button variant="ghost" onClick={() => setEditor({ type: 'hypothesis', question: q.id })}>
              Thêm giả thuyết
            </Button>
            {rows(draft.hypotheses.filter((h) => h.question === q.id))}
          </Card>
        ))}
      {unattached.length > 0 && (
        <Card>
          <h3>Chưa gắn câu hỏi</h3>
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
          title={deletion.type === 'question' ? 'Xoá câu hỏi' : 'Xoá giả thuyết'}
          description={
            references.length
              ? `${deletion.id} đang được dùng bởi ${references.join(', ')}. Gỡ liên kết trước khi xoá.`
              : count
                ? `Câu hỏi này còn ${count} giả thuyết. Chuyển hoặc xoá các giả thuyết trước.`
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
