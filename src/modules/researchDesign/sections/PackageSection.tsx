import { useState } from 'react';
import { Link } from 'react-router-dom';
import { version as appVersion } from '../../../../package.json';
import type { Run } from '@/core/autoresearch/record';
import { freezeGate, nextVersion } from '@/core/researchDesign/draft/freezeGate';
import { setPlanTitle } from '@/core/researchDesign/draft/ops';
import { checkDesign } from '@/core/researchDesign/draft/checkDesign';
import { checkChain } from '@/core/researchDesign/draft/checkChain';
import { checkPlan } from '@/core/researchDesign/draft/checkPlan';
import type { ExperimentPlan } from '@/core/researchDesign/plan/schema';
import { ResearchDesignConflictError } from '@/shared/storage/errors';
import { Button } from '@/shared/ui/Button';
import { Badge } from '@/shared/ui/Badge';
import { Card } from '@/shared/ui/Card';
import { Dialog, DialogActions } from '@/shared/ui/Dialog';
import { TextField } from '@/shared/ui/TextField';
import { Empty, Loading } from '@/shared/ui/StateNote';
import { useToast } from '@/shared/ui/toastContext';
import { useResearchDesign } from '../ResearchDesignProvider';
import { issueText, missingLink, missingText, ruleText } from '../package/gateText';
import { autoLockState } from '../package/autoLock';
import { PlanPreviewDrawer, type PlanPreview } from '../package/PlanPreviewDrawer';
import { FrozenVersion } from '../package/FrozenVersion';
import { PublishNote } from '../package/PublishNote';
import { NOT_SIGNED_IN, usePlanPublisher, type PublishOutcome } from '../package/usePlanPublisher';

type Props = { autoResearch?: { run: Run; busy: boolean; connect: (version: number) => Promise<boolean> } };

export default function PackageSection({ autoResearch }: Props) {
  const state = useResearchDesign();
  const toast = useToast();
  const ready = !state.loading && !state.error;
  const { signedIn, publish } = usePlanPublisher(
    ready ? state.project.id : '',
    ready ? state.update : async () => Promise.reject(new Error('Research design is not loaded')),
  );
  const [note, setNote] = useState<PublishOutcome | null>(null);
  const [sending, setSending] = useState<number | null>(null);
  const [title, setTitle] = useState<string | null>(null);
  const [dialog, setDialog] = useState(false);
  const [deviation, setDeviation] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [drawer, setDrawer] = useState<PlanPreview | null>(null);
  if (state.loading) return <Loading />;
  if (state.error) return <Empty title="Không tải được gói kế hoạch." />;
  const { draft, frozenPlans, version: designVersion } = state.design;
  const { freeze, reload, papers } = state;
  const { run, connect } = autoResearch ?? {};
  const previous = frozenPlans.at(-1) ?? null;
  const pending = state.design.planDeviation;
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
    previous,
  );
  const { sourceRun, reconnect, lockError } = autoLockState(state.design, gate, run);
  const reason =
    sourceRun && !run
      ? 'Duyệt quyết định đóng băng trong AutoResearch.'
      : reconnect
        ? 'Gắn phiên bản đã đóng băng vào run trước khi tạo phiên bản mới.'
        : lockError
          ? 'Kế hoạch chưa khớp với thiết kế đã duyệt.'
          : gate.state === 'not_a_plan'
            ? 'Bản nháp chưa đủ để thành kế hoạch.'
            : gate.unchanged && !pending
              ? `Bản nháp không khác phiên bản ${version - 1}.`
              : gate.blocked
                ? 'Còn quy tắc chặn.'
                : '';
  const designFlags = checkDesign(draft, state.bank);
  const planFlags = checkPlan(draft).filter((f) => f.level !== 'note');
  const counts = [
    ['Research design', 'design', designFlags.length],
    [
      'Research questions và hypotheses',
      'questions',
      designFlags.filter((f) => draft.hypotheses.some((h) => h.id === f.subject)).length,
    ],
    ['Measurement', 'measurement', checkChain(draft).length],
    ['Statistical analysis', 'analyses', planFlags.filter((f) => f.rule.startsWith('AN-')).length],
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
    let frozen: ExperimentPlan | undefined;
    try {
      const design = await freeze(
        version,
        'local',
        version === 1 ? null : deviation.trim(),
        papers,
        appVersion,
        ...(run ? [{ runId: run.id, revision: run.revision, designVersion }] : []),
      );
      frozen = design.frozenPlans.at(-1);
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
    // Publishing is separate from freezing: the version stays frozen whatever the server answers.
    if (frozen) {
      await send(frozen);
      if (connect) await connect(frozen.planVersion);
    }
  }
  async function send(plan: ExperimentPlan) {
    setSending(plan.planVersion);
    setNote(await publish(plan));
    setSending(null);
  }
  const publishedPlans = state.design.publishedPlans ?? {};
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
          disabled={!!reason || !!autoResearch?.busy}
          onClick={() => {
            setError('');
            setDialog(true);
          }}
        >
          Đóng băng phiên bản {version}
        </Button>{' '}
        {reason && <span>{reason}</span>}
        {sourceRun && !run && (
          <p>
            <Link to={`?ar=S11&arRun=${encodeURIComponent(sourceRun)}`}>
              Mở quyết định đóng băng AutoResearch
            </Link>
          </p>
        )}
        {lockError && (
          <details>
            <summary>Chi tiết kỹ thuật</summary>
            {lockError}
          </details>
        )}
        {reconnect && previous && connect && (
          <Button
            disabled={autoResearch?.busy || sending !== null || busy}
            onClick={() => void connect(previous.planVersion)}
          >
            Gắn phiên bản {previous.planVersion} vào run
          </Button>
        )}
      </Card>
      <Card>
        <h3>Các phiên bản đã đóng băng</h3>
        {note && <PublishNote note={note} />}
        {!signedIn && frozenPlans.length > 0 && !note && <p>{NOT_SIGNED_IN}</p>}
        {frozenPlans.length ? (
          [...frozenPlans]
            .sort((a, b) => b.planVersion - a.planVersion)
            .map((plan) => (
              <FrozenVersion
                key={plan.planVersion}
                plan={plan}
                open={(kind, selected) => setDrawer({ kind, plan: selected })}
                published={Boolean(publishedPlans[String(plan.planVersion)])}
                signedIn={signedIn}
                sending={sending === plan.planVersion}
                send={(selected) => void send(selected)}
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
            <Button variant="primary" disabled={busy || autoResearch?.busy} onClick={() => void submit()}>
              Đóng băng
            </Button>
          </DialogActions>
        </Dialog>
      )}
      {drawer && <PlanPreviewDrawer preview={drawer} close={() => setDrawer(null)} />}
    </>
  );
}
