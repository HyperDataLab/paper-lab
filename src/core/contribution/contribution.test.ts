import { describe, expect, it } from 'vitest';
import { buildPaperModel } from '../paperModel';
import type { ContributionRun, Paper, PaperInsightsRecord } from '../schemas';
import { contributionKnowledge, ncgZip, verifyContribution } from './index';

const sentence = {
  key: '0123456789abcdef#1',
  displayId: 'p_s1',
  paragraphId: 'p',
  sectionId: 's',
  page: 1,
  start: 0,
  end: 19,
  text: 'We propose a model.',
};
const output = {
  domain: 'other' as const,
  sentences: [
    {
      sentenceId: sentence.key,
      unit: 'Model' as const,
      phrases: ['We', 'propose', 'a model', 'missing'],
      triples: [
        { unit: 'Model' as const, subject: 'We', predicate: 'propose', object: 'a model' },
        { unit: 'Model' as const, subject: 'We', predicate: 'propose', object: 'missing' },
      ],
    },
  ],
};
const run: ContributionRun = {
  ...output,
  id: '00000000-0000-4000-8000-000000000001',
  createdAt: '2026-01-01T00:00:00.000Z',
  model: 'm',
  promptVersion: 'contribution-1',
  callsUsed: 1,
  droppedPhrases: 0,
  droppedTriples: 0,
};
describe('R17e contribution', () => {
  it('drops unanchored phrases and triples referring to them', () => {
    const verified = verifyContribution(output, [sentence]);
    expect(verified.droppedPhrases).toBe(1);
    expect(verified.droppedTriples).toBe(1);
    expect(verified.sentences[0]?.triples).toHaveLength(1);
  });
  it('builds knowledge and exports only present units with an out-of-domain note', () => {
    const knowledge = contributionKnowledge(run, [sentence]);
    expect(knowledge.phrases).toHaveLength(3);
    const files = ncgZip(
      { sentences: [sentence], knowledge, annotations: [] } as unknown as Parameters<typeof ncgZip>[0],
      'other',
    );
    expect(files['triples/Model.txt']).toContain('(We||propose||a model)');
    expect(files['info-units/Model.json']).toBeDefined();
    expect(files['triples/Results.txt']).toBeUndefined();
    expect(files['README.txt']).toContain('outside');
  });
  it('buildPaperModel leaves knowledge empty without a run and fills it with a run', () => {
    const paper: Paper = {
      schemaVersion: 1,
      id: '00000000-0000-4000-8000-000000000002',
      title: 'Synthetic',
      createdAt: run.createdAt,
      updatedAt: run.createdAt,
      source: { kind: 'text', fileName: '', pageCount: 1, sha256: '' },
      sections: [{ id: 's', heading: 'Intro', role: 'introduction', level: 1, pageStart: 1 }],
      paragraphs: [
        { id: 'p', sectionId: 's', order: 0, kind: 'body', text: sentence.text, pageStart: 1, textHash: '' },
      ],
    };
    const base = buildPaperModel({ paper, metadata: null, now: new Date() });
    expect(base.knowledge.triples).toHaveLength(0);
    const updated = {
      ...run,
      sentences: [{ ...output.sentences[0], sentenceId: base.sentences[0]?.key ?? '' }],
    };
    const insights = {
      contributionRuns: [updated],
      rhetoricRuns: [],
      decisions: [],
    } as unknown as PaperInsightsRecord;
    expect(
      buildPaperModel({ paper, metadata: null, insights, now: new Date() }).knowledge.triples,
    ).toHaveLength(1);
  });
});
