import { buildSnapshotPrompt, PROMPT_VERSIONS } from '@/core/prompts';
import { SnapshotOutputSchema, type Paper, type SnapshotRun } from '@/core/schemas';
import { snapshotInput, verifySnapshot } from '@/core/snapshot';
import type { LlmClient } from './client';
import type { LlmConfig } from './config';
import { requirePaperConsent } from './consent';

/** One request. The caller has already asked for consent; this checks it again before sending. */
export async function llmSnapshot(
  client: LlmClient,
  paper: Paper,
  options: { config: LlmConfig; signal?: AbortSignal; newId?: () => string; now?: () => string },
): Promise<SnapshotRun> {
  requirePaperConsent(options.config);
  const paragraphs = snapshotInput(paper);
  if (!paragraphs.length) throw new Error('Không có đoạn nào để đọc.');
  let calls = 0;
  const result = await client.completeJson({
    ...buildSnapshotPrompt(paragraphs),
    schema: SnapshotOutputSchema,
    schemaName: 'snapshot',
    promptVersion: PROMPT_VERSIONS.snapshot,
    temperature: 0,
    timeoutMs: 180000,
    signal: options.signal,
    onRequest: async () => {
      requirePaperConsent(options.config);
      calls++;
    },
  });
  return {
    id: options.newId?.() ?? crypto.randomUUID(),
    createdAt: options.now?.() ?? new Date().toISOString(),
    model: result.meta.model,
    promptVersion: PROMPT_VERSIONS.snapshot,
    callsUsed: calls,
    sectionIds: [...new Set(paragraphs.map((p) => p.sectionId))],
    values: verifySnapshot(SnapshotOutputSchema.parse(result.data), paragraphs),
  };
}
