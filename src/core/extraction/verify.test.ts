import { describe, expect, it } from 'vitest';
import type { ExtractionCell, ProjectField, ProjectPaper } from '../schemas';
import { catalogField, cellsFromOutput, estimateCalls, extractionSource, reviewCell } from './index';
import { applyVerification, needsRetry, verifiable } from './verify';

const at = '2026-01-01T00:00:00.000Z';
const paper: ProjectPaper = {
  key: 'k',
  source: { kind: 'library', libraryId: '00000000-0000-4000-8000-000000000001' },
  title: 'P',
  authors: [],
  year: null,
  venue: null,
  doi: null,
  access: 'ABSTRACT_ONLY',
  abstract: 'We enrolled 120 adults. Later analyses used 118 adults.',
  revision: 'r',
  screening: 'included',
};
const source = extractionSource(paper, undefined);
const field = (key: string) => ({ ...(catalogField(key) as ProjectField), hidden: false });
const fields = [field('population_sample'), field('results'), field('dataset')];
const [sample, results, dataset] = cellsFromOutput(
  {
    fields: [
      {
        field_key: 'population_sample',
        status: 'found',
        value: '120 adults',
        inferred: false,
        evidence: [{ paragraphId: 'abstract', quote: 'We enrolled 120 adults' }],
      },
      {
        field_key: 'results',
        status: 'found',
        value: 'Adults',
        inferred: false,
        evidence: [{ paragraphId: 'abstract', quote: 'used 118 adults' }],
      },
      { field_key: 'dataset', status: 'found', value: '500 images', inferred: false, evidence: [] },
    ],
  },
  fields,
  source,
  { paper, runId: '00000000-0000-4000-8000-000000000002', mode: 'HIGH_QUALITY', at },
) as ExtractionCell[];
if (!sample || !results || !dataset) throw new Error('missing cells');

describe('High Quality verification', () => {
  it('retries only unsupported values and verifies only cells with evidence', () => {
    expect(needsRetry(dataset)).toBe(true);
    expect(needsRetry(sample)).toBe(false);
    expect(verifiable(sample)).toBe(true);
    expect(verifiable(dataset)).toBe(false);
    expect(verifiable(reviewCell(sample, 'approve', at))).toBe(false);
  });
  it('marks supported values as automated, never as human-reviewed', () => {
    const [checked] = applyVerification(
      [sample],
      { checks: [{ field_key: 'population_sample', verdict: 'SUPPORTED', note: 'ok', conflicts: [] }] },
      source,
      at,
    );
    expect(checked).toMatchObject({
      status: 'EXTRACTED',
      verification: 'AUTOMATED',
      verdict: 'SUPPORTED',
      value: '120 adults',
    });
    expect(checked?.history.at(-1)).toMatchObject({ action: 'verify', by: 'model' });
  });
  it('shows a conflict with both passages and picks no value', () => {
    const [checked] = applyVerification(
      [sample],
      {
        checks: [
          {
            field_key: 'population_sample',
            verdict: 'PARTIALLY_SUPPORTED',
            note: 'Hai cỡ mẫu khác nhau',
            conflicts: [
              { paragraphId: 'abstract', quote: 'used 118 adults' },
              { paragraphId: 'abstract', quote: 'We enrolled 120 adults' },
              { paragraphId: 'abstract', quote: 'invented' },
            ],
          },
        ],
      },
      source,
      at,
    );
    expect(checked).toMatchObject({ status: 'CONFLICT', value: null, aiValue: '120 adults' });
    expect(checked?.evidence.map((item) => item.stance)).toEqual(['supports', 'conflicts']);
    expect(checked?.flags).toContain('CONFLICTING_PASSAGES');
  });
  it('sends weaker verdicts to review and withholds a contradicted value', () => {
    const checks = (verdict: 'PARTIALLY_SUPPORTED' | 'CONTRADICTED' | 'INDETERMINATE') =>
      applyVerification(
        [sample],
        { checks: [{ field_key: 'population_sample', verdict, note: 'x', conflicts: [] }] },
        source,
        at,
      )[0];
    expect(checks('PARTIALLY_SUPPORTED')).toMatchObject({ status: 'NEEDS_REVIEW', value: '120 adults' });
    expect(checks('INDETERMINATE')?.flags).toContain('VERIFIER_INDETERMINATE');
    expect(checks('CONTRADICTED')).toMatchObject({ status: 'NEEDS_REVIEW', value: null });
  });
  it('flags a cell the verifier skipped and leaves cells it cannot check', () => {
    const [skipped, untouched] = applyVerification([results, dataset], { checks: [] }, source, at);
    expect(skipped?.flags).toContain('VERIFIER_SKIPPED');
    expect(untouched).toBe(dataset);
  });
  it('estimates the extra requests of High Quality', () => {
    const project = { papers: [paper] } as Parameters<typeof estimateCalls>[0];
    expect(estimateCalls(project, ['k'], ['a', 'b'], 'STANDARD')).toBe(1);
    expect(estimateCalls(project, ['k'], ['a', 'b'], 'HIGH_QUALITY')).toBe(3);
    expect(estimateCalls(project, ['k'], [], 'HIGH_QUALITY')).toBe(0);
  });
});
