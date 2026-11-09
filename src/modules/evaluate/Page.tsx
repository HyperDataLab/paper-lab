import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useRepositories } from '@/shared/storage/StorageProvider';
import { analyzeText } from '@/core/text';
import type { CalibrationSnapshot, Issue, TextAnalysis } from '@/core/schemas';
import { Button } from '@/shared/ui/Button';
import { TextField } from '@/shared/ui/TextField';
import { Card } from '@/shared/ui/Card';
import { EmptyState } from '@/shared/ui/EmptyState';
import { Skeleton } from '@/shared/ui/Skeleton';
import styles from './page.module.css';
import { AnalysisResult } from './AnalysisResult';
import { useSyntaxAnalysis } from './useSyntaxAnalysis';
import { useCandidateJudge } from './useCandidateJudge';
import { AnalysisStep } from './AnalysisStep';
import { ParagraphModes } from './ParagraphModes';
import { detectCandidates, DETECTOR_VERSION } from '@/core/detectors';
import { ReviewWorkspace } from './ReviewWorkspace';
import { Tabs } from '@/shared/ui/Tabs';
import { SyntaxControls } from './SyntaxControls';
import { useParagraphAnalysis } from './useParagraphAnalysis';
import { ParagraphView } from './ParagraphView';
import { useScoring } from './useScoring';
import { ScoresView } from './ScoresView';
import { latestStyleWarning } from '@/core/probe';
import { AnalysisSchema } from '@/core/schemas';
import { RUBRIC_VERSION } from '@/core/scoring/rubric';
import { ReportMenu } from '@/shared/report/ReportMenu';
import { useCalibration } from '@/shared/calibration/useCalibration';
import { captureCalibration } from '@/shared/calibration/data';

