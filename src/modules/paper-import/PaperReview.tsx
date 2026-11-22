import { runFreshness } from '@/core/runFreshness';
import { useStoredChanged } from './paperJobs';
import { useEffect, useRef, useState } from 'react';
import { LENSES, LensSchema, PROMPT_VERSIONS, type Lens } from '@/core/prompts';
import { agreement, anchoringRate, mergePanel, panelSimilarity } from '@/core/reviewPanel';
import type { Paper, PaperChecksRecord, PaperReviewsRecord, ReviewDecision } from '@/core/schemas';
import { useLlm } from '@/shared/llm/LlmProvider';
import { llmPaperReviewer } from '@/shared/llm/llmPaperReviewer';
import { useRepositories } from '@/shared/storage/StorageProvider';
import { ActionBar } from '@/shared/ui/ActionBar';
import { Button } from '@/shared/ui/Button';
import { Wizard } from '@/shared/ui/Wizard';
import { Card } from '@/shared/ui/Card';
import { Checkbox } from '@/shared/ui/Checkbox';
import { TextField } from '@/shared/ui/TextField';
import { LENS_DESCRIPTIONS } from './reviewLabels';
import { ReviewResults } from './ReviewResults';
import { usePaperScope, useRunBudget } from './paperScope';
import { SectionPicker } from './SectionPicker';
import { useReportJob } from './paperJobs';
import styles from './review.module.css';
import { captureCalibration } from '@/shared/calibration/data';
import { Loading } from '@/shared/ui/StateNote';

const reviewSections = (paper: Paper) =>
  paper.sections
    .filter(
      (s) =>
        !['references', 'appendix'].includes(s.role) &&
        paper.paragraphs.some((p) => p.sectionId === s.id && p.kind === 'body'),
    )
    .map((s) => s.id);

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
  const notifyStoredChanged = useStoredChanged();
  const llm = useLlm();
  const [record, setRecord] = useState<PaperReviewsRecord>();
  const [loading, setLoading] = useState(true);
  const [notes, setNotes] = useState('');
  const [lenses, setLenses] = useState<Lens[]>([...LensSchema.options]);
  const [sections, setSections] = usePaperScope(paper, reviewSections);
  const { budget, setBudget } = useRunBudget(lenses.length);
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
      notifyStoredChanged();
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
      const calibrationSnapshot = await captureCalibration(repo);
      let callsUsed = 0;
      const results = await llmPaperReviewer(llm.client, paper, {
        lenses,
        sectionIds: sections,
        checkSummary:
          checks?.report.checks.map((c) => `${c.label}: ${c.status} — ${c.summary}`).join('; ') ||
          'Chưa chạy kiểm tra.',
        config: llm.config,
        budget,
        signal: abort.signal,
        onRequest: async (count) => {
          callsUsed = count;
          setUsed(count);
        },
      });
      if (abort.signal.aborted) return;
      const reviews = results.map((result) => result.review);
      const merged = mergePanel(reviews);
      const saved = await repo.paperReviews.saveRun(paper.id, {
        calibrationSnapshot,
        callsUsed,
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
      notifyStoredChanged();
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
      notifyStoredChanged();
      setError('');
    } catch (cause) {
      setError(String(cause));
    }
  }
  // The reader's own notes come first, so this analysis is never started from outside.
  useReportJob('review', {
    stale: run
      ? runFreshness(
          { sectionIds: run.sectionIds, promptVersions: { main: run.promptVersion }, model: run.model },
          {
            sectionIds: sections,
            promptVersions: { main: PROMPT_VERSIONS.paperReview },
            model: llm.config.model,
          },
        )
      : null,
    running,
    done: Boolean(run),
    estimate: lenses.length,
    ready: !loading,
    start: null,
  });
  if (loading) return <Loading label="Đang tải phản biện…" />;
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
      {!revealed && !running && (record?.runs.length ?? 0) > 0 && (
        <p role="status">
          Đã có kết quả phản biện của AI. Lưu nhận xét của bạn hoặc bấm “Bỏ qua bước này” ở trên để xem.
        </p>
      )}
      <Card>
        <h2>Thiết lập phản biện AI</h2>
        {running ? (
          <ActionBar
            busy
            status={
              <span role="status">
                Đã dùng {used}/{budget} lượt gọi.
              </span>
            }
          >
            <Button variant="danger" onClick={() => controller.current?.abort()}>
              Huỷ
            </Button>
          </ActionBar>
        ) : (
          <Wizard
            label="Các bước thiết lập phản biện"
            finishLabel="Chạy phản biện (AI)"
            finishDisabled={tooLarge || !lenses.length || !hasBody || lenses.length > budget}
            onFinish={() => void start()}
            note={`Ước tính: ${characters.toLocaleString('vi-VN')} ký tự · ${lenses.length} lượt gọi AI (có thể phát sinh khi thử lại hoặc sửa kết quả).`}
            steps={[
              {
                id: 'lenses',
                title: 'Chọn góc nhìn',
                summary: `${lenses.length} góc nhìn`,
                ready: lenses.length > 0,
                content: (
                  <fieldset>
                    <legend>Góc nhìn</legend>
                    {LensSchema.options.map((lens) => (
                      <Checkbox
                        key={lens}
                        checked={lenses.includes(lens)}
                        onChange={(e) =>
                          setLenses((old) =>
                            e.target.checked ? [...old, lens] : old.filter((item) => item !== lens),
                          )
                        }
                      >
                        {LENSES[lens].label} — {LENS_DESCRIPTIONS[lens]}
                      </Checkbox>
                    ))}
                  </fieldset>
                ),
              },
              {
                id: 'sections',
                title: 'Chọn section',
                summary: `${sections.length} section`,
                ready: hasBody && !tooLarge,
                content: (
                  <>
                    <SectionPicker
                      paper={paper}
                      value={sections}
                      onChange={setSections}
                      legend="Section được gửi"
                      count={(section) =>
                        paper.paragraphs.filter((p) => p.sectionId === section.id && p.kind === 'body').length
                      }
                    />
                    {tooLarge && <p role="alert">Vui lòng chọn ít phần hơn (tối đa 60.000 ký tự).</p>}
                  </>
                ),
              },
              {
                id: 'confirm',
                title: 'Xác nhận và chạy',
                content: (
                  <>
                    <TextField
                      label="Giới hạn lượt gọi phản biện"
                      type="number"
                      min={0}
                      step={1}
                      value={budget}
                      onChange={(e) => setBudget(e.target.value)}
                    />
                    {lenses.length > budget && <p role="alert">Ước tính vượt giới hạn lượt gọi.</p>}
                  </>
                ),
              },
            ]}
          />
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
              paper={paper}
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
