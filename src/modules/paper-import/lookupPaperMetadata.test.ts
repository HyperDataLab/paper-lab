import { expect, it, vi } from 'vitest';
import { examplePaper } from '@/core/paperModel/contract';
import { lookupPaperMetadata } from './lookupPaperMetadata';

const lookup = vi.hoisted(() => vi.fn());
vi.mock('@/shared/scholar/client', () => ({ createScholarClient: () => ({ paperMetadata: lookup }) }));

it('R15 looks up metadata once when a DOI is known', async () => {
  const paper = examplePaper();
  const metadata = { doi: '10.1234/example', fetchedAt: '2024-01-01T00:00:00.000Z' };
  lookup.mockResolvedValue(metadata);
  const save = vi.fn(async (record) => record);
  const context = {
    schemaVersion: 1 as const,
    paperId: paper.id,
    checkedAt: metadata.fetchedAt,
    paperDoi: metadata.doi,
    checked: 0,
    found: 0,
    retracted: [],
    retractionChecked: false,
    metadata: null,
  };
  const saved = await lookupPaperMetadata(paper, context, save);
  await lookupPaperMetadata(paper, saved, save);
  expect(lookup).toHaveBeenCalledTimes(1);
  expect(lookup).toHaveBeenCalledWith(metadata.doi);
  expect(save).toHaveBeenCalledTimes(1);
});
