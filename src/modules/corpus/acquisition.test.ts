import { beforeEach, describe, expect, it, vi } from 'vitest';
import { exampleCorpus } from '@/core/corpus/contract';
import type { Repositories } from '@/shared/storage/repositories';
import { acquireMember } from './acquisition';

const mocks = vi.hoisted(() => ({ lookup: vi.fn(), download: vi.fn(), importFile: vi.fn() }));
vi.mock('@/shared/scholar/client', () => ({
  createScholarClient: () => ({ lookupDoi: mocks.lookup, downloadArxivPdf: mocks.download }),
}));
vi.mock('@/modules/paper-import', () => ({ importPaperFile: mocks.importFile }));

describe('C2 acquisition', () => {
  beforeEach(() => vi.resetAllMocks());
  it('links a retrieved open PDF to its paper', async () => {
    mocks.lookup.mockResolvedValue({ found: true, patch: { arxiv_id: '1234', title: 'Paper' } });
    mocks.download.mockResolvedValue(new File(['pdf'], 'paper.pdf'));
    mocks.importFile.mockResolvedValue({ id: 'paper', source: { sha256: 'sha256:abc' } });
    const member = exampleCorpus().members[0]!;
    const result = await acquireMember(
      { ...member, identifiers: { ...member.identifiers, doi: '10.1/a' } },
      {} as Repositories,
    );
    expect(mocks.lookup).toHaveBeenCalledWith('10.1/a', undefined);
    expect(result.retrieval).toBe('retrieved');
    expect(result.textRead).toBe('FULL_TEXT');
    expect(result.identifiers.paperIds).toEqual(['paper']);
  });
  it('records a reason when no open copy is found', async () => {
    mocks.lookup.mockResolvedValue({ found: false });
    const member = exampleCorpus().members[0]!;
    const result = await acquireMember(
      { ...member, identifiers: { ...member.identifiers, doi: '10.1/a' } },
      {} as Repositories,
    );
    expect(result.retrieval).toBe('not_retrieved');
    expect(result.retrievalReason).toBeTruthy();
  });
});
