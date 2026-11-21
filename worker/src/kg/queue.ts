import type { KgIngestSource, KgIngestStatus, KgQueueState } from '../../../src/core/schemas/labKg';
import type { D1Database } from './bindings';

export const MAX_ATTEMPTS = 5;
const LEASE_MS = 5 * 60_000;
const scopeId = (projectId: string | undefined, id: string) => (projectId ? `@rh/${projectId}/${id}` : id);
const logicalId = (projectId: string | undefined, id: string) => {
  const prefix = projectId ? `@rh/${projectId}/` : '';
  return prefix && id.startsWith(prefix) ? id.slice(prefix.length) : id;
};

type Job = { id: string; depth: number; attempts: number; claim_token: string };
type JobOutcome = { at: string } & (
  | { status: 'done'; paperId: string; targets: string[] }
  | { status: 'pending' | 'failed'; code: string; nextAt: string }
);

export function enqueueStatement(
  db: D1Database,
  ids: string[],
  depth: number,
  source: KgIngestSource,
  at: string,
  parent?: Job,
) {
  return db
    .prepare(
      `INSERT INTO ingest_queue (id, depth, source, next_at, enqueued_at)
    SELECT value, ?1, ?2, ?3, ?3 FROM json_each(?4)
    WHERE ?5 IS NULL OR EXISTS (SELECT 1 FROM ingest_queue WHERE id = ?5 AND claim_token = ?6)
    ON CONFLICT(id) DO UPDATE SET depth = excluded.depth,
      source = excluded.source,
      status = CASE WHEN ingest_queue.status = 'done' THEN 'pending' ELSE ingest_queue.status END,
      attempts = CASE WHEN ingest_queue.status = 'done' THEN 0 ELSE ingest_queue.attempts END,
      next_at = CASE WHEN ingest_queue.status = 'done' THEN excluded.next_at ELSE ingest_queue.next_at END
    WHERE excluded.depth > ingest_queue.depth AND ingest_queue.status <> 'failed'`,
    )
    .bind(depth, source, at, JSON.stringify(ids), parent?.id ?? null, parent?.claim_token ?? null);
}

