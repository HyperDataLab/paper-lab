import { z } from 'zod';
import { DebateSchema, DuplicationSchema, ImpactSchema, SaturationSchema } from '../topicCheck/evidence';

const text = z.string().max(4000);
const snapshot = {
  id: text,
  ranAt: z.iso.datetime(),
  input: z.record(z.string(), z.unknown()),
  queryUsed: text,
  broadenedFrom: text.optional(),
};
export const TopicCheckSchema = z.strictObject({
  schemaVersion: z.literal(1),
  track: z.enum(['review', 'study']),
  statement: text,
  /** English search keywords for the literature tools; absent or empty means use the statement. */
  searchQuery: text.optional(),
  neighbours: z
    .array(
      z.strictObject({ ref: text, label: text, difference: text, source: z.enum(['researcher', 'tool']) }),
    )
    .max(10),
  debate: text,
  convergence: z.strictObject({
    interest: z.number().int().min(1).max(5).nullable(),
    feasibility: text,
    debateAlive: z.enum(['yes', 'unsure', 'no']).nullable(),
  }),
  pico: z.strictObject({ population: text, exposure: text, comparison: text, outcome: text }),
  plainSummary: text,
  evidence: z
    .array(
      z.discriminatedUnion('kind', [
        z.strictObject({ ...snapshot, kind: z.literal('duplication'), result: DuplicationSchema }),
        z.strictObject({ ...snapshot, kind: z.literal('saturation'), result: SaturationSchema }),
        z.strictObject({ ...snapshot, kind: z.literal('debate'), result: DebateSchema }),
        z.strictObject({ ...snapshot, kind: z.literal('impact'), result: ImpactSchema }),
      ]),
    )
    .max(20),
  reviewedIds: z.array(z.string()).max(50).default([]),
  decision: z.strictObject({
    verdict: z.enum(['go', 'adjust', 'groundwork']).nullable(),
    note: text,
    nextHumanStep: text,
    decidedAt: z.iso.datetime().optional(),
  }),
  updatedAt: z.iso.datetime(),
});
export type TopicCheck = z.infer<typeof TopicCheckSchema>;
export function emptyTopicCheck(): TopicCheck {
  return {
    schemaVersion: 1,
    track: 'review',
    statement: '',
    neighbours: [],
    debate: '',
    convergence: { interest: null, feasibility: '', debateAlive: null },
    pico: { population: '', exposure: '', comparison: '', outcome: '' },
    plainSummary: '',
    evidence: [],
    reviewedIds: [],
    decision: { verdict: null, note: '', nextHumanStep: '' },
    updatedAt: new Date().toISOString(),
  };
}
