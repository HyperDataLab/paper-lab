import { buildDigestPrompt, PROMPT_VERSIONS } from '@/core/prompts';
import { digestInput, verifyDigest } from '@/core/paperDigest';
import { DigestOutputSchema, type DigestRun, type Paper } from '@/core/schemas';
import type { LlmClient } from './client';
import type { LlmConfig } from './config';
import { requirePaperConsent } from './consent';

/** One request for the reader's summary. The caller has asked for consent; this checks it again before sending. */
export async function llmDigest(
  client: LlmClient,
  paper: Paper,
  options: { config: LlmConfig; signal?: AbortSignal; newId?: () => string; now?: () => string },
): Promise<DigestRun> {
  requirePaperConsent(options.config);
  const input = digestInput(paper);
  if (input.read === 0) throw new Error('Không có đoạn nào để đọc.');
  let calls = 0;
  const result = await client.completeJson({
    ...buildDigestPrompt(input.sections),
    schema: DigestOutputSchema,
    schemaName: 'paper_digest',
    promptVersion: PROMPT_VERSIONS.digest,
    temperature: 0,
    timeoutMs: 300000,
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
    promptVersion: PROMPT_VERSIONS.digest,
    callsUsed: calls,
    read: input.read,
    total: input.total,
    ...verifyDigest(
      DigestOutputSchema.parse(result.data),
      input.sections.flatMap((section) => section.paragraphs),
    ),
  };
}
