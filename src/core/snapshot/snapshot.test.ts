import { describe, expect, it } from 'vitest';
import type { Paper, PaperParagraph } from '../schemas';
import { snapshotInput, verifySnapshot } from './index';

const at = '2026-01-01T00:00:00.000Z';
const body = (id: string, sectionId: string, text: string): PaperParagraph => ({
  id,
  sectionId,
  order: 0,
  text,
  kind: 'body',
  textHash: id,
  pageStart: 4,
});
const section = (id: string, role: Paper['sections'][number]['role']) => ({
  id,
  heading: id,
  role,
  level: 1,
  pageStart: 1,
});
const paper: Paper = {
  schemaVersion: 1,
  id: '00000000-0000-4000-8000-000000000001',
  title: 'T',
  createdAt: at,
  updatedAt: at,
  source: { kind: 'text', fileName: 'a', pageCount: 1, sha256: 'x' },
  sections: [
    section('i', 'introduction'),
    section('m', 'methods'),
    section('a', 'abstract'),
    section('r', 'references'),
  ],
  paragraphs: [
    body('pi', 'i', 'Intro.'),
    body('pm', 'm', 'We enrolled 120 adults in Hanoi for 12 weeks.'),
    body('pa', 'a', 'A randomised trial.'),
    body('pr', 'r', 'Ref.'),
  ],
};

describe('snapshot', () => {
  it('reads the abstract and methods first and skips references', () => {
    expect(snapshotInput(paper).map((p) => p.id)).toEqual(['pa', 'pm', 'pi']);
  });
  it('keeps the paper short of the input limit', () => {
    const long = {
      ...paper,
      paragraphs: [
        body('pa', 'a', 'x'.repeat(23000)),
        body('pm', 'm', 'y'.repeat(2000)),
        body('pi', 'i', 'z'),
      ],
    };
    expect(snapshotInput(long).map((p) => p.id)).toEqual(['pa', 'pi']);
  });
  it('shows a value only with a quote that contains its numbers', () => {
    const values = verifySnapshot(
      {
        fields: [
          { field: 'sample_size', value: '120 adults', paragraphId: 'pm', quote: 'We enrolled 120 adults' },
          { field: 'duration', value: '3 months', paragraphId: 'pm', quote: 'for 12 weeks' },
          { field: 'location', value: 'Hanoi', paragraphId: 'pm', quote: 'in Saigon' },
          { field: 'methods', value: 'Randomised trial', paragraphId: 'pa', quote: 'A randomised trial' },
          { field: 'outcome', value: null, paragraphId: null, quote: null },
        ],
      },
      paper.paragraphs,
    );
    const by = (field: string) => values.find((value) => value.field === field);
    expect(values).toHaveLength(7);
    expect(by('sample_size')).toMatchObject({
      status: 'reported',
      value: '120 adults',
      source: { paragraphId: 'pm', page: 4 },
    });
    expect(by('duration')).toMatchObject({ status: 'unverified', value: null });
    expect(by('location')).toMatchObject({ status: 'unverified', value: null });
    expect(by('methods')?.status).toBe('reported');
    expect(by('outcome')?.status).toBe('not_reported');
    expect(by('population')?.status).toBe('not_reported');
  });
});
