import { samplingOf, samplingRuleText } from '../corpus/admired';
import type { Corpus, CorpusMember } from '../schemas/corpus';
import type { CorpusProfileFeature } from '../schemas/corpusProfile';
import type { KeywordPaper } from '../schemas/corpusKeywords';
import { CorpusProfileV2Schema, type CorpusProfileV2 } from '../schemas/corpusProfileV2';
import type { ConfoundCheck } from './confounds';
import type { HoldoutResult } from './holdout';
import { headingKey, measurePaperV2Detail, sectionSequence, topSections } from './measureV2';
import { PHRASE_RULES } from './phrases';
import {
  buildCorpusProfile,
  comparisonOf,
  compareValues,
  isDistinctive,
  machineShareOf,
  profileEligible,
  valuesOf,
  type ProfilePaper,
} from './profile';
import { FEATURE_REGISTRY, SIGNATURE_SECTIONS } from './registry';
import { FDR_FAMILIES, FEATURE_REGISTRY_V2, registryV2Digest } from './registryV2';
import { benjaminiHochberg, keyness, summarize } from './stats';

/** Cut-offs of the v2 list blocks. Keywords reuse the phrase minimums (decision 5). */
export const PROFILE_V2_LISTS = {
  headingsPerRole: 10,
  sectionSequences: 10,
  keywords: 50,
  keywordMinTargetPrevalence: PHRASE_RULES.minTargetPrevalence,
  keywordMinTargetPapers: PHRASE_RULES.minTargetPapers,
} as const;

type Status = CorpusProfileV2['features'][number]['status'];
type Measured = {
  member: CorpusMember;
  paper: ProfilePaper;
  measurement: ReturnType<typeof measurePaperV2Detail>;
};

const protocolBody = (corpus: Corpus) => corpus.protocol.at(-1)?.body;

function sampleOf(
  target: Corpus,
  control: Corpus,
  targetYearBuckets: CorpusProfileV2['sample']['yearBuckets'],
) {
  const sampling = samplingOf(protocolBody(target));
  const controlBody = protocolBody(control);
  // A control protocol records no scope of its own: it follows the target it matches (`journalSampling`).
  const controlRule = `${
    sampling.scope === 'admired'
      ? "control venues ranked the same way: per year as many papers as the target's sample, split evenly across venues"
      : samplingRuleText(sampling)
  }${controlBody && 'samplingRule' in controlBody ? ` (protocol: ${controlBody.samplingRule})` : ''}`;
  if (sampling.scope !== 'admired')
    return {
      sampling,
      sample: {
        n: target.members.length,
        rankingRule: samplingRuleText(sampling),
        yearBuckets: targetYearBuckets,
        controlRule,
      },
    };
  // Admired buckets are one publication year each, as the sample was ranked.
  const years = new Map<number, number>();
  for (const member of target.members)
    if (member.stratum.year !== undefined)
      years.set(member.stratum.year, (years.get(member.stratum.year) ?? 0) + 1);
  return {
    sampling,
    sample: {
      n: sampling.n,
      rankingRule: samplingRuleText(sampling),
      yearBuckets: [...years]
        .sort(([a], [b]) => a - b)
        .map(([year, papers]) => ({ from: year, to: year, papers })),
      controlRule,
    },
  };
}

function headingsOf(rows: readonly Measured[]): CorpusProfileV2['headings'] {
  const byRole = new Map<string, Map<string, { papers: Set<string>; forms: Map<string, number> }>>();
  for (const { member, paper } of rows)
    for (const section of topSections(paper.model)) {
      const form = headingKey(section.heading);
      if (!form) continue;
      const key = form.toLowerCase();
      const role = byRole.get(section.role) ?? new Map();
      byRole.set(section.role, role);
      const entry = role.get(key) ?? { papers: new Set<string>(), forms: new Map<string, number>() };
      role.set(key, entry);
      entry.papers.add(member.memberId);
      entry.forms.set(form, (entry.forms.get(form) ?? 0) + 1);
    }
  return SIGNATURE_SECTIONS.flatMap((role) => {
    const entries = byRole.get(role);
    if (!entries || !rows.length) return [];
    const items = [...entries.values()]
      .map((entry) => ({
        // The spelling most papers use; ties alphabetical.
        heading: [...entry.forms].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? '',
        documentShare: entry.papers.size / rows.length,
      }))
      .sort((a, b) => b.documentShare - a.documentShare || a.heading.localeCompare(b.heading))
      .slice(0, PROFILE_V2_LISTS.headingsPerRole);
    return [{ role, items }];
  });
}

