import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { version as appVersion } from '../../../../package.json';
import { freezeGate, nextVersion } from '@/core/researchDesign/draft/freezeGate';
import { setPlanTitle } from '@/core/researchDesign/draft/ops';
import { checkDesign } from '@/core/researchDesign/draft/checkDesign';
import { checkChain } from '@/core/researchDesign/draft/checkChain';
import { checkPlan } from '@/core/researchDesign/draft/checkPlan';
import { exportPackage } from '@/core/researchDesign/plan/exportPackage';
import { planMarkdown } from '@/core/researchDesign/plan/planMarkdown';
import { runnerStubs } from '@/core/researchDesign/plan/runnerStubs';
import type { ExperimentPlan } from '@/core/researchDesign/plan/schema';
import { ResearchDesignConflictError } from '@/shared/storage/researchDesigns';
import { Button } from '@/shared/ui/Button';
import { Badge } from '@/shared/ui/Badge';
import { Card } from '@/shared/ui/Card';
import { Dialog, DialogActions } from '@/shared/ui/Dialog';
import { Drawer } from '@/shared/ui/Drawer';
import { TextField } from '@/shared/ui/TextField';
import { Empty, Loading } from '@/shared/ui/StateNote';
import { useToast } from '@/shared/ui/toastContext';
import { useResearchDesign } from '../ResearchDesignProvider';
import { issueText, missingLink, missingText, ruleText } from '../package/gateText';
import { Markdown } from '../package/Markdown';

function download(name: string, bytes: Uint8Array, type: string) {
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes).buffer], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function FrozenVersion({
  plan,
  open,
}: {
  plan: ExperimentPlan;
  open: (kind: 'plan' | 'runner', plan: ExperimentPlan) => void;
}) {
  const toast = useToast();
  const [manifest, setManifest] = useState<Awaited<ReturnType<typeof exportPackage>>['manifest'] | null>(
    null,
  );
  useEffect(() => {
    let active = true;
    void exportPackage(plan)
      .then((file) => {
        if (active) setManifest(file.manifest);
      })
      .catch(() => {
        if (active) setManifest(null);
      });
    return () => {
      active = false;
    };
  }, [plan]);
  return (
    <section>
      <p>
        Phiên bản {plan.planVersion} · {plan.frozenBy} · {new Date(plan.frozenAt).toLocaleString('vi-VN')}
      </p>
      {plan.deviation && <p>{plan.deviation}</p>}
      {manifest ? (
        manifest.files.map((file) => (
          <p key={file.path}>
            {file.path} · SHA-256: <code>{file.sha256}</code>
          </p>
        ))
      ) : (
        <p>Không tải được mã băm.</p>
      )}
      <Button variant="ghost" onClick={() => open('plan', plan)}>
        Xem
      </Button>
      <Button
        variant="ghost"
        onClick={() =>
          void exportPackage(plan)
            .then((file) => download(file.fileName, file.bytes, 'application/zip'))
            .catch(() => toast('Không tải được gói.'))
        }
      >
        Tải gói (.zip)
      </Button>
      <Button variant="ghost" onClick={() => open('runner', plan)}>
        Mã mẫu cho runner
      </Button>
    </section>
  );
}

