import { beforeEach, expect, it } from 'vitest';
import {
  AUTO_BUDGET_FLOOR,
  budgetFor,
  DEFAULT_RUN_DEFAULTS,
  getRunDefaults,
  RUN_DEFAULTS_KEY,
  saveRunDefaults,
} from './runDefaults';

beforeEach(() => localStorage.clear());

it('P1 auto budget follows the estimate and never drops under the floor', () => {
  expect(budgetFor(40, DEFAULT_RUN_DEFAULTS)).toBe(80);
  expect(budgetFor(2, DEFAULT_RUN_DEFAULTS)).toBe(AUTO_BUDGET_FLOOR);
  expect(budgetFor(40, { ...DEFAULT_RUN_DEFAULTS, factor: 3 })).toBe(120);
});

it('P1 fixed budget ignores the estimate', () => {
  expect(budgetFor(400, { ...DEFAULT_RUN_DEFAULTS, mode: 'fixed', fixed: 60 })).toBe(60);
});

it('P1 run defaults round-trip through storage and reject bad values', () => {
  expect(getRunDefaults()).toEqual(DEFAULT_RUN_DEFAULTS);
  expect(saveRunDefaults({ mode: 'fixed', factor: 2, fixed: 300, probeParagraphs: 7 })).toBe(true);
  expect(getRunDefaults()).toEqual({ mode: 'fixed', factor: 2, fixed: 300, probeParagraphs: 7 });
  expect(saveRunDefaults({ mode: 'fixed', factor: 2, fixed: 0, probeParagraphs: 7 })).toBe(false);
  localStorage.setItem(RUN_DEFAULTS_KEY, '{"mode":"nonsense"}');
  expect(getRunDefaults()).toEqual(DEFAULT_RUN_DEFAULTS);
});
