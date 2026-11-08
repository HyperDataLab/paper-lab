import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, HelpCircle } from 'lucide-react';
import { estimateProbe, PROBE_DEFAULT, PROBE_MAXIMUM, PROBE_MINIMUM } from '@/core/probe';
import type { Analysis, Paper, PaperProbeRun, PaperProbesRecord } from '@/core/schemas';
import { DIMENSIONS } from '@/core/scoring/rubric';
import { describeLlmError } from '@/shared/llm';
import { useLlm } from '@/shared/llm/LlmProvider';
import { createStyleProbeRun, llmStyleProbe } from '@/shared/llm/llmStyleProbe';
import { useRepositories } from '@/shared/storage/StorageProvider';
import { Badge } from '@/shared/ui/Badge';
import { Button } from '@/shared/ui/Button';
import { Card } from '@/shared/ui/Card';
import { Select } from '@/shared/ui/Select';
import { TextField } from '@/shared/ui/TextField';
import styles from './probe.module.css';
import { captureCalibration } from '@/shared/calibration/data';

const PLAN_ID = '00000000-0000-4000-8000-000000000000';
const number = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 });
const value = (input: number | null) => (input === null ? '—' : number.format(input));
function signed(input: number | null) {
  if (input === null) return '—';
  const arrow = input > 0 ? '↑' : input < 0 ? '↓' : '→';
  return `${arrow} ${input > 0 ? '+' : ''}${number.format(input)}`;
}
const VERDICTS = {
  stable: { label: 'Ổn định', tone: 'success', icon: CheckCircle2 },
  style_sensitive: { label: 'Nhạy với văn phong', tone: 'warning', icon: AlertTriangle },
  insufficient: { label: 'Chưa đủ dữ liệu', tone: 'neutral', icon: HelpCircle },
} as const;

