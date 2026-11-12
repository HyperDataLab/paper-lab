import { webcrypto } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import type { ContributionPending, Paper } from '@/core/schemas';
import type { LlmClient } from './client';
import { getConfig } from './config';
import { acceptConsent } from './consent';
import { llmContribution } from './llmContribution';

it('R17e checkpoints completed chunks and resumes after a failed request', async () => {
  vi.stubGlobal('crypto', webcrypto);
  localStorage.clear();
  const config = getConfig();
  acceptConsent(config, true);
  const at = '2026-01-01T00:00:00.000Z';
  const paper: Paper = {
    schemaVersion: 1,
    id: '00000000-0000-4000-8000-000000000002',
    title: 'Synthetic',
    createdAt: at,
    updatedAt: at,
    source: { kind: 'text', fileName: '', pageCount: 1, sha256: '' },
    sections: [{ id: 's', heading: 'Intro', role: 'introduction', level: 1, pageStart: 1 }],
    paragraphs: Array.from({ length: 91 }, (_, i) => ({
      id: `p${i}`,
      sectionId: 's',
      order: i,
      kind: 'body' as const,
      text: `Synthetic sentence ${i}.`,
      pageStart: 1,
      textHash: '',
    })),
  };
  const saved: { pending: ContributionPending | null } = { pending: null };
  let requests = 0;
  const client = {
    completeJson: async (request: Parameters<LlmClient['completeJson']>[0]) => {
      await request.onRequest?.();
      requests++;
      if (requests === 2) throw new Error('Interrupted');
      return {
        data: request.schema.parse({ domain: 'other', sentences: [] }),
        meta: { model: 'm', promptVersion: request.promptVersion, latencyMs: 1, repaired: false },
      };
    },
  } as LlmClient;
  const onProgress = async (pending: ContributionPending) => {
    saved.pending = structuredClone(pending);
  };
  await expect(llmContribution(client, paper, { config, onProgress })).rejects.toThrow('Interrupted');
  expect(saved.pending?.chunks).toHaveProperty('0');
  const result = await llmContribution(client, paper, { config, pending: saved.pending, onProgress });
  expect(requests).toBe(3);
  expect(result.callsUsed).toBe(3);
  expect(result.domain).toBe('other');
});
