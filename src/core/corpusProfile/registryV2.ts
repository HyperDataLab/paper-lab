import { CLAIM_TYPES } from '../argument/claimTypes';
import { canonicalDigest } from '../corpus';
import { FEATURE_REGISTRY, SIGNATURE_SECTIONS, type Feature, type SignatureSection } from './registry';
import { STYLE_LEXICON_VERSION, STYLE_LEXICONS } from './styleLexicon';

/**
 * Feature registry v2 (writing-bank doc 39 §3, slice P2). Every v1 feature is kept with its id and definition and
 * forms the pre-declared `core` FDR family, so the v1 comparisons are unchanged; new features are tested in their
 * own families. Values are still one per paper: `granularity` says whether the value describes one section role
 * of the paper or the whole paper.
 */
export const FDR_FAMILIES = ['core', 'structure', 'paragraphs', 'style', 'reasoning'] as const;
export type FdrFamily = (typeof FDR_FAMILIES)[number];

export type FeatureV2 = Omit<Feature, 'granularity'> & {
  granularity: 'paper' | 'section';
  fdrFamily: FdrFamily;
  /**
   * `llm` features count machine labels (claim types, Toulmin elements); the profile reports their machine share.
   * `tool` features come from an external parser (spaCy, P6); null when the paper was not parsed.
   */
  extractor: 'deterministic' | 'llm' | 'tool';
};

export const SYNTAX_TENSES = ['past', 'present', 'future'] as const;

/** Roles an argument run reads: every body role except appendices (`isRhetoricSection`). */
export const CLAIM_SECTIONS = SIGNATURE_SECTIONS.filter((section) => section !== 'APPENDIX');

export const ARGUMENT_ELEMENTS = [
  'with_data',
  'stated_warrant',
  'inferred_warrant',
  'with_qualifier',
  'with_rebuttal',
  'unsupported',
] as const;
export type ArgumentElement = (typeof ARGUMENT_ELEMENTS)[number];

const ARGUMENT_TEXT: Record<ArgumentElement, string> = {
  with_data: 'has at least one data (grounds) span',
  stated_warrant: 'has a warrant quoted from the paper',
  inferred_warrant: "has only the analyst's inferred warrant (none stated)",
  with_qualifier: 'has a qualifier span',
  with_rebuttal: 'has at least one rebuttal span',
  unsupported: 'has no data span, so no premise leads into it',
};

const MACHINE_GATE =
  "Machine labels of the paper's latest argument run, counted only when that run covers every body section except appendices; dismissed arguments excluded.";

const v2 = (
  base: Omit<FeatureV2, 'granularity' | 'fdrFamily' | 'extractor'>,
  fdrFamily: FdrFamily,
  extractor: FeatureV2['extractor'] = 'deterministic',
): FeatureV2 => ({
  ...base,
  granularity: base.section === 'ARTICLE' ? 'paper' : 'section',
  fdrFamily,
  extractor,
});

const MACHINE_V1 = new Set<Feature['family']>(['stance', 'rhetorical', 'scientific']);
const lexicon = (words: readonly string[]) => words.join(', ');

const perSection = (section: SignatureSection): FeatureV2[] => [
  v2(
    {
      id: `section.${section}.presence`,
      family: 'structure',
      section,
      metricType: 'prevalence',
      unit: 'proportion',
      operationalDefinition: 'Whether the paper has body words in a section of this role (1) or not (0).',
    },
    'structure',
  ),
  v2(
    {
      id: `section.${section}.paragraph_count`,
      family: 'paragraph',
      section,
      metricType: 'mean',
      unit: 'paragraphs',
      operationalDefinition:
        'Body blocks (parsed paragraphs, boilerplate removed) in sections of this role; null when the paper has none.',
    },
    'paragraphs',
  ),
  v2(
    {
      id: `section.${section}.paragraph_length`,
      family: 'paragraph',
      section,
      metricType: 'mean',
      unit: 'words per paragraph',
      operationalDefinition:
        'Mean words per body block in sections of this role; null when the paper has none.',
    },
    'paragraphs',
  ),
  ...(['hedges', 'boosters', 'first_person'] as const).map((list) =>
    v2(
      {
        id: `section.${section}.${list}`,
        family: list === 'first_person' ? 'linguistic' : 'stance',
        section,
        metricType: 'rate',
        unit: 'per 1000 words',
        operationalDefinition: `Word-list matches per 1000 body words of sections of this role (${STYLE_LEXICON_VERSION}; not machine labels): ${lexicon(STYLE_LEXICONS[list])}. Null when the role has no words.`,
      },
      'style',
    ),
  ),
];

