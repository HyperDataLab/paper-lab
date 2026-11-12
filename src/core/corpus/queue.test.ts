import { describe, expect, it } from 'vitest';
import { exampleCorpus } from './contract';
import { checkpoint, doiExport, isStale, startQueue } from './queue';

describe('C2 corpus queue', () => {
  it('exports only DOIs that have not been retrieved', () => {
    const member = exampleCorpus().members[0]!;
    expect(
      doiExport([
        { ...member, identifiers: { ...member.identifiers, doi: '10.1/a' } },
        { ...member, retrieval: 'retrieved', identifiers: { ...member.identifiers, doi: '10.1/b' } },
        { ...member, retrieval: 'not_retrieved', identifiers: { ...member.identifiers, doi: '10.1/c' } },
      ]),
    ).toBe('10.1/a\n10.1/c\n');
  });
  it('resumes at the next member after a checkpoint and reload', () => {
    const corpus = exampleCorpus();
    const member = corpus.members[0]!;
    corpus.members = [
      { ...member, retrieval: 'retrieved', identifiers: { ...member.identifiers, paperIds: ['p1'] } },
      {
        ...member,
        memberId: '00000000-0000-4000-8000-000000000002',
        retrieval: 'retrieved',
        identifiers: { ...member.identifiers, paperIds: ['p2'] },
      },
    ];
    const inputs = {
      textHashes: [],
      metadataDigest: 'digest',
      insightRunIds: [],
      stanceRunIds: [],
      segmenterVersion: '1',
      sentenceKeyVersion: '1',
    };
    const saved = checkpoint(startQueue(corpus), member.memberId, inputs);
    const reloaded = JSON.parse(JSON.stringify(saved)) as typeof saved;
    expect(reloaded.buildQueue?.pending).toEqual([corpus.members[1]?.memberId]);
    expect(isStale(reloaded.members[0]!, { ...inputs, segmenterVersion: '2' })).toBe(true);
  });
});
