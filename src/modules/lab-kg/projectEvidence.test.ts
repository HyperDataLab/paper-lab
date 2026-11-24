import { describe, expect, it } from 'vitest';
import { rankProjectEvidence, type ProjectEvidence } from './projectEvidence';

function evidence(id: string, text: string): ProjectEvidence {
  return { id, title: id, kind: 'Dữ liệu KG', locator: '', text };
}

describe('rankProjectEvidence', () => {
  it('matches DOI punctuation without favoring unrelated records', () => {
    const ranked = rankProjectEvidence(
      [
        evidence('other', 'A review of distributed systems and data management.'),
        evidence('doi', '10.1016/j.comnet.2025.111430'),
      ],
      '10.1016/j.comnet.2025.111430',
      1,
    );

    expect(ranked.map(({ id }) => id)).toEqual(['doi']);
  });

  it('normalizes Vietnamese diacritics', () => {
    const ranked = rankProjectEvidence(
      [
        evidence('match', 'Các mô hình AI báo cáo kết quả thử nghiệm.'),
        evidence('other', 'An unrelated survey.'),
      ],
      'mô hình AI kết quả thử nghiệm',
      1,
    );

    expect(ranked.map(({ id }) => id)).toEqual(['match']);
  });

  it('matches common English singular and plural word forms', () => {
    const ranked = rankProjectEvidence(
      [evidence('match', 'AI models report results.'), evidence('other', 'A qualitative interview study.')],
      'AI model report result',
      1,
    );

    expect(ranked.map(({ id }) => id)).toEqual(['match']);
  });

  it('keeps negation meaningful in ranking', () => {
    const ranked = rankProjectEvidence(
      [
        evidence('positive-only', 'The intervention is safe.'),
        evidence('negated', 'The intervention is not safe.'),
      ],
      'not safe',
      2,
    );

    expect(ranked.map(({ id }) => id)).toEqual(['negated', 'positive-only']);
  });
});
