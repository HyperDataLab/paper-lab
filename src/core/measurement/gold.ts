import { z } from 'zod';
import { PROTOCOL_FIELDS, type MeasurementProfile } from '../schemas/measurement';
import { containsExact } from './verify';

export const MeasurementGoldSchema = z.object({
  format: z.literal('paragraph-lab-measurement-gold'),
  version: z.literal(1),
  paper_sha256: z.string(),
  rater: z.string(),
  metrics: z.array(z.object({ name: z.string(), aliases: z.array(z.string()).default([]) })),
  results: z.array(
    z.object({
      value: z.string(),
      unit: z.string().nullable(),
      blockId: z.string().nullable(),
      /** False when the PDF reader itself got this table wrong: a parsing error, not an inference error. */
      reader_correct: z.boolean(),
    }),
  ),
  reported_protocol_fields: z.array(z.object({ experiment: z.string(), field: z.enum(PROTOCOL_FIELDS) })),
});
export type MeasurementGold = z.infer<typeof MeasurementGoldSchema>;

export interface Tally {
  hit: number;
  n: number;
}
export interface GoldScore {
  metricPrecision: Tally;
  metricRecall: Tally;
  numericExact: Tally;
  evidenceLocation: Tally;
  protocolPrecision: Tally;
  falseReported: Tally;
  parsingErrors: number;
}

/** Product targets from PRD §12. They are goals, not results. */
export const GOLD_TARGETS: Record<keyof Omit<GoldScore, 'parsingErrors'>, { min?: number; max?: number }> = {
  metricPrecision: { min: 0.9 },
  metricRecall: { min: 0.85 },
  numericExact: { min: 0.99 },
  evidenceLocation: { min: 0.95 },
  protocolPrecision: { min: 0.9 },
  falseReported: { max: 0.02 },
};
export const GOLD_MIN_PAPERS = 30;

const normalize = (text: string) => text.normalize('NFC').toLowerCase().replace(/\s+/gu, ' ').trim();

export function scoreAgainstGold(profile: MeasurementProfile, gold: MeasurementGold): GoldScore {
  const goldNames = gold.metrics.map((metric) => new Set([metric.name, ...metric.aliases].map(normalize)));
  const namesOf = (metric: MeasurementProfile['metrics'][number]) =>
    [metric.reported_name, ...metric.aliases].map(normalize);
  const matched = profile.metrics.filter((metric) =>
    namesOf(metric).some((name) => goldNames.some((set) => set.has(name))),
  );
  const found = goldNames.filter((set) =>
    profile.metrics.some((metric) => namesOf(metric).some((name) => set.has(name))),
  );

  const readable = gold.results.filter((result) => result.reader_correct);
  const evidenceOf = (id: string) => profile.evidence.find((item) => item.id === id);
  const sameValue = (
    result: MeasurementGold['results'][number],
    item: MeasurementProfile['results'][number],
  ) =>
    containsExact(item.value, result.value) &&
    containsExact(result.value, item.value) &&
    normalize(result.unit ?? '') === normalize(item.unit ?? '');
  const numericHits = readable.filter((result) => profile.results.some((item) => sameValue(result, item)));
  const located = readable.filter((result) => result.blockId !== null);
  const locatedHits = located.filter((result) =>
    profile.results.some(
      (item) =>
        sameValue(result, item) && item.evidence_ids.some((id) => evidenceOf(id)?.blockId === result.blockId),
    ),
  );

  const goldProtocol = new Set(
    gold.reported_protocol_fields.map((item) => `${normalize(item.experiment)}|${item.field}`),
  );
  const predicted = profile.experiments.flatMap((experiment) =>
    PROTOCOL_FIELDS.filter((field) => experiment.protocol[field].status === 'REPORTED').map(
      (field) => `${normalize(experiment.name)}|${field}`,
    ),
  );
  const correct = predicted.filter((key) => goldProtocol.has(key));
  return {
    metricPrecision: { hit: matched.length, n: profile.metrics.length },
    metricRecall: { hit: found.length, n: gold.metrics.length },
    numericExact: { hit: numericHits.length, n: readable.length },
    evidenceLocation: { hit: locatedHits.length, n: located.length },
    protocolPrecision: { hit: correct.length, n: predicted.length },
    falseReported: { hit: predicted.length - correct.length, n: predicted.length },
    parsingErrors: gold.results.length - readable.length,
  };
}

export function sumScores(scores: GoldScore[]): GoldScore {
  const add = (key: keyof Omit<GoldScore, 'parsingErrors'>): Tally => ({
    hit: scores.reduce((sum, score) => sum + score[key].hit, 0),
    n: scores.reduce((sum, score) => sum + score[key].n, 0),
  });
  return {
    metricPrecision: add('metricPrecision'),
    metricRecall: add('metricRecall'),
    numericExact: add('numericExact'),
    evidenceLocation: add('evidenceLocation'),
    protocolPrecision: add('protocolPrecision'),
    falseReported: add('falseReported'),
    parsingErrors: scores.reduce((sum, score) => sum + score.parsingErrors, 0),
  };
}

export type GoldVerdict = 'not_measured' | 'met' | 'not_met';
export function goldVerdict(key: keyof typeof GOLD_TARGETS, tally: Tally): GoldVerdict {
  if (tally.n === 0) return 'not_measured';
  const rate = tally.hit / tally.n;
  const target = GOLD_TARGETS[key];
  if (target.min !== undefined) return rate >= target.min ? 'met' : 'not_met';
  return rate <= (target.max ?? 1) ? 'met' : 'not_met';
}
