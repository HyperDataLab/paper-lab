import { describe, expect, it } from 'vitest';
import { drawSample, excludeRecord, harvestQuery, type Work } from './sampling';

const buckets = [
  { from: 2020, to: 2021 },
  { from: 2022, to: 2023 },
  { from: 2024, to: 2025 },
];
const options = { size: 150, buckets, minPerBucket: 20, capPerIssue: null, heldOutShare: 0.2, seed: 'seed' };
function work(i: number, venue = 'S1'): Work {
  return {
    id: `W${venue}-${i}`,
    doi: `10.1/${venue}-${i}`,
    title: 'Research',
    publication_year: 2020 + (i % 6),
    type: 'article',
    is_retracted: false,
    primary_location: { source: { id: venue } },
  };
}
describe('C4a journal sampling', () => {
  it('queries only open published articles and required fields', () => {
    const url = new URL(harvestQuery({ sourceId: 'S13144211', years: [2020, 2025] }));
    expect(url.searchParams.get('filter')).toBe(
      'primary_location.source.id:S13144211,type:article,from_publication_date:2020-01-01,to_publication_date:2025-12-31,open_access.oa_status:gold|diamond|hybrid|bronze',
    );
    expect(url.searchParams.get('select')).toBe(
      'id,doi,title,publication_year,primary_location,authorships,biblio,open_access,is_retracted,type,cited_by_count,primary_topic',
    );
    expect(url.searchParams.get('sort')).toBeNull();
  });
  it('P4 sorts by citations when the admired scope asks for it', () => {
    const url = new URL(harvestQuery({ sourceId: 'S1', years: [2022], sort: 'cited_by_count:desc' }));
    expect(url.searchParams.get('sort')).toBe('cited_by_count:desc');
    expect(url.searchParams.get('filter')).toContain(
      'from_publication_date:2022-01-01,to_publication_date:2022-12-31',
    );
  });
  it('excludes retractions, corrections, non-articles and missing DOI', () => {
    expect(excludeRecord({ ...work(1), is_retracted: true })).toBe('retracted');
    expect(excludeRecord({ ...work(1), title: 'Corrigendum to a paper' })).toBe('title');
    expect(excludeRecord({ ...work(1), type: 'editorial' })).toBe('type');
    expect(excludeRecord({ ...work(1), doi: null })).toBe('missing_doi');
  });
  it('is deterministic, stratifies and holds out 20 percent', () => {
    const records = Array.from({ length: 600 }, (_, i) => work(i));
    const result = drawSample(records, options);
    expect(drawSample(records, options)).toEqual(result);
    expect(drawSample(records, { ...options, seed: 'other' }).sample).not.toEqual(result.sample);
    expect(result.report.buckets.map((b) => b.count)).toEqual([50, 50, 50]);
    expect(result.sample.filter((s) => s.role === 'held_out')).toHaveLength(30);
    expect(drawSample(records.slice(0, 30), options).report.buckets.every((b) => b.shortfall > 0)).toBe(true);
  });
  it('matches target buckets and samples venues proportionally', () => {
    const records = [
      ...Array.from({ length: 600 }, (_, i) => work(i, 'S1')),
      ...Array.from({ length: 300 }, (_, i) => work(i, 'S2')),
    ];
    const result = drawSample(records, {
      ...options,
      buckets: buckets.map((b, i) => ({ ...b, target: [30, 50, 70][i] })),
    });
    expect(result.report.buckets.map((b) => b.count)).toEqual([30, 50, 70]);
    expect(result.sample.filter((s) => s.work.primary_location?.source?.id === 'S1')).toHaveLength(100);
  });
});
