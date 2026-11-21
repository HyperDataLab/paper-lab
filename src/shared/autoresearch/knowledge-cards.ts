import { z } from 'zod';
import { canonicalDigest } from '@/core/corpus';
import type { StageContent } from '@/core/autoresearch/contracts';
import type { StageState } from '@/core/autoresearch/record';
import { cardOutputSchema } from '@/core/autoresearch/stage-fields';
import { passStage } from '@/core/autoresearch/validation';
import type { CardInput } from './card-sources';

export const CARD_BATCH = 8;
const outputSchema = z.strictObject({ cards: z.array(cardOutputSchema) });
type CardOutput = z.infer<typeof cardOutputSchema>;
type KnowledgeCard = StageContent['S6']['cards'][number];

function resolveCard(candidate: CardOutput, source: CardInput): KnowledgeCard | null {
  if (candidate.evidence_scope !== source.evidence_scope) return null;
  if (source.evidence_scope === 'abstract') return candidate.quote_anchors.length ? null : candidate;
  const byKey = new Map(
    source.sections.flatMap(({ title, sentences }) =>
      sentences.map((sentence) => [sentence.key, { ...sentence, section: title }]),
    ),
  );
  const sentences = candidate.quote_anchors.flatMap((key) => byKey.get(key) ?? []);
  if (!sentences.length || sentences.length !== candidate.quote_anchors.length) return null;
  return { ...candidate, full_text_source: { paperId: source.paperId, sentences } };
}

export async function extractCards(
  eligible: CardInput[],
  prior: Pick<StageContent, 'S4' | 'S5'>,
  state: StageState,
  checkpoint: (patch: Partial<StageState>) => Promise<void>,
  ask: (batch: CardInput[], schema: typeof outputSchema) => Promise<z.infer<typeof outputSchema>>,
): Promise<StageContent['S6'] | null> {
  const cardInputHash = await canonicalDigest(eligible);
  if (state.cardInputHash && state.cardInputHash !== cardInputHash) return null;
  const cards = [...state.cardProgress];
  for (let start = state.cardCursor; start < eligible.length;) {
    const fullTextAt = eligible
      .slice(start, start + CARD_BATCH)
      .findIndex((item) => item.evidence_scope === 'full_text');
    const batch = eligible.slice(
      start,
      start + (fullTextAt === 0 ? 1 : fullTextAt < 0 ? CARD_BATCH : fullTextAt),
    );
    const answer = await ask(batch, outputSchema);
    const sources = new Map(batch.map((item) => [item.decisionId, item]));
    for (const card of answer.cards) {
      const source = sources.get(card.decisionId);
      const resolved = source && resolveCard(card, source);
      if (!resolved) return null;
      cards.push(resolved);
    }
    if (cards.length && passStage('S6', { cards }, prior)) return null;
    start += batch.length;
    await checkpoint({ cardProgress: [...cards], cardCursor: start, cardInputHash });
  }
  return { cards };
}
