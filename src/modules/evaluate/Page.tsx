import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useRepositories } from '@/shared/storage/StorageProvider';
import { analyzeText } from '@/core/text';
import type { Issue, TextAnalysis } from '@/core/schemas';
import { Button } from '@/shared/ui/Button';
import { TextField } from '@/shared/ui/TextField';
import { Card } from '@/shared/ui/Card';
import { EmptyState } from '@/shared/ui/EmptyState';
import { Skeleton } from '@/shared/ui/Skeleton';
import styles from './page.module.css';
import { AnalysisResult } from './AnalysisResult';
import { useSyntaxAnalysis } from './useSyntaxAnalysis';
import { useCandidateJudge } from './useCandidateJudge';
import { detectCandidates, DETECTOR_VERSION } from '@/core/detectors';
import { ReviewWorkspace } from './ReviewWorkspace';
import { Tabs } from '@/shared/ui/Tabs';
import { SyntaxControls } from './SyntaxControls';

export default function Page() {
  const repositories = useRepositories();
  const syntax = useSyntaxAnalysis();
  const judge = useCandidateJudge();
  const { load: loadJudge, reset: resetJudge } = judge;
  const { load: loadSyntax, reset: resetSyntax } = syntax;
  const [params, setParams] = useSearchParams();
  const id = params.get('id');
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [previousStatuses, setPreviousStatuses] = useState<Record<string, Issue['status']>>({});
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const saveInFlight = useRef(false);
  const [text, setText] = useState('');
  const [result, setResult] = useState<TextAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [decisions, setDecisions] = useState<
    {
      issueId: string;
      change: { status?: Issue['status']; severity?: Issue['severity'] };
      previous: Issue;
    }[]
  >([]);
  const [view, setView] = useState<'text' | 'sentences'>('text');
  const [editing, setEditing] = useState(false);
  const [toolbar, setToolbar] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!id) return;
    let active = true;
    Promise.all([repositories.analyses.get(id), repositories.audit.listByAnalysis(id)])
      .then(([value, audit]) => {
        if (!active) return;
        if (!value) throw new Error('Analysis not found');
        setText(value.text.sourceText);
        setResult(value.text);
        loadSyntax(value.sentenceAnnotations, value.versions);
        loadJudge(value.issues, value.versions);
        const previous: Record<string, Issue['status']> = {};
        for (const event of audit.items) {
          if (
            (event.action === 'confirm' || event.action === 'dismiss') &&
            event.issueId &&
            event.before &&
            typeof event.before === 'object' &&
            'status' in event.before
          ) {
            const status = event.before.status;
            if (status === 'candidate' || status === 'confirmed_by_model') previous[event.issueId] = status;
          }
        }
        setPreviousStatuses(previous);
        setDecisions([]);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      active = false;
    };
  }, [id, repositories, retry, loadSyntax, loadJudge]);
  const candidates = result ? detectCandidates(result, syntax.annotations) : [];
  const baseIssues = judge.issues ?? candidates;
  const issues = decisions.reduce(
    (items, decision) =>
      items.map((item) => (item.id === decision.issueId ? { ...item, ...decision.change } : item)),
    baseIssues,
  );
  async function review(issue: Issue, change: { status?: Issue['status']; severity?: Issue['severity'] }) {
    if (
      change.status === 'candidate' &&
      (issue.status === 'confirmed_by_human' || issue.status === 'dismissed_by_human')
    ) {
      change = {
        ...change,
        status:
          previousStatuses[issue.id] ??
          [...decisions]
            .reverse()
            .find((d) => d.issueId === issue.id && d.change.status && d.change.status !== 'candidate')
            ?.previous.status ??
          'candidate',
      };
    }
    try {
      const targetId = id ?? createdId;
      if (targetId) {
        const stored = await repositories.analyses.get(targetId);
        if (stored && !stored.issues.some((item) => item.id === issue.id))
          await repositories.analyses.update(targetId, {
            issues: baseIssues,
            versions: { ...stored.versions, detectors: DETECTOR_VERSION },
          });
        await repositories.analyses.reviewIssue(targetId, issue.id, change);
      }
      if (change.status === 'confirmed_by_human' || change.status === 'dismissed_by_human')
        setPreviousStatuses((old) => ({ ...old, [issue.id]: issue.status }));
      setDecisions((old) => [...old, { issueId: issue.id, change, previous: issue }]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }
  async function save() {
    if (!result || saved || saveInFlight.current) return;
    saveInFlight.current = true;
    setSaving(true);
    try {
      const created = await repositories.analyses.create({
        text: result,
        title: Array.from(result.sourceText).slice(0, 60).join(''),
        sentenceAnnotations: syntax.annotations ?? [],
        versions: { ...syntax.versions, detectors: DETECTOR_VERSION, ...(judge.versions ?? {}) },
        issues: [...decisions]
          .reverse()
          .reduce(
            (items, decision) =>
              items.map((item) =>
                item.id === decision.issueId
                  ? { ...item, status: decision.previous.status, severity: decision.previous.severity }
                  : item,
              ),
            baseIssues,
          ),
      });
      for (const decision of decisions)
        await repositories.analyses.reviewIssue(created.id, decision.issueId, decision.change);
      setCreatedId(created.id);
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      saveInFlight.current = false;
      setSaving(false);
    }
  }
  async function run() {
    setLoading(true);
    setError(null);
    setSaved(false);
    resetSyntax();
    resetJudge();
    setDecisions([]);
    setCreatedId(null);
    setPreviousStatuses({});
    setEditing(false);
    try {
      setResult(await analyzeText(text));
    } catch (cause) {
      setResult(null);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }
  return (
    <div className={styles.page}>
      <h1>Đánh giá</h1>
      {(!result || editing) && (
        <Card>
          <TextField
            label="Dán một đoạn văn tiếng Anh"
            multiline
            id="paragraph"
            value={text}
            disabled={!!id}
            onChange={(event) => {
              setText(event.target.value);
              setResult(null);
              setSaved(false);
              resetSyntax();
              resetJudge();
            }}
            rows={7}
          />
          {id ? (
            <Button
              onClick={() => {
                setParams({});
                setText('');
                setResult(null);
                setError(null);
                setSaved(false);
                setCreatedId(null);
                setDecisions([]);
                resetSyntax();
                resetJudge();
              }}
            >
              Tạo bản phân tích mới
            </Button>
          ) : (
            <Button type="button" disabled={loading} onClick={() => void run()}>
              Tách câu
            </Button>
          )}
        </Card>
      )}
      {loading ? (
        <Skeleton />
      ) : error ? (
        <Card>
          <p role="alert">
            {id ? 'Không tìm thấy bản phân tích này.' : 'Không thể tách câu. Vui lòng thử lại.'}
          </p>
          <Button onClick={() => (id ? setRetry((value) => value + 1) : void run())}>Thử lại</Button>{' '}
          {id && <Link to="/history">Quay lại Lịch sử</Link>}
          <details>
            <summary>Chi tiết kỹ thuật</summary>
            <code>{error}</code>
          </details>
        </Card>
      ) : result && result.sentences.length > 0 ? (
        <>
          <div className={styles.toolbar} id="evaluate-toolbar" ref={setToolbar}>
            {id && (
              <Button
                onClick={() => {
                  setParams({});
                  setText('');
                  setResult(null);
                  setError(null);
                  setSaved(false);
                  setCreatedId(null);
                  setDecisions([]);
                  setPreviousStatuses({});
                  resetSyntax();
                  resetJudge();
                }}
              >
                Tạo bản phân tích mới
              </Button>
            )}
            {!id && (
              <Button
                onClick={() => {
                  setEditing(true);
                  setResult(null);
                  setDecisions([]);
                  resetSyntax();
                  resetJudge();
                }}
              >
                Chỉnh sửa văn bản
              </Button>
            )}
            {saved && (
              <p role="status">
                Đã lưu. <Link to="/history">Xem trong Lịch sử</Link>
              </p>
            )}
            {!id && (
              <Button
                disabled={saved || saving || syntax.running || judge.running}
                onClick={() => void save()}
              >
                {saved ? 'Đã lưu' : 'Lưu vào lịch sử'}
              </Button>
            )}
            <SyntaxControls
              syntax={syntax}
              readOnly={!!id}
              onRun={() => {
                resetJudge();
                void syntax.run(result);
              }}
            />
            {!id && (candidates.length > 0 || syntax.annotations?.some((a) => a.voice === 'passive')) && (
              <section>
                {judge.running ? (
                  <>
                    <span role="status">Đang đánh giá…</span> <Button onClick={judge.cancel}>Huỷ</Button>
                  </>
                ) : (
                  <Button
                    disabled={syntax.running}
                    onClick={() =>
                      void judge.run(
                        result,
                        syntax.annotations,
                        candidates,
                        { before: null, after: null, audience: null },
                        issues,
                      )
                    }
                  >
                    Đánh giá theo ngữ cảnh (AI)
                  </Button>
                )}
                {judge.error && (
                  <p role="alert">
                    Không đánh giá được: {judge.error}{' '}
                    {judge.error.includes('Chưa nhập khoá API') && <Link to="/settings">Cài đặt</Link>}
                  </p>
                )}
              </section>
            )}
          </div>
          <p className={styles.meta}>Thiếu ngữ cảnh: chỉ phân tích đoạn văn này (context_limited)</p>
          <Tabs label="Chế độ xem">
            <Button
              id="text-tab"
              aria-controls="text-panel"
              role="tab"
              aria-selected={view === 'text'}
              onClick={() => setView('text')}
            >
              Văn bản
            </Button>
            <Button
              id="sentences-tab"
              aria-controls="sentences-panel"
              role="tab"
              aria-selected={view === 'sentences'}
              onClick={() => setView('sentences')}
            >
              Câu &amp; số liệu
            </Button>
          </Tabs>
          <div id="text-panel" role="tabpanel" aria-labelledby="text-tab" hidden={view !== 'text'}>
            <ReviewWorkspace
              text={result}
              issues={issues}
              toolbarTarget={toolbar}
              onChange={(issue, change) => void review(issue, change)}
            />
          </div>
          <div
            id="sentences-panel"
            role="tabpanel"
            aria-labelledby="sentences-tab"
            hidden={view !== 'sentences'}
          >
            <AnalysisResult result={result} syntax={syntax} />
          </div>
        </>
      ) : (
        <EmptyState
          title="Chưa có câu"
          description="Dán đoạn văn và chọn Tách câu để xem kết quả."
          detail="Văn bản được xử lý trên thiết bị của bạn."
        />
      )}
    </div>
  );
}