export default function PackageSection() {
  const state = useResearchDesign();
  const toast = useToast();
  const [title, setTitle] = useState<string | null>(null);
  const [dialog, setDialog] = useState(false);
  const [deviation, setDeviation] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [drawer, setDrawer] = useState<{ kind: 'plan' | 'runner'; plan: ExperimentPlan } | null>(null);
  if (state.loading) return <Loading />;
  if (state.error) return <Empty title="Không tải được gói kế hoạch." />;
  const { draft, frozenPlans } = state.design;
  const { freeze, reload, papers } = state;
  const version = nextVersion(frozenPlans.map((p) => p.planVersion));
  const gate = freezeGate(
    draft,
    {
      planId: state.project.id,
      planVersion: version,
      title: draft.planTitle || state.project.title,
      frozenAt: new Date().toISOString(),
      frozenBy: 'local',
      deviation: version === 1 ? null : 'preview',
      appVersion,
    },
    state.papers,
    frozenPlans.at(-1) ?? null,
  );
  const reason =
    gate.state === 'not_a_plan'
      ? 'Bản nháp chưa đủ để thành kế hoạch.'
      : gate.unchanged
        ? `Bản nháp không khác phiên bản ${version - 1}.`
        : gate.blocked
          ? 'Còn quy tắc chặn.'
          : '';
  const designFlags = checkDesign(draft, state.bank);
  const planFlags = checkPlan(draft).filter((f) => f.level !== 'note');
  const counts = [
    ['Thiết kế nghiên cứu', 'design', designFlags.length],
    [
      'Câu hỏi và giả thuyết',
      'questions',
      designFlags.filter((f) => draft.hypotheses.some((h) => h.id === f.subject)).length,
    ],
    ['Đo lường', 'measurement', checkChain(draft).length],
    ['Phân tích thống kê', 'analyses', planFlags.filter((f) => f.rule.startsWith('AN-')).length],
    ['Ma trận chạy', 'runs', planFlags.filter((f) => f.rule.startsWith('RM-')).length],
  ] as const;
  const destination = (subject: string | undefined, rule: string) =>
    draft.hypotheses.some((h) => h.id === subject)
      ? 'questions'
      : draft.analyses.some((a) => a.id === subject)
        ? 'analyses'
        : rule === 'PP-03' || rule === 'PP-07'
          ? 'runs'
          : 'measurement';
  async function submit() {
    if (version > 1 && !deviation.trim()) {
      setError('Cần ghi thay đổi so với phiên bản trước.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await freeze(version, 'local', version === 1 ? null : deviation.trim(), papers, appVersion);
      setDialog(false);
      setDeviation('');
      toast(`Đã đóng băng phiên bản ${version}.`);
    } catch (e) {
      setError(
        e instanceof ResearchDesignConflictError
          ? 'Phiên bản vừa thay đổi. Danh sách đã được tải lại.'
          : 'Không đóng băng được. Bản nháp có thể đã thay đổi; hãy xem lại danh sách kiểm tra.',
      );
      await reload().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <h3>Gói kế hoạch</h3>
      <p>Kiểm tra, đóng băng và xuất gói cho Scientific Research Desktop.</p>
      <Card>
        <h3>Bản nháp hiện tại</h3>
        <TextField
          label="Tên kế hoạch"
          placeholder={state.project.title}
          value={title ?? draft.planTitle}
          onChange={(e) => setTitle(e.target.value)}
        />
        <Button
          onClick={() =>
            void state
              .save((record) => {
                const result = setPlanTitle(record.draft, title ?? record.draft.planTitle);
                return result.ok ? { ...record, draft: result.doc } : record;
              })
              .then(() => toast('Đã lưu tên.'))
              .catch(() => toast('Không lưu được tên.'))
          }
        >
          Lưu tên
        </Button>
        {gate.state === 'not_a_plan' ? (
          <>
            <p>Bản nháp chưa đủ để thành kế hoạch.</p>
            <ul>
              {gate.missing.map((m, i) => (
                <li key={i}>
                  <Link to={missingLink(m)}>{missingText(m, draft)}</Link>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <div>
            {Array.from({ length: 10 }, (_, i) => `PP-${String(i + 1).padStart(2, '0')}`).map((rule) => {
              const issues = gate.issues.filter((issue) => issue.rule === rule);
              const blocked = issues.some((issue) => issue.level === 'blocking');
              return (
                <div key={rule}>
                  <p>
                    <code>{rule}</code> {ruleText(rule)}{' '}
                    <Badge tone={issues.length ? (blocked ? 'danger' : 'warning') : 'success'}>
                      {issues.length ? (blocked ? 'Chặn' : 'Cảnh báo') : 'Đạt'}
                    </Badge>
                  </p>
                  {issues.map((issue, i) => (
                    <p key={i}>
                      <Link to={`?design=${destination(issue.subject, rule)}`}>
                        {issueText(issue, gate.plan)}
                      </Link>
                    </p>
                  ))}
                </div>
              );
            })}
          </div>
        )}
        <Button
          variant="primary"
          disabled={!!reason}
          onClick={() => {
            setError('');
            setDialog(true);
          }}
        >
          Đóng băng phiên bản {version}
        </Button>{' '}
        {reason && <span>{reason}</span>}
      </Card>
      <Card>
        <h3>Các phiên bản đã đóng băng</h3>
        {frozenPlans.length ? (
          [...frozenPlans]
            .sort((a, b) => b.planVersion - a.planVersion)
            .map((plan) => (
              <FrozenVersion
                key={plan.planVersion}
                plan={plan}
                open={(kind, selected) => setDrawer({ kind, plan: selected })}
              />
            ))
        ) : (
          <p>Chưa có phiên bản nào được đóng băng.</p>
        )}
      </Card>
      <Card>
        <h3>Cờ trên bản nháp</h3>
        {counts.some((c) => c[2]) ? (
          <ul>
            {counts
              .filter((c) => c[2])
              .map(([label, path, count]) => (
                <li key={path}>
                  <Link to={`?design=${path}`}>
                    {label}: {count}
                  </Link>
                </li>
              ))}
          </ul>
        ) : (
          <p>Không còn cờ nào.</p>
        )}
      </Card>
      {dialog && gate.state === 'plan' && (
        <Dialog
          title={`Đóng băng phiên bản ${version}`}
          description={`${gate.plan.runMatrix.expectedRuns} lần chạy`}
          onClose={() => setDialog(false)}
        >
          {gate.issues
            .filter((i) => i.level === 'warning')
            .map((i, n) => (
              <p key={n}>{issueText(i, gate.plan)}</p>
            ))}
          {version > 1 && (
            <TextField
              multiline
              label="Thay đổi so với phiên bản trước và lý do"
              required
              value={deviation}
              onChange={(e) => {
                setDeviation(e.target.value);
                setError('');
              }}
            />
          )}
          {error && <p role="alert">{error}</p>}
          <DialogActions>
            <Button onClick={() => setDialog(false)}>Hủy</Button>
            <Button variant="primary" disabled={busy} onClick={() => void submit()}>
              Đóng băng
            </Button>
          </DialogActions>
        </Dialog>
      )}
      {drawer && (
        <Drawer
          open
          side="right"
          title={
            drawer.kind === 'plan'
              ? `Phiên bản ${drawer.plan.planVersion} · đã đóng băng · chỉ đọc`
              : 'Mã mẫu cho runner'
          }
          onClose={() => setDrawer(null)}
        >
          {drawer.kind === 'plan' ? (
            <Markdown text={planMarkdown(drawer.plan)} />
          ) : (
            <>
              <p>Điểm bắt đầu cho mã chạy; ứng dụng này không chạy chúng.</p>
              {Object.values(runnerStubs(drawer.plan))
                .filter((x): x is { fileName: string; text: string } => typeof x !== 'number')
                .map((file) => (
                  <section key={file.fileName}>
                    <h3>{file.fileName}</h3>
                    <pre>{file.text}</pre>
                    <Button
                      onClick={() =>
                        void navigator.clipboard
                          .writeText(file.text)
                          .then(() => toast('Đã sao chép.'))
                          .catch(() => toast('Không sao chép được.'))
                      }
                    >
                      Sao chép
                    </Button>
                    <Button
                      onClick={() =>
                        download(file.fileName, new TextEncoder().encode(file.text), 'text/plain')
                      }
                    >
                      Tải về
                    </Button>
                  </section>
                ))}
            </>
          )}
        </Drawer>
      )}
    </>
  );
}
