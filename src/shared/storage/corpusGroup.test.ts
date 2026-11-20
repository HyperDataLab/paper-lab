import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { exampleCorpus } from '@/core/corpus/contract';
import { addFromDois } from '@/core/corpus/intake';
import { buildCorpusKeywords } from '@/core/corpusKeywords';
import { fixturePaper, PAPER_ID } from '@/core/measurement/testFixture';
import type { CorpusKg } from '@/core/openkg';
import { type DocStore } from './docStore';
import { CorpusConflict, DataNotConfiguredError, DuplicateDoiError, UniqueConflictError } from './errors';
import { CORPUS_COLLECTIONS } from './remote/corpusCollections';
import { testId, testWorkerData } from './remoteTestSupport';
import { createRepositories } from './repositories';
import { testRepositories } from './testRepositories';

beforeEach(() => vi.stubGlobal('crypto', webcrypto));
afterEach(() => vi.unstubAllGlobals());

const kw = (slug: string, score: number) => ({ id: `keywords/${slug}`, name: slug, score });
const snapshot = (snapshotId: string, createdAt: string) => ({
  format: 'paperlab-corpus-topics' as const,
  schemaVersion: 1 as const,
  snapshotId,
  createdAt,
  corpora: [{ corpusId: exampleCorpus().id, kind: 'journal' as const, title: 'A' }],
  pipeline: {
    tag: 'test',
    embeddingModel: 'test',
    parameters: {},
    seed: 1,
    textSource: 'abstract' as const,
    openalexFetchedAt: '2026-01-01T00:00:00Z',
  },
  quality: { outlierShare: 0 },
  topics: [],
  members: [],
});

/** Repositories over the in-process lab worker. */
function online(worker = testWorkerData()) {
  const remote = worker.connect();
  return { worker, remote, repo: createRepositories(remote) };
}

const stores: [string, () => { repo: ReturnType<typeof createRepositories>; remote: boolean }][] = [
  ['MemoryDocStore', () => ({ repo: testRepositories(), remote: false })],
  ['RemoteDocStore (lab)', () => ({ repo: online().repo, remote: true })],
];

describe.each(stores)('C3 corpus repositories over %s', (_name, make) => {
  it('saves, lists newest first and deletes a corpus with its keywords', async () => {
    const { repo } = make();
    const older = { ...exampleCorpus(), id: testId(11), updatedAt: '2026-01-01T00:00:00.000Z' };
    const newer = { ...exampleCorpus(), id: testId(12), updatedAt: '2026-02-01T00:00:00.000Z' };
    await repo.corpora.save(older);
    await repo.corpora.save(newer);
    expect((await repo.corpora.list()).map((item) => item.id)).toEqual([newer.id, older.id]);
    await repo.corpusKeywords.save(
      buildCorpusKeywords({
        corpusId: older.id,
        memberIds: ['m1'],
        papers: [{ memberId: 'm1', year: 2020, keywords: [kw('alpha', 0.5)] }],
        computedAt: '2026-11-18T00:00:00.000Z',
      }),
    );
    await repo.corpora.delete(older.id);
    await repo.corpora.delete(testId(13));
    expect(await repo.corpora.get(older.id)).toBeUndefined();
    expect(await repo.corpusKeywords.get(older.id)).toBeUndefined();
    expect(await repo.corpora.get(newer.id)).toEqual(newer);
  });

  it('coalesces corpus checkpoints and reads them back after a flush', async () => {
    const { repo } = make();
    const corpus = exampleCorpus();
    await repo.corpora.save(corpus);
    for (const title of ['Batch 1', 'Batch 2', 'Batch 3'])
      await repo.corpora.checkpoint({ ...corpus, title });
    expect((await repo.corpora.get(corpus.id))?.title).toBe('Batch 3');
    await repo.corpora.flush(corpus.id);
    await repo.corpora.save({ ...corpus, title: 'Final' });
    expect((await repo.corpora.get(corpus.id))?.title).toBe('Final');
  });

  it('keeps topic snapshots by corpus with their names', async () => {
    const { repo } = make();
    const corpusId = exampleCorpus().id;
    await repo.corpusTopics.save(snapshot('one', '2026-01-01T00:00:00Z'));
    await repo.corpusTopics.save(snapshot('two', '2026-02-01T00:00:00Z'));
    expect((await repo.corpusTopics.list(corpusId)).map((item) => item.snapshotId)).toEqual(['two', 'one']);
    for (const topicId of [10, 2])
      await repo.corpusTopics.saveName({
        schemaVersion: 1,
        snapshotId: 'one',
        topicId,
        promptVersion: 'v1',
        candidateName: `Topic ${topicId}`,
        candidateDescription: '',
        name: null,
        description: null,
      });
    expect((await repo.corpusTopics.names('one')).map((name) => name.topicId)).toEqual([2, 10]);
  });

  it('adds DOIs in batches, resolves member keywords and clears links to a deleted paper', async () => {
    const { repo } = make();
    const dois = Array.from({ length: 150 }, (_, i) => `10.1000/bulk${i}`);
    const first = await repo.library.addDois(dois);
    expect(first.added).toHaveLength(150);
    const again = await repo.library.addDois([...dois.slice(0, 2), '10.1000/new']);
    expect(again).toMatchObject({ duplicates: 2, added: [{ doi: '10.1000/new' }] });
    const [linked] = first.added;
    if (!linked) throw new Error('missing item');
    await repo.papers.create(fixturePaper);
    await repo.library.update(linked.id, { paper_id: PAPER_ID, keywords: [kw('alpha', 0.9)] });
    const corpus = addFromDois(exampleCorpus(), `${linked.doi}\n10.1000/fetched`).corpus;
    await repo.corpusKeywords.saveFetched({ memberId: 'x', doi: '10.1000/fetched', libraryId: null }, [
      kw('beta', 0.3),
    ]);
    const keywords = await repo.corpusKeywords.memberKeywords(corpus);
    expect(keywords.papers.map((paper) => paper.keywords[0]?.name).sort()).toEqual(['alpha', 'beta']);
    // Papers may stay in this browser while the library is on the lab store: two commits, no mixed unit of work.
    await repo.papers.delete(PAPER_ID);
    expect(await repo.library.get(linked.id)).toMatchObject({ paper_id: null, file_matches_title: null });
    await repo.library.remove(first.added.map((item) => item.id));
    expect(await repo.library.list()).toHaveLength(1);
  });

  it('imports calibration labels with their audit event', async () => {
    const { repo } = make();
    const data = {
      format: 'paragraph-lab-labels',
      version: 1,
      labels: [
        { rater: 'A', target: { kind: 'issue', type: 'x', textHash: 'h', quote: 'q' }, label: 'correct' },
      ],
    };
    const first = await repo.calibrationLabels.import('a.json', data);
    const second = await repo.calibrationLabels.import('b.json', data);
    expect(second.importedAt > first.importedAt).toBe(true);
    expect((await repo.calibrationLabels.list()).map((item) => item.id)).toEqual([second.id, first.id]);
    await repo.calibrationLabels.delete(first.id);
    expect(await repo.calibrationLabels.list()).toEqual([second]);
  });
});

