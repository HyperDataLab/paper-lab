import { describe, expect, it } from 'vitest';
import type { PaperModelSentence } from '../schemas';
import { buildPaperModel, spanToSentences } from './index';
import { exampleInsights, examplePaper, exampleStance } from './contract';

const now = new Date('2026-11-11T00:00:00.000Z');
const sentence = (start: number, end: number, text: string, paragraphId = 'p1'): PaperModelSentence => ({
  key: `${'0'.repeat(16)}#${start + 1}`,
  displayId: `${paragraphId}_s`,
  paragraphId,
  sectionId: 'x',
  page: 1,
  start,
  end,
  text,
});

describe('R17a PaperLab labels on the sentence index', () => {
  const two = [sentence(0, 10, 'One thing.'), sentence(11, 21, 'Two thing.')];
  it('a span inside one sentence is made relative to it', () => {
    expect(spanToSentences(two, 'p1', 12, 15).map((h) => h.span)).toEqual([{ start: 1, end: 4 }]);
  });
  it('a span crossing two sentences yields one clipped hit per sentence', () => {
    const hits = spanToSentences(two, 'p1', 4, 14);
    expect(hits.map((h) => [h.sentence.start, h.span])).toEqual([
      [0, { start: 4, end: 10 }],
      [11, { start: 0, end: 3 }],
    ]);
  });
  it('touching ends, other paragraphs and the gap between sentences do not count', () => {
    expect(spanToSentences(two, 'p1', 10, 11)).toEqual([]);
    expect(spanToSentences(two, 'p2', 0, 5)).toEqual([]);
  });
  it('maps decisions to states: confirm → confirmed, dismiss → rejected (kept), none → machine', () => {
    const paper = examplePaper();
    const model = buildPaperModel({
      paper,
      metadata: null,
      insights: exampleInsights(paper),
      stance: exampleStance(paper),
      now,
    });
    const byItem = new Map(model.annotations.map((a) => [`${a.scheme}:${String(a.attrs.itemId)}`, a]));
    expect(byItem.get('paperlab-rhetoric:i1')?.state).toBe('confirmed');
    expect(byItem.get('paperlab-rhetoric:i2')?.state).toBe('machine');
    expect(byItem.get('paperlab-rhetoric:i3')?.state).toBe('rejected');
    expect(byItem.get('paperlab-stance:s1')).toMatchObject({
      label: 'boosters',
      text: 'robust',
      origin: 'ai',
      source: { model: 'example-model', promptVersion: 'example-stance-1' },
    });
  });
  it('a reopen decision returns the label to machine', () => {
    const paper = examplePaper();
    const insights = exampleInsights(paper);
    const runId = insights.rhetoricRuns[0]!.id;
    insights.decisions.push({ run_id: runId, item_id: 'i1', decision: 'reopen', at: now.toISOString() });
    const model = buildPaperModel({ paper, metadata: null, insights, now });
    expect(model.annotations.find((a) => a.attrs.itemId === 'i1')?.state).toBe('machine');
  });
  it('only the latest run is used, and a span in a non-indexed paragraph is skipped and counted', () => {
    const paper = examplePaper();
    const insights = exampleInsights(paper);
    const latest = structuredClone(insights.rhetoricRuns[0]!);
    latest.id = '00000000-0000-4000-8000-0000000000c1';
    const table = paper.paragraphs.find((p) => p.id === 't1')!;
    latest.items = [
      { ...latest.items[0]!, id: 'n1' },
      {
        ...latest.items[0]!,
        id: 'n2',
        paragraphId: 't1',
        sectionId: 'res',
        start: 0,
        end: 5,
        excerpt: table.text.slice(0, 5),
      },
    ];
    insights.rhetoricRuns.push(latest);
    const model = buildPaperModel({ paper, metadata: null, insights, now });
    expect(model.annotations.map((a) => a.attrs.itemId)).toEqual(['n1']);
    expect(model.annotationRuns).toEqual([
      expect.objectContaining({ scheme: 'paperlab-rhetoric', runId: latest.id, items: 2, skipped: 1 }),
    ]);
  });
  it('with no runs the model has no annotations', () => {
    const model = buildPaperModel({ paper: examplePaper(), metadata: null, now });
    expect(model.annotations).toEqual([]);
    expect(model.annotationRuns).toEqual([]);
  });
});
