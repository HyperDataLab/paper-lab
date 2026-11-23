import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { normalizeDoi } from '@/core/library/doi';
import { useRepositories } from '@/shared/storage/StorageProvider';
import { PROMPT_VERSIONS } from '@/core/prompts';
import {
  KgAnswerSchema,
  KgSqlResultSchema,
  KgSqlOutputSchema,
  type KgAnswer,
  type KgSqlOutput,
  type KgSqlResult,
} from '@/core/schemas/kgSql';
import { buildKgSqlPrompt } from '@/core/semantic/kgSchema';
import { buildKgAnswerPrompt } from '@/core/semantic/kgAnswer';
import { useAuth } from '@/shared/auth/authContext';
import { useHubProjectId } from '@/shared/storage/StorageProvider';
import { LabKgError, queryLabKg } from '@/shared/labKg/client';
import { requireConsent } from '@/shared/llm/consent';
import { describeLlmError } from '@/shared/llm/describeError';
import { useLlm } from '@/shared/llm/LlmProvider';
import { Button } from '@/shared/ui/Button';
import { DataTable } from '@/shared/ui/DataTable';
import { TextField } from '@/shared/ui/TextField';
import { ErrorNote } from './ErrorNote';
import { paperSourceHref } from './paperSourceHref';
import { rankProjectEvidence, retrieveProjectEvidence, type ProjectEvidence } from './projectEvidence';
import styles from './labKg.module.css';

const MAX_QUESTION_LENGTH = 2_000;
const ASK_RETURN_STATE_KEY = 'paperlab:lab-kg:ask-return:v1';
const EMPTY_PAPER_IDS: ReadonlyMap<string, string> = new Map();

type AskReturnState = {
  question: string;
  generated?: KgSqlOutput;
  result?: KgSqlResult;
  answer?: KgAnswer;
  answerSources: ProjectEvidence[];
};

function readAskReturnState(projectId: string | null | undefined): AskReturnState | undefined {
  if (!projectId || typeof window === 'undefined') return undefined;
  try {
    const raw = sessionStorage.getItem(ASK_RETURN_STATE_KEY);
    if (!raw) return undefined;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('projectId' in parsed) ||
      parsed.projectId !== projectId
    )
      return undefined;
    if (!('question' in parsed) || typeof parsed.question !== 'string') return undefined;
    const generated = 'generated' in parsed ? KgSqlOutputSchema.safeParse(parsed.generated) : undefined;
    const result = 'result' in parsed ? KgSqlResultSchema.safeParse(parsed.result) : undefined;
    const answer = 'answer' in parsed ? KgAnswerSchema.safeParse(parsed.answer) : undefined;
    const sources =
      'answerSources' in parsed && Array.isArray(parsed.answerSources)
        ? parsed.answerSources.filter(
            (source): source is ProjectEvidence =>
              typeof source === 'object' &&
              source !== null &&
              'id' in source &&
              typeof source.id === 'string' &&
              'title' in source &&
              typeof source.title === 'string' &&
              'kind' in source &&
              typeof source.kind === 'string' &&
              'locator' in source &&
              typeof source.locator === 'string' &&
              'text' in source &&
              typeof source.text === 'string' &&
              (!('paperId' in source) || typeof source.paperId === 'string'),
          )
        : [];
    return {
      question: parsed.question.slice(0, MAX_QUESTION_LENGTH),
      ...(generated?.success && { generated: generated.data }),
      ...(result?.success && { result: result.data }),
      ...(answer?.success && { answer: answer.data }),
      answerSources: sources,
    };
  } catch {
    return undefined;
  }
}

function resultColumnWidth(column: string) {
  const name = column.toLocaleLowerCase();
  if (name === 'title' || name.includes('abstract')) return '300px';
  if (name.includes('doi')) return '165px';
  if (name.endsWith('_id') || name === 'id') return '175px';
  if (name.includes('venue') || name.includes('subfield')) return '160px';
  return '115px';
}

function columnIndex(columns: string[], aliases: string[]) {
  return columns.findIndex((column) => aliases.includes(column.toLocaleLowerCase()));
}

