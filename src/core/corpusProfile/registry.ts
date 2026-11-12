import { CLAIM_TYPES } from '../argument/claimTypes';
import { canonicalDigest } from '../corpus';
import { RHETORIC_CATEGORIES } from '../schemas/paperInsights';
import type { PaperModelSection } from '../schemas/paperModel';

export const SECTION_MAP = {
  title: 'OTHER',
  abstract: 'ABSTRACT',
  introduction: 'INTRODUCTION',
  related_work: 'RELATED_WORK',
  methods: 'METHODS',
  results: 'RESULTS',
  discussion: 'DISCUSSION',
  conclusion: 'CONCLUSION',
  references: 'OTHER',
  appendix: 'APPENDIX',
  other: 'OTHER',
} as const satisfies Record<PaperModelSection['role'], string>;
export const SIGNATURE_SECTIONS = [
  'ABSTRACT',
  'INTRODUCTION',
  'RELATED_WORK',
  'METHODS',
  'RESULTS',
  'DISCUSSION',
  'CONCLUSION',
  'OTHER',
  'APPENDIX',
] as const;
export type SignatureSection = (typeof SIGNATURE_SECTIONS)[number];
export type Feature = {
  id: string;
  family: 'structure' | 'paragraph' | 'linguistic' | 'citation' | 'stance' | 'rhetorical' | 'scientific';
  section: SignatureSection | 'ARTICLE';
  granularity: 'paper';
  metricType: 'share' | 'mean' | 'rate' | 'prevalence';
  unit: string;
  operationalDefinition: string;
};

const feature = (
  id: string,
  family: Feature['family'],
  section: Feature['section'],
  metricType: Feature['metricType'],
  unit: string,
  operationalDefinition: string,
): Feature => ({ id, family, section, granularity: 'paper', metricType, unit, operationalDefinition });

export const FEATURE_REGISTRY = {
  id: 'paperlab-feature-registry',
  version: 1,
  features: [
    ...SIGNATURE_SECTIONS.flatMap((section) => [
      feature(
        `section.${section}.word_share`,
        'structure',
        section,
        'share',
        'proportion',
        'Section body words divided by article body words.',
      ),
      feature(
        `section.${section}.sentence_length`,
        'linguistic',
        section,
        'mean',
        'words per sentence',
        'Mean words per indexed body sentence in the section.',
      ),
    ]),
    feature(
      'paragraph.length',
      'paragraph',
      'ARTICLE',
      'mean',
      'words per paragraph',
      'Mean words per body block.',
    ),
    feature(
      'citation.rate',
      'citation',
      'ARTICLE',
      'rate',
      'per 100 words',
      'Citation markers per 100 body words.',
    ),
    ...(['hedges', 'boosters'] as const).map((label) =>
      feature(
        `stance.${label}`,
        'stance',
        'ARTICLE',
        'rate',
        'per 1000 words',
        `Non-rejected ${label} annotations per 1000 words of the body sections the stance labeller reads (appendices and boilerplate excluded); machine labels included.`,
      ),
    ),
    ...RHETORIC_CATEGORIES.map((label) =>
      feature(
        `rhetoric.${label}`,
        'rhetorical',
        'ARTICLE',
        'prevalence',
        'proportion',
        `Presence of a non-rejected ${label} annotation in the paper; machine labels included.`,
      ),
    ),
    ...CLAIM_TYPES.map((label) =>
      feature(
        `claim.${label}`,
        'scientific',
        'ARTICLE',
        'share',
        'proportion',
        `Share of typed claims labelled ${label} in argument runs; machine labels.`,
      ),
    ),
  ],
} as const;

export function registryDigest(registry: typeof FEATURE_REGISTRY = FEATURE_REGISTRY): Promise<string> {
  return canonicalDigest(registry);
}