export function kgQueue(db: D1Database, projectId?: string) {
  return {
    async enqueue(ids: string[], depth: number, source: KgIngestSource, at: string) {
      const [queued] = await db.batch([
        enqueueStatement(
          db,
          [...new Set(ids)].map((id) => scopeId(projectId, id)),
          depth,
          source,
          at,
        ),
      ]);
      return queued?.meta.changes ?? 0;
    },

    async claim(now: Date, ids?: string[]) {
      const at = now.toISOString();
      const leaseUntil = new Date(now.getTime() + LEASE_MS).toISOString();
      const token = crypto.randomUUID();
      const [, , result] = await db.batch<Job>([
        db
          .prepare(
            `INSERT INTO ingest_log (id, code, attempts, at)
          SELECT id, 'lease_expired', attempts, ?1 FROM ingest_queue
          WHERE status = 'processing' AND next_at <= ?1 AND attempts >= ?2
            AND (?3 IS NULL OR id LIKE ?3)`,
          )
          .bind(at, MAX_ATTEMPTS, projectId ? `@rh/${projectId}/%` : null),
        db
          .prepare(
            `UPDATE ingest_queue SET status = 'failed', claim_token = NULL
          WHERE status = 'processing' AND next_at <= ?1 AND attempts >= ?2
            AND (?3 IS NULL OR id LIKE ?3)`,
          )
          .bind(at, MAX_ATTEMPTS, projectId ? `@rh/${projectId}/%` : null),
        db
          .prepare(
            `UPDATE ingest_queue SET status = 'processing', attempts = attempts + 1, next_at = ?1, claim_token = ?2
          WHERE id = (SELECT id FROM ingest_queue WHERE status IN ('pending', 'processing') AND next_at <= ?3
            AND attempts < ?4 AND (?5 IS NULL OR id IN (SELECT value FROM json_each(?5)))
            AND (?6 IS NULL OR id LIKE ?6)
            AND NOT EXISTS (SELECT 1 FROM ingest_log
              WHERE code = 'openalex_rate_limited' AND retry_at > ?3 AND (?7 IS NULL OR id LIKE ?7))
            ORDER BY next_at, enqueued_at, source = 'expansion', id LIMIT 1)
          RETURNING id, depth, attempts, claim_token`,
          )
          .bind(
            leaseUntil,
            token,
            at,
            MAX_ATTEMPTS,
            ids ? JSON.stringify(ids.map((id) => scopeId(projectId, id))) : null,
            projectId ? `@rh/${projectId}/%` : null,
            projectId ? `@rh/${projectId}/%` : null,
          ),
      ]);
      const job = result?.results[0];
      return job ? { ...job, id: logicalId(projectId, job.id) } : undefined;
    },

    async finish(job: Job, outcome: JobOutcome) {
      const { at, status } = outcome;
      const code = status === 'done' ? 'ingested' : outcome.code;
      const nextAt = status === 'done' ? at : outcome.nextAt;
      const physicalJob = { ...job, id: scopeId(projectId, job.id) };
      const statements = [
        ...(outcome.status === 'done' && outcome.targets.length
          ? [
              enqueueStatement(
                db,
                outcome.targets.map((id) => scopeId(projectId, id)),
                job.depth - 1,
                'expansion',
                at,
                physicalJob,
              ),
            ]
          : []),
        db
          .prepare(
            `INSERT INTO ingest_log (id, code, attempts, at, retry_at)
          SELECT id, ?1, attempts, ?2, CASE WHEN ?1 = 'openalex_rate_limited' THEN ?3 ELSE NULL END
          FROM ingest_queue WHERE id = ?4 AND claim_token = ?5`,
          )
          .bind(code, at, nextAt, physicalJob.id, job.claim_token),
        db
          .prepare(
            `UPDATE ingest_queue SET
          status = CASE WHEN ?1 = 'done' AND depth > ?2 THEN 'pending' ELSE ?1 END,
          attempts = CASE WHEN ?1 = 'done' AND depth > ?2 THEN 0 ELSE attempts END,
          next_at = ?3, claim_token = NULL,
          resolved_paper_id = coalesce(?4, resolved_paper_id)
          WHERE id = ?5 AND claim_token = ?6`,
          )
          .bind(
            status,
            job.depth,
            nextAt,
            status === 'done' ? scopeId(projectId, outcome.paperId) : null,
            physicalJob.id,
            job.claim_token,
          ),
      ];
      const result = await db.batch(statements);
      return result.at(-1)?.meta.changes === 1;
    },

    async status(): Promise<KgIngestStatus> {
      const counts = { pending: 0, processing: 0, done: 0, failed: 0 };
      const [queue, logs] = await db.batch<
        { status: KgQueueState; count: number } | KgIngestStatus['logs'][number]
      >([
        db
          .prepare(
            `SELECT status, count(*) AS count FROM ingest_queue ${projectId ? 'WHERE id LIKE ?' : ''} GROUP BY status`,
          )
          .bind(...(projectId ? [`@rh/${projectId}/%`] : [])),
        db
          .prepare(
            `SELECT id, code, attempts, at FROM ingest_log ${projectId ? 'WHERE id LIKE ?' : ''} ORDER BY sequence DESC LIMIT 20`,
          )
          .bind(...(projectId ? [`@rh/${projectId}/%`] : [])),
      ]);
      for (const row of queue?.results ?? []) if ('status' in row) counts[row.status] = row.count;
      return {
        counts,
        logs: (logs?.results ?? [])
          .filter((row) => 'code' in row)
          .map((row) => ({ ...row, id: logicalId(projectId, row.id) })),
      };
    },
  };
}
