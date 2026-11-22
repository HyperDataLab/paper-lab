import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useRepositories } from '@/shared/storage/StorageProvider';
import { addLocalPaperAbstracts, findLocalPaperMatches, type LocalPaperMatch } from './localPaperMatches';
import { PROMPT_VERSIONS } from '@/core/prompts';
import { KgSqlOutputSchema, type KgSqlOutput, type KgSqlResult } from '@/core/schemas/kgSql';
import { buildKgSqlPrompt, KG_TABLE_CONCEPTS } from '@/core/semantic/kgSchema';
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
import styles from './labKg.module.css';

const MAX_QUESTION_LENGTH = 2_000;
const conceptNames = new Map(KG_TABLE_CONCEPTS.map(({ id, name }) => [id, name]));

export function AskKg() {
  const { user, getIdToken } = useAuth();
  const repo = useRepositories();
  const projectId = useHubProjectId();
  const { client, config, ensureConsent } = useLlm();
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [receiving, setReceiving] = useState(false);
  const [generated, setGenerated] = useState<KgSqlOutput>();
  const [result, setResult] = useState<KgSqlResult>();
  const [localMatches, setLocalMatches] = useState<LocalPaperMatch[]>();
  const [checkingLocal, setCheckingLocal] = useState(false);
  const [localError, setLocalError] = useState('');
  const [error, setError] = useState<LabKgError>();
  const active = useRef<AbortController>(null);
  const emptyKgResult = result?.rows.length === 0;
  useEffect(() => () => active.current?.abort(), []);

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
      setLocalMatches(undefined);
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
      if (answer.rows.length === 0) {
        setCheckingLocal(true);
        try {
          const [papers, contexts, library] = await Promise.all([
            repo.papers.listSummaries(),
            repo.paperContext.list(),
            repo.library.list(),
          ]);
          if (signal.aborted) return;
          const matches = findLocalPaperMatches(text, papers, contexts, library);
          const fullPapers = matches.some((match) => match.paperId)
            ? await repo.papers.getMany(matches.flatMap((match) => (match.paperId ? [match.paperId] : [])))
            : [];
          if (!signal.aborted) setLocalMatches(addLocalPaperAbstracts(matches, fullPapers));
        } catch {
          if (!signal.aborted) setLocalError('Không tra được kho bài PaperLab của project này. Hãy thử lại.');
        }
      }
    } catch (cause) {
      if (signal.aborted) return;
      if (cause instanceof LabKgError) setError(cause);
      else {
        const message = describeLlmError(cause);
        if (message) setError(new LabKgError(message, cause instanceof Error ? cause.message : ''));
      }
    } finally {
      active.current = null;
      setCheckingLocal(false);
      setReceiving(false);
      if (!signal.aborted) setBusy(false);
    }
  }

  return (
    <section className={styles.ask} aria-labelledby="ask-kg-heading">
      <div className={styles.panelHeading}>
        <h2 id="ask-kg-heading" className={styles.heading}>
          Hỏi KG bằng câu hỏi
        </h2>
        <p className={styles.muted}>Đặt câu hỏi bằng tiếng Việt hoặc tiếng Anh để truy vấn dữ liệu.</p>
      </div>
      <form className={styles.askForm} onSubmit={(event) => void ask(event)}>
        <TextField
          multiline
          rows={2}
          label="Câu hỏi về KG"
          hint="Câu trả lời được tạo từ dữ liệu hiện có trong KG."
          maxLength={MAX_QUESTION_LENGTH}
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
        />
        <Button type="submit" disabled={busy || !question.trim()}>
          Hỏi KG (AI)
        </Button>
      </form>
      {busy && (
        <p className={styles.muted} role="status">
          {generated
            ? 'Đang truy vấn KG…'
            : receiving
              ? 'Đang nhận phản hồi từ mô hình…'
              : 'Đang gửi yêu cầu đến mô hình…'}
        </p>
      )}
      {generated &&
        (emptyKgResult ? (
          <details className={styles.queryDetails}>
            <summary>Chi tiết truy vấn</summary>
            <p>{generated.explanation}</p>
            <pre className={styles.sql} aria-label="SQL được tạo">
              <code>{generated.sql}</code>
            </pre>
          </details>
        ) : (
          <>
            <p>{generated.explanation}</p>
            <pre className={styles.sql} aria-label="SQL được tạo">
              <code>{generated.sql}</code>
            </pre>
          </>
        ))}
      {error && <ErrorNote error={error} />}
      {result && (
        <>
          {result.rows.length === 0 ? (
            <p className={styles.muted} role="status">
              Không có bản ghi phù hợp trong Lab KG.
            </p>
          ) : (
            <>
              <p className={styles.muted} role="status">
                {result.rows.length} dòng
                {result.truncated && ' · Đã giới hạn kết quả, còn dòng chưa hiển thị.'}
              </p>
              <p className={styles.muted}>
                Concept đã dùng
                {result.concepts.length
                  ? ` · ${result.concepts.map((id) => conceptNames.get(id) ?? id).join(', ')}`
                  : ' · Không có'}
              </p>
            </>
          )}
          {result.rows.length > 0 && result.columns.length > 0 && (
            <DataTable aria-label="Kết quả truy vấn KG" className={styles.sqlTable}>
              <thead>
                <tr>
                  {result.columns.map((column, i) => (
                    <th key={i} scope="col">
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row, i) => (
                  <tr key={i}>
                    {row.map((value, j) => (
                      <td key={j}>{Array.isArray(value) ? JSON.stringify(value) : (value ?? 'NULL')}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </DataTable>
          )}
        </>
      )}
      {result?.rows.length === 0 && (
        <section className={styles.localResults} aria-label="Tìm trong kho PaperLab">
          <div>
            <h3 className={styles.localResultsHeading}>Kho PaperLab của project</h3>
            {checkingLocal ? (
              <p className={styles.muted} role="status">
                Lab KG không có dòng phù hợp. Đang tìm trong bài đã nhập…
              </p>
            ) : localError ? (
              <p className={styles.muted} role="alert">
                {localError}
              </p>
            ) : localMatches?.length ? (
              <p className={styles.muted} role="status">
                Tìm thấy {localMatches.length} mục trong kho PaperLab của project.
              </p>
            ) : (
              <p className={styles.muted} role="status">
                Không tìm thấy bài khớp trong kho PaperLab của project này.
              </p>
            )}
          </div>
          {localMatches && localMatches.length > 0 && (
            <ul className={styles.localMatchList}>
              {localMatches.map((match) => (
                <li key={match.paperId ?? `${match.doi}:${match.title}`}>
                  <div className={styles.localMatchTitle}>{match.title}</div>
                  <p className={styles.muted}>
                    {[match.doi && `DOI ${match.doi}`, match.year].filter(Boolean).join(' · ')}
                  </p>
                  {(match.venue || match.authors.length > 0) && (
                    <details>
                      <summary>Thông tin thư mục</summary>
                      <p className={styles.muted}>
                        {[match.venue, match.authors.join(', ')].filter(Boolean).join(' · ')}
                      </p>
                    </details>
                  )}
                  {match.abstract && (
                    <details>
                      <summary>Xem tóm tắt đã nhập</summary>
                      <p>{match.abstract}</p>
                    </details>
                  )}
                  {match.paperId && <Link to={`/papers/${match.paperId}`}>Mở bài đã nhập</Link>}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </section>
  );
}
