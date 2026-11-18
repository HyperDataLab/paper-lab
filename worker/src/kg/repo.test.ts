import { expect, it } from 'vitest';
import { coauthorUpdates, cooccurUpdates, mapOpenAlexWorkToKg } from '../../../src/core/labKg';
import { kgRepo } from './repo';
import { testDb } from './testDb';

it('upserts work and edges idempotently, and keeps FTS and pair counts current on replacement', async () => {
  const { db, sqlite } = testDb();
  const repo = kgRepo(db);
  const work = (id: string, keywords: string[], authors: string[], title = 'Synthetic lantern') =>
    mapOpenAlexWorkToKg({
      id,
      title,
      abstract_inverted_index: { Copper: [0], coil: [1] },
      referenced_works: ['W99'],
      keywords: keywords.map((name) => ({ id: `keywords/${name}`, display_name: name, score: 0.6 })),
      authorships: authors.map((id) => ({ author: { id }, institutions: [{ id: 'I1' }] })),
    });
  const first = work('W1', ['physics', 'field'], ['A2', 'A1']);
  await repo.upsertWork(first);
  await repo.upsertWork(first);
  await repo.upsertWork(work('W2', ['physics', 'field'], ['A1', 'A2']));
  await repo.upsertWork(work('W3', ['physics'], ['A1']));
  expect(sqlite.prepare('SELECT * FROM cooccur').all()).toEqual(
    cooccurUpdates([
      ['keywords/physics', 'keywords/field'],
      ['keywords/physics', 'keywords/field'],
      ['keywords/physics'],
    ]),
  );
  expect(sqlite.prepare('SELECT * FROM coauthor').all()).toEqual(
    coauthorUpdates([['A1', 'A2'], ['A1', 'A2'], ['A1']]),
  );
  expect(sqlite.prepare('SELECT count(*) AS count FROM affiliated WHERE paper_id = ?').get('W1')).toEqual({
    count: 2,
  });
  expect(sqlite.prepare('SELECT count(*) AS count FROM cites WHERE paper_id = ?').get('W1')).toEqual({
    count: 1,
  });
  expect(
    sqlite
      .prepare(`SELECT count(*) AS count FROM paper_fts WHERE paper_fts MATCH 'lantern AND copper'`)
      .get(),
  ).toEqual({ count: 3 });
  expect(
    sqlite.prepare(`SELECT count(*) AS count FROM keyword_fts WHERE keyword_fts MATCH 'physics'`).get(),
  ).toEqual({ count: 1 });

  await repo.upsertWork(work('W1', ['field'], ['A2'], 'Synthetic prism'));
  expect(sqlite.prepare('SELECT * FROM cooccur').all()).toEqual(
    cooccurUpdates([['keywords/field'], ['keywords/physics', 'keywords/field'], ['keywords/physics']]),
  );
  expect(sqlite.prepare('SELECT * FROM coauthor').all()).toEqual(
    coauthorUpdates([['A2'], ['A1', 'A2'], ['A1']]),
  );
  expect(
    sqlite.prepare(`SELECT count(*) AS count FROM paper_fts WHERE paper_fts MATCH 'lantern'`).get(),
  ).toEqual({ count: 2 });
  expect(
    sqlite.prepare(`SELECT count(*) AS count FROM paper_fts WHERE paper_fts MATCH 'prism AND copper'`).get(),
  ).toEqual({ count: 1 });
  await repo.upsertWork(work('W2', [], []));
  expect(sqlite.prepare('SELECT * FROM cooccur').all()).toEqual([]);
  expect(sqlite.prepare('SELECT * FROM coauthor').all()).toEqual([]);
});
