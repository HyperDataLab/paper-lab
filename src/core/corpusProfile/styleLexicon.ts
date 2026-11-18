import { tokenize } from '../text/tokenize';

/** Bump when a list or the matching below changes: counts are only comparable within one version. */
export const STYLE_LEXICON_VERSION = 'paperlab-style-lexicon-1';

/**
 * Single-word stance markers in the spirit of Hyland's metadiscourse lists (writing-bank doc 39 §3: "đếm theo danh
 * sách từ"). A deterministic proxy, not the stance labeller: it counts every use, including non-stance senses such
 * as "may" in "May 2020". `first_person` leaves out "I" (Roman numerals, "Type I") and counts "us" only in lower
 * case ("US" is a country).
 */
export const STYLE_LEXICONS = {
  hedges: [
    'apparently',
    'appear',
    'appeared',
    'appears',
    'approximately',
    'assume',
    'could',
    'generally',
    'likely',
    'may',
    'might',
    'perhaps',
    'plausible',
    'plausibly',
    'possible',
    'possibly',
    'potentially',
    'presumably',
    'probably',
    'relatively',
    'roughly',
    'seem',
    'seemed',
    'seems',
    'somewhat',
    'suggest',
    'suggested',
    'suggests',
    'tend',
    'tends',
    'typically',
    'unlikely',
  ],
  boosters: [
    'certainly',
    'clearly',
    'conclusively',
    'definitely',
    'demonstrate',
    'demonstrated',
    'demonstrates',
    'evident',
    'evidently',
    'indeed',
    'obviously',
    'prove',
    'proved',
    'proves',
    'proven',
    'surely',
    'undoubtedly',
  ],
  first_person: ['me', 'mine', 'my', 'myself', 'our', 'ours', 'ourselves', 'us', 'we'],
} as const;
export type StyleList = keyof typeof STYLE_LEXICONS;

const SETS = Object.fromEntries(
  Object.entries(STYLE_LEXICONS).map(([list, words]) => [list, new Set<string>(words)]),
) as Record<StyleList, Set<string>>;

/** Word count and matches per list in one text, with the tokenizer the profile uses for word counts. */
export function styleCounts(text: string): { words: number } & Record<StyleList, number> {
  const counts = { words: 0, hedges: 0, boosters: 0, first_person: 0 };
  for (const token of tokenize(text)) {
    if (token.kind !== 'word') continue;
    counts.words++;
    const word = token.text.normalize('NFKC').toLowerCase().replace(/’/gu, "'");
    if (SETS.hedges.has(word)) counts.hedges++;
    if (SETS.boosters.has(word)) counts.boosters++;
    if (SETS.first_person.has(word) && (word !== 'us' || token.text === 'us')) counts.first_person++;
  }
  return counts;
}
