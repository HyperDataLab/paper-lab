// Passage indexing (docs/plans/PASSAGE_INDEX.md). Papers reach `passage_queue` through the triggers of migration
// 0004 (every write of a `papers` record) or POST /v1/passages/reindex; the cron drains the queue in bounded
// batches: read the paper body, split its paragraphs, embed the new or changed ones through Workers AI, upsert
// them to Vectorize, then upsert the D1 rows (which keep the FTS5 index in step). Removed paragraphs and deleted
// papers lose their rows and vectors.
import { PaperSchema } from '../../../src/core/schemas/paper';
import type { PassageStatus } from '../../../src/core/schemas/passages';
import { chunk, projectRecordId, type DocRow } from '../data/store';
import { EMBEDDING_MODEL, type D1Database, type D1Statement } from '../kg/bindings';
import { passageVectorId, sha256Hex, type PassageEnv } from './bindings';
import { EMBED_CHARS, splitPassages, type SplitPassage } from './split';

export const MAX_ATTEMPTS = 5;
/** Papers per cron run (every 5 minutes) and per reindex request. */
export const CRON_PAPERS = 10;
export const REQUEST_PAPERS = 1;
/** Embeddings per drain; the claim loop stops once a run has embedded this many passages. */
export const MAX_EMBEDDINGS_PER_RUN = 1500;
/** Texts per Workers AI call and vectors per Vectorize call. */
export const EMBED_BATCH = 50;
const VECTOR_BATCH = 100;
/** Bytes of passage JSON per D1 statement, well under D1's 2 MB value limit. */
const WRITE_BYTES = 512 * 1024;
const LEASE_MS = 10 * 60_000;
const EMBEDDING_DIMENSIONS = 768;

export class PassageIndexError extends Error {
  constructor(
    readonly code: string,
    readonly retry = true,
  ) {
    super(code);
  }
}

export interface PassageJob {
  project_id: string;
  paper_id: string;
  generation: number;
  attempts: number;
}

interface PassageRow {
  paragraph_id: string;
  section_role: string;
  ord: number;
  text_hash: string;
  vector_id: string;
}

const UPSERT_QUEUE = `ON CONFLICT (project_id, paper_id) DO UPDATE SET status = 'pending',
  generation = passage_queue.generation + 1, attempts = 0, next_at = excluded.next_at,
  enqueued_at = excluded.enqueued_at, last_error = NULL`;

/**
 * Queues a project's papers: the live `papers` records (all, or those in `paperIds`) and the papers that still have
 * passages but no live record, so their rows and vectors are removed. Returns how many queue rows changed.
 */
export async function enqueuePapers(
  db: D1Database,
  projectId: string,
  paperIds: string[] | null,
  at: string,
) {
  const prefix = `@rh/${projectId}/`;
  const ids = paperIds ? JSON.stringify([...new Set(paperIds)]) : null;
  const results = await db.batch([
    db
      .prepare(
        `INSERT INTO passage_queue (project_id, paper_id, next_at, enqueued_at)
        SELECT ?1, substr(id, ?4), ?2, ?2 FROM doc
        WHERE collection = 'papers' AND hub_project_id = ?1 AND substr(id, 1, ?4 - 1) = ?5 AND deleted_at IS NULL
          AND (?3 IS NULL OR substr(id, ?4) IN (SELECT value FROM json_each(?3)))
        ${UPSERT_QUEUE}`,
      )
      .bind(projectId, at, ids, prefix.length + 1, prefix),
    db
      .prepare(
        `INSERT INTO passage_queue (project_id, paper_id, next_at, enqueued_at)
        SELECT DISTINCT project_id, paper_id, ?2, ?2 FROM passage
        WHERE project_id = ?1 AND (?3 IS NULL OR paper_id IN (SELECT value FROM json_each(?3)))
          AND NOT EXISTS (SELECT 1 FROM doc WHERE collection = 'papers' AND id = ?4 || passage.paper_id
            AND deleted_at IS NULL)
        ${UPSERT_QUEUE}`,
      )
      .bind(projectId, at, ids, prefix),
  ]);
  return results.reduce((sum, result) => sum + result.meta.changes, 0);
}

/** Leases up to `limit` due jobs (their `next_at` moves past the lease, so an overlapping run skips them). */
async function claimJobs(db: D1Database, now: Date, limit: number, projectId?: string) {
  const [result] = await db.batch<PassageJob>([
    db
      .prepare(
        `UPDATE passage_queue SET next_at = ?1
        WHERE (project_id, paper_id) IN (SELECT project_id, paper_id FROM passage_queue
          WHERE status = 'pending' AND next_at <= ?2 AND (?3 IS NULL OR project_id = ?3)
          ORDER BY next_at, enqueued_at LIMIT ?4)
        RETURNING project_id, paper_id, generation, attempts`,
      )
      .bind(new Date(now.getTime() + LEASE_MS).toISOString(), now.toISOString(), projectId ?? null, limit),
  ]);
  return result?.results ?? [];
}

