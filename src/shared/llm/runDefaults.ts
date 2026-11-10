import { z } from 'zod';

/**
 * How many AI calls one analysis may make, decided once in Settings instead of on every run.
 * `auto` follows the estimate of the run at hand; `fixed` is one ceiling for every run.
 */
const schema = z.object({
  mode: z.enum(['auto', 'fixed']),
  factor: z.number().int().min(1).max(10),
  fixed: z.number().int().min(1).max(100000),
  probeParagraphs: z.number().int().min(3).max(10),
});
export type RunDefaults = z.infer<typeof schema>;
export const RUN_DEFAULTS_KEY = 'pl.run.defaults';
/** Retries and repair rounds need headroom, so even a tiny run gets this many calls. */
export const AUTO_BUDGET_FLOOR = 10;
export const DEFAULT_RUN_DEFAULTS: RunDefaults = { mode: 'auto', factor: 2, fixed: 150, probeParagraphs: 5 };

export function getRunDefaults(): RunDefaults {
  try {
    const parsed = schema.safeParse(JSON.parse(localStorage.getItem(RUN_DEFAULTS_KEY) || 'null'));
    return parsed.success ? parsed.data : DEFAULT_RUN_DEFAULTS;
  } catch {
    return DEFAULT_RUN_DEFAULTS;
  }
}

/** Returns false when the values are out of range or the browser refuses to store them. */
export function saveRunDefaults(value: RunDefaults): boolean {
  const parsed = schema.safeParse(value);
  if (!parsed.success) return false;
  try {
    localStorage.setItem(RUN_DEFAULTS_KEY, JSON.stringify(parsed.data));
    return true;
  } catch {
    return false;
  }
}

/** The call ceiling for a run estimated at `estimate` calls. */
export function budgetFor(estimate: number, defaults: RunDefaults = getRunDefaults()): number {
  return defaults.mode === 'fixed'
    ? defaults.fixed
    : Math.max(Math.ceil(estimate * defaults.factor), AUTO_BUDGET_FLOOR);
}