const claimFeatures = (section: SignatureSection): FeatureV2[] =>
  CLAIM_TYPES.map((type) =>
    v2(
      {
        id: `section.${section}.claim.${type}`,
        family: 'scientific',
        section,
        metricType: 'prevalence',
        unit: 'proportion',
        operationalDefinition: `Whether the paper has at least one claim typed ${type} in a body block of this role (1) or not (0); null when the role is absent. ${MACHINE_GATE}`,
      },
      'reasoning',
      'llm',
    ),
  );

const SYNTAX_GATE =
  'Main clause of each body sentence of this role as parsed by the spaCy service (P6); null when the paper was not parsed or the share has no denominator.';

/** Same ids as `SECTION_SYNTAX_FEATURE_IDS` (syntaxParse imports the registry, so they are rebuilt here). */
const syntaxFeatures = (section: SignatureSection): FeatureV2[] => [
  v2(
    {
      id: `section.${section}.passive`,
      family: 'linguistic',
      section,
      metricType: 'share',
      unit: 'proportion',
      operationalDefinition: `Share of passive main clauses among parsed sentences with a main verb. ${SYNTAX_GATE}`,
    },
    'style',
    'tool',
  ),
  ...SYNTAX_TENSES.map((tense) =>
    v2(
      {
        id: `section.${section}.tense.${tense}`,
        family: 'linguistic',
        section,
        metricType: 'share',
        unit: 'proportion',
        operationalDefinition: `Share of ${tense}-tense main verbs among parsed sentences whose main verb is past, present or future (will/shall → future; other modals and verbless sentences left out). ${SYNTAX_GATE}`,
      },
      'style',
      'tool',
    ),
  ),
];

export const FEATURE_REGISTRY_V2 = {
  id: 'paperlab-feature-registry',
  version: 2,
  features: [
    ...FEATURE_REGISTRY.features.map((feature) =>
      v2(
        {
          id: feature.id,
          family: feature.family,
          section: feature.section,
          metricType: feature.metricType,
          unit: feature.unit,
          operationalDefinition: feature.operationalDefinition,
        },
        'core',
        MACHINE_V1.has(feature.family) ? 'llm' : 'deterministic',
      ),
    ),
    v2(
      {
        id: 'structure.section_count',
        family: 'structure',
        section: 'ARTICLE',
        metricType: 'mean',
        unit: 'sections',
        operationalDefinition:
          'Top-level sections that hold body text (directly or in a subsection), after boilerplate, references and title are removed; the abstract is not counted.',
      },
      'structure',
    ),
    v2(
      {
        id: 'structure.results_discussion_combined',
        family: 'structure',
        section: 'ARTICLE',
        metricType: 'prevalence',
        unit: 'proportion',
        operationalDefinition:
          'Whether a body section heading combines results and discussion ("Results and discussion", "Discussion and results").',
      },
      'structure',
    ),
    v2(
      {
        id: 'structure.other_share',
        family: 'structure',
        section: 'ARTICLE',
        metricType: 'share',
        unit: 'proportion',
        operationalDefinition:
          'Share of body words in sections with no recognised role (OTHER); high values mean the heading table missed the structure.',
      },
      'structure',
    ),
    ...SIGNATURE_SECTIONS.flatMap(perSection),
    ...CLAIM_SECTIONS.flatMap(claimFeatures),
    ...ARGUMENT_ELEMENTS.map((element) =>
      v2(
        {
          id: `argument.${element}`,
          family: 'scientific',
          section: 'ARTICLE',
          metricType: 'prevalence',
          unit: 'proportion',
          operationalDefinition: `Whether at least one main argument ${ARGUMENT_TEXT[element]} (1) or not (0); null with no main argument. Toulmin elements from argumentMetrics. ${MACHINE_GATE}`,
        },
        'reasoning',
        'llm',
      ),
    ),
    ...SIGNATURE_SECTIONS.flatMap(syntaxFeatures),
  ],
  /** Ids held for later slices: listed so consumers can map them, never measured by this registry version. */
  reserved: [] as { id: string; slice: string }[],
} as const;

export function registryV2Digest(registry: typeof FEATURE_REGISTRY_V2 = FEATURE_REGISTRY_V2) {
  return canonicalDigest(registry);
}
