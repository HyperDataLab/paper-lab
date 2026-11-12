import { describe, expect, it } from 'vitest';
import { labelPrecision, sampleLabels } from './labelChecks';

describe('C4b human label checks', () => {
  it('draws a reproducible sample across member and section strata', () => {
    const items = Array.from({ length: 24 }, (_, index) => ({
      memberId: `member-${index % 3}`,
      section: `section-${index % 2}`,
      sentenceKey: `sentence-${index}`,
      label: 'label',
    }));
    const sample = sampleLabels(items, 12, 'seed');
    expect(sampleLabels([...items].reverse(), 12, 'seed')).toEqual(sample);
    expect(new Set(sample.map((item) => `${item.memberId}:${item.section}`)).size).toBe(6);
    expect(sampleLabels(items, 12, 'another seed')).not.toEqual(sample);
  });

  it('calculates precision and a Wilson interval, excluding unsure decisions', () => {
    const result = labelPrecision([
      ...Array<'correct'>(8).fill('correct'),
      'incorrect',
      'incorrect',
      'unsure',
    ]);
    expect(result.precision).toBe(0.8);
    expect(result.lower).toBeCloseTo(0.4902, 4);
    expect(result.upper).toBeCloseTo(0.9433, 4);
    expect(labelPrecision(['unsure']).precision).toBeNull();
  });
});
