import type { HoldoutResult } from './holdout';
import type { ConfoundCheck } from './confounds';
import type { Corpus, CorpusMember } from '../schemas/corpus';
import { CorpusProfileSchema, type CorpusProfile, type CorpusProfileFeature } from '../schemas/corpusProfile';
import type { PaperInsightsRecord } from '../schemas/paperInsights';
import type { PaperModel } from '../schemas/paperModel';
import type { StanceRecord } from '../schemas/stance';
import { bodySentences, measurePaperDetail, type PaperMeasurement } from './measure';
import { PHRASE_NORMALISATION, PHRASE_RULES, PHRASE_TOKENIZER_VERSION, phraseSignals } from './phrases';
import { FEATURE_REGISTRY, registryDigest } from './registry';
import {
  benjaminiHochberg,
  BOOTSTRAP_RESAMPLES,
  bootstrapCi,
  cohensD,
  mannWhitney,
  proportionDifference,
  summarize,
} from './stats';

/** Section 4 of CORPUS_PLAN.md and the minimum effects for `distinctiveFeatureIds`. */
export const PROFILE_THRESHOLDS = {
  alpha: 0.05,
  minCohensD: 0.2,
  minProportionDifference: 0.1,
  bootstrapResamples: BOOTSTRAP_RESAMPLES,
  minPapersPerCorpus: 150,
  minPapersPerBucket: 20,
  bucketYears: 2,
} as const;

export type ProfilePaper = {
  model: PaperModel;
  insights?: PaperInsightsRecord | null;
  stance?: StanceRecord | null;
};

const MACHINE_FAMILIES = new Set(['stance', 'rhetorical', 'scientific']);

/** Build members read in full text; held-out members are kept for the held-out test and never profiled. */
export const profileEligible = (member: CorpusMember) =>
  member.role !== 'held_out' && member.retrieval === 'retrieved' && member.textRead === 'FULL_TEXT';

function yearsOf(corpus: Corpus): number[] {
  const body = corpus.protocol.at(-1)?.body;
  return body?.years ?? [];
}

function side(
  corpus: Corpus,
  profiled: readonly CorpusMember[],
  bucketStart: number | null,
  bucketEnd: number | null,
) {
  const release = corpus.releases.at(-1) ?? null;
  // Section 4 sizes count full-text papers of record, held-out ones included (150 with 20 % held out).
  const fullText = corpus.members.filter((m) => m.retrieval === 'retrieved' && m.textRead === 'FULL_TEXT');
  const years = fullText.flatMap((m) => (m.stratum.year === undefined ? [] : [m.stratum.year]));
  const yearBuckets: { from: number; to: number; papers: number }[] = [];
  if (bucketStart !== null && bucketEnd !== null)
    for (let from = bucketStart; from <= bucketEnd; from += PROFILE_THRESHOLDS.bucketYears) {
      const to = from + PROFILE_THRESHOLDS.bucketYears - 1;
      yearBuckets.push({ from, to, papers: years.filter((y) => y >= from && y <= to).length });
    }
  return {
    corpusId: corpus.id,
    kind: corpus.kind,
    title: corpus.title,
    releaseId: release?.id ?? null,
    releaseDigest: release?.digest ?? null,
    members: corpus.members.length,
    heldOut: corpus.members.filter((m) => m.role === 'held_out').length,
    fullText: fullText.length,
    profiled: profiled.length,
    notOnDevice: corpus.members.filter(profileEligible).length - profiled.length,
    yearBuckets,
    withoutYear: fullText.length - years.length,
  };
}

const finiteOrNull = (value: number | null | undefined) =>
  value === null || value === undefined || !Number.isFinite(value) ? null : value;

/**
 * The corpus profile of a journal against its control: per-paper feature values, summary statistics,
 * paper-level comparisons with FDR control, and phrase keyness. Pure computation over the given papers.
 */