const labels = {
  format: 'paragraph-lab-labels',
  version: 1,
  labels: [{ rater: 'A', target: { kind: 'issue', type: 'x', textHash: 'h', quote: 'q' }, label: 'correct' }],
};

describe('C3 corpus group on the lab store', () => {
  it('routes every corpus collection to the lab', async () => {
    const { repo, worker } = online();
    await repo.corpora.save(exampleCorpus());
    await repo.library.addDois(['10.1000/a']);
    await repo.calibrationLabels.import('a.json', labels);
    const other = worker.connect();
    expect(await other.query('corpora')).toHaveLength(1);
    expect(await other.query('library')).toHaveLength(1);
    expect(await other.query('calibrationLabels')).toHaveLength(1);
    // The label's audit event went in the same commit as the label.
    const commits = worker.requests.filter((request) => request.url.endsWith('/commit'));
    const bodies = (await Promise.all(commits.map((request) => request.json()))) as {
      ops: { collection: string }[];
      audit: { collection: string }[];
    }[];
    expect(
      bodies.some(
        (body) =>
          body.ops.some((op) => op.collection === 'calibrationLabels') &&
          body.audit.some((entry) => entry.collection === 'auditEvents'),
      ),
    ).toBe(true);
    expect(CORPUS_COLLECTIONS).toContain('topicNames');
  });

  it('turns a stale corpus write into a CorpusConflict and reads the newer copy', async () => {
    const worker = testWorkerData();
    const mine = online(worker).repo;
    const theirs = online(worker).repo;
    const corpus = exampleCorpus();
    await mine.corpora.save(corpus);
    await theirs.corpora.save({ ...(await theirs.corpora.get(corpus.id))!, title: 'Theirs' });
    const error = await mine.corpora.save({ ...corpus, title: 'Mine' }).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(CorpusConflict);
    expect(error).toMatchObject({ collection: 'corpora', id: corpus.id, version: 2 });
    expect((await mine.corpora.get(corpus.id))?.title).toBe('Theirs');
    await mine.corpora.save({ ...corpus, title: 'Mine after reload' });
    expect((await theirs.corpora.get(corpus.id))?.title).toBe('Mine after reload');
  });

  it('discards a checkpoint that received a 409, then reloads and saves normally', async () => {
    const worker = testWorkerData();
    const { repo, remote: composite } = online(worker);
    const other = worker.connect();
    const corpus = exampleCorpus();
    await repo.corpora.save(corpus);
    await other.put('corpora', corpus.id, { ...corpus, title: 'Edited elsewhere' }, 1);
    await repo.corpora.checkpoint({ ...corpus, title: 'Failed checkpoint' });
    await expect(repo.corpora.flush(corpus.id)).rejects.toMatchObject({ name: 'CorpusConflict', version: 2 });
    expect(composite.getSaveStatus()).toBe('error');
    await expect(repo.corpora.save(corpus)).rejects.toBeInstanceOf(CorpusConflict);

    const latest = await repo.corpora.reload(corpus.id);
    if (!latest) throw new Error('Corpus not found');
    expect(composite.getSaveStatus()).toBe('idle');
    expect(latest).toMatchObject({ doc: { title: 'Edited elsewhere' }, version: 2 });
    expect(worker.requests.at(-1)?.headers.get('If-None-Match')).toBeNull();
    await repo.corpora.save({ ...latest.doc, title: 'Saved after reload' });
    expect(await other.get('corpora', corpus.id)).toMatchObject({
      doc: { title: 'Saved after reload' },
      version: 3,
    });
  });

  it('releases with the version of the displayed corpus even when its cache has a newer edit', async () => {
    const worker = testWorkerData();
    const { repo } = online(worker);
    const corpus = exampleCorpus();
    const displayed = await repo.corpora.saveVersioned(corpus);
    const other = worker.connect();
    const concurrent = { ...corpus, title: 'Edited elsewhere' };
    await other.put('corpora', corpus.id, concurrent, displayed.version);
    await repo.corpora.get(corpus.id);

    await expect(repo.corpora.release(displayed.doc, displayed.version)).rejects.toMatchObject({
      name: 'CorpusConflict',
      version: 2,
    });
    expect(worker.requests.at(-1)?.headers.get('If-Match')).toBe('"v1"');
    expect(await repo.corpora.get(corpus.id)).toEqual(concurrent);
  });

  it('runs overlapping writes to one corpus from this tab one after another, without self-conflicts', async () => {
    const { repo } = online();
    const corpus = exampleCorpus();
    await repo.corpora.save(corpus);
    await Promise.all([
      repo.corpora.save({ ...corpus, title: 'A' }),
      repo.corpora.save({ ...corpus, title: 'B' }),
    ]);
    expect((await repo.corpora.get(corpus.id))?.title).toBe('B');
    const decision = repo.corpora.save({ ...corpus, title: 'Decision' });
    await repo.corpora.checkpoint({ ...corpus, title: 'Batch' });
    await decision;
    await repo.corpora.flush(corpus.id);
    expect((await repo.corpora.get(corpus.id))?.title).toBe('Batch');
  });

  it('maps the server UNIQUE DOI refusal to a clear error', async () => {
    const worker = testWorkerData();
    const store = worker.connect();
    const { added } = await online(worker).repo.library.addDois(['10.5555/same']);
    const copy = { ...added[0]!, id: testId(21), doi: 'https://doi.org/10.5555/SAME' };
    await expect(store.put('library', copy.id, copy, null)).rejects.toBeInstanceOf(UniqueConflictError);
    const failing: DocStore = {
      get: () => Promise.resolve(null),
      getMany: () => Promise.resolve([]),
      query: () => Promise.resolve([]),
      put: () => Promise.resolve(1),
      remove: () => Promise.resolve(),
      unitOfWork: () => Promise.reject(new UniqueConflictError()),
    };
    const repo = testRepositories({ store: failing });
    await expect(repo.library.addDois(['10.5555/same'])).rejects.toBeInstanceOf(DuplicateDoiError);
    await expect(repo.library.addDois(['10.5555/same'])).rejects.toThrow('DOI này đã có trong Library.');
  });

  it('reports an unconfigured lab store as an error and keeps nothing in the browser', async () => {
    const { repo } = online(testWorkerData(false));
    await expect(repo.corpora.save(exampleCorpus())).rejects.toBeInstanceOf(DataNotConfiguredError);
    await expect(repo.library.addDois(['10.1000/local'])).rejects.toBeInstanceOf(DataNotConfiguredError);
    await expect(repo.corpora.list()).rejects.toBeInstanceOf(DataNotConfiguredError);
  });

  it('rebuilds the corpus graph after a write, without live queries', async () => {
    const { repo } = online();
    const corpus = {
      ...exampleCorpus(),
      members: addFromDois(exampleCorpus(), '10.1000/alpha').corpus.members,
    };
    const graphs: CorpusKg[] = [];
    const subscription = repo.corpusOpenKg.observe(corpus).subscribe({ next: (graph) => graphs.push(graph) });
    await vi.waitFor(() => expect(graphs).toHaveLength(1));
    await repo.corpusKeywords.saveFetched({ memberId: 'x', doi: '10.1000/alpha', libraryId: null }, [
      kw('alpha', 0.5),
    ]);
    await vi.waitFor(() => expect(graphs).toHaveLength(2));
    expect(JSON.stringify(graphs[1])).toContain('alpha');
    subscription.unsubscribe();
    await repo.library.addDois(['10.1000/after']);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(graphs).toHaveLength(2);
  });
});
