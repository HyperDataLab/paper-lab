import { runFreshness } from '@/core/runFreshness';
import { useLlm } from '@/shared/llm/LlmProvider';
import { PAPER_PROMPT_VERSIONS } from '@/shared/llm/paperParagraphAnalyzer';
import { useState } from 'react';
import { planRun } from '@/core/batch';
import type { BatchStep, Paper } from '@/core/schemas';
import { Button } from '@/shared/ui/Button';
import { Card } from '@/shared/ui/Card';
import { Checkbox } from '@/shared/ui/Checkbox';
import { TextField } from '@/shared/ui/TextField';
import type { useBatchRun } from './useBatchRun';
import { mainBodySections, usePaperScope, useRunBudget } from './paperScope';
import { RunSetup } from './RunSetup';
import { acceptsSectionRun, useReportJob } from './paperJobs';
import styles from './page.module.css';

const steps: { id: BatchStep; label: string }[] = [
  { id: 'syntax', label: 'Phân tích câu' },
  { id: 'judge', label: 'Đánh giá ngữ cảnh' },
  { id: 'structure', label: 'Cấu trúc đoạn' },
  { id: 'score', label: 'Chấm điểm' },
  { id: 'transitions', label: 'Chuyển đoạn' },
];
export function BatchPanel({ paper, batch }: { paper: Paper; batch: ReturnType<typeof useBatchRun> }) {
  const llm = useLlm();
  const [sections, setSections] = usePaperScope(paper, mainBodySections);
  // Every step is on by default: a first run should answer everything without setup.
  const [selectedSteps, setSteps] = useState<BatchStep[]>(() => steps.map((step) => step.id));
  const total = planRun(paper, {
    sectionIds: sections,
    steps: selectedSteps,
    budget: Number.MAX_SAFE_INTEGER,
  }).total;
  const { budget, setBudget } = useRunBudget(total);
  const plan = planRun(paper, { sectionIds: sections, steps: selectedSteps, budget });
  const run = batch.run;
  const done = run?.items.filter((item) => ['done', 'cached', 'skipped'].includes(item.status)).length ?? 0;
  const running = run?.status === 'running';
  const [editing, setEditing] = useState(false);
  const showSetup = (!run || editing) && !running;
  const staleness = run
    ? runFreshness(
        { sectionIds: run.plan.sectionIds, promptVersions: run.promptVersions, model: run.model },
        { sectionIds: sections, promptVersions: PAPER_PROMPT_VERSIONS, model: llm.config.model },
      )
    : null;
  const sectionChoices = paper.sections
    .map((section) => ({
      id: section.id,
      estimate: planRun(paper, { sectionIds: [section.id], steps: selectedSteps, budget }).total,
    }))
    .filter((choice) => choice.estimate > 0);
  useReportJob('batch', {
    stale: staleness,
    running,
    done: Boolean(run) && !running && !['paused', 'budget_exceeded', 'failed'].includes(run?.status ?? ''),
    estimate: plan.total,
    budget,
    ready: batch.loaded,
    start:
      plan.withinBudget && plan.paragraphs.length && selectedSteps.length ? () => batch.start(plan) : null,
    stop: batch.pause,
    sectionRun:
      run && !running && acceptsSectionRun(staleness) && selectedSteps.length
        ? {
            sections: sectionChoices,
            // Paragraphs already analysed with the same prompts are reused from the cache, so this only
            // spends calls on the chosen section.
            start: (sectionId: string) =>
              batch.start(planRun(paper, { sectionIds: [sectionId], steps: selectedSteps, budget })),
          }
        : null,
  });
  return (
    <Card>
      <div className={styles.sectionHead}>
        <h2>Phân tích chất lượng viết</h2>
        {run && !running && (
          <Button size="sm" variant="ghost" onClick={() => setEditing(!editing)}>
            {editing ? 'Ẩn thiết lập' : 'Chạy với lựa chọn khác'}
          </Button>
        )}
      </div>
      {showSetup && (
        <RunSetup
          paper={paper}
          sections={sections}
          onSections={setSections}
          estimate={plan.total}
          budget={budget}
          onBudget={setBudget}
          budgetLabel="Giới hạn lượt gọi"
          running={running}
          disabled={!plan.paragraphs.length || !selectedSteps.length}
          onStart={() => void batch.start(plan)}
          summary={` · ${plan.paragraphs.length} đoạn · ${selectedSteps.length} bước AI`}
          count={(section) =>
            paper.paragraphs.filter((p) => p.sectionId === section.id && p.kind === 'body').length
          }
        >
          <fieldset disabled={running}>
            <legend>Các bước AI</legend>
            {steps.map((step) => (
              <Checkbox
                key={step.id}
                checked={selectedSteps.includes(step.id)}
                onChange={(e) =>
                  setSteps((old) =>
                    e.target.checked ? [...old, step.id] : old.filter((id) => id !== step.id),
                  )
                }
              >
                {step.label}
              </Checkbox>
            ))}
          </fieldset>
          {selectedSteps.includes('transitions') && (
            <p>Chuyển đoạn: ~{plan.calls.transitions ?? 0} lượt gọi AI</p>
          )}
        </RunSetup>
      )}
      <div className={styles.filterBar}>
        {running && (
          <>
            <Button onClick={batch.pause}>Tạm dừng</Button> <Button onClick={batch.cancel}>Huỷ</Button>
          </>
        )}
        {run && ['paused', 'budget_exceeded', 'failed'].includes(run.status) && (
          <>
            {!showSetup && (
              <TextField
                label="Giới hạn lượt gọi"
                type="number"
                min={0}
                step={1}
                value={String(budget)}
                onChange={(e) => setBudget(e.target.value)}
              />
            )}
            <Button variant="primary" onClick={() => batch.resume(budget)}>
              Tiếp tục chạy
            </Button>{' '}
            <Button onClick={batch.cancel}>Huỷ</Button>
          </>
        )}
      </div>
      {batch.error && <p role="alert">Không thể chạy phân tích: {batch.error}</p>}
      {run && (
        <section aria-label="Tiến độ phân tích">
          <p>
            Tiến độ: {done}/{run.items.length} đoạn · {run.callsUsed} lượt gọi
          </p>
          <progress aria-label="Tiến độ tổng" value={done} max={run.items.length || 1} />
          <details>
            <summary>Tiến độ theo mục</summary>
            {paper.sections
              .filter((section) => run.plan.sectionIds.includes(section.id))
              .map((section) => {
                const ids = new Set(
                  run.plan.paragraphs.filter((p) => p.sectionId === section.id).map((p) => p.paragraphId),
                );
                const items = run.items.filter((item) => ids.has(item.paragraphId));
                return (
                  <p key={section.id}>
                    {section.heading}:{' '}
                    {items.filter((item) => ['done', 'cached', 'skipped'].includes(item.status)).length}/
                    {items.length}
                  </p>
                );
              })}
          </details>
        </section>
      )}
    </Card>
  );
}
