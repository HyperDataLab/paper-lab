import { bodySentences } from '../corpusProfile/measure';
import { SECTION_MAP, SIGNATURE_SECTIONS, type SignatureSection } from '../corpusProfile/registry';
import type { PaperModel } from '../schemas/paperModel';
import type { ParsedSentence } from './schema';

const SHARED_TENSES = ['past', 'present', 'future'] as const;
export type SharedTense = (typeof SHARED_TENSES)[number];

/**
 * Feature ids reserved for the corpus-profile registry (slice P2 wires them in; this slice does not touch the
 * registry). Values come from `sectionSyntaxFeatures`.
 */
export const SECTION_SYNTAX_FEATURE_IDS = SIGNATURE_SECTIONS.flatMap((section) => [
  `section.${section}.passive`,
  ...SHARED_TENSES.map((tense) => `section.${section}.tense.${tense}`),
]);

export type SectionSyntaxMeasure = {
  /** Body sentences in the section (same selection as `section.<ROLE>.sentence_length`). */
  sentences: number;
  /** Of those, how many the parser returned. */
  parsed: number;
  /** Denominator of `passiveShare`: parsed sentences with a main verb (voice not null). */
  voiced: number;
  /** Denominator of `tenseShares`: parsed sentences whose tense is past, present or future (not `none`). */
  tensed: number;
  /** Null when `voiced` is 0. */
  passiveShare: number | null;
  /** Sums to 1; null when `tensed` is 0. Modal (`none`) and verbless sentences are left out. */
  tenseShares: Record<SharedTense, number> | null;
};

/**
 * Per signature section, the share of passive main clauses and the past/present/future split of main-clause tense.
 * `parsed` holds spaCy results keyed by the paper model's sentence content key; missing keys count as unparsed.
 */
export function measureSectionSyntax(
  model: PaperModel,
  parsed: ReadonlyMap<string, Pick<ParsedSentence, 'voice' | 'tense'>>,
): Record<SignatureSection, SectionSyntaxMeasure> {
  const roles = new Map(model.document.sections.map((section) => [section.id, SECTION_MAP[section.role]]));
  const sentences = bodySentences(model);
  return Object.fromEntries(
    SIGNATURE_SECTIONS.map((section) => {
      const own = sentences.filter((sentence) => roles.get(sentence.sectionId) === section);
      const results = own.flatMap((sentence) => {
        const value = parsed.get(sentence.key);
        return value ? [value] : [];
      });
      const voiced = results.filter((r) => r.voice !== null);
      const tensed = results.filter((r) => r.tense !== 'none');
      const measure: SectionSyntaxMeasure = {
        sentences: own.length,
        parsed: results.length,
        voiced: voiced.length,
        tensed: tensed.length,
        passiveShare: voiced.length
          ? voiced.filter((r) => r.voice === 'passive').length / voiced.length
          : null,
        tenseShares: tensed.length
          ? (Object.fromEntries(
              SHARED_TENSES.map((tense) => [
                tense,
                tensed.filter((r) => r.tense === tense).length / tensed.length,
              ]),
            ) as Record<SharedTense, number>)
          : null,
      };
      return [section, measure];
    }),
  ) as Record<SignatureSection, SectionSyntaxMeasure>;
}

/** The measures as reserved feature values (`SECTION_SYNTAX_FEATURE_IDS`); null where a share is undefined. */
export function sectionSyntaxFeatures(
  measures: Record<SignatureSection, SectionSyntaxMeasure>,
): Record<string, number | null> {
  const result: Record<string, number | null> = {};
  for (const section of SIGNATURE_SECTIONS) {
    const measure = measures[section];
    result[`section.${section}.passive`] = measure.passiveShare;
    for (const tense of SHARED_TENSES)
      result[`section.${section}.tense.${tense}`] = measure.tenseShares?.[tense] ?? null;
  }
  return result;
}
