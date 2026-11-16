/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { CorpusTopicsSchema } from '../schemas/corpusTopics';
import {
  corpusTopicsJsonSchema,
  CORPUS_TOPICS_SCHEMA_FILE,
  CORPUS_TOPICS_SCHEMA_PUBLIC_FILE,
} from './contract';

const sample = {
  format: 'paperlab-corpus-topics',
  schemaVersion: 1,
  snapshotId: 'run-1',
  createdAt: '2026-01-01T00:00:00Z',
  corpora: [{ corpusId: 'a', kind: 'journal', title: 'A' }],
  pipeline: {
    tag: 'test',
    embeddingModel: 'test',
    parameters: {},
    seed: 42,
    textSource: 'abstract',
    openalexFetchedAt: '2026-01-01T00:00:00Z',
  },
  quality: { outlierShare: 0 },
  topics: [
    {
      topicId: 0,
      size: 1,
      byCorpus: { a: 1 },
      words: ['test'],
      representativeMemberIds: ['m'],
      openalexSubfields: [],
    },
  ],
  members: [
    {
      corpusId: 'a',
      memberId: 'm',
      topicId: 0,
      probability: 0.5,
      weak: false,
      keyphrases: [],
      textUsed: 'abstract',
    },
  ],
};
it('validates the snapshot and rejects duplicate topics and invalid bounds', () => {
  expect(CorpusTopicsSchema.safeParse(sample).success).toBe(true);
  expect(
    CorpusTopicsSchema.safeParse({ ...sample, topics: [sample.topics[0], sample.topics[0]] }).success,
  ).toBe(false);
  expect(
    CorpusTopicsSchema.safeParse({ ...sample, members: [{ ...sample.members[0], probability: 2 }] }).success,
  ).toBe(false);
});
it('keeps both published JSON Schemas in sync', () => {
  for (const file of [
    CORPUS_TOPICS_SCHEMA_FILE,
    CORPUS_TOPICS_SCHEMA_PUBLIC_FILE,
    'topics-worker/topics/schema.json',
  ])
    expect(JSON.parse(readFileSync(resolve(process.cwd(), file), 'utf8'))).toEqual(corpusTopicsJsonSchema());
});
it('accepts older members and low probability, but requires unassigned members to be weak', () => {
  const member = sample.members[0];
  expect(CorpusTopicsSchema.safeParse(sample).success).toBe(true);
  expect(
    CorpusTopicsSchema.safeParse({ ...sample, members: [{ ...member, probability: 0.1, weak: false }] })
      .success,
  ).toBe(true);
  expect(
    CorpusTopicsSchema.safeParse({ ...sample, members: [{ ...member, topicId: -1, weak: false }] }).success,
  ).toBe(false);
  expect(
    CorpusTopicsSchema.safeParse({ ...sample, members: [{ ...member, fit: -1, weakReason: 'low-fit' }] })
      .success,
  ).toBe(true);
  expect(CorpusTopicsSchema.safeParse({ ...sample, members: [{ ...member, fit: 1.1 }] }).success).toBe(false);
});
