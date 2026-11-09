import { useState } from 'react';
import { planRun } from '@/core/batch';
import type { BatchStep, Paper } from '@/core/schemas';
import { Button } from '@/shared/ui/Button';
import { Card } from '@/shared/ui/Card';
import { Wizard } from '@/shared/ui/Wizard';
import { Checkbox } from '@/shared/ui/Checkbox';
import { TextField } from '@/shared/ui/TextField';
import type { useBatchRun } from './useBatchRun';
import { SectionPicker } from './SectionPicker';
import styles from './page.module.css';

const steps: { id: BatchStep; label: string }[] = [
  { id: 'syntax', label: 'Phân tích câu' },
  { id: 'judge', label: 'Đánh giá ngữ cảnh' },
  { id: 'structure', label: 'Cấu trúc đoạn' },
  { id: 'score', label: 'Chấm điểm' },
  { id: 'transitions', label: 'Chuyển đoạn' },
];
export function BatchPanel({ paper, batch }: { paper: Paper; batch: ReturnType<typeof useBatchRun> }) {
  const [sections, setSections] = useState<string[]>([]);
  const [selectedSteps, setSteps] = useState<BatchStep[]>([]);
  const [budget, setBudget] = useState(150);
  const plan = planRun(paper, { sectionIds: sections, steps: selectedSteps, budget });
  const run = batch.run;
  const done = run?.items.filter((item) => ['done', 'cached', 'skipped'].includes(item.status)).length ?? 0;
  const running = run?.status === 'running';
  const [editing, setEditing] = useState(false);
  const showSetup = (!run || editing) && !running;
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
        <Wizard
          label="Các bước thiết lập phân tích"
          finishLabel="Bắt đầu phân tích"
          finishDisabled={running || !plan.withinBudget || !plan.paragraphs.length || !selectedSteps.length}
          onFinish={() => void batch.start(plan)}
          note={`Ước tính ~${plan.total} lượt gọi AI (giới hạn ${budget})`}
          steps={[
            {
              id: 'sections',
              title: 'Chọn mục',
              summary: `${sections.length} mục`,
              ready: sections.length > 0,
              content: (
                <SectionPicker
                  paper={paper}
                  value={sections}
                  onChange={setSections}
                  disabled={running}
                  legend="Mục cần phân tích"
                  count={(section) =>
                    paper.paragraphs.filter((p) => p.sectionId === section.id && p.kind === 'body').length
                  }
                />
              ),
            },
            {
              id: 'steps',
              title: 'Chọn bước AI',
              summary: `${selectedSteps.length} bước`,
              ready: selectedSteps.length > 0,
              content: (
                <div className={styles.setupSide}>
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
                  <TextField
                    label="Giới hạn lượt gọi"
                    type="number"
                    min={0}
                    step={1}
                    value={budget}
                    disabled={running}
                    onChange={(e) => setBudget(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
                  />
                  {selectedSteps.includes('transitions') && (
                    <p>Chuyển đoạn: ~{plan.calls.transitions ?? 0} lượt gọi AI</p>
                  )}
                  {!plan.withinBudget && <p role="alert">Ước tính vượt giới hạn lượt gọi.</p>}
                </div>
              ),
            },
            {
              id: 'confirm',
              title: 'Xác nhận và chạy',
              content: (
                <p>
                  Sẽ gửi {plan.paragraphs.length} đoạn trong {sections.length} mục cho AI, qua{' '}
                  {selectedSteps.length} bước.
                </p>
              ),
            },
          ]}
        />
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
                value={budget}
                onChange={(e) => setBudget(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
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
