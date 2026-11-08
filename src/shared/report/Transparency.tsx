import { useEffect, useState } from 'react';
import type { AnalysisReport, Paper, PaperRun, PaperReviewsRecord, PaperProbesRecord } from '@/core/schemas';
import { useRepositories } from '@/shared/storage/StorageProvider';
import { downloadJson } from '@/shared/calibration/download';
import { Button } from '@/shared/ui/Button';

type Step = {
  step: string;
  model: string | null;
  prompt: string | null;
  rubric: string | null;
  detectors: string | null;
  date: string | null;
  calls: number | null;
  sections: string[] | null;
  calibration: null;
};
function analysisSteps(report: AnalysisReport): Step[] {
  const a = report.analysis;
  const make = (step: string, model: string | null, prompt: string | null): Step => ({
    step,
    model,
    prompt,
    rubric: a.versions.rubric,
    detectors: a.versions.detectors,
    date: null,
    calls: null,
    sections: null,
    calibration: null,
  });
  return [
    make('Phân tích câu', a.versions.model, a.versions.prompt),
    make('Cấu trúc đoạn', a.versions.structureModel, a.versions.structurePrompt),
    make('Chấm điểm', a.versions.scoringModel, a.versions.scoringPrompt),
  ];
}
function paperSteps(
  paper: Paper,
  runs: PaperRun[],
  reviews?: PaperReviewsRecord,
  probes?: PaperProbesRecord,
): Step[] {
  const sections = (ids: string[]) => ids.map((id) => paper.sections.find((s) => s.id === id)?.heading ?? id);
  return [
    ...runs.map((run): Step => ({
      step: `Phân tích bài báo: ${run.plan.steps.join(', ')}`,
      model: run.model,
      prompt: Object.entries(run.promptVersions)
        .map(([key, value]) => `${key}: ${value}`)
        .join(', '),
      rubric: null,
      detectors: null,
      date: run.createdAt,
      calls: run.callsUsed,
      sections: null,
      calibration: null,
    })),
    ...(reviews?.runs ?? []).map((run): Step => ({
      step: 'Phản biện AI',
      model: run.model,
      prompt: run.promptVersion,
      rubric: null,
      detectors: null,
      date: run.createdAt,
      calls: null,
      sections: sections(run.sectionIds),
      calibration: null,
    })),
    ...(probes?.runs ?? []).map((run): Step => ({
      step: 'Độ bền điểm',
      model: run.model,
      prompt: Object.entries(run.promptVersions)
        .map(([key, value]) => `${key}: ${value}`)
        .join(', '),
      rubric: null,
      detectors: null,
      date: run.createdAt,
      calls: run.callsUsed,
      sections: sections([...new Set(run.items.map((item) => item.sectionId))]),
      calibration: null,
    })),
  ];
}
export function Transparency({ paper, report }: { paper?: Paper; report?: AnalysisReport }) {
  const repo = useRepositories();
  const [paperEntries, setSteps] = useState<Step[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!paper) return;
    let active = true;
    void Promise.all([
      repo.paperRuns.listByPaper(paper.id),
      repo.paperReviews.get(paper.id),
      repo.paperProbes.get(paper.id),
    ])
      .then(([runs, reviews, probes]) => {
        if (active) setSteps(paperSteps(paper, runs, reviews, probes));
      })
      .catch((cause: unknown) => {
        if (active) setError(String(cause));
      });
    return () => {
      active = false;
    };
  }, [repo, paper, report]);
  const steps = report ? analysisSteps(report) : paperEntries;
  const record = {
    format: 'paragraph-lab-transparency',
    version: 1,
    sourceId: paper?.id ?? report?.analysis.id,
    steps,
  };
  return (
    <section>
      <details>
        <summary>Minh bạch</summary>
        <p>
          Thông tin chưa được lưu tại thời điểm chạy được ghi là không rõ; trạng thái hiệu chuẩn lịch sử không
          được suy đoán.
        </p>
        {error && (
          <div role="alert">
            Không thể tải thông tin.
            <details>
              <summary>Chi tiết kỹ thuật</summary>
              {error}
            </details>
          </div>
        )}
        {steps.length === 0 && <p>Chưa có bước được ghi nhận.</p>}
        {steps.map((step, index) => (
          <div key={`${step.step}-${index}`}>
            <h3>{step.step}</h3>
            <p>
              Model: {step.model ?? 'Không rõ'} · Prompt: {step.prompt ?? 'Không rõ'} · Rubric:{' '}
              {step.rubric ?? 'Không rõ'} · Detector: {step.detectors ?? 'Không rõ'}
            </p>
            <p>
              Ngày: {step.date ?? 'Không rõ'} · Số lần gọi: {step.calls ?? 'Không rõ'} · Mục gửi đến model:{' '}
              {step.sections?.join(', ') || 'Không rõ'} · Hiệu chuẩn tại thời điểm chạy: Không được ghi nhận
            </p>
          </div>
        ))}
        <Button onClick={() => downloadJson('paragraph-lab-transparency.json', record)}>
          Tải bản ghi minh bạch JSON
        </Button>
      </details>
    </section>
  );
}
