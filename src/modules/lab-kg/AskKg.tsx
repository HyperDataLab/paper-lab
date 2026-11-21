import { useEffect, useRef, useState, type FormEvent } from 'react';
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
  const projectId = useHubProjectId();
  const { client, config, ensureConsent } = useLlm();
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [generated, setGenerated] = useState<KgSqlOutput>();
  const [result, setResult] = useState<KgSqlResult>();
  const [error, setError] = useState<LabKgError>();
  const active = useRef<AbortController>(null);
  useEffect(() => () => active.current?.abort(), []);

  async function ask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = question.trim();
    if (!text || !user || active.current) return;
    const controller = new AbortController();
    const { signal } = controller;
    active.current = controller;
    setBusy(true);
    try {
      if (!(await ensureConsent('kg')) || signal.aborted) return;
      setGenerated(undefined);
      setResult(undefined);
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
        signal,
        onRequest: async () => requireConsent(config),
      });
      if (signal.aborted) return;
      setGenerated(data);
      if (!projectId) throw new LabKgError('Mở một project ResearchHub để truy vấn KG.');
      const answer = await queryLabKg(data.sql, token, projectId, signal);
      if (!signal.aborted) setResult(answer);
    } catch (cause) {
      if (signal.aborted) return;
      if (cause instanceof LabKgError) setError(cause);
      else {
        const message = describeLlmError(cause);
        if (message) setError(new LabKgError(message, cause instanceof Error ? cause.message : ''));
      }
    } finally {
      active.current = null;
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
          {generated ? 'Đang truy vấn KG…' : 'Đang chuẩn bị SQL…'}
        </p>
      )}
      {generated && (
        <>
          <p>{generated.explanation}</p>
          <pre className={styles.sql} aria-label="SQL được tạo">
            <code>{generated.sql}</code>
          </pre>
        </>
      )}
      {error && <ErrorNote error={error} />}
      {result && (
        <>
          <p className={styles.muted} role="status">
            {result.rows.length} dòng{result.truncated && ' · Đã giới hạn kết quả, còn dòng chưa hiển thị.'}
          </p>
          <p className={styles.muted}>
            Concept đã dùng
            {result.concepts.length
              ? ` · ${result.concepts.map((id) => conceptNames.get(id) ?? id).join(', ')}`
              : ' · Không có'}
          </p>
          {result.columns.length > 0 && (
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
    </section>
  );
}
