import { candidateFromWork } from '@/core/extraction/deep';
import { SNOWBALL_SOURCES, type SnowballDirection, type SnowballResult } from '@/core/corpus/snowball';
import type { Candidate, CorpusMember } from '@/core/schemas';
import type { ScholarClient } from '@/shared/scholar/client';

type Client = Pick<ScholarClient, 'referencedWorks' | 'worksByIds' | 'citingWorks'>;
const toCandidates = (works: unknown[], direction: SnowballDirection) =>
  works
    .map((work) => candidateFromWork(work, SNOWBALL_SOURCES[direction]))
    .filter((item): item is Candidate => item !== null);

/**
 * One snowballing iteration in one direction. Backward reads each seed's reference list and fetches those works;
 * forward pages through the works citing each seed. `cap` limits works per seed; null means no limit.
 */
export async function runSnowball(
  client: Client,
  seeds: CorpusMember[],
  direction: SnowballDirection,
  cap: number | null,
  signal?: AbortSignal,
): Promise<SnowballResult> {
  const withIds = seeds.flatMap((seed) =>
    seed.identifiers.openalexId ? [{ memberId: seed.memberId, id: seed.identifiers.openalexId }] : [],
  );
  const requestUrls: string[] = [];
  let truncated = false;
  if (direction === 'backward') {
    const ids = new Set<string>();
    const reported = new Set<string>();
    for (const seed of withIds) {
      const references = await client.referencedWorks(seed.id, signal);
      requestUrls.push(references.url);
      const kept = cap === null ? references.ids : references.ids.slice(0, cap);
      if (kept.length < references.ids.length) truncated = true;
      references.ids.forEach((id) => reported.add(id));
      kept.forEach((id) => ids.add(id));
    }
    const works = await client.worksByIds([...ids], signal);
    requestUrls.push(...works.urls);
    const candidates = toCandidates(works.results, direction);
    // Retrieved counts what entered intake (works without a title are dropped), so the PRISMA column adds up.
    return {
      direction,
      seeds: withIds.map((seed) => seed.memberId),
      candidates,
      requestUrls,
      totalReported: reported.size,
      retrieved: candidates.length,
      truncated,
    };
  }
  const results: unknown[] = [];
  let totalReported = 0;
  for (const seed of withIds) {
    const citing = await client.citingWorks(seed.id, { cap }, signal);
    requestUrls.push(...citing.urls);
    results.push(...citing.results);
    totalReported += citing.total;
    truncated ||= citing.truncated;
  }
  const candidates = toCandidates(results, direction);
  return {
    direction,
    seeds: withIds.map((seed) => seed.memberId),
    candidates,
    requestUrls,
    totalReported,
    retrieved: candidates.length,
    truncated,
  };
}
