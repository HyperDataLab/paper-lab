import { describe, expect, it } from 'vitest';
import { fitPdfScale } from './fitPdfScale';

describe('fitPdfScale', () => {
  it('fits the actual client width without adding an artificial gutter', () => {
    expect(fitPdfScale(1000, 500)).toBe(2);
  });

  it('uses the client width after the browser has reserved a scrollbar', () => {
    expect(fitPdfScale(985, 500)).toBe(1.97);
  });

  it('subtracts only padding that is actually present', () => {
    expect(fitPdfScale(1000, 500, 12)).toBe(1.976);
  });
});
