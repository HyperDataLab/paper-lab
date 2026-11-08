import { useState } from 'react';
import { planRun } from '@/core/batch';
import type { BatchStep, Paper } from '@/core/schemas';
import { Badge } from '@/shared/ui/Badge';
import { Button } from '@/shared/ui/Button';
import { Card } from '@/shared/ui/Card';
import { Checkbox } from '@/shared/ui/Checkbox';
import { TextField } from '@/shared/ui/TextField';
import type { useBatchRun } from './useBatchRun';

const steps: { id: BatchStep; label: string }[] = [
  { id: 'syntax', label: 'Phân tích câu' },
  { id: 'judge', label: 'Đánh giá ngữ cảnh' },
  { id: 'structure', label: 'Cấu trúc đoạn' },
  { id: 'score', label: 'Chấm điểm' },
];
export function BatchPanel({ paper, batch }: { paper: Paper; batch: ReturnType<typeof useBatchRun> }) {
  const [sections, setSections] = useState<string[]>([]);
  const [selectedSteps, setSteps] = useState<BatchStep[]>([]);
  const [budget, setBudget] = useState(150);
  const plan = planRun(paper, { sectionIds: sections, steps: selectedSteps, budget });
  const run = batch.run;
  const done = run?.items.filter((item) => ['done', 'cached', 'skipped'].includes(item.status)).length ?? 0;
  const running = run?.status === 'running';
  return (
    <Card>
      <h2>Phân tích hàng loạt</h2>
      <fieldset disabled={running}>
        <legend>Chọn mục</legend>
        {paper.sections.map((section) => (
          <Checkbox
            key={section.id}
            checked={sections.includes(section.id)}
            onChange={(e) =>
              setSections((old) =>
                e.target.checked ? [...old, section.id] : old.filter((id) => id !== section.id),
              )
            }
          >
            {section.heading} <Badge>{section.role}</Badge> (
            {paper.paragraphs.filter((p) => p.sectionId === section.id && p.kind === 'body').length} đoạn)
          </Checkbox>
        ))}
      </fieldset>
      <fieldset disabled={running}>
        <legend>Các bước AI</legend>
        {steps.map((step) => (
          <Checkbox
            key={step.id}
            checked={selectedSteps.includes(step.id)}
            onChange={(e) =>
              setSteps((old) => (e.target.checked ? [...old, step.id] : old.filter((id) => id !== step.id)))
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
      <p>
        Ước tính ~{plan.total} lượt gọi AI (giới hạn {budget})
      </p>
      {!plan.withinBudget && <p role="alert">Ước tính vượt giới hạn lượt gọi.</p>}
      <Button
        disabled={running || !plan.withinBudget || !plan.paragraphs.length || !selectedSteps.length}
        onClick={() => void batch.start(plan)}
      >
        Bắt đầu
      </Button>{' '}
      {running && (
        <>
          <Button onClick={batch.pause}>Tạm dừng</Button> <Button onClick={batch.cancel}>Huỷ</Button>
        </>
      )}
      {run && ['paused', 'budget_exceeded', 'failed'].includes(run.status) && (
        <>
          <Button onClick={batch.resume}>Tiếp tục</Button> <Button onClick={batch.cancel}>Huỷ</Button>
        </>
      )}
      {batch.error && <p role="alert">Không thể chạy phân tích: {batch.error}</p>}
      {run && (
        <section aria-label="Tiến độ phân tích">
          <p>
            Tiến độ: {done}/{run.items.length} đoạn · {run.callsUsed} lượt gọi
          </p>
          <progress aria-label="Tiến độ tổng" value={done} max={run.items.length || 1} />
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
        </section>
      )}
    </Card>
  );
}