export async function buildCorpusProfile({
  target,
  control,
  papers,
  registry = FEATURE_REGISTRY,
  seed,
  now,
  holdout,
  confounds,
}: {
  target: Corpus;
  control: Corpus;
  /** Keyed by member id. */
  papers: ReadonlyMap<string, ProfilePaper>;
  registry?: typeof FEATURE_REGISTRY;
  seed: number;
  now: Date;
  holdout?: HoldoutResult;
  confounds?: ConfoundCheck[];
}): Promise<CorpusProfile> {
  const warnings: string[] = [];
  const profile = (corpus: Corpus) => {
    const eligible = corpus.members.filter(profileEligible);
    const members = eligible.filter((m) => papers.has(m.memberId));
    if (members.length < eligible.length)
      warnings.push(
        `${corpus.title}: ${eligible.length - members.length} of ${eligible.length} full-text build members have no paper on this device and were left out.`,
      );
    const measured = members.map((member) => {
      const paper = papers.get(member.memberId);
      if (!paper) throw new Error('unreachable');
      return { member, paper, measurement: measurePaperDetail(paper.model, paper.insights, paper.stance) };
    });
    return { members, measured };
  };
  const t = profile(target),
    c = profile(control);
  for (const corpus of [target, control]) {
    if (!corpus.releases.length)
      warnings.push(`${corpus.title}: never released, so the profile names no release id.`);
    if (!corpus.members.some((m) => m.role === 'held_out'))
      warnings.push(`${corpus.title}: no held-out members, so a held-out test cannot follow.`);
  }
  if (target.kind !== 'journal') warnings.push(`${target.title}: target is not a journal corpus.`);
  if (control.kind !== 'control') warnings.push(`${control.title}: control is not a control corpus.`);

  const protocolYears = [...yearsOf(target), ...yearsOf(control)];
  const paperYears = [...t.members, ...c.members].flatMap((m) =>
    m.stratum.year === undefined ? [] : [m.stratum.year],
  );
  const allYears = protocolYears.length ? protocolYears : paperYears;
  const bucketStart = allYears.length ? Math.min(...allYears) : null;
  const bucketEnd = allYears.length ? Math.max(...allYears) : null;
  const targetSide = side(target, t.members, bucketStart, bucketEnd);
  const controlSide = side(control, c.members, bucketStart, bucketEnd);

  const valuesOf = (rows: { measurement: PaperMeasurement }[], id: string) =>
    rows.flatMap((row) => {
      const value = row.measurement.values[id];
      return value === null || value === undefined || !Number.isFinite(value) ? [] : [value];
    });
  const machineShare = (rows: { measurement: PaperMeasurement }[], id: string) => {
    let total = 0,
      machine = 0;
    for (const row of rows) {
      const count = row.measurement.labels[id];
      total += count?.total ?? 0;
      machine += count?.machine ?? 0;
    }
    return total ? machine / total : null;
  };
  const drafts = registry.features.map((feature, index) => {
    const a = valuesOf(t.measured, feature.id),
      b = valuesOf(c.measured, feature.id);
    const binary = feature.metricType === 'prevalence';
    const statistic = binary ? proportionDifference : cohensD;
    const effect = finiteOrNull(statistic(a, b));
    const ci =
      effect === null ? null : bootstrapCi(a, b, (seed + Math.imul(index + 1, 0x9e3779b1)) >>> 0, statistic);
    const pValue = effect === null ? null : mannWhitney(a, b);
    return {
      feature,
      a,
      b,
      effect,
      metric: binary ? ('proportion_difference' as const) : ('cohens_d' as const),
      ci,
      pValue,
    };
  });
  const q = benjaminiHochberg(drafts.map((draft) => draft.pValue));
  const features: CorpusProfileFeature[] = drafts.map((draft, index) => {
    const { feature } = draft;
    const machine = MACHINE_FAMILIES.has(feature.family);
    const qValue = q[index] ?? null;
    return {
      featureId: feature.id,
      family: feature.family,
      section: feature.section,
      metricType: feature.metricType,
      unit: feature.unit,
      extractor: machine ? 'llm' : 'deterministic',
      target: summarize(draft.a),
      control: summarize(draft.b),
      comparison:
        draft.effect === null || draft.pValue === null || qValue === null
          ? null
          : {
              effectSize: draft.effect,
              effectMetric: draft.metric,
              ci95Low: draft.ci?.[0] ?? null,
              ci95High: draft.ci?.[1] ?? null,
              pValue: draft.pValue,
              qValue,
              bootstrapUnit: 'paper',
            },
      machineShare: machine
        ? { target: machineShare(t.measured, feature.id), control: machineShare(c.measured, feature.id) }
        : null,
      coverage: {
        target: { measured: draft.a.length, papers: t.measured.length },
        control: { measured: draft.b.length, papers: c.measured.length },
      },
    };
  });
  const distinctiveFeatureIds = features
    .filter((f) => {
      const cmp = f.comparison;
      if (!cmp || cmp.qValue >= PROFILE_THRESHOLDS.alpha) return false;
      const min =
        cmp.effectMetric === 'cohens_d'
          ? PROFILE_THRESHOLDS.minCohensD
          : PROFILE_THRESHOLDS.minProportionDifference;
      return Math.abs(cmp.effectSize) >= min;
    })
    .map((f) => f.featureId);

  const phrasePapers = (rows: typeof t.measured) =>
    rows.map(({ member, paper }) => ({
      memberExportId: member.exportId,
      sentences: bodySentences(paper.model).map((s) => ({ key: s.key, text: s.text })),
    }));
  const phrases = phraseSignals(phrasePapers(t.measured), phrasePapers(c.measured));

  const shortfalls: string[] = [];
  for (const s of [targetSide, controlSide]) {
    if (s.fullText < PROFILE_THRESHOLDS.minPapersPerCorpus)
      shortfalls.push(
        `${s.title}: ${s.fullText} full-text papers, fewer than ${PROFILE_THRESHOLDS.minPapersPerCorpus}`,
      );
    if (s.notOnDevice) shortfalls.push(`${s.title}: ${s.notOnDevice} build papers not on this device`);
    const thin = s.yearBuckets.filter((bucket) => bucket.papers < PROFILE_THRESHOLDS.minPapersPerBucket);
    if (!s.yearBuckets.length) shortfalls.push(`${s.title}: no year buckets`);
    else if (thin.length)
      shortfalls.push(
        `${s.title}: ${thin.map((b) => `${b.from}–${b.to} has ${b.papers}`).join(', ')} (fewer than ${PROFILE_THRESHOLDS.minPapersPerBucket} per bucket)`,
      );
    if (!s.heldOut) shortfalls.push(`${s.title}: nothing held out`);
  }
  const interpretationStatus = shortfalls.length
    ? 'exploratory'
    : holdout?.passed && distinctiveFeatureIds.length
      ? 'supported'
      : 'inconclusive';
  const interpretationReason = shortfalls.length
    ? `Below the minimums of CORPUS_PLAN section 4. ${shortfalls.join('; ')}.`
    : holdout?.passed && distinctiveFeatureIds.length
      ? 'The section 4 minimums and held-out test are met.'
      : holdout
        ? 'The held-out test did not pass, so no feature is supported.'
        : 'The section 4 minimums are met, but the held-out test (C5b) has not run, so no feature is supported yet.';

  const methodNotes = [
    'Values are per paper: body blocks only, publisher boilerplate (competing interests, CRediT, data availability, acknowledgements, funding, front matter), references and title removed; one paper model per member.',
    'Profiled papers are build members that were retrieved, read in full text and have a paper on this device; held-out members are never profiled.',
    `Continuous features compare corpora with Cohen's d (pooled SD); prevalence features with the difference in proportions. The 95% CI is a percentile bootstrap of that same effect over ${BOOTSTRAP_RESAMPLES} resamples of whole papers, independently within each corpus, seeded from the profile seed.`,
    'p values are two-sided Mann–Whitney U (normal approximation, tie and continuity corrected). q values are Benjamini–Hochberg over every registry feature with a p value; phrases form a separate family.',
    `A feature is distinctive when q < ${PROFILE_THRESHOLDS.alpha} and |d| ≥ ${PROFILE_THRESHOLDS.minCohensD} or |difference in proportions| ≥ ${PROFILE_THRESHOLDS.minProportionDifference}.`,
    'Machine-label features (stance, rhetoric, claim types) count a paper only when its latest run covers every body section except appendices; machineShare is the share of counted labels no person has confirmed.',
    `Phrases: document frequency (papers using the phrase, counted once per paper) compared by G² (1 df) and Log Ratio; tested only when used by at least ${PHRASE_RULES.minTargetPrevalence * 100}% of target papers and at least ${PHRASE_RULES.minTargetPapers} papers (owner decision 5); only phrases the target uses more are listed, top ${PHRASE_RULES.top} by G² with q < ${PHRASE_RULES.alpha}; evidence excerpts are at most ${PHRASE_RULES.maxExcerptChars} characters (decision 6).`,
    `Year buckets are ${PROFILE_THRESHOLDS.bucketYears} years wide from the earliest protocol year (or paper year when the protocol names none); sizes and buckets count full-text members, held-out ones included.`,
    'Not yet done: author-cluster bootstrap and leaving each control journal out.',
  ];

  return CorpusProfileSchema.parse({
    format: 'paperlab-corpus-profile',
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    registry: { id: registry.id, version: registry.version, digest: await registryDigest(registry) },
    target: targetSide,
    control: controlSide,
    seed: seed >>> 0,
    thresholds: PROFILE_THRESHOLDS,
    features,
    distinctiveFeatureIds,
    phrases: {
      tokenizerVersion: PHRASE_TOKENIZER_VERSION,
      normalisation: PHRASE_NORMALISATION,
      rules: PHRASE_RULES,
      tested: phrases.tested,
      items: phrases.items,
    },
    interpretationStatus,
    interpretationReason,
    holdoutVerified: Boolean(holdout?.passed && distinctiveFeatureIds.length),
    ...(holdout ? { holdout } : {}),
    ...(confounds ? { confoundChecks: confounds } : {}),
    warnings,
    methodNotes,
  });
}
