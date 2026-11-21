import { canonicalDigest } from '@/core/corpus';
import { buildPaperModel, SENTENCE_KEY_VERSION } from '@/core/paperModel';
import { SEGMENTER_VERSION } from '@/core/text';
import type { CorpusMember } from '@/core/schemas/corpus';
import type { Repositories } from '@/shared/storage/types';

export async function modelInputs(
  member: CorpusMember,
  repo: Repositories,
  build = false,
): Promise<NonNullable<CorpusMember['inputs']>> {
  const id = member.identifiers.paperIds[0];
  if (!id) throw new Error('Thiếu paper');
  const [paper, context, insights, stance] = await Promise.all([
    repo.papers.get(id),
    repo.paperContext.get(id),
    repo.paperInsights.get(id),
    repo.stance.get(id),
  ]);
  if (!paper) throw new Error('Không tìm thấy paper');
  const metadata = context?.metadata ?? null;
  if (build) buildPaperModel({ paper, metadata, insights, stance, now: new Date() });
  const insightRunIds = [insights?.rhetoricRuns.at(-1)?.id, insights?.contributionRuns.at(-1)?.id].filter(
    (x): x is string => Boolean(x),
  );
  return {
    textHashes: paper.paragraphs.map((p) => p.textHash),
    metadataDigest: await canonicalDigest(metadata),
    insightRunIds,
    stanceRunIds: stance?.runs.at(-1) ? [stance.runs.at(-1)!.id] : [],
    segmenterVersion: SEGMENTER_VERSION,
    sentenceKeyVersion: SENTENCE_KEY_VERSION,
  };
}
