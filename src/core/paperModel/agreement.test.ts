import { describe, expect, it } from 'vitest';
import { accuracy, cohenKappa, macroF1 } from './agreement';

describe('R17a agreement metrics', () => {
  const gold = ['A', 'A', 'B', 'B', 'C'];
  const pred = ['A', 'B', 'B', 'B', 'A'];
  it('accuracy', () => {
    expect(accuracy(gold, pred)).toBeCloseTo(3 / 5);
  });
  it('macro F1 over labels in gold; a never-predicted gold label scores 0', () => {
    // A: tp1 fp1 fn1 → 0.5; B: tp2 fp1 fn0 → 0.8; C: tp0 fn1 → 0.
    expect(macroF1(gold, pred)).toBeCloseTo((0.5 + 0.8 + 0) / 3);
    // A label only in the prediction is not averaged in.
    expect(macroF1(['A', 'A'], ['A', 'Z'])).toBeCloseTo(2 / 3);
  });
  it("Cohen's kappa", () => {
    // po = 0.6; pe = 0.4·0.4 + 0.4·0.6 + 0.2·0 = 0.4; κ = 0.2 / 0.6.
    expect(cohenKappa(gold, pred)).toBeCloseTo(1 / 3);
    expect(cohenKappa(['x', 'y'], ['x', 'y'])).toBe(1);
    expect(cohenKappa(['x', 'y'], ['y', 'x'])).toBe(-1);
    expect(cohenKappa(['x', 'x'], ['x', 'x'])).toBe(1);
  });
  it('rejects empty or unequal inputs', () => {
    expect(() => accuracy([], [])).toThrow();
    expect(() => macroF1(['a'], [])).toThrow();
    expect(() => cohenKappa(['a'], ['a', 'b'])).toThrow();
  });
});
