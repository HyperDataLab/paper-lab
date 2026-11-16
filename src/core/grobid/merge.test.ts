import { describe, expect, it } from 'vitest';
import { runPaperChecks } from '../paperChecks';
import { referenceList } from '../scholarlyContext';
import { grobidPaper, grobidRecord, grobidResult } from '@/test/grobidFixtures';
import type { GrobidResult, PaperMetadata } from '../schemas';
import { mergeGrobidMetadata, usableGrobid } from './merge';

const at = '2026-01-01T00:00:00.000Z';

const manual = (fields: Partial<PaperMetadata>): PaperMetadata => ({
  source: 'manual',
  fetchedAt: at,
  doi: null,
  title: null,
  type: null,
  year: null,
  authors: [],
  affiliations: [],
  keywords: [],
  venue: null,
  volume: null,
  issue: null,
  pages: null,
  citedBy: null,
  topic: null,
  ...fields,
});

describe('U7 GROBID merge rules', () => {
  it('fills empty metadata from the header, treating a file-name title as empty', () => {
    const { metadata, filled } = mergeGrobidMetadata(null, grobidRecord(), grobidPaper);
    expect(filled).toEqual(['title', 'authors', 'year', 'doi']);
    expect(metadata).toMatchObject({
      source: 'grobid',
      title: 'A synthetic header title',
      authors: ['Ann Lee', 'Bo Wu'],
      year: 2024,
      doi: '10.48550/arxiv.2401.00001',
    });
    const fileTitle = mergeGrobidMetadata(manual({ title: 'scan_0001' }), grobidRecord(), grobidPaper);
    expect(fileTitle.metadata?.title).toBe('A synthetic header title');
  });

  it('never overwrites fields the user edited', () => {
    const base = manual({ title: 'Edited title', authors: ['Kim Ho'], year: 2020 });
    const { metadata, filled } = mergeGrobidMetadata(base, grobidRecord(), grobidPaper);
    expect(filled).toEqual(['doi']);
    expect(metadata).toMatchObject({
      source: 'manual',
      title: 'Edited title',
      authors: ['Kim Ho'],
      year: 2020,
      doi: '10.48550/arxiv.2401.00001',
    });
  });

  it('ignores failed records and leaves metadata as stored', () => {
    expect(usableGrobid(grobidRecord(null))).toBeNull();
    expect(mergeGrobidMetadata(null, grobidRecord(null), grobidPaper)).toEqual({
      metadata: null,
      filled: [],
    });
  });

  it('uses the GROBID reference list, placed in the reference section', () => {
    const items = referenceList(grobidPaper, new Date(at), grobidResult);
    expect(items.map((item) => [item.year, item.doi, item.location?.paragraphId])).toEqual([
      [2019, null, 'r1'],
      [2021, '10.1000/xyz', 'r1'],
    ]);
  });

  it('recomputes citation findings from GROBID links', () => {
    const report = runPaperChecks(grobidPaper, new Date(at), grobidResult);
    const check = report.checks.find((item) => item.id === 'citations_references');
    const findings = check?.findings ?? [];
    const missing = findings.filter((f) => f.message.startsWith('Trích dẫn chưa có'));
    const unused = findings.filter((f) => f.message.startsWith('Tài liệu tham khảo chưa'));
    // [9] has no link, so it stays a candidate finding anchored on the marker itself.
    expect(missing).toHaveLength(1);
    expect(missing[0]?.locations).toEqual([{ paragraphId: 'p1', start: 52, end: 55 }]);
    // b0 is cited through a resolved link; only b1 is unused.
    expect(unused).toHaveLength(1);
    expect(unused[0]?.evidence[0]).toBe('Unused synthetic note');
    expect(report.droppedLocations).toBe(0);
  });

  it('suppresses and counts findings that cannot be placed in the text', () => {
    const result: GrobidResult = {
      ...grobidResult,
      citations: [
        ...grobidResult.citations,
        { referenceId: null, text: '[7]', sentence: 'Not in this paper [7].', page: 1 },
      ],
    };
    const report = runPaperChecks(grobidPaper, new Date(at), result);
    // Two findings cannot be placed: the missing reference [7], and the numbering gap 2–6 whose only anchor is [7].
    expect(report.droppedLocations).toBe(2);
    const ids = report.checks.flatMap((check) => check.findings.map((finding) => finding.id));
    expect(ids.some((id) => id.includes(':missing:grobid:[7]'))).toBe(false);
    expect(ids.some((id) => id.includes(':gap:grobid:reference:2–6'))).toBe(false);
  });
});
