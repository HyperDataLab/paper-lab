import { useState } from 'react';
import { addMetric } from '@/core/researchDesign/draft/measureOps';
import { addHypothesis, addThreat, type DraftResult } from '@/core/researchDesign/draft/ops';
import { addAnalysis } from '@/core/researchDesign/draft/planOps';
import type { Target } from '@/core/researchDesign/suggest/suggest';
import type { Draft } from '@/core/researchDesign/draft/schema';
import type { ResearchDesign } from '@/core/schemas/researchDesign';
import { Badge } from '@/shared/ui/Badge';
import { Button } from '@/shared/ui/Button';
import { Chip } from '@/shared/ui/Chip';
import { Drawer } from '@/shared/ui/Drawer';
import { SegmentedControl } from '@/shared/ui/SegmentedControl';
import { Select } from '@/shared/ui/Select';
import { SheetSection } from '@/shared/ui/SheetSection';
import type { Loaded } from './useEvidence';
import type { FactsDoc } from '@/core/researchDesign/facts/factsDoc';
import type { Paper } from '@/core/researchDesign/papers';
import { useSaveOnceMore } from './useSaveOnceMore';
import { useSuggestions } from './useSuggestions';
import styles from './evidence.module.css';

const TARGETS: { value: Target; label: string }[] = [
  { value: 'hypotheses', label: 'Hypothesis' },
  { value: 'metrics', label: 'Metric' },
  { value: 'threats', label: 'Nguy cơ' },
  { value: 'analyses', label: 'Phân tích' },
];
const slug = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 250);
function addTo(target: Target, draft: Draft, text: string, question: string | null): DraftResult {
  if (target === 'hypotheses')
    return addHypothesis(draft, { statement: text, kind: 'exploratory', question, claim: null });
  if (target === 'threats') return addThreat(draft, { name: text, mitigation: '', bank: null });
  if (target === 'analyses')
    return addAnalysis(draft, {
      hypothesis: null,
      method: null,
      variables: [],
      conditions: [],
      parameters: {},
      assumptions: [text],
      missingPolicy: 'listwise',
      alpha: 0.05,
      correction: 'none',
    });
  return addMetric(draft, {
    name: text,
    key: slug(text),
    unit: '',
    goal: null,
    aggregation: null,
    protocol: text,
    bank: null,
    protocolBank: null,
  });
}
class DraftError extends Error {}

/** AI suggestions are candidates: each one enters the draft only when a person presses its button (D55). */
export function SuggestDrawer({
  state,
  papers,
  docs,
  close,
  openFacts,
  scope,
}: {
  state: Loaded;
  papers: Paper[];
  docs: Record<string, FactsDoc | undefined>;
  close: () => void;
  openFacts: () => void;
  scope?: Target;
}) {
  const [target, setTarget] = useState<Target>(scope ?? 'hypotheses');
  const draft = state.design.draft;
  const result = useSuggestions({ projectId: state.project.id, target, papers, docs, draft });
  const save = useSaveOnceMore(state.save);
  const [added, setAdded] = useState<string[]>([]);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [questions, setQuestions] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function add(text: string, id: string) {
    setBusy(true);
    setError('');
    const update = (design: ResearchDesign) => {
      const next = addTo(target, design.draft, text, questions[id] || null);
      if (!next.ok) throw new DraftError(next.error);
      return { ...design, draft: next.doc };
    };
    try {
      if ((await save(update)) === 'saved') setAdded((current) => [...current, id]);
      else setError('Bản nháp vừa thay đổi ở nơi khác; hãy thử lại.');
    } catch (caught) {
      setError(caught instanceof DraftError ? 'Không thêm được gợi ý này vào bản nháp.' : 'Không lưu được.');
    } finally {
      setBusy(false);
    }
  }
  const sending = result.state === 'sending';
  return (
    <Drawer
      open
      onClose={close}
      side="right"
      size="lg"
      label="Gợi ý từ bảng so sánh"
      title="Gợi ý từ bảng so sánh"
      description="AI đề xuất từ các dữ kiện đã đặt Dùng; bạn chọn cái nào vào bản nháp."
      footer={
        result.factCount > 0 && (
          <>
            <span className={styles.footNote}>Ước tính 1 lượt gọi AI</span>
            <Button
              variant="primary"
              disabled={sending}
              onClick={() => {
                setAdded([]);
                setDismissed([]);
                void result.send();
              }}
            >
              {sending ? 'Đang gửi…' : 'Gửi và nhận gợi ý'}
            </Button>
          </>
        )
      }
    >
      <SegmentedControl
        label="Gợi ý cho"
        value={target}
        options={scope ? TARGETS.filter((entry) => entry.value === scope) : TARGETS}
        onChange={(value) => setTarget(value as Target)}
      />
      {result.factCount === 0 ? (
        <p className={styles.hint}>Chưa có dữ kiện nào được đặt Dùng.</p>
      ) : (
        <p className={styles.hint}>
          Sẽ gửi {result.factCount} dữ kiện đã đặt Dùng (loại, giá trị, tên bài) cùng research questions và
          hypotheses của dự án. Không gửi câu trích hay nội dung Writing Bank.
        </p>
      )}
      {result.state === 'consent' && (
        <p role="alert" className={styles.hint}>
          Cần đồng ý gửi dữ liệu cho AI trước khi dùng tính năng này. Bấm “Gửi và nhận gợi ý” để xem lại thông
          báo quyền riêng tư.
        </p>
      )}
      {result.state === 'unreadable' && <p role="alert">AI trả lời không đúng định dạng; hãy thử lại.</p>}
      {result.state === 'failed' && <p role="alert">{result.message}</p>}
      {error && <p role="alert">{error}</p>}
      {result.droppedCites > 0 && (
        <p className={styles.hint}>Đã bỏ {result.droppedCites} trích dẫn không thuộc dữ kiện đã gửi.</p>
      )}
      {result.state === 'done' && result.suggestions.length === 0 && (
        <p className={styles.hint}>AI không đưa ra gợi ý nào dựa trên các dữ kiện đã gửi.</p>
      )}
      {result.suggestions.map((item, index) => {
        const id = `${target}:${index}`;
        if (dismissed.includes(id)) return null;
        return (
          <SheetSection key={id} title={<Badge tone="accent">Gợi ý của AI</Badge>}>
            <p>{item.text}</p>
            {target === 'analyses' && (
              <p className={styles.hint}>
                Khi thêm, gợi ý được lưu ở giả định; hãy chọn phương pháp và kiểm tra các thiết lập phân tích.
              </p>
            )}
            <div className={styles.row}>
              {item.cites.map((cite) => (
                <Chip key={cite} onClick={openFacts}>
                  {result.citations[cite]}
                </Chip>
              ))}
            </div>
            {added.includes(id) ? (
              <p className={styles.hint}>Đã thêm</p>
            ) : (
              <div className={styles.row}>
                {target === 'hypotheses' && (
                  <Select
                    label="Research question"
                    size="sm"
                    value={questions[id] ?? ''}
                    onChange={(event) => setQuestions({ ...questions, [id]: event.target.value })}
                  >
                    <option value="">Không gắn research question</option>
                    {draft.questions.map((question) => (
                      <option key={question.id} value={question.id}>
                        {question.text}
                      </option>
                    ))}
                  </Select>
                )}
                <Button size="sm" disabled={busy} onClick={() => void add(item.text, id)}>
                  Thêm vào bản nháp
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => setDismissed([...dismissed, id])}
                >
                  Bỏ qua
                </Button>
              </div>
            )}
          </SheetSection>
        );
      })}
    </Drawer>
  );
}