function cellText(value: unknown) {
  return Array.isArray(value) || (typeof value === 'object' && value !== null)
    ? JSON.stringify(value)
    : String(value ?? '');
}

export function AskKg({ localPaperIds = EMPTY_PAPER_IDS }: { localPaperIds?: ReadonlyMap<string, string> }) {
  const { user, getIdToken } = useAuth();
  const repo = useRepositories();
  const projectId = useHubProjectId();
  const { client, config, ensureConsent } = useLlm();
  const [returnState] = useState(() => readAskReturnState(projectId));
  const [question, setQuestion] = useState(returnState?.question ?? '');
  const [busy, setBusy] = useState(false);
  const [receiving, setReceiving] = useState(false);
  const [generated, setGenerated] = useState<KgSqlOutput | undefined>(returnState?.generated);
  const [result, setResult] = useState<KgSqlResult | undefined>(returnState?.result);
  const [answer, setAnswer] = useState<KgAnswer | undefined>(returnState?.answer);
  const [answerSources, setAnswerSources] = useState<ProjectEvidence[]>(returnState?.answerSources ?? []);
  const [findingEvidence, setFindingEvidence] = useState(false);
  const [synthesizing, setSynthesizing] = useState(false);
  const [localError, setLocalError] = useState('');
  const [error, setError] = useState<LabKgError>();
  const [copiedDoi, setCopiedDoi] = useState('');
  const questionField = useRef<HTMLTextAreaElement>(null);
  const loadingCard = useRef<HTMLDivElement>(null);
  const [loadingCardSize, setLoadingCardSize] = useState({ width: 1, height: 1 });
  const active = useRef<AbortController>(null);
  useEffect(() => () => active.current?.abort(), []);
  useEffect(() => {
    if (!returnState) return;
    try {
      sessionStorage.removeItem(ASK_RETURN_STATE_KEY);
    } catch {
      /* Storage may be unavailable. */
    }
  }, [returnState]);
  useEffect(() => {
    const field = questionField.current;
    if (!field) return;
    field.style.height = 'auto';
    field.style.height = `${Math.min(Math.max(field.scrollHeight, 72), 160)}px`;
  }, [question]);
  useEffect(() => {
    const card = loadingCard.current;
    if (!busy || !card || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      const bounds = card.getBoundingClientRect();
      setLoadingCardSize({
        width: Math.max(2, Math.round(bounds.width)),
        height: Math.max(2, Math.round(bounds.height)),
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(card);
    return () => observer.disconnect();
  }, [busy]);

  async function ask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = question.trim();
    if (!text || !user || active.current) return;
    const controller = new AbortController();
    const { signal } = controller;
    active.current = controller;
    setBusy(true);
    setReceiving(false);
    try {
      if (!(await ensureConsent('kg')) || signal.aborted) return;
      setGenerated(undefined);
      setResult(undefined);
      setAnswer(undefined);
      setAnswerSources([]);
      setLocalError('');
      setError(undefined);
      const token = await getIdToken();
      if (signal.aborted) return;
      if (!token) throw new LabKgError('Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.');
      const { data } = await client.completeJson({
        ...buildKgSqlPrompt(text),
        schema: KgSqlOutputSchema,
        schemaName: 'kg_sql',
        promptVersion: PROMPT_VERSIONS.kgSql,
        temperature: 0,
        stream: true,
        onStreamStart: () => setReceiving(true),
        signal,
        onRequest: async () => requireConsent(config),
      });
      if (signal.aborted) return;
      setGenerated(data);
      if (!projectId) throw new LabKgError('Mở một project ResearchHub để truy vấn KG.');
      const answer = await queryLabKg(data.sql, token, projectId, signal);
      if (signal.aborted) return;
      setResult(answer);
      setFindingEvidence(true);
      let projectEvidence: ProjectEvidence[] = [];
      try {
        projectEvidence = await retrieveProjectEvidence(repo, `${text}\n${data.explanation}`, projectId);
      } catch {
        setLocalError(
          'Không tìm được toàn văn hoặc phân tích đã lưu; câu trả lời sẽ chỉ dùng dữ liệu Lab KG.',
        );
      }
      if (signal.aborted) return;
      const kgSources: ProjectEvidence[] = answer.rows.map((row, index) => ({
        id: `kg:${index + 1}`,
        title: 'Lab KG',
        kind: 'Dữ liệu KG',
        locator: 'Kết quả truy vấn KG',
        text: answer.columns
          .map((column, cellIndex) => `${column}: ${String(row[cellIndex] ?? 'NULL')}`)
          .join(' · ')
          .slice(0, 1_000),
      }));
      const rankedKgSources = rankProjectEvidence(kgSources, text, 4);
      const sources = [...rankedKgSources, ...projectEvidence.slice(0, 10 - rankedKgSources.length)];
      setAnswerSources(sources);
      setFindingEvidence(false);
      setSynthesizing(true);
      if (!(await ensureConsent('kgAnswer')) || signal.aborted) return;
      setReceiving(false);
      const { data: synthesized } = await client.completeJson({
        ...buildKgAnswerPrompt(text, sources),
        schema: KgAnswerSchema,
        schemaName: 'kg_evidence_answer',
        promptVersion: PROMPT_VERSIONS.kgAnswer,
        temperature: 0,
        stream: true,
        onStreamStart: () => setReceiving(true),
        signal,
        onRequest: async () => requireConsent(config),
      });
      if (signal.aborted) return;
      const sourceIds = new Set(sources.map(({ id }) => id));
      const claims = synthesized.claims
        .map((claim) => ({ ...claim, sourceIds: claim.sourceIds.filter((id) => sourceIds.has(id)) }))
        .filter((claim) => claim.sourceIds.length > 0);
      setAnswer({
        claims:
          claims.length > 0
            ? claims
            : [
                {
                  text: 'Chưa tìm thấy bằng chứng phù hợp trong dữ liệu KG hoặc dữ liệu PaperLab của project này để trả lời câu hỏi.',
                  sourceIds: [],
                },
              ],
      });
    } catch (cause) {
      if (signal.aborted) return;
      if (cause instanceof LabKgError) setError(cause);
      else {
        const message = describeLlmError(cause);
        if (message) setError(new LabKgError(message, cause instanceof Error ? cause.message : ''));
      }
    } finally {
      active.current = null;
      setFindingEvidence(false);
      setSynthesizing(false);
      setReceiving(false);
      if (!signal.aborted) setBusy(false);
    }
  }

  const paperTitleIndex = columnIndex(result?.columns ?? [], ['title', 'paper_title']);
  const paperDoiIndex = columnIndex(result?.columns ?? [], ['doi', 'paper_doi']);
  const paperYearIndex = columnIndex(result?.columns ?? [], ['publication_year', 'year']);
  const paperCitationIndex = columnIndex(result?.columns ?? [], [
    'cited_by_count',
    'citation_count',
    'citations',
  ]);
  const paperTypeIndex = columnIndex(result?.columns ?? [], ['type', 'paper_type', 'publication_type']);
  const paperIdIndex = columnIndex(result?.columns ?? [], ['paper_id', 'id']);
  const isPaperResult =
    paperTitleIndex >= 0 &&
    (paperIdIndex >= 0 || paperDoiIndex >= 0 || paperYearIndex >= 0 || paperCitationIndex >= 0);
  const loadingStep = generated ? (synthesizing ? 2 : 1) : 0;
  const loadingTitle =
    loadingStep === 0
      ? receiving
        ? 'AI đang tạo truy vấn KG…'
        : 'Đang gửi câu hỏi đến AI…'
      : loadingStep === 1
        ? findingEvidence
          ? 'Đang đối chiếu tài liệu trong project…'
          : 'Đang truy vấn dữ liệu KG…'
        : receiving
          ? 'AI đang hoàn thiện câu trả lời…'
          : 'Đang tổng hợp câu trả lời có dẫn chứng…';
  const loadingHint =
    loadingStep === 0
      ? 'PaperLab sẽ truy vấn KG, đối chiếu tài liệu liên quan và kiểm tra nguồn trước khi trả lời.'
      : loadingStep === 1
        ? 'Đang thu thập dữ liệu phù hợp trong phạm vi project của bạn.'
        : 'Các dẫn chứng được kiểm tra trước khi hiển thị.';

  async function copyDoi(doi: string) {
    try {
      await navigator.clipboard.writeText(doi);
      setCopiedDoi(doi);
      window.setTimeout(() => setCopiedDoi(''), 1600);
    } catch {
      setCopiedDoi('');
    }
  }

  function rememberBeforeOpeningPaper() {
    if (!projectId) return;
    try {
      sessionStorage.setItem(
        ASK_RETURN_STATE_KEY,
        JSON.stringify({ projectId, question, generated, result, answer, answerSources }),
      );
    } catch {
      /* Keep the reader link usable when storage is unavailable or full. */
    }
  }

  return (
    <section className={styles.ask} aria-label="Hỏi KG bằng câu hỏi">
      <form className={styles.askForm} onSubmit={(event) => void ask(event)}>
        <TextField
          multiline
          rows={2}
          label="Câu hỏi về KG"
          hint="Câu trả lời được tạo từ dữ liệu hiện có trong KG."
          placeholder="Ví dụ: Bài báo này liên kết với những chủ đề nào?"
          maxLength={MAX_QUESTION_LENGTH}
          value={question}
          ref={questionField}
          onChange={(event) => setQuestion(event.target.value)}
        />
        <div className={styles.askActions}>
          <span className={styles.askScope}>Trả lời dựa trên dữ liệu KG và tài liệu của project.</span>
          <Button type="submit" variant="primary" disabled={busy || !question.trim()}>
            {busy ? 'Đang xử lý…' : 'Hỏi KG'}
          </Button>
        </div>
      </form>
      {busy && (
        <div
          ref={loadingCard}
          className={styles.loadingState}
          role="status"
          aria-live="polite"
          aria-busy="true"
        >
          <svg
            className={styles.loadingBorder}
            viewBox={`0 0 ${loadingCardSize.width} ${loadingCardSize.height}`}
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <rect
              x="1"
              y="1"
              width={Math.max(0, loadingCardSize.width - 2)}
              height={Math.max(0, loadingCardSize.height - 2)}
              rx="8"
              pathLength="1000"
            />
          </svg>
          <div className={styles.loadingContent}>
            <div className={styles.loadingHeading}>
              <strong>{loadingTitle}</strong>
              <span>Bước {loadingStep + 1}/3</span>
            </div>
            <p>{loadingHint}</p>
            <ol className={styles.loadingSteps} aria-label="Tiến độ xử lý câu hỏi">
              {['Tạo truy vấn', 'Đối chiếu dữ liệu', 'Tổng hợp câu trả lời'].map((label, index) => (
                <li
                  key={label}
                  className={
                    index === loadingStep
                      ? styles.loadingStepCurrent
                      : index < loadingStep
                        ? styles.loadingStepComplete
                        : undefined
                  }
                  aria-current={index === loadingStep ? 'step' : undefined}
                >
                  {label}
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}
      {error && <ErrorNote error={error} />}
      {localError && (
        <p className={styles.muted} role="status">
          {localError}
        </p>
      )}
      {answer && (
        <section className={styles.answer} aria-label="Câu trả lời có dẫn chứng">
          <h3>Câu trả lời</h3>
          {answer.claims.map((claim, index) => (
            <p key={index}>
              {claim.text}
              {claim.sourceIds.map((id) => (
                <a className={styles.citation} href={`#${id}`} key={id} aria-label={`Nguồn ${id}`}>
                  {id}
                </a>
              ))}
            </p>
          ))}
          {answer.claims.some((claim) => claim.sourceIds.length > 0) && (
            <ol className={styles.citations} aria-label="Nguồn trích dẫn">
              {answerSources
                .filter(({ id }) => answer.claims.some((claim) => claim.sourceIds.includes(id)))
                .map((source) => {
                  const href = paperSourceHref(source);
                  return (
                    <li id={source.id} key={source.id}>
                      <strong>
                        [{source.id}]{' '}
                        {href ? (
                          <Link to={href} onClick={rememberBeforeOpeningPaper}>
                            {source.title}
                          </Link>
                        ) : (
                          source.title
                        )}
                      </strong>
                      <span>{[source.kind, source.locator].filter(Boolean).join(' · ')}</span>
                      <blockquote>{source.text}</blockquote>
                    </li>
                  );
                })}
            </ol>
          )}
        </section>
      )}
      {result && result.rows.length > 0 && result.columns.length > 0 && (
        <section className={styles.resultBlock} aria-label="Kết quả trong KG">
          <div className={styles.resultHeading}>
            <h3>Kết quả trong KG</h3>
            <span className={styles.resultCount}>{result.rows.length} bản ghi</span>
          </div>
          {result.truncated && (
            <p className={styles.resultNote} role="status">
              Một số kết quả đã được giới hạn. Hãy thu hẹp câu hỏi để xem dữ liệu sát hơn.
            </p>
          )}
          {isPaperResult ? (
            <ol className={styles.paperResults} aria-label="Bài báo trong kết quả KG">
              {result.rows.map((row, i) => {
                const title = cellText(row[paperTitleIndex]) || 'Bài báo chưa có tiêu đề';
                const doi = paperDoiIndex >= 0 ? cellText(row[paperDoiIndex]) : '';
                const paperId = paperIdIndex >= 0 ? cellText(row[paperIdIndex]) : '';
                const normalizedDoi = doi ? normalizeDoi(doi) : null;
                const readerPaperId = normalizedDoi ? localPaperIds.get(normalizedDoi) : undefined;
                const metadata = [
                  paperYearIndex >= 0 && cellText(row[paperYearIndex]),
                  paperCitationIndex >= 0 && `${cellText(row[paperCitationIndex])} trích dẫn`,
                  paperTypeIndex >= 0 && cellText(row[paperTypeIndex]),
                ].filter((value): value is string => typeof value === 'string' && value.length > 0);
                return (
                  <li className={styles.paperResult} key={`${paperId}-${doi}-${i}`}>
                    <div className={styles.paperResultMain}>
                      <strong>
                        {readerPaperId ? (
                          <Link
                            className={styles.paperResultTitle}
                            to={`/papers/${readerPaperId}`}
                            onClick={rememberBeforeOpeningPaper}
                          >
                            {title}
                          </Link>
                        ) : (
                          title
                        )}
                      </strong>
                      {doi && (
                        <div className={styles.paperDoi}>
                          <span title={doi}>{doi}</span>
                          <Button size="sm" variant="ghost" onClick={() => void copyDoi(doi)}>
                            {copiedDoi === doi ? 'Đã sao chép' : 'Sao chép DOI'}
                          </Button>
                        </div>
                      )}
                      {metadata.length > 0 && <p>{metadata.join(' · ')}</p>}
                    </div>
                    {paperId && (
                      <details className={styles.paperIdDetails}>
                        <summary>Chi tiết định danh</summary>
                        <code>{paperId}</code>
                      </details>
                    )}
                  </li>
                );
              })}
            </ol>
          ) : (
            <DataTable
              aria-label="Bảng kết quả KG"
              className={styles.sqlTable}
              scrollClassName={styles.resultScroll}
            >
              <colgroup>
                {result.columns.map((column, index) => (
                  <col key={`${column}-${index}`} style={{ width: resultColumnWidth(column) }} />
                ))}
              </colgroup>
              <thead>
                <tr>
                  {result.columns.map((column, i) => (
                    <th key={i} scope="col">
                      {column.replaceAll('_', ' ')}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row, i) => (
                  <tr key={i}>
                    {row.map((value, j) => (
                      <td key={j}>{cellText(value) || '—'}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </DataTable>
          )}
        </section>
      )}
      {result?.rows.length === 0 && (
        <p className={styles.muted} role="status">
          Không có bản ghi phù hợp trong Lab KG; đang dùng nguồn khác trong project nếu tìm thấy.
        </p>
      )}
    </section>
  );
}
