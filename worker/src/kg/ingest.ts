import { expansionTargets, mapOpenAlexWorkToKg } from '../../../src/core/labKg';
import type { KgIngestResult } from '../../../src/core/schemas/labKg';
import { EMBEDDING_MODEL, type ConfiguredKg } from './bindings';
import { OpenAlexError, openAlexClient } from './openAlex';
import { kgQueue, MAX_ATTEMPTS } from './queue';
import { kgRepo } from './repo';
const scopeId = (projectId: string | undefined, id: string) => projectId ? `@rh/${projectId}/${id}` : id;

export const REQUEST_JOBS = 1;
/**
 * Jobs per cron run (every 5 minutes). A job makes about seven subrequests (claim, OpenAlex work, citing works,
 * D1 upsert batch, Workers AI embedding, Vectorize upsert, finish), so 20 jobs stay far below the paid plan's 1000.
 */
export const CRON_JOBS = 20;

function retryAt(now: Date, attempts: number, header: string | null) {
  const retryAfter =
    header && /^\d+$/u.test(header) ? now.getTime() + Number(header) * 1000 : Date.parse(header ?? '');
  const backoff = now.getTime() + 60_000 * 2 ** (attempts - 1);
  const validHeader = Number.isFinite(retryAfter) && retryAfter <= Date.UTC(9999, 11, 31);
  return new Date(Math.max(backoff, validHeader ? retryAfter : 0)).toISOString();
}

export async function drainKgQueue(
  kg: ConfiguredKg,
  {
    now,
    fetcher = fetch,
    limit = CRON_JOBS,
    ids,
    projectId,
  }: { now: () => Date; fetcher?: typeof fetch; limit?: number; ids?: string[]; projectId?: string },
): Promise<Pick<KgIngestResult, 'processed' | 'errors'>> {
  const openAlex = openAlexClient(fetcher, kg.mailto, kg.apiKey);
  const repo = kgRepo(kg.db, projectId);
  const queue = kgQueue(kg.db, projectId);
  let processed = 0;
  const errors: KgIngestResult['errors'] = [];
  for (let i = 0; i < limit; i++) {
    const job = await queue.claim(now(), ids);
    if (!job) break;
    let errorCode = 'ingest_failed';
    try {
      const work = await openAlex.work(job.id);
      errorCode = 'openalex_invalid_response';
      const graph = mapOpenAlexWorkToKg(work);
      const paper = graph.nodes.paper;
      const citing = job.depth > 0 ? await openAlex.citing(paper.id) : [];
      errorCode = 'storage_failed';
      await repo.upsertWork(graph);
      const text = [paper.title, paper.abstract].filter(Boolean).join('\n\n');
      if (text) {
        errorCode = 'embedding_failed';
        const values = (await kg.ai.run(EMBEDDING_MODEL, { text: [text] })).data?.[0];
        if (values?.length !== 768 || values.some((value) => !Number.isFinite(value)))
          throw new Error(errorCode);
        errorCode = 'vector_write_failed';
        await kg.vectors.upsert([
          {
            id: scopeId(projectId, paper.id),
            values,
            metadata: {
              ...(paper.publication_year !== null ? { year: paper.publication_year } : {}),
              ...(paper.subfield_id ? { subfieldId: paper.subfield_id } : {}),
            },
          },
        ]);
      }
      errorCode = 'storage_failed';
      const targets = expansionTargets(
        {
          id: paper.id,
          referenced_works: graph.edges.cites.map(({ target_id }) => target_id),
          citing_works: citing,
        },
        { depth: job.depth },
      );
      if (
        await queue.finish(job, {
          at: now().toISOString(),
          status: 'done',
          paperId: paper.id,
          targets: targets.map(({ id }) => id),
        })
      )
        processed++;
    } catch (cause) {
      const error = cause instanceof OpenAlexError ? cause : new OpenAlexError(errorCode);
      const completedAt = now();
      const at = completedAt.toISOString();
      const rateLimited = error.code === 'openalex_rate_limited';
      const retry = error.retry && job.attempts < MAX_ATTEMPTS;
      if (
        await queue.finish(job, {
          at,
          code: error.code,
          status: retry ? 'pending' : 'failed',
          nextAt: retry || rateLimited ? retryAt(completedAt, job.attempts, error.retryAfter) : at,
        })
      )
        errors.push({ id: job.id, code: error.code });
      if (rateLimited) break;
    }
  }
  return { processed, errors };
}
