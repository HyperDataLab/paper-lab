import type { ImportPlan } from '@/core/transfer/planImport';

const empty = {
  toInsert: [],
  toUpdate: [],
  papersToInsert: [],
  papersToUpdate: [],
  generationsToInsert: [],
  revisionsToInsert: [],
  paperOverviews: [],
  paperChecks: [],
  paperReviews: [],
  paperProbes: [],
  measurements: [],
  stance: [],
  paperInsights: [],
  auditEvents: [],
} satisfies Partial<Extract<ImportPlan, { ok: true }>>;

export type PaperImport = Pick<Extract<ImportPlan, { ok: true }>, keyof typeof empty>;

const encoder = new TextEncoder();
const bytes = (data: unknown) => encoder.encode(JSON.stringify(data)).length;
const maxBodyBytes = 20 * 1024 * 1024;
const maxEntries = 32;

function* partition<T>(values: T[], max = maxEntries) {
  let batch: T[] = [];
  let size = 0;
  for (const value of values) {
    const length = bytes(value);
    if (batch.length && (batch.length >= max || size + length > maxBodyBytes)) {
      yield batch;
      batch = [];
      size = 0;
    }
    batch.push(value);
    size += length;
  }
  if (batch.length) yield batch;
}

/** Keep ordinary imports atomic. Large packages commit records in dependency order within worker limits. */
export function* paperImportBatches(plan: PaperImport): Generator<PaperImport> {
  const keys = Object.keys(empty) as (keyof PaperImport)[];
  const records = keys.reduce((count, key) => count + plan[key].length, 0);
  const size = keys.reduce((count, key) => count + (plan[key].length ? bytes(plan[key]) : 0), 0);
  if (records <= maxEntries && size <= maxBodyBytes) {
    yield plan;
    return;
  }

  const transitionEvents = new Map<string, PaperImport['auditEvents']>();
  for (const event of plan.auditEvents) {
    if (event.action !== 'review_transition') continue;
    const events = transitionEvents.get(event.analysisId) ?? [];
    events.push(event);
    transitionEvents.set(event.analysisId, events);
  }
  for (const key of keys) {
    if (key === 'paperOverviews') {
      for (const record of plan.paperOverviews)
        yield { ...empty, paperOverviews: [record], auditEvents: transitionEvents.get(record.paperId) ?? [] };
    } else {
      const entries =
        key === 'auditEvents'
          ? plan.auditEvents.filter(({ action }) => action !== 'review_transition')
          : plan[key];
      // Reviews may also replace multiple n-gram rows. Measurement imports may clear chunked progress.
      const max = key === 'paperReviews' || key === 'measurements' ? 1 : maxEntries;
      for (const batch of partition<unknown>(entries, max)) yield { ...empty, [key]: batch };
    }
  }
}
