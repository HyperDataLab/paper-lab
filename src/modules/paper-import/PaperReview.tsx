import { useEffect, useRef, useState } from 'react';
import { LENSES, LensSchema, PROMPT_VERSIONS, type Lens } from '@/core/prompts';
import { agreement, anchoringRate, mergePanel, panelSimilarity } from '@/core/reviewPanel';
import type { Paper, PaperChecksRecord, PaperReviewsRecord, ReviewDecision } from '@/core/schemas';
import { useLlm } from '@/shared/llm/LlmProvider';
import { llmPaperReviewer } from '@/shared/llm/llmPaperReviewer';
import { useRepositories } from '@/shared/storage/StorageProvider';
import { Button } from '@/shared/ui/Button';
import { Card } from '@/shared/ui/Card';
import { Checkbox } from '@/shared/ui/Checkbox';
import { TextField } from '@/shared/ui/TextField';
import { LENS_DESCRIPTIONS } from './reviewLabels';
import { ReviewResults } from './ReviewResults';
import styles from './review.module.css';

export function PaperReview({
  paper,
  checks,
  onLocation,
}: {
  paper: Paper;
  checks?: PaperChecksRecord;
  onLocation: (anchor: { paragraphId: string; start: number; end: number }) => void;
}) {
  const repo = useRepositories();
  const llm = useLlm();
  const [record, setRecord] = useState<PaperReviewsRecord>();
  const [loading, setLoading] = useState(true);
  const [notes, setNotes] = useState('');
  const [lenses, setLenses] = useState<Lens[]>([...LensSchema.options]);
  const [sections, setSections] = useState(() =>
    paper.sections
      .filter(
        (s) =>
          !['references', 'appendix'].includes(s.role) &&
          paper.paragraphs.some((p) => p.sectionId === s.id && p.kind === 'body'),
      )
      .map((s) => s.id),
  );
  const [budget, setBudget] = useState(150);
  const [used, setUsed] = useState(0);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    let active = true;
    void repo.paperReviews
      .getVisible(paper.id)
      .then((value) => {
        if (active) {
          setRecord(value);
          setNotes(value?.humanNotes?.text ?? '');
          setLoading(false);
        }
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(String(cause));
          setLoading(false);
        }
      });
    return () => {
      active = false;
      controller.current?.abort();
    };
  }, [paper.id, repo]);
  const characters = paper.paragraphs
    .filter((p) => p.kind === 'body' && sections.includes(p.sectionId))
    .reduce((n, p) => n + p.text.length, 0);
  const hasBody = paper.paragraphs.some((p) => p.kind === 'body' && sections.includes(p.sectionId));
  const tooLarge = characters > 60000;
  const revealed = Boolean(record?.humanNotes?.revealedAt);
  const run = revealed ? record?.runs.at(-1) : undefined;
  async function saveNotes(skip = false) {
    try {
      setRecord(await repo.paperReviews.saveNotes(paper.id, notes, skip));
      if (skip) setNotes('');
      setError('');
    } catch (cause) {
      setError(String(cause));
    }
  }
  async function start() {
    const abort = new AbortController();
    controller.current = abort;
    setRunning(true);
    setUsed(0);
    setError('');
    try {
      if (!(await llm.ensureConsent('paper')) || abort.signal.aborted) return;
      const results = await llmPaperReviewer(llm.client, paper, {
        lenses,
        sectionIds: sections,
        checkSummary:
          checks?.report.checks.map((c) => `${c.label}: ${c.status} — ${c.summary}`).join('; ') ||
          'Chưa chạy kiểm tra.',
        config: llm.config,
        budget,
        signal: abort.signal,
        onRequest: async (count) => setUsed(count),
      });
      if (abort.signal.aborted) return;
      const reviews = results.map((result) => result.review);
      const merged = mergePanel(reviews);
      const saved = await repo.paperReviews.saveRun(paper.id, {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        lenses,
        sectionIds: sections,
        promptVersion: PROMPT_VERSIONS.paperReview,
        model: results[0]?.model ?? llm.config.model,
        reviews,
        merged,
        metrics: {
          anchoring: anchoringRate(reviews),
          similarity: panelSimilarity(reviews),
          templates: [],
          agreement: agreement(merged, record?.humanNotes ?? null),
        },
      });
      if (!abort.signal.aborted) setRecord(saved);
    } catch (cause) {
      if (!abort.signal.aborted) setError(String(cause));
    } finally {
      if (controller.current === abort) {
        controller.current = null;
        setRunning(false);
      }
    }
  }
  async function review(id: string, status: ReviewDecision['status'] | 'candidate') {
    try {
      setRecord(await repo.paperReviews.review(paper.id, id, status));
      setError('');
    } catch (cause) {
      setError(String(cause));
    }
  }
  if (loading) return <p>Đang tải phản biện…</p>;
  const notesPanel = (
    <Card>
      <h2>Nhận xét của bạn</h2>
      <TextField
        multiline
        label="Nhận xét của bạn trước khi xem AI"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
      />
      <Button onClick={() => void saveNotes()}>Lưu</Button>{' '}
      {!revealed && (
        <Button variant="secondary" onClick={() => void saveNotes(true)}>
          Bỏ qua bước này
        </Button>
      )}
    </Card>
  );
  return (
    <div className={styles.panel}>
      {!revealed && notesPanel}
      <Card>
        <h2>Thiết lập phản biện AI</h2>
        <fieldset disabled={running}>
          <legend>Góc nhìn</legend>
          {LensSchema.options.map((lens) => (
            <Checkbox
              key={lens}
              checked={lenses.includes(lens)}
              onChange={(e) =>
                setLenses((old) => (e.target.checked ? [...old, lens] : old.filter((item) => item !== lens)))
              }
            >
              {LENSES[lens].label} — {LENS_DESCRIPTIONS[lens]}
            </Checkbox>
          ))}
        </fieldset>
        <fieldset disabled={running}>
          <legend>Mục được gửi</legend>
          {paper.sections.map((section) => (
            <Checkbox
              key={section.id}
              checked={sections.includes(section.id)}
              onChange={(e) =>
                setSections((old) =>
                  e.target.checked ? [...old, section.id] : old.filter((item) => item !== section.id),
                )
              }
            >
              {section.heading} (
              {paper.paragraphs.filter((p) => p.sectionId === section.id && p.kind === 'body').length} đoạn)
            </Checkbox>
          ))}
        </fieldset>
        <p>
          Ước tính: {characters.toLocaleString('vi-VN')} ký tự · {lenses.length} lượt gọi AI (có thể phát sinh
          khi thử lại hoặc sửa kết quả).
        </p>
        {tooLarge && <p role="alert">Vui lòng chọn ít phần hơn (tối đa 60.000 ký tự).</p>}
        <TextField
          label="Giới hạn lượt gọi phản biện"
          type="number"
          min={0}
          step={1}
          value={budget}
          disabled={running}
          onChange={(e) => setBudget(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
        />
        {lenses.length > budget && <p role="alert">Ước tính vượt giới hạn lượt gọi.</p>}
        <Button
          variant="primary"
          disabled={running || tooLarge || !lenses.length || !hasBody || lenses.length > budget}
          onClick={() => void start()}
        >
          Chạy phản biện (AI)
        </Button>{' '}
        {running && (
          <>
            <Button onClick={() => controller.current?.abort()}>Huỷ</Button>
            <p>
              Đã dùng {used}/{budget} lượt gọi.
            </p>
          </>
        )}
      </Card>
      {error && (
        <div role="alert">
          Không thể xử lý phản biện.
          <details>
            <summary>Chi tiết kỹ thuật</summary>
            {error}
          </details>
        </div>
      )}
      {revealed && (
        <div className={styles.reviewLayout}>
          {notesPanel}
          {run && (
            <ReviewResults
              run={run}
              decisions={record?.decisions ?? []}
              onLocation={onLocation}
              onReview={(id, status) => void review(id, status)}
            />
          )}
        </div>
      )}
    </div>
  );
}