export function PaperProbe({ paper, analyses }: { paper: Paper; analyses: Analysis[] }) {
  const repo = useRepositories();
  const llm = useLlm();
  const [record, setRecord] = useState<PaperProbesRecord>();
  const [n, setN] = useState(PROBE_DEFAULT);
  const [budget, setBudget] = useState(150);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    let active = true;
    void repo.paperProbes.get(paper.id).then((found) => {
      if (active) setRecord(found);
    });
    return () => {
      active = false;
      controller.current?.abort();
    };
  }, [paper.id, repo]);
  const plan = useMemo(() => {
    try {
      const planned = createStyleProbeRun(paper, analyses, {
        n,
        budget: Math.max(1, budget),
        model: llm.config.model,
        id: PLAN_ID,
        now: new Date(0).toISOString(),
      });
      return {
        calls: estimateProbe(analyses.filter((a) => planned.analysisIds.includes(a.id))),
        paragraphs: planned.n,
        refusal: '',
      };
    } catch (cause) {
      return { calls: 0, paragraphs: 0, refusal: cause instanceof Error ? cause.message : String(cause) };
    }
  }, [paper, analyses, n, budget, llm.config.model]);
  const latest = record?.runs.at(-1);
  const resumable = latest && latest.status !== 'done' && !running ? latest : undefined;
  async function execute(run: PaperProbeRun) {
    const abort = new AbortController();
    controller.current = abort;
    setRunning(true);
    setError('');
    try {
      if (!(await llm.ensureConsent('paper')) || abort.signal.aborted) return;
      const nextRun =
        run.calibrationSnapshot == null
          ? { ...run, calibrationSnapshot: await captureCalibration(repo) }
          : run;
      await llmStyleProbe(llm.client, paper, analyses, nextRun, {
        config: llm.config,
        now: () => new Date().toISOString(),
        signal: abort.signal,
        save: async (next) => {
          setRecord(await repo.paperProbes.saveRun(paper.id, next));
        },
      });
    } catch (cause) {
      if (!abort.signal.aborted) setError(describeLlmError(cause) ?? String(cause));
    } finally {
      if (controller.current === abort) {
        controller.current = null;
        setRunning(false);
      }
    }
  }
  function start() {
    void execute(
      createStyleProbeRun(paper, analyses, {
        n,
        budget,
        model: llm.config.model,
        id: crypto.randomUUID(),
        now: new Date().toISOString(),
      }),
    );
  }
  const overBudget = plan.calls > budget;
  // A verdict only means something once every selected paragraph has been processed.
  const verdict = latest?.status === 'done' ? VERDICTS[latest.summary.verdict] : null;
  const Icon = verdict?.icon;
  const discarded = latest?.items.filter((item) => item.reasons.length > 0) ?? [];
  const valid = latest?.items.filter((item) => item.reasons.length === 0) ?? [];
  const rows = latest
    ? [
        { id: 'overall', label: 'Tổng của đoạn', metric: latest.summary.overall },
        ...DIMENSIONS.map((d) => ({
          id: d.id as string,
          label: d.label as string,
          metric: latest.summary.dimensions[d.id],
        })),
      ]
    : [];
  return (
    <>
      <Card>
        <h2>Độ bền điểm</h2>
        <p>
          Kiểm tra này viết lại một số đoạn chỉ khác văn phong, giữ nguyên nội dung, rồi chấm lại để xem bộ
          chấm điểm có bị văn phong ảnh hưởng không. Đây không phải công cụ nâng điểm.
        </p>
        <div className={styles.setup}>
          <Select label="Số đoạn" value={n} onChange={(event) => setN(Number(event.target.value))}>
            {Array.from({ length: PROBE_MAXIMUM - PROBE_MINIMUM + 1 }, (_, i) => PROBE_MINIMUM + i).map(
              (option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ),
            )}
          </Select>
          <TextField
            label="Giới hạn lượt gọi"
            type="number"
            min={1}
            value={budget}
            onChange={(event) => setBudget(Number(event.target.value))}
          />
          {running ? (
            <Button onClick={() => controller.current?.abort()}>Huỷ</Button>
          ) : (
            <Button
              variant="primary"
              disabled={Boolean(plan.refusal) || overBudget || budget < 1}
              onClick={start}
            >
              Chạy kiểm tra độ bền (AI)
            </Button>
          )}
          {resumable && (
            <Button
              onClick={() =>
                void execute({ ...resumable, budget: Math.max(resumable.callsUsed + 1, budget) })
              }
            >
              Tiếp tục lượt trước
            </Button>
          )}
        </div>
        {plan.refusal ? (
          <p role="alert">{plan.refusal}</p>
        ) : (
          <p className={styles.muted}>
            Ước tính ~{plan.calls} lượt gọi AI cho {plan.paragraphs} đoạn (giới hạn {budget})
            {overBudget && ' · Vượt giới hạn, hãy giảm số đoạn hoặc tăng giới hạn.'}
          </p>
        )}
        {running && (
          <p role="status">
            Đang kiểm tra độ bền… {latest?.items.length ?? 0}/{latest?.n ?? plan.paragraphs} đoạn
          </p>
        )}
        {resumable && (
          <p className={styles.muted}>
            Lượt trước chưa hoàn tất ({resumable.items.length}/{resumable.n} đoạn).
          </p>
        )}
        {error && <p role="alert">{error}</p>}
      </Card>
      {latest && verdict && Icon && (
        <Card>
          <h3>Kết quả</h3>
          <p>
            <Badge tone={verdict.tone} icon={<Icon size={14} aria-hidden="true" />}>
              {verdict.label}
            </Badge>{' '}
            <span className={styles.muted}>
              {valid.length} đoạn hợp lệ · {discarded.length} đoạn bị loại · {latest.callsUsed} lượt gọi ·
              Model {latest.model} · Prompt {latest.promptVersions.rewrite}
            </span>
          </p>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Tiêu chí</th>
                <th>Thay đổi trung bình</th>
                <th>Thay đổi tuyệt đối</th>
                <th>Dao động khi chấm lại</th>
                <th>n</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ id, label, metric }) => (
                <tr key={id}>
                  <td>{label}</td>
                  <td>{signed(metric?.meanDelta ?? null)}</td>
                  <td>{value(metric?.meanAbsDelta ?? null)}</td>
                  <td>{value(metric?.meanNoise ?? null)}</td>
                  <td>{metric?.n ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className={styles.muted}>
            Số dương nghĩa là điểm tăng khi chỉ đổi văn phong. Ngưỡng là quy ước thử nghiệm, chưa hiệu chuẩn.
          </p>
          {discarded.length > 0 && (
            <>
              <h3>Bản viết lại bị loại</h3>
              <ul>
                {discarded.map((item) => (
                  <li key={item.paragraphId}>
                    {item.paragraphId}: {item.reasons.join('; ')}
                  </li>
                ))}
              </ul>
            </>
          )}
          <h3>Từng đoạn</h3>
          <ul>
            {valid.map((item) => (
              <li key={item.paragraphId}>
                {item.paragraphId} · {paper.sections.find((s) => s.id === item.sectionId)?.heading}
                <ul>
                  {DIMENSIONS.map((dimension) => {
                    const before = item.original?.dimensions.find((d) => d.id === dimension.id);
                    const after = item.rewritten?.dimensions.find((d) => d.id === dimension.id);
                    if (!before?.applicable || !after?.applicable) return null;
                    return (
                      <li key={dimension.id}>
                        {dimension.label}: {value(before.score)} → {value(after.score)}
                      </li>
                    );
                  })}
                </ul>
                <details>
                  <summary>Xem bản viết lại (chỉ để kiểm chứng)</summary>
                  <p className={styles.rewrite}>{item.rewrittenText}</p>
                </details>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