function sequencesOf(rows: readonly Measured[]): CorpusProfileV2['sectionSequences'] {
  const counts = new Map<string, { roles: ReturnType<typeof sectionSequence>; papers: number }>();
  for (const { paper } of rows) {
    const roles = sectionSequence(paper.model);
    if (!roles.length) continue;
    const key = roles.join('>');
    counts.set(key, { roles, papers: (counts.get(key)?.papers ?? 0) + 1 });
  }
  return [...counts]
    .map(([key, { roles, papers }]) => ({ key, roles, documentShare: papers / rows.length }))
    .sort((a, b) => b.documentShare - a.documentShare || a.key.localeCompare(b.key))
    .slice(0, PROFILE_V2_LISTS.sectionSequences)
    .map(({ roles, documentShare }) => ({ roles, documentShare }));
}

/** Keyword document frequency of the profiled papers that have keywords, target against control. */
function keywordsOf(
  target: readonly KeywordPaper[],
  control: readonly KeywordPaper[],
): CorpusProfileV2['keywords'] {
  const count = (papers: readonly KeywordPaper[]) => {
    const found = new Map<string, { name: string; papers: number }>();
    let withKeywords = 0;
    for (const paper of papers) {
      const ids = new Map(paper.keywords.map((keyword) => [keyword.id, keyword.name]));
      if (!ids.size) continue;
      withKeywords++;
      for (const [id, name] of ids) found.set(id, { name, papers: (found.get(id)?.papers ?? 0) + 1 });
    }
    return { found, withKeywords };
  };
  const t = count(target),
    c = count(control);
  if (!t.withKeywords || !c.withKeywords) return [];
  const minPapers = Math.max(
    PROFILE_V2_LISTS.keywordMinTargetPapers,
    Math.ceil(PROFILE_V2_LISTS.keywordMinTargetPrevalence * t.withKeywords),
  );
  return [...t.found]
    .filter(([, entry]) => entry.papers >= minPapers)
    .map(([id, entry]) => {
      const b = c.found.get(id)?.papers ?? 0;
      const { g2, logRatio } = keyness(entry.papers, t.withKeywords, b, c.withKeywords);
      return {
        id,
        name: entry.name,
        targetShare: entry.papers / t.withKeywords,
        controlShare: b / c.withKeywords,
        g2,
        logRatio,
      };
    })
    .sort((x, y) => y.targetShare - x.targetShare || y.g2 - x.g2 || x.id.localeCompare(y.id))
    .slice(0, PROFILE_V2_LISTS.keywords);
}

function subfieldsOf(
  target: readonly Measured[],
  control: readonly Measured[],
  names: ReadonlyMap<string, string>,
): CorpusProfileV2['classification']['subfields'] {
  const shares = (rows: readonly Measured[]) => {
    const ids = rows.flatMap(({ member }) => (member.subfieldId ? [member.subfieldId] : []));
    const counts = new Map<string, number>();
    for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
    return (id: string) => (ids.length ? (counts.get(id) ?? 0) / ids.length : 0);
  };
  const t = shares(target),
    c = shares(control);
  const ids = new Set([...target, ...control].flatMap(({ member }) => member.subfieldId ?? []));
  return [...ids]
    .map((id) => ({ id, name: names.get(id) ?? null, targetShare: t(id), controlShare: c(id) }))
    .sort(
      (a, b) => b.targetShare - a.targetShare || b.controlShare - a.controlShare || a.id.localeCompare(b.id),
    );
}

