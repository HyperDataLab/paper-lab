import { useEffect, useState } from 'react';
import type {
  AnalysisReport,
  CalibrationSnapshot,
  Paper,
  PaperRun,
  PaperReviewsRecord,
  PaperProbesRecord,
  PaperChecksRecord,
  MeasurementsRecord,
} from '@/core/schemas';
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
  calibration: CalibrationSnapshot | null;
  cachedSections?: string[];
};
function analysisSteps(report: AnalysisReport): Step[] {
  const a = report.analysis;
  const make = (step: string, key: string, model: string | null, prompt: string | null): Step => ({
    step,
    model,
    prompt,
    rubric: a.versions.rubric,
    detectors: a.versions.detectors,
    date: null,
    calls: null,
    sections: null,
    calibration: a.versions.calibrationSnapshots?.[key] ?? null,
  });
  return [
    make('Phân tích câu', 'syntax', a.versions.model, a.versions.prompt),
    make('Đánh giá theo ngữ cảnh', 'judge', a.versions.model, a.versions.judgePrompt),
    make('Cấu trúc đoạn', 'structure', a.versions.structureModel, a.versions.structurePrompt),
    make('Chấm điểm', 'score', a.versions.scoringModel, a.versions.scoringPrompt),
  ];
}
function paperSteps(
  paper: Paper,
  runs: PaperRun[],
  reviews?: PaperReviewsRecord,
  probes?: PaperProbesRecord,
  checks?: PaperChecksRecord,
  measurements?: MeasurementsRecord,
): Step[] {
  const sections = (ids: string[]) => ids.map((id) => paper.sections.find((s) => s.id === id)?.heading ?? id);
  return [
    ...(checks
      ? [
          {
            step: 'Kiểm tra',
            model: null,
            prompt: null,
            rubric: null,
            detectors: checks.report.version,
            date: checks.report.generatedAt,
            calls: 0,
            sections: [],
            calibration: checks.calibrationSnapshot ?? null,
          } satisfies Step,
        ]
      : []),
    ...runs.flatMap((run) =>
      run.plan.steps.map((step): Step => ({
        step: `Phân tích bài báo: ${step}`,
        model: run.model,
        prompt: Object.entries(run.promptVersions)
          .map(([key, value]) => `${key}: ${value}`)
          .join(', '),
        rubric: null,
        detectors: null,
        date: run.createdAt,
        calls: run.callsByStep?.[step] ?? null,
        sections: sections(
          run.plan.sectionIds.filter((id) =>
            run.plan.paragraphs.some(
              (p) =>
                p.sectionId === id &&
                !run.plan.skipped.some((s) => s.paragraphId === p.paragraphId) &&
                run.items.some((item) => item.paragraphId === p.paragraphId && item.status !== 'skipped'),
            ),
          ),
        ),
        cachedSections: sections(
          run.plan.sectionIds.filter((id) =>
            run.plan.paragraphs.some(
              (p) =>
                p.sectionId === id &&
                !run.plan.skipped.some((s) => s.paragraphId === p.paragraphId) &&
                run.items.some((item) => item.paragraphId === p.paragraphId && item.status === 'cached'),
            ),
          ),
        ),
        calibration: run.calibrationSnapshots?.[step] ?? null,
      })),
    ),
    ...(reviews?.runs ?? []).map((run): Step => ({
      step: 'Phản biện AI',
      model: run.model,
      prompt: run.promptVersion,
      rubric: null,
      detectors: null,
      date: run.createdAt,
      calls: run.callsUsed ?? null,
      sections: sections(run.sectionIds),
      calibration: run.calibrationSnapshot ?? null,
    })),
    ...(measurements?.runs ?? []).map((run): Step => ({
      step: 'Đo lường',
      model: run.profile.model_id,
      prompt: run.profile.prompt_version,
      rubric: null,
      detectors: run.profile.parser_version,
      date: run.createdAt,
      calls: run.callsUsed,
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
      calibration: run.calibrationSnapshot ?? null,
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
      repo.paperChecks.get(paper.id),
      repo.measurements.get(paper.id),
    ])
      .then(([runs, reviews, probes, checks, measurements]) => {
        if (active) setSteps(paperSteps(paper, runs, reviews, probes, checks, measurements));
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
              {step.sections === null ? 'Không rõ' : step.sections.join(', ') || 'Không có'} · Mục có đoạn
              dùng bộ nhớ đệm: {step.cachedSections?.join(', ') || 'Không có'} · Hiệu chuẩn tại thời điểm
              chạy:{' '}
              {step.calibration === null
                ? 'Không được ghi nhận'
                : step.calibration.length === 0
                  ? 'Chưa có dữ liệu'
                  : step.calibration
                      .map(
                        (item) =>
                          `${item.kind}/${item.type}: ${item.status === 'reliable' ? 'Đáng tin' : item.status === 'unreliable' ? 'Chưa đáng tin' : 'Chưa hiệu chuẩn'} (n=${item.n})`,
                      )
                      .join('; ')}
            </p>
          </div>
        ))}
        <Button onClick={() => downloadJson('paperlab-transparency.json', record)}>
          Tải bản ghi minh bạch JSON
        </Button>
      </details>
    </section>
  );
}
