import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
import type { Analysis, Revision } from '@/core/schemas';
import { sliceCp } from '@/core/text';
import { labels } from '../evaluate/issueLabels';
import { buildRevision } from '@/core/revision';
import { createLlmRevisionProvider } from '@/shared/llm/llmRevisionProvider';
import { describeLlmError } from '@/shared/llm/describeError';
import { useLlm } from '@/shared/llm/LlmProvider';
import { useRepositories } from '@/shared/storage/StorageProvider';
import { Button } from '@/shared/ui/Button';
import { Card } from '@/shared/ui/Card';
import { Checkbox } from '@/shared/ui/Checkbox';
import { Chip } from '@/shared/ui/Chip';
import { Dialog } from '@/shared/ui/Dialog';
import { TextField } from '@/shared/ui/TextField';
import { useToast } from '@/shared/ui/toastContext';
import { DiffView } from './DiffView';
import styles from './page.module.css';

const checkLabels: Record<string, string> = {
  numbers_preserved: 'Giữ nguyên số liệu',
  citations_preserved: 'Giữ nguyên trích dẫn',
  negation_preserved: 'Giữ nguyên phủ định',
  hedging_preserved: 'Giữ mức độ dè dặt',
  preserve_terms: 'Giữ thuật ngữ',
  length_change: 'Thay đổi độ dài',
};