/** Ends a job unless the paper was queued again while it ran (then the newer generation stays pending). */
async function finishJob(db: D1Database, job: PassageJob, now: Date, error?: PassageIndexError) {
  const attempts = job.attempts + 1;
  const failed = !!error && (!error.retry || attempts >= MAX_ATTEMPTS);
  const status = !error ? 'done' : failed ? 'failed' : 'pending';
  const nextAt = error && !failed ? new Date(now.getTime() + 60_000 * 2 ** (attempts - 1)) : now;
  await db.batch([
    db
      .prepare(
        `UPDATE passage_queue SET status = ?1, attempts = ?2, next_at = ?3, last_error = ?4
        WHERE project_id = ?5 AND paper_id = ?6 AND generation = ?7`,
      )
      .bind(
        status,
        error ? attempts : 0,
        nextAt.toISOString(),
        error?.code ?? null,
        job.project_id,
        job.paper_id,
        job.generation,
      ),
  ]);
}

async function readPaper(env: PassageEnv, projectId: string, paperId: string) {
  const [result] = await env.db.batch<DocRow>([
    env.db
      .prepare("SELECT * FROM doc WHERE collection = 'papers' AND id = ?")
      .bind(projectRecordId(projectId, paperId)),
  ]);
  const row = result?.results[0];
  if (!row || row.deleted_at) return null;
  let text = row.body_json;
  if (text === null && row.r2_key) {
    const object = await env.bucket.get(row.r2_key);
    text = object ? await new Response(object.body).text() : null;
  }
  if (text === null) throw new PassageIndexError('paper_body_missing');
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new PassageIndexError('paper_invalid', false);
  }
  const paper = PaperSchema.safeParse(value);
  if (!paper.success) throw new PassageIndexError('paper_invalid', false);
  return paper.data;
}

async function embed(env: PassageEnv, texts: string[]) {
  let data: number[][] | undefined;
  try {
    data = (await env.ai.run(EMBEDDING_MODEL, { text: texts.map((text) => text.slice(0, EMBED_CHARS)) }))
      .data;
  } catch {
    throw new PassageIndexError('embedding_failed');
  }
  if (
    data?.length !== texts.length ||
    data.some(
      (values) => values.length !== EMBEDDING_DIMENSIONS || values.some((value) => !Number.isFinite(value)),
    )
  )
    throw new PassageIndexError('embedding_failed');
  return data;
}

async function deleteVectors(env: PassageEnv, ids: string[]) {
  for (const part of chunk(ids, VECTOR_BATCH)) {
    try {
      await env.vectors.deleteByIds(part);
    } catch {
      throw new PassageIndexError('vector_delete_failed');
    }
  }
}

function deleteRows(db: D1Database, projectId: string, paperId: string, paragraphIds: string[] | null) {
  return db
    .prepare(
      `DELETE FROM passage WHERE project_id = ?1 AND paper_id = ?2
      AND (?3 IS NULL OR paragraph_id IN (SELECT value FROM json_each(?3)))`,
    )
    .bind(projectId, paperId, paragraphIds ? JSON.stringify(paragraphIds) : null);
}

type RowValues = [string, string, string, string, number, string, string, string, string];

function upsertRows(db: D1Database, rows: RowValues[]) {
  const statements: D1Statement[] = [];
  let part: RowValues[] = [];
  let bytes = 0;
  const flush = () => {
    if (!part.length) return;
    statements.push(
      db
        .prepare(
          `INSERT INTO passage (project_id, paper_id, paragraph_id, section_role, ord, text, text_hash, vector_id,
            indexed_at)
          SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]'), json_extract(value, '$[2]'),
            json_extract(value, '$[3]'), json_extract(value, '$[4]'), json_extract(value, '$[5]'),
            json_extract(value, '$[6]'), json_extract(value, '$[7]'), json_extract(value, '$[8]')
          FROM json_each(?1) WHERE true
          ON CONFLICT (project_id, paper_id, paragraph_id) DO UPDATE SET section_role = excluded.section_role,
            ord = excluded.ord, text = excluded.text, text_hash = excluded.text_hash,
            vector_id = excluded.vector_id, indexed_at = excluded.indexed_at`,
        )
        .bind(JSON.stringify(part)),
    );
    part = [];
    bytes = 0;
  };
  for (const row of rows) {
    const size = row[5].length * 3 + 400;
    if (bytes + size > WRITE_BYTES) flush();
    part.push(row);
    bytes += size;
  }
  flush();
  return statements;
}

/**
 * Brings one paper's passages in line with its current record. Returns how many passages were embedded.
 * Vectors are written before D1 rows: a crash in between re-embeds on the retry instead of leaving a row whose
 * hash says its vector exists.
 */