export default function Page() {
  const repositories = useRepositories();
  const navigate = useNavigate();
  const location = useLocation();
  const [revisionOverrides, setRevisionOverrides] = useState<Record<string, boolean>>({});
  const [snapshots, setSnapshots] = useState<Record<string, CalibrationSnapshot>>({});
  // Provenance only: it must never delay or block the AI action. A failed capture shows as "không rõ".
  function captureStep(step: string) {
    captureCalibration(repositories)
      .then((snapshot) => setSnapshots((previous) => ({ ...previous, [step]: snapshot })))
      .catch(() => undefined);
  }
  const [generationId, setGenerationId] = useState<string | null>(null);
  const [parent, setParent] = useState<{ id: string; title: string } | null>(null);
  const [paperBreadcrumb, setPaperBreadcrumb] = useState<{ id: string; heading: string } | null>(null);
  const [styleWarning, setStyleWarning] = useState<string | null>(null);
  const syntax = useSyntaxAnalysis();
  const judge = useCandidateJudge();
  const paragraph = useParagraphAnalysis();
  const scoring = useScoring();
  const { load: loadScoring, reset: resetScoring } = scoring;
  const { load: loadParagraph, reset: resetParagraph } = paragraph;
  const { load: loadJudge, reset: resetJudge } = judge;
  const { load: loadSyntax, reset: resetSyntax } = syntax;
  const [params, setParams] = useSearchParams();
  const id = params.get('id');
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [previousStatuses, setPreviousStatuses] = useState<Record<string, Issue['status']>>({});
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const saveInFlight = useRef(false);
  const [text, setText] = useState(() => {
    const state: unknown = location.state;
    return typeof state === 'object' &&
      state !== null &&
      'prefill' in state &&
      typeof state.prefill === 'string'
      ? state.prefill
      : '';
  });
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
  const calibration = useCalibration(repositories, `${createdId ?? id ?? ''}:${decisions.length}`);
  const [view, setView] = useState<'text' | 'sentences' | 'paragraph' | 'scores'>('text');
  const [selectedIssue, setSelectedIssue] = useState<{ id: string; nonce: number } | null>(null);
  const [selectedSentence, setSelectedSentence] = useState<string | null>(null);
  const [previousIssueIds, setPreviousIssueIds] = useState('[]');
  const [editing, setEditing] = useState(false);
  const [toolbar, setToolbar] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!id) return;
    let active = true;
    Promise.all([repositories.analyses.get(id), repositories.audit.listByAnalysis(id)])
      .then(([value, audit]) => {
        if (!active) return;
        if (!value) throw new Error('Analysis not found');
        setRevisionOverrides({});
        setParent(null);
        setPaperBreadcrumb(null);
        setStyleWarning(null);
        if (value.origin?.kind === 'paper') {
          const origin = value.origin;
          void repositories.papers.get(origin.paperId).then((paper) => {
            const paragraph = paper?.paragraphs.find((item) => item.id === origin.paragraphId);
            const section = paper?.sections.find((item) => item.id === paragraph?.sectionId);
            if (active && paper && section) setPaperBreadcrumb({ id: paper.id, heading: section.heading });
          });
          void repositories.paperProbes.get(origin.paperId).then((probes) => {
            if (active) setStyleWarning(latestStyleWarning(probes?.runs));
          });
        }
        setGenerationId(value.origin?.kind === 'generated' ? value.origin.generationId : null);
        if (value.parentAnalysisId)
          void repositories.analyses.get(value.parentAnalysisId).then((source) => {
            if (active && source) setParent({ id: source.id, title: source.title || 'đoạn văn' });
          });
        setText(value.text.sourceText);
        setResult(value.text);
        loadSyntax(value.sentenceAnnotations, value.versions);
        loadJudge(value.issues, value.versions);
        loadParagraph(value);
        loadScoring(value);
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
  }, [id, repositories, retry, loadSyntax, loadJudge, loadParagraph, loadScoring]);
  const candidates = result ? detectCandidates(result, syntax.annotations) : [];
  const baseIssues = [
    ...(judge.issues ?? candidates).filter(
      (item) => item.category !== 'flow' && item.category !== 'organization',
    ),
    ...(paragraph.result?.issues ?? []),
  ];
  const issueIds = JSON.stringify(baseIssues.map((issue) => issue.id).sort());
  if (issueIds !== previousIssueIds) {
    const currentIds = new Set<string>(JSON.parse(issueIds) as string[]);
    setPreviousIssueIds(issueIds);
    setDecisions((old) => old.filter((decision) => currentIds.has(decision.issueId)));
  }
  const issues = decisions.reduce(
    (items, decision) =>
      items.map((item) => (item.id === decision.issueId ? { ...item, ...decision.change } : item)),
    baseIssues,
  );
  const revisionSelection = issues
    .filter(
      (issue) =>
        issue.status !== 'dismissed_by_human' &&
        (revisionOverrides[issue.id] ??
          (issue.status === 'confirmed_by_model' || issue.status === 'confirmed_by_human')),
    )
    .map((issue) => issue.id);
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
        sentenceAnnotations: (syntax.annotations ?? []).map((annotation) => {
          const role = paragraph.result?.roles.find((item) => item.sentenceId === annotation.sentenceId);
          return role
            ? {
                ...annotation,
                role: role.role,
                roleConfidence: role.confidence,
                roleRationale: role.rationale,
              }
            : annotation;
        }),
        paragraph: paragraph.result?.paragraph ?? null,
        flowLinks: paragraph.result?.flowLinks ?? [],
        paragraphMetrics: paragraph.result?.metrics ?? null,
        scores: scoring.result?.scores ?? null,
        versions: {
          ...syntax.versions,
          calibrationSnapshots: snapshots,
          detectors: DETECTOR_VERSION,
          ...(judge.versions ?? {}),
          structurePrompt: paragraph.result?.promptVersion ?? null,
          structureModel: paragraph.result?.model ?? null,
          rubric: scoring.result ? RUBRIC_VERSION : null,
          scoringPrompt: scoring.result?.promptVersion ?? null,
          scoringModel: scoring.result?.model ?? null,
        },
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
      for (const decision of decisions.filter((item) =>
        baseIssues.some((issue) => issue.id === item.issueId),
      ))
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
    setSnapshots({});
    setLoading(true);
    setError(null);
    setSaved(false);
    resetSyntax();
    resetJudge();
    resetParagraph();
    resetScoring();
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
  const canJudge = candidates.length > 0 || !!syntax.annotations?.some((a) => a.voice === 'passive');
  const judgeDone = canJudge && !!judge.versions && !judge.running;
  const nextStep = !syntax.annotations
    ? 'syntax'
    : !paragraph.result
      ? 'structure'
      : canJudge && !judgeDone
        ? 'judge'
        : !scoring.result
          ? 'score'
          : 'save';
  return (
    <div className={styles.page}>
      <h1>Đánh giá</h1>
      {!id && !result && <ParagraphModes current="/evaluate" />}
      {paperBreadcrumb && (
        <p>
          <Link to={`/papers/${paperBreadcrumb.id}`}>Bài báo › {paperBreadcrumb.heading}</Link>
        </p>
      )}
      {generationId && (
        <p>
          <Link to={`/generate?id=${generationId}`}>Đoạn soạn từ luận điểm</Link>
        </p>
      )}
      {parent && (
        <p>
          <Link to={`/evaluate?id=${parent.id}`}>Bản sửa của {parent.title}</Link>
        </p>
      )}
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
              resetParagraph();
              resetScoring();
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
                resetParagraph();
                resetScoring();
              }}
            >
              Tạo bản phân tích mới
            </Button>
          ) : (
            <Button variant="primary" type="button" disabled={loading} onClick={() => void run()}>
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
            {(id || createdId) && (
              <Button
                disabled={!revisionSelection.length}
                onClick={() =>
                  navigate(
                    `/revise?${new URLSearchParams({ analysis: id ?? createdId ?? '', issues: revisionSelection.join(',') })}`,
                  )
                }
              >
                Chỉnh sửa các gợi ý đã chọn
              </Button>
            )}
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
                  resetParagraph();
                  resetScoring();
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
                  resetParagraph();
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
            {(id || (saved && createdId)) && <ReportMenu id={id ?? createdId ?? ''} />}
            {id && parent && (
              <Link to={`/compare?${new URLSearchParams({ a: parent.id, b: id })}`}>So sánh với bản gốc</Link>
            )}
            {!id && (
              <Button
                variant={nextStep === 'save' ? 'primary' : 'secondary'}
                disabled={
                  saved || saving || syntax.running || judge.running || paragraph.running || scoring.running
                }
                onClick={() => void save()}
              >
                {saved ? 'Đã lưu' : 'Lưu vào lịch sử'}
              </Button>
            )}
          </div>
          {id && (
            <SyntaxControls
              syntax={syntax}
              readOnly={!!id}
              saved={saved}
              busy={judge.running || paragraph.running || scoring.running}
              onRun={() => {
                resetJudge();
                resetParagraph();
                resetScoring();
                captureStep('syntax');
                void syntax.run(result);
              }}
            />
          )}
          {!id && (
            <Card padding="md">
              <h2>Các bước phân tích</h2>
              <ol className={styles.steps}>
                <AnalysisStep number={1} done={!!syntax.annotations}>
                  <SyntaxControls
                    syntax={syntax}
                    readOnly={!!id}
                    saved={saved}
                    busy={judge.running || paragraph.running || scoring.running}
                    onRun={() => {
                      resetJudge();
                      resetParagraph();
                      resetScoring();
                      captureStep('syntax');
                      void syntax.run(result);
                    }}
                  />
                </AnalysisStep>
                {!id && (
                  <AnalysisStep number={2} done={!!paragraph.result}>
                    {paragraph.running ? (
                      <>
                        <span role="status">Đang phân tích cấu trúc…</span>{' '}
                        <Button onClick={paragraph.cancel}>Huỷ</Button>
                      </>
                    ) : (
                      <Button
                        variant={nextStep === 'structure' ? 'primary' : 'secondary'}
                        disabled={
                          saved || !syntax.annotations || syntax.running || judge.running || scoring.running
                        }
                        onClick={() => {
                          resetScoring();
                          captureStep('structure');
                          void paragraph.run(result, syntax.annotations, issues);
                        }}
                      >
                        Phân tích cấu trúc đoạn (AI)
                      </Button>
                    )}
                    {saved ? (
                      <small>Đã lưu — chọn Chỉnh sửa văn bản để phân tích lại</small>
                    ) : (
                      !syntax.annotations && <small>Cần phân tích câu trước</small>
                    )}
                    {paragraph.error && <p role="alert">Không phân tích được: {paragraph.error}</p>}
                  </AnalysisStep>
                )}
                {!id && !canJudge && (
                  <AnalysisStep number={3} done={false}>
                    <small>Đánh giá theo ngữ cảnh: chưa có ứng viên để đánh giá.</small>
                  </AnalysisStep>
                )}
                {!id && canJudge && (
                  <AnalysisStep number={3} done={judgeDone}>
                    {judge.running ? (
                      <>
                        <span role="status">Đang đánh giá…</span> <Button onClick={judge.cancel}>Huỷ</Button>
                      </>
                    ) : (
                      <Button
                        variant={nextStep === 'judge' ? 'primary' : 'secondary'}
                        disabled={saved || syntax.running || paragraph.running || scoring.running}
                        onClick={() => {
                          captureStep('judge');
                          void judge.run(
                            result,
                            syntax.annotations,
                            candidates,
                            { before: null, after: null, audience: null },
                            issues,
                          );
                        }}
                      >
                        Đánh giá theo ngữ cảnh (AI)
                      </Button>
                    )}
                    {saved && <small>Đã lưu — chọn Chỉnh sửa văn bản để phân tích lại</small>}
                    {judge.error && (
                      <p role="alert">
                        Không đánh giá được: {judge.error}{' '}
                        {judge.error.includes('Chưa nhập khoá API') && <Link to="/settings">Cài đặt</Link>}
                      </p>
                    )}
                  </AnalysisStep>
                )}
                {!id && (
                  <AnalysisStep number={4} done={!!scoring.result}>
                    {scoring.running ? (
                      <>
                        <span role="status">Đang chấm điểm…</span>{' '}
                        <Button onClick={scoring.cancel}>Huỷ</Button>
                      </>
                    ) : (
                      <Button
                        variant={nextStep === 'score' ? 'primary' : 'secondary'}
                        disabled={saved || saving || syntax.running || judge.running || paragraph.running}
                        onClick={() => {
                          const analysis = AnalysisSchema.parse({
                            schemaVersion: 1,
                            id: crypto.randomUUID(),
                            createdAt: new Date().toISOString(),
                            updatedAt: new Date().toISOString(),
                            text: result,
                            context: { before: null, after: null, audience: null },
                            contextLimited: true,
                            versions: { rubric: null, prompt: null, model: null, syntaxProvider: null },
                            sentenceAnnotations: (syntax.annotations ?? []).map((annotation) => {
                              const role = paragraph.result?.roles.find(
                                (item) => item.sentenceId === annotation.sentenceId,
                              );
                              return role
                                ? {
                                    ...annotation,
                                    role: role.role,
                                    roleConfidence: role.confidence,
                                    roleRationale: role.rationale,
                                  }
                                : annotation;
                            }),
                            paragraph: paragraph.result?.paragraph ?? null,
                            flowLinks: paragraph.result?.flowLinks ?? [],
                            paragraphMetrics: paragraph.result?.metrics ?? null,
                            issues,
                            parentAnalysisId: null,
                          });
                          captureStep('score');
                          void scoring.run(analysis);
                        }}
                      >
                        Chấm điểm (AI)
                      </Button>
                    )}
                    {scoring.error && <p role="alert">Không chấm điểm được: {scoring.error}</p>}
                  </AnalysisStep>
                )}
              </ol>
            </Card>
          )}
          <p className={styles.meta}>
            Chỉ phân tích riêng đoạn này, không có ngữ cảnh của đoạn trước và sau.
          </p>
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
            <Button
              id="paragraph-tab"
              aria-controls="paragraph-panel"
              role="tab"
              aria-selected={view === 'paragraph'}
              onClick={() => setView('paragraph')}
            >
              Cấu trúc đoạn
            </Button>
            <Button
              id="scores-tab"
              aria-controls="scores-panel"
              role="tab"
              aria-selected={view === 'scores'}
              onClick={() => setView('scores')}
            >
              Điểm
            </Button>
          </Tabs>
          <div id="text-panel" role="tabpanel" aria-labelledby="text-tab" hidden={view !== 'text'}>
            <ReviewWorkspace
              calibrationStats={calibration?.stats}
              revisionSelection={id || createdId ? revisionSelection : undefined}
              onRevisionSelection={(issueId, selected) =>
                setRevisionOverrides((old) => ({ ...old, [issueId]: selected }))
              }
              text={result}
              roles={paragraph.result?.roles}
              selectedIssue={selectedIssue}
              issues={issues}
              toolbarTarget={toolbar}
              onChange={(issue, change) => void review(issue, change)}
            />
          </div>
          <div id="scores-panel" role="tabpanel" aria-labelledby="scores-tab" hidden={view !== 'scores'}>
            <ScoresView
              scores={scoring.result?.scores ?? null}
              issues={issues}
              styleWarning={styleWarning}
              onIssue={(issueId) => {
                setSelectedIssue((previous) => ({ id: issueId, nonce: (previous?.nonce ?? 0) + 1 }));
                setView('text');
              }}
              onSentence={(sentenceId) => {
                setView('sentences');
                setSelectedSentence(sentenceId);
                window.setTimeout(
                  () =>
                    document.getElementById(`sentence-${sentenceId}`)?.scrollIntoView?.({ block: 'nearest' }),
                  0,
                );
              }}
            />
          </div>
          <div
            id="sentences-panel"
            role="tabpanel"
            aria-labelledby="sentences-tab"
            hidden={view !== 'sentences'}
          >
            <AnalysisResult
              result={result}
              syntax={syntax}
              roles={paragraph.result?.roles}
              selectedSentence={selectedSentence}
            />
          </div>
          <div
            id="paragraph-panel"
            role="tabpanel"
            aria-labelledby="paragraph-tab"
            hidden={view !== 'paragraph'}
          >
            <ParagraphView text={result} result={paragraph.result} />
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