/**
 * The journal profile v2 (slice P2, deterministic part): the v1 profile unchanged as the `core` FDR family, the P2
 * features tested per family, and the list blocks. `admired` profiles are always exploratory. Pure computation.
 */
export async function buildCorpusProfileV2(input: {
  target: Corpus;
  control: Corpus;
  /** Keyed by member id. */
  papers: ReadonlyMap<string, ProfilePaper>;
  /** OpenAlex keywords per member (`memberKeywords`); members outside the profiled set are ignored. */
  keywords?: { target: readonly KeywordPaper[]; control: readonly KeywordPaper[] };
  /** Subfield display names by id, from library records; ids without one get a null name. */
  subfieldNames?: ReadonlyMap<string, string>;
  /** P7 fills this; not computed here. */
  evidenceLevel?: CorpusProfileV2['evidenceLevel'];
  seed: number;
  now: Date;
  holdout?: HoldoutResult;
  confounds?: ConfoundCheck[];
}): Promise<CorpusProfileV2> {
  const { target, control, papers, seed } = input;
  const v1 = await buildCorpusProfile({ ...input, registry: FEATURE_REGISTRY });
  const measure = (corpus: Corpus): Measured[] =>
    corpus.members.filter(profileEligible).flatMap((member) => {
      const paper = papers.get(member.memberId);
      return paper
        ? [{ member, paper, measurement: measurePaperV2Detail(paper.model, paper.insights, paper.stance) }]
        : [];
    });
  const t = measure(target),
    c = measure(control);
  const { sampling, sample } = sampleOf(target, control, v1.target.yearBuckets);
  const admired = sampling.scope === 'admired';
  const warnings = [...v1.warnings];
  const controlBody = protocolBody(control);
  if (controlBody && 'sampling' in controlBody && samplingOf(controlBody).scope !== sampling.scope)
    warnings.push(`${control.title}: control was not drawn with the target's scope (${sampling.scope}).`);

  const v1Ids = new Set(FEATURE_REGISTRY.features.map((feature) => feature.id));
  const v1Features = new Map(v1.features.map((feature) => [feature.featureId, feature]));
  const drafts = FEATURE_REGISTRY_V2.features.map((feature, index) => {
    if (v1Ids.has(feature.id)) return { feature, row: v1Features.get(feature.id) ?? null, draft: null };
    const a = valuesOf(t, feature.id),
      b = valuesOf(c, feature.id);
    return { feature, row: null, draft: { a, b, ...compareValues(feature.metricType, a, b, seed, index) } };
  });
  // Benjamini–Hochberg within each new family; `core` keeps the v1 q values (BH over the v1 registry).
  const q = new Map<string, number | null>();
  for (const family of FDR_FAMILIES.filter((family) => family !== 'core')) {
    const members = drafts.filter((d) => d.feature.fdrFamily === family && d.draft);
    const qs = benjaminiHochberg(members.map((d) => d.draft?.pValue ?? null));
    members.forEach((d, i) => q.set(d.feature.id, qs[i] ?? null));
  }
  const rows: CorpusProfileFeature[] = drafts.map(({ feature, row, draft }) => {
    if (row) return row;
    if (!draft) throw new Error(`v1 profile has no row for ${feature.id}`);
    const machine = feature.extractor === 'llm';
    return {
      featureId: feature.id,
      family: feature.family,
      section: feature.section,
      metricType: feature.metricType,
      unit: feature.unit,
      extractor: feature.extractor,
      target: summarize(draft.a),
      control: summarize(draft.b),
      comparison: comparisonOf(draft, q.get(feature.id) ?? null),
      machineShare: machine
        ? { target: machineShareOf(t, feature.id), control: machineShareOf(c, feature.id) }
        : null,
      coverage: {
        target: { measured: draft.a.length, papers: t.length },
        control: { measured: draft.b.length, papers: c.length },
      },
    };
  });
  const distinctive = new Set([
    ...v1.distinctiveFeatureIds,
    ...rows
      .filter((row) => !v1Ids.has(row.featureId) && isDistinctive(row.comparison))
      .map((r) => r.featureId),
  ]);
  const interpretationStatus = admired ? 'exploratory' : v1.interpretationStatus;
  const holdoutPassed = !admired && v1.holdoutVerified;
  // The held-out test (C5b) checks only the v1 distinctive features, so a P2 feature is never `supported` yet.
  const status = (id: string): Status =>
    interpretationStatus === 'exploratory'
      ? 'exploratory'
      : holdoutPassed && v1Ids.has(id) && distinctive.has(id)
        ? 'supported'
        : 'inconclusive';

  const keywordRows = (rows: readonly Measured[], papers: readonly KeywordPaper[] | undefined) => {
    const ids = new Set(rows.map((row) => row.member.memberId));
    return (papers ?? []).filter((paper) => ids.has(paper.memberId));
  };
  if (!input.keywords) warnings.push('No keyword collections were given, so the keywords block is empty.');

  return CorpusProfileV2Schema.parse({
    ...v1,
    schemaVersion: 2,
    draft: true,
    registry: {
      id: FEATURE_REGISTRY_V2.id,
      version: FEATURE_REGISTRY_V2.version,
      digest: await registryV2Digest(),
    },
    scope: sampling.scope,
    sample,
    features: rows.map((row, index) => {
      const feature = FEATURE_REGISTRY_V2.features[index];
      if (!feature) throw new Error('unreachable');
      return {
        ...row,
        granularity: feature.granularity,
        fdrFamily: feature.fdrFamily,
        status: status(row.featureId),
      };
    }),
    distinctiveFeatureIds: [...distinctive],
    headings: headingsOf(t),
    sectionSequences: sequencesOf(t),
    keywords: keywordsOf(keywordRows(t, input.keywords?.target), keywordRows(c, input.keywords?.control)),
    classification: { subfields: subfieldsOf(t, c, input.subfieldNames ?? new Map()) },
    ...(input.evidenceLevel ? { evidenceLevel: input.evidenceLevel } : {}),
    interpretationStatus,
    interpretationReason: admired
      ? `Admired scope (top ${sample.n} by citations within publication year, no hold-out) is always exploratory (writing-bank doc 39 §2). ${v1.interpretationReason}`
      : v1.interpretationReason,
    holdoutVerified: holdoutPassed,
    warnings,
    methodNotes: [
      ...v1.methodNotes,
      `Registry v2: the v1 features keep their v1 comparisons and form the core FDR family; the P2 features are tested with the same statistics, Benjamini–Hochberg within each family (${FDR_FAMILIES.filter((f) => f !== 'core').join(', ')}).`,
      'Per-section values other than presence are null for a paper without that role, so their summaries describe papers that have the section.',
      'Style rates (hedges, boosters, first person) are word-list counts per 1000 body words of the role, not machine labels. Claim types per section and Toulmin elements are machine labels from the latest complete argument run, reported as prevalence.',
      `Headings: top-level body section headings (numbering removed), document share among profiled target papers, top ${PROFILE_V2_LISTS.headingsPerRole} per role. Section sequences: top-level body section roles in order, abstract/other/appendix left out, repeats collapsed; top ${PROFILE_V2_LISTS.sectionSequences}.`,
      `Keywords: OpenAlex keywords of profiled papers; shares are over papers with any keyword; G² and Log Ratio as for phrases; listed when used by at least ${PROFILE_V2_LISTS.keywordMinTargetPrevalence * 100}% and ${PROFILE_V2_LISTS.keywordMinTargetPapers} target papers, top ${PROFILE_V2_LISTS.keywords} by target share. Subfields: primary-topic subfield share among profiled members that carry one.`,
      'Not yet in v2: passive voice and tense (P6), evidence level E0–E5 (P7).',
    ],
  });
}
