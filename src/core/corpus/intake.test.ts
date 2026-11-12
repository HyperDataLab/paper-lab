import { expect, it } from 'vitest';
import { exampleCorpus } from './contract';
import { addFromDois, addMember, mergeMembers } from './intake';

const now = '2026-01-02T00:00:00.000Z';
const id = '00000000-0000-4000-8000-000000000002';
const nextId = '00000000-0000-4000-8000-000000000003';
const empty = () => ({ ...exampleCorpus(), members: [] });

it('C1b matches DOI variants and enriches a DOI member with a PDF hash', () => {
  const first = addMember(empty(), { doi: '10.1000/ABC', memberId: id }, now);
  const second = addMember(
    first.corpus,
    { doi: 'https://doi.org/10.1000/abc', sha256: 'hash', paperId: 'paper' },
    now,
  );
  expect(second.matched).toBe('identifier');
  expect(second.corpus.members).toHaveLength(1);
  expect(second.corpus.members[0]?.identifiers.sha256).toEqual(['hash']);
});
it('C1b title and year need confirmation without changing the corpus', () => {
  const first = addMember(empty(), { title: 'Caf\u00e9: A study', year: 2020, memberId: id }, now);
  const second = addMember(first.corpus, { title: 'Cafe a study', year: 2020 }, now);
  expect(second).toMatchObject({ matched: 'title-year', candidate: id });
  expect(second.corpus).toBe(first.corpus);
});
it('C1b merge is idempotent and retains alternate identifiers', () => {
  const first = addMember(empty(), { doi: '10.1000/a', memberId: id }, now);
  const second = addMember(first.corpus, { doi: '10.1000/b', memberId: nextId }, now);
  const merged = mergeMembers(second.corpus, id, nextId, 'confirmed', now);
  expect(mergeMembers(merged, id, nextId, 'confirmed', now)).toEqual(merged);
  expect(merged.aliases).toHaveLength(1);
  expect(addMember(merged, { doi: '10.1000/a' }, now).matched).toBe('identifier');
});
it('C1b DOI input counts invalid entries and duplicates', () => {
  const result = addFromDois(empty(), '10.1000/a, bad\nhttps://doi.org/10.1000/A\nwrong', {
    now,
    makeId: () => id,
  });
  expect(result.counts).toEqual({ added: 1, matched: 1, needsConfirmation: 0, invalid: 2 });
  expect(result.invalid).toEqual(['bad', 'wrong']);
});
