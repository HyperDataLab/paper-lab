import { z } from 'zod';
import { bankBenchmarks, bankMetrics, bankProtocols } from '../researchDesign/bank/readSnapshot';
import type { BankDoc } from '../researchDesign/bank/snapshot';
import { analysisSchema, conditionSchema } from '../researchDesign/plan/schema';
import { canonicalDigest } from '../corpus';
import type { Inputs } from './contracts';
import { refs, text } from './stage-fields';

export const experimentDesignSchema = z.strictObject({
  design: z.strictObject({ id: text.nullable(), rationale: text }),
  datasets: z
    .array(
      z.strictObject({
        name: text,
        source: text,
        split: text,
        license: text.optional(),
        bankRef: text.optional(),
      }),
    )
    .min(1),
  baselines: z.array(z.strictObject({ name: text, why: text, citeKey: text.optional() })),
  methods: z.array(z.strictObject({ name: text, hypothesisIds: refs })),
  ablations: z.array(z.strictObject({ name: text, removes: text, hypothesisId: text })),
  metrics: z.array(
    z.strictObject({
      name: text,
      bankRef: text.optional(),
      protocolRef: text.optional(),
      direction: z.enum(['higher_better', 'lower_better', 'target_value', 'descriptive']),
      hypothesisIds: refs,
    }),
  ),
  conditions: z.array(conditionSchema.pick({ name: true, baseline: true, params: true })).min(1),
  threats: z.array(z.strictObject({ bankRef: text.optional(), mitigation: text })),
  compute: z.strictObject({ estimate: text, budget: text }),
  analysis: z.array(
    z.strictObject({
      hypothesisId: text,
      test: text,
      alpha: analysisSchema.shape.alpha,
      correction: analysisSchema.shape.correction,
      metric: text.optional(),
      conditions: z.tuple([text, text]).optional(),
    }),
  ),
});

const ids = z.array(text);
const bankPinSchema = z.strictObject({
  release: text,
  hash: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
  designs: ids,
  threats: ids,
  metrics: ids,
  protocols: ids,
  benchmarks: ids,
});
export const s10Schema = experimentDesignSchema.extend({ bank: bankPinSchema.nullable() });
export type ExperimentDesign = z.infer<typeof s10Schema>;

export function bankDesignInputs(bank: BankDoc | null) {
  return (
    bank && {
      release: bank.release,
      designs: bank.collections.designs,
      threats: bank.collections.threats,
      metrics: bankMetrics(bank),
      protocols: bankProtocols(bank),
      benchmarks: bankBenchmarks(bank),
    }
  );
}

export async function pinDesignBank(bank: ReturnType<typeof bankDesignInputs>) {
  const ids = (entries: { id: string }[]) => entries.map(({ id }) => id);
  return (
    bank && {
      release: bank.release,
      hash: await canonicalDigest(bank),
      designs: ids(bank.designs),
      threats: ids(bank.threats),
      metrics: ids(bank.metrics),
      protocols: ids(bank.protocols),
      benchmarks: ids(bank.benchmarks),
    }
  );
}

export function validDesign(value: ExperimentDesign, prior: Inputs) {
  const hypotheses = new Set(prior.S8?.hypotheses.map(({ id }) => id));
  if (!hypotheses.size || !prior.S9 || !prior.S4 || !prior.S5) return false;
  const screened = new Set(prior.S5.decisions.map(({ paperId }) => paperId));
  const citeKeys = new Set(
    prior.S4.candidates
      .filter(({ id }) => screened.has(id))
      .flatMap(({ citationKey, cite_key }) => (cite_key ? [citationKey, cite_key] : [citationKey])),
  );
  const { bank, methods, metrics, analysis, conditions } = value;
  const resolves = (
    id: string | undefined | null,
    collection: keyof Omit<NonNullable<typeof bank>, 'release' | 'hash'>,
  ) => id == null || Boolean(bank?.[collection].includes(id));
  const uniqueNames = (rows: { name: string }[]) =>
    new Set(rows.map(({ name }) => name.toLowerCase())).size === rows.length;
  return (
    [metrics, value.datasets, conditions].every(uniqueNames) &&
    [...hypotheses].every(
      (id) =>
        methods.some((m) => m.hypothesisIds.includes(id)) &&
        metrics.some((m) => m.hypothesisIds.includes(id)) &&
        analysis.some((row) => row.hypothesisId === id),
    ) &&
    [...methods, ...metrics].every((row) => row.hypothesisIds.every((id) => hypotheses.has(id))) &&
    value.ablations.every((row) => hypotheses.has(row.hypothesisId)) &&
    analysis.every(
      (row) =>
        hypotheses.has(row.hypothesisId) &&
        (row.metric === undefined ||
          metrics.some((m) => m.name === row.metric && m.hypothesisIds.includes(row.hypothesisId))) &&
        (!row.conditions ||
          (new Set(row.conditions).size === 2 &&
            row.conditions.every((name) => conditions.some((c) => c.name === name)))),
    ) &&
    resolves(value.design.id, 'designs') &&
    value.datasets.every((row) => resolves(row.bankRef, 'benchmarks')) &&
    metrics.every((row) => resolves(row.bankRef, 'metrics') && resolves(row.protocolRef, 'protocols')) &&
    value.threats.every((row) => resolves(row.bankRef, 'threats')) &&
    value.baselines.every((row) => row.citeKey === undefined || citeKeys.has(row.citeKey))
  );
}