export async function indexPaper(env: PassageEnv, projectId: string, paperId: string, at: string) {
  const [existingResult] = await env.db.batch<PassageRow>([
    env.db
      .prepare(
        `SELECT paragraph_id, section_role, ord, text_hash, vector_id FROM passage
        WHERE project_id = ? AND paper_id = ?`,
      )
      .bind(projectId, paperId),
  ]);
  const existing = new Map((existingResult?.results ?? []).map((row) => [row.paragraph_id, row]));
  const paper = await readPaper(env, projectId, paperId);

  if (!paper) {
    await deleteVectors(
      env,
      [...existing.values()].map((row) => row.vector_id),
    );
    await env.db.batch([deleteRows(env.db, projectId, paperId, null)]);
    return 0;
  }

  const passages = splitPassages(paper);
  const kept = new Set(passages.map((passage) => passage.paragraphId));
  const removed = [...existing.values()].filter((row) => !kept.has(row.paragraph_id));
  const toEmbed: (SplitPassage & { hash: string; vectorId: string })[] = [];
  const rows: RowValues[] = [];
  for (const passage of passages) {
    const hash = await sha256Hex(passage.text);
    const vectorId = await passageVectorId(projectId, paperId, passage.paragraphId);
    const prior = existing.get(passage.paragraphId);
    // The vector's metadata carries the section role, so a changed role re-embeds too.
    if (!prior || prior.text_hash !== hash || prior.section_role !== passage.sectionRole)
      toEmbed.push({ ...passage, hash, vectorId });
    else if (prior.ord === passage.ord && prior.vector_id === vectorId) continue;
    rows.push([
      projectId,
      paperId,
      passage.paragraphId,
      passage.sectionRole,
      passage.ord,
      passage.text,
      hash,
      vectorId,
      at,
    ]);
  }

  for (const batch of chunk(toEmbed, EMBED_BATCH)) {
    const values = await embed(
      env,
      batch.map(({ text }) => text),
    );
    try {
      await env.vectors.upsert(
        batch.map((passage, index) => ({
          id: passage.vectorId,
          values: values[index] as number[],
          metadata: {
            projectId,
            paperId,
            paragraphId: passage.paragraphId,
            sectionRole: passage.sectionRole,
          },
        })),
      );
    } catch {
      throw new PassageIndexError('vector_write_failed');
    }
  }
  await deleteVectors(
    env,
    removed.map((row) => row.vector_id),
  );
  const statements = [
    ...(removed.length
      ? [
          deleteRows(
            env.db,
            projectId,
            paperId,
            removed.map((row) => row.paragraph_id),
          ),
        ]
      : []),
    ...upsertRows(env.db, rows),
  ];
  if (statements.length) {
    try {
      await env.db.batch(statements);
    } catch {
      throw new PassageIndexError('storage_failed');
    }
  }
  return toEmbed.length;
}

export async function drainPassageQueue(
  env: PassageEnv,
  {
    now,
    limit = CRON_PAPERS,
    projectId,
    maxEmbeddings = MAX_EMBEDDINGS_PER_RUN,
  }: { now: () => Date; limit?: number; projectId?: string; maxEmbeddings?: number },
) {
  let processed = 0;
  let embedded = 0;
  const errors: { projectId: string; paperId: string; code: string }[] = [];
  while (processed + errors.length < limit && embedded < maxEmbeddings) {
    const jobs = await claimJobs(env.db, now(), 1, projectId);
    const job = jobs[0];
    if (!job) break;
    try {
      embedded += await indexPaper(env, job.project_id, job.paper_id, now().toISOString());
      await finishJob(env.db, job, now());
      processed++;
    } catch (cause) {
      const error = cause instanceof PassageIndexError ? cause : new PassageIndexError('index_failed');
      await finishJob(env.db, job, now(), error);
      errors.push({ projectId: job.project_id, paperId: job.paper_id, code: error.code });
    }
  }
  return { processed, embedded, errors };
}

export async function passageStatus(db: D1Database, projectId: string): Promise<PassageStatus> {
  const [queue, totals] = await db.batch<{ status?: string; count: number; papers?: number }>([
    db
      .prepare('SELECT status, count(*) AS count FROM passage_queue WHERE project_id = ? GROUP BY status')
      .bind(projectId),
    db
      .prepare(
        'SELECT count(*) AS count, count(DISTINCT paper_id) AS papers FROM passage WHERE project_id = ?',
      )
      .bind(projectId),
  ]);
  const counts = { pending: 0, done: 0, failed: 0 };
  for (const row of queue?.results ?? [])
    if (row.status === 'pending' || row.status === 'done' || row.status === 'failed')
      counts[row.status] = row.count;
  const total = totals?.results[0];
  return { queue: counts, passages: total?.count ?? 0, papers: total?.papers ?? 0 };
}
