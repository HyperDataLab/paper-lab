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
  StanceRecord,
  PaperInsightsRecord,
} from '@/core/schemas';
import { useRepositories } from '@/shared/storage/StorageProvider';
import { downloadJson } from '@/shared/calibration/download';
import { Badge } from '@/shared/ui/Badge';
import { Button } from '@/shared/ui/Button';
import { Drawer } from '@/shared/ui/Drawer';
import styles from './transparency.module.css';

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
  stance?: StanceRecord,
  insights?: PaperInsightsRecord,
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
    ...(insights?.snapshotRuns ?? []).map((run): Step => ({
      step: 'Snapshot',
      model: run.model,
      prompt: run.promptVersion,
      rubric: null,
      detectors: null,
      date: run.createdAt,
      calls: run.callsUsed,
      sections: sections(run.sectionIds),
      calibration: null,
    })),
    ...(insights?.argumentRuns ?? []).map((run): Step => ({
      step: 'Lập luận',
      model: run.model,
      prompt: run.promptVersion,
      rubric: null,
      detectors: null,
      date: run.createdAt,
      calls: run.callsUsed,
      sections: sections(run.sectionIds),
      calibration: null,
    })),
    ...(insights?.rhetoricRuns ?? []).map((run): Step => ({
      step: 'Tu từ và mức độ báo cáo',
      model: run.model,
      prompt: run.promptVersion,
      rubric: null,
      detectors: null,
      date: run.createdAt,
      calls: run.callsUsed,
      sections: sections(run.sectionIds),
      calibration: null,
    })),
    ...(stance?.runs ?? []).map((run): Step => ({
      step: 'Giọng văn',
      model: run.model,
      prompt: run.promptVersion,
      rubric: null,
      detectors: null,
      date: run.createdAt,
      calls: run.callsUsed,
      sections: sections(run.sectionIds),
      calibration: null,
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
const CALIBRATION = {
  reliable: 'Đáng tin',
  unreliable: 'Chưa đáng tin',
  uncalibrated: 'Chưa hiệu chuẩn',
} as const;
const STEP_NAMES: Record<string, string> = {
  syntax: 'Phân tích câu',
  judge: 'Đánh giá ngữ cảnh',
  structure: 'Cấu trúc đoạn',
  score: 'Chấm điểm',
  transitions: 'Chuyển đoạn',
};
const BATCH_PREFIX = 'Phân tích bài báo: ';

function formatDate(value: string | null) {
  if (!value) return 'Không rõ ngày';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('vi-VN');
}

function calibrationSummary(snapshot: CalibrationSnapshot | null) {
  if (snapshot === null) return 'Không được ghi nhận';
  if (snapshot.length === 0) return 'Chưa có dữ liệu';
  const counts = new Map<string, number>();
  for (const item of snapshot) counts.set(item.status, (counts.get(item.status) ?? 0) + 1);
  return (Object.keys(CALIBRATION) as (keyof typeof CALIBRATION)[])
    .filter((status) => counts.has(status))
    .map((status) => `${CALIBRATION[status]}: ${counts.get(status)} loại`)
    .join(' · ');
}

/** The steps of one batch run share everything but their name, so they read as one entry. */
function groupSteps(steps: Step[]) {
  const groups: { title: string; parts: string[]; first: Step; key: string }[] = [];
  for (const step of steps) {
    const batch = step.step.startsWith(BATCH_PREFIX);
    const key = batch ? `${step.model}|${step.prompt}|${step.date}|${step.sections?.join()}` : '';
    const name = step.step.slice(BATCH_PREFIX.length);
    const existing = batch ? groups.find((group) => group.key === key) : undefined;
    if (existing) existing.parts.push(STEP_NAMES[name] ?? name);
    else
      groups.push(
        batch
          ? { title: 'Phân tích bài báo', parts: [STEP_NAMES[name] ?? name], first: step, key }
          : { title: step.step, parts: [], first: step, key: '' },
      );
  }
  return groups;
}

/** A long list of section names is folded so the facts around it stay readable. */
function SectionNames({ names }: { names: string[] | null }) {
  if (names === null) return <>Không rõ</>;
  if (names.length <= 4) return <>{names.join(', ') || 'Không có'}</>;
  return (
    <details>
      <summary>{names.length} mục</summary>
      {names.join(', ')}
    </details>
  );
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
      repo.stance.get(paper.id),
      repo.paperInsights.get(paper.id),
    ])
      .then(([runs, reviews, probes, checks, measurements, stance, insights]) => {
        if (active)
          setSteps(paperSteps(paper, runs, reviews, probes, checks, measurements, stance, insights));
      })
      .catch((cause: unknown) => {
        if (active) setError(String(cause));
      });
    return () => {
      active = false;
    };
  }, [repo, paper, report]);
  const [open, setOpen] = useState(false);
  const steps = report ? analysisSteps(report) : paperEntries;
  const record = {
    format: 'paragraph-lab-transparency',
    version: 1,
    sourceId: paper?.id ?? report?.analysis.id,
    steps,
  };
  const body = (
    <>
      <p className={styles.note}>
        Thông tin không được lưu lúc chạy sẽ ghi là Không rõ, hệ thống không suy đoán.
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
      {steps.length === 0 && <p>Chưa có bước nào được ghi nhận.</p>}
      {groupSteps(steps).map((group, index) => {
        const step = group.first;
        const known = (value: string | null) => value ?? 'Không rõ';
        return (
          <section key={`${step.step}-${index}`} className={styles.step}>
            <div className={styles.stepHead}>
              <h3>{group.title}</h3>
              <span className={styles.note}>{formatDate(step.date)}</span>
            </div>
            {group.parts.length > 0 && (
              <div className={styles.badges}>
                {group.parts.map((part) => (
                  <Badge key={part}>{part}</Badge>
                ))}
              </div>
            )}
            <dl className={styles.facts}>
              <dt>Model</dt>
              <dd>{known(step.model)}</dd>
              <dt>Prompt</dt>
              <dd>{known(step.prompt)}</dd>
              {step.rubric && (
                <>
                  <dt>Rubric</dt>
                  <dd>{step.rubric}</dd>
                </>
              )}
              {step.detectors && (
                <>
                  <dt>Detector</dt>
                  <dd>{step.detectors}</dd>
                </>
              )}
              <dt>Số lượt gọi</dt>
              <dd>{step.calls ?? 'Không rõ'}</dd>
              <dt>Mục gửi cho AI</dt>
              <dd>
                <SectionNames names={step.sections} />
              </dd>
              {Boolean(step.cachedSections?.length) && (
                <>
                  <dt>Dùng bộ nhớ đệm</dt>
                  <dd>{step.cachedSections?.join(', ')}</dd>
                </>
              )}
              <dt>Hiệu chuẩn</dt>
              <dd>{calibrationSummary(step.calibration)}</dd>
            </dl>
            {Boolean(step.calibration?.length) && (
              <details className={styles.more}>
                <summary>Chi tiết hiệu chuẩn</summary>
                <ul>
                  {step.calibration?.map((item) => (
                    <li key={`${item.kind}/${item.type}`}>
                      {item.kind}/{item.type}: {CALIBRATION[item.status]} (n={item.n})
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </section>
        );
      })}
      <div>
        <Button onClick={() => downloadJson('paperlab-transparency.json', record)}>
          Tải bản ghi minh bạch JSON
        </Button>
      </div>
    </>
  );
  if (report)
    return (
      <section>
        <details>
          <summary>Minh bạch</summary>
          <div className={styles.drawer}>{body}</div>
        </details>
      </section>
    );
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        Minh bạch
      </Button>
      <Drawer open={open} onClose={() => setOpen(false)} side="right" label="Thông tin minh bạch">
        <div className={styles.drawer}>
          <div className={styles.head}>
            <h2>Thông tin minh bạch</h2>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Đóng
            </Button>
          </div>
          {body}
        </div>
      </Drawer>
    </>
  );
}