export default function Page() {
  const [params] = useSearchParams();
  const sourceId = params.get('analysis');
  const revisionId = params.get('revision');
  const navigate = useNavigate();
  const repo = useRepositories();
  const { client, ensureConsent } = useLlm();
  const provider = useMemo(() => createLlmRevisionProvider(client), [client]);
  const toast = useToast();
  const [source, setSource] = useState<Analysis | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [terms, setTerms] = useState<string[]>([]);
  const [term, setTerm] = useState('');
  const [revision, setRevision] = useState<Revision | null>(null);
  const [selectedCheck, setSelectedCheck] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [technical, setTechnical] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  function invalidate() {
    controller.current?.abort();
    controller.current = null;
    setRunning(false);
    setRevision(null);
  }
  useEffect(() => {
    if (!sourceId) return;
    let active = true;
    Promise.all([
      repo.analyses.get(sourceId),
      revisionId ? repo.revisions.get(revisionId) : Promise.resolve(undefined),
    ])
      .then(([analysis, storedRevision]) => {
        if (!active) return;
        if (!analysis || (revisionId && (!storedRevision || storedRevision.sourceAnalysisId !== sourceId)))
          throw new Error('Không tìm thấy dữ liệu');
        setSource(analysis);
        setSelected(
          (storedRevision?.appliedIssueIds ?? (params.get('issues') ?? '').split(',')).filter((id) =>
            analysis.issues.some((issue) => issue.id === id && issue.status !== 'dismissed_by_human'),
          ),
        );
        setRevision(storedRevision ?? null);
      })
      .catch((cause: unknown) => {
        if (active) {
          setError('Không thể tải bản phân tích.');
          setTechnical(String(cause));
        }
      });
    return () => {
      active = false;
      controller.current?.abort();
      controller.current = null;
    };
  }, [sourceId, revisionId, repo, params]);
  async function generate() {
    if (!source || !selected.length || running) return;
    setError(null);
    const current = new AbortController();
    controller.current = current;
    setRunning(true);
    try {
      if (!(await ensureConsent()) || current.signal.aborted) return;
      const issues = source.issues.filter(
        (issue) => selected.includes(issue.id) && issue.status !== 'dismissed_by_human',
      );
      const constraints = {
        preserveClaims: true,
        preserveHedging: true,
        noNewFacts: true,
        preserveTerms: terms,
      } as const;
      const output = await provider.revise(source, issues, constraints, current.signal);
      if (current.signal.aborted) return;
      const value = await buildRevision(source, output.output, issues, constraints, {
        id: crypto.randomUUID(),
        model: output.model,
        createdAt: new Date().toISOString(),
      });
      if (current.signal.aborted) return;
      await repo.revisions.create(value);
      if (!current.signal.aborted) {
        setRevision(value);
        setSelectedCheck(null);
      }
    } catch (cause) {
      if (!current.signal.aborted) {
        setError(describeLlmError(cause) ?? 'Không thể tạo bản sửa.');
        setTechnical(String(cause));
      }
    } finally {
      if (controller.current === current) {
        controller.current = null;
        setRunning(false);
      }
    }
  }
  async function apply() {
    if (!source || !revision || applying) return;
    setApplying(true);
    try {
      const value = await repo.revisions.applyRevision(source.id, revision.id);
      navigate(`/evaluate?id=${value.id}`);
    } catch (cause) {
      setError('Không thể áp dụng bản sửa.');
      setTechnical(String(cause));
    } finally {
      setApplying(false);
      setConfirm(false);
    }
  }
  if (!sourceId)
    return (
      <Card>
        <h1>Chỉnh sửa</h1>
        <p>Chọn gợi ý từ một bản phân tích đã lưu.</p>
        <Link to="/history">Mở lịch sử</Link>
      </Card>
    );
  if (!source)
    return (
      <Card>
        <h1>Chỉnh sửa</h1>
        <p role={error ? 'alert' : 'status'}>{error ?? 'Đang tải…'}</p>
        <Link to="/history">Mở lịch sử</Link>
      </Card>
    );
  const failed = revision?.checks.filter((check) => check.status === 'fail') ?? [];
  return (
    <div className={styles.page}>
      <h1>Chỉnh sửa</h1>
      <div className={styles.grid}>
        <Card>
          <h2>Gợi ý đã chọn</h2>
          <ul>
            {source.issues
              .filter((issue) => selected.includes(issue.id))
              .map((issue) => (
                <li key={issue.id}>
                  {labels[issue.type]}: “
                  {issue.spans
                    .map((span) => sliceCp(source.text.sourceText, span.start, span.end))
                    .join(' / ')}
                  ” · {issue.why}{' '}
                  <Button
                    size="sm"
                    onClick={() => {
                      setSelected((old) => old.filter((id) => id !== issue.id));
                      invalidate();
                    }}
                  >
                    Bỏ chọn
                  </Button>
                </li>
              ))}
          </ul>
          <h3>Ràng buộc</h3>
          <Checkbox checked disabled>
            Giữ nguyên các khẳng định
          </Checkbox>
          <Checkbox checked disabled>
            Giữ mức độ dè dặt
          </Checkbox>
          <Checkbox checked disabled>
            Không thêm dữ kiện
          </Checkbox>
          <TextField
            label="Thuật ngữ cần giữ nguyên"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
          />
          <Button
            onClick={() => {
              if (term && !terms.includes(term)) {
                setTerms([...terms, term]);
                invalidate();
              }
              setTerm('');
            }}
          >
            Thêm thuật ngữ
          </Button>
          <div>
            {terms.map((item) => (
              <Chip
                key={item}
                onClick={() => {
                  setTerms(terms.filter((value) => value !== item));
                  invalidate();
                }}
                aria-label={`Bỏ ${item}`}
              >
                {item} ×
              </Chip>
            ))}
          </div>
        </Card>
        <Card>
          <h2>So sánh bản sửa</h2>
          {revision ? (
            <DiffView source={source.text.sourceText} revision={revision} selectedCheck={selectedCheck} />
          ) : (
            <p>Tạo bản sửa để xem so sánh.</p>
          )}
        </Card>
        <Card>
          <h2>Kiểm tra ý nghĩa</h2>
          {revision ? (
            <>
              <ul>
                {revision.checks.map((check) => (
                  <li key={check.id}>
                    <Button variant="ghost" title={check.id} onClick={() => setSelectedCheck(check.id)}>
                      {check.status === 'pass' ? (
                        <CheckCircle2 size={16} />
                      ) : check.status === 'warn' ? (
                        <AlertTriangle size={16} />
                      ) : (
                        <XCircle size={16} />
                      )}{' '}
                      {check.status === 'pass' ? 'Đạt' : check.status === 'warn' ? 'Cảnh báo' : 'Không đạt'} ·{' '}
                      {checkLabels[check.id] ?? check.id}: {check.detail}
                    </Button>
                  </li>
                ))}
              </ul>
              <h3>Cần bằng chứng từ bạn</h3>
              {revision.needsEvidence.length ? (
                <ul>
                  {revision.needsEvidence.map((item, index) => (
                    <li key={index}>
                      {item.issueId}: {item.note}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>Không có.</p>
              )}
            </>
          ) : (
            <p>Chưa có kết quả.</p>
          )}
        </Card>
      </div>
      <div className={styles.actions}>
        {running ? (
          <>
            <span role="status">Đang tạo bản sửa…</span>
            <Button onClick={invalidate}>Huỷ</Button>
          </>
        ) : (
          <Button disabled={!selected.length} onClick={() => void generate()}>
            {revision ? 'Tạo lại' : 'Tạo bản sửa (AI)'}
          </Button>
        )}
        {revision && (
          <>
            <Button
              onClick={() =>
                void navigator.clipboard
                  .writeText(revision.revisedText)
                  .then(() => toast('Đã sao chép bản sửa'))
                  .catch(() => setError('Không thể sao chép bản sửa.'))
              }
            >
              Sao chép bản sửa
            </Button>
            <Button
              variant="primary"
              disabled={applying}
              onClick={() => (failed.length ? setConfirm(true) : void apply())}
            >
              Áp dụng bản sửa
            </Button>
          </>
        )}
        <Button onClick={() => navigate(`/evaluate?id=${source.id}`)}>Huỷ</Button>
      </div>
      {error && (
        <div role="alert">
          {error}
          {technical && (
            <details>
              <summary>Chi tiết kỹ thuật</summary>
              <code>{technical}</code>
            </details>
          )}
        </div>
      )}
      {confirm && (
        <Dialog
          title="Áp dụng dù kiểm tra không đạt?"
          description="Vui lòng xem lại các kiểm tra sau trước khi xác nhận."
          onClose={() => setConfirm(false)}
        >
          <ul>
            {failed.map((check) => (
              <li key={check.id}>
                <span title={check.id}>{checkLabels[check.id] ?? check.id}</span>: {check.detail}
              </li>
            ))}
          </ul>
          <Button onClick={() => setConfirm(false)}>Quay lại</Button>
          <Button variant="primary" disabled={applying} onClick={() => void apply()}>
            Xác nhận áp dụng
          </Button>
        </Dialog>
      )}
    </div>
  );
}
