import type { Section } from '../schemas/paper';

type Role = Section['role'];

/**
 * Heading patterns → section role, tried in order (specific before generic). Deterministic, no model.
 * Patterns run on the heading with its numbering removed ("4.1", "IV.", "A.").
 *
 * Two uses, kept apart because a known heading is accepted by the segmenter even when unnumbered, in title case
 * and at body height:
 * - Role (`headingRole`): the full table, including a short qualifier tail ("Experiments on benchmark datasets"),
 *   for any line already accepted as a heading.
 * - Cue (`headingCue`): what alone makes an unnumbered line a heading. It ignores the tail, skips bare generic
 *   words ("Data", "Analysis", "Comparison", "Approach", "Framework", "Baselines", "Implementation", "Summary")
 *   and does not strip letter numbering, so wrapped body lines and figure labels stay body text.
 * The older prefix patterns stay prefix matches for both ("Results on X" is results).
 *
 * Judgement calls, made because the role set has no slot for them:
 * - "Experiments", "Experimental results/evaluation/study", "Evaluation", "Performance evaluation",
 *   "Case study" → results. "Experimental setup/settings", "Datasets", "Implementation details" → methods.
 * - "Proposed method/approach/framework/model", "Problem formulation/definition/statement" → methods.
 * - "Background", "Preliminaries", "Literature review", "State of the art" → related_work.
 * - "Limitations", "Threats to validity" → discussion. "Future work", "Summary" → conclusion.
 * - Back matter (competing interests, CRediT, data availability, funding) → other, but known, so it is split
 *   off as its own section instead of running on inside the conclusion.
 */
const PROPOSED = String.raw`(?:(?:the|our)\s+)?(?:proposed|presented|suggested)`;
const METHOD_NOUN = String.raw`(?:methods?|methodology|methodologies|approach(?:es)?|frameworks?|models?|systems?|algorithms?|schemes?|techniques?|architectures?|solutions?)`;
/** A short qualifier: "Experiments on benchmark datasets", "The proposed model for fault diagnosis". */
const TAIL = String.raw`(?:\s+(?:of|for|on|and|in|with|to)\s+[^.,;:!?]{1,45})?`;

/** `<T>` in a body stands for the optional tail. */
type Row = { build: (tail: string) => RegExp; role: Role; cue: boolean };
const prefix = (pattern: RegExp, role: Role): Row => ({ build: () => pattern, role, cue: true });
const full = (body: string, role: Role, cue = true): Row => ({
  build: (tail) => new RegExp(String.raw`^(?:${body.replaceAll('<T>', tail)})$`, 'i'),
  role,
  cue,
});

const ROWS: Row[] = [
  prefix(/^abstract\b/i, 'abstract'),
  prefix(/^introduction\b/i, 'introduction'),
  // Methods: experimental setup must be tried before the generic experiments → results entry.
  prefix(/^(materials? and methods?|methods?|methodology|experimental (setup|design))\b/i, 'methods'),
  full(
    String.raw`experiment(?:al)?\s+(?:set-?ups?|settings?|configurations?|protocols?|details|design)<T>`,
    'methods',
  ),
  full(String.raw`${PROPOSED}\s+${METHOD_NOUN}<T>`, 'methods'),
  full(String.raw`research\s+(?:methodology|methods?|design)<T>`, 'methods'),
  full(String.raw`(?:approach|framework)<T>`, 'methods', false),
  full(String.raw`problem\s+(?:formulation|definition|statement|description|setting)<T>`, 'methods'),
  full(
    String.raw`(?:data\s*sets?|data\s+(?:collection|description|preparation)|implementation\s+details|evaluation\s+(?:metrics|measures|criteria)|parameter\s+settings?)<T>`,
    'methods',
  ),
  full(String.raw`(?:data|implementation|baselines?(?:\s+methods)?)<T>`, 'methods', false),
  // Combined headings: results first, so the primary role is results.
  full(String.raw`(?:results?|findings|experimental\s+results?)\s*(?:and|&)\s*discussions?<T>`, 'results'),
  full(String.raw`discussions?\s*(?:and|&)\s*(?:results?|findings)<T>`, 'results'),
  prefix(/^(results?|findings)\b/i, 'results'),
  full(
    String.raw`experiments?<T>|experimental\s+(?:results?|evaluations?|studies|study|analysis|analyses|comparisons?|validation)<T>`,
    'results',
  ),
  full(
    String.raw`(?:performance|empirical|experimental|comparative)\s+(?:evaluation|analysis|comparison)<T>|evaluation<T>|case\s+stud(?:y|ies)<T>|ablation\s+stud(?:y|ies)<T>`,
    'results',
  ),
  full(String.raw`(?:analysis|comparison)<T>`, 'results', false),
  full(
    String.raw`(?:discussions?\s*(?:and|&)\s*conclusions?|conclusions?\s*(?:and|&)\s*discussions?)<T>`,
    'discussion',
  ),
  prefix(/^discussion\b/i, 'discussion'),
  full(
    String.raw`limitations?(?:\s*(?:and|&)\s*(?:future\s+(?:work|research|directions?)|implications))?|threats\s+to\s+validity`,
    'discussion',
  ),
  prefix(/^(conclusions?|concluding remarks)\b/i, 'conclusion'),
  full(
    String.raw`future\s+(?:work|research|directions?)|conclusions?\s+and\s+future\s+(?:work|research|directions?)`,
    'conclusion',
  ),
  full(String.raw`summary(?:\s+and\s+conclusions?)?`, 'conclusion', false),
  prefix(/^(related work|background|literature review|prior work)\b/i, 'related_work'),
  full(
    String.raw`related\s+works<T>|theoretical\s+background<T>|preliminar(?:y|ies)<T>|(?:review\s+of\s+(?:the\s+)?literature|literature\s+survey|state\s+of\s+the\s+art)<T>`,
    'related_work',
  ),
  prefix(/^(references|bibliography|works cited)\b/i, 'references'),
  prefix(/^appendix\b/i, 'appendix'),
  prefix(/^acknowledg(?:e)?ments?\b/i, 'other'),
  full(
    String.raw`declarations?\s+of\s+(?:competing\s+)?interests?|competing\s+interests?|conflicts?\s+of\s+interests?|credit\s+authorship\s+contribution\s+statement|author\s+contributions?|data\s+availability(?:\s+statement)?|funding(?:\s+(?:information|statement|sources?))?`,
    'other',
  ),
];

export const SECTION_ROLE_PATTERNS: readonly [RegExp, Role][] = ROWS.map((row) => [
  row.build(TAIL),
  row.role,
]);
const CUE_PATTERNS: readonly RegExp[] = ROWS.filter((row) => row.cue).map((row) => row.build(''));

const NUMBER = /^(?:\d+(?:\.\d+)*\.?|[IVXL]+\.)\s+/u;
const NUMBER_OR_LETTER = /^(?:\d+(?:\.\d+)*\.?|[IVXL]+\.|[A-Z]\.(?:\d+(?:\.\d+)*\.?)?)\s+/u;

/** Drops a leading section number ("4.1", "4.1.", "IV.", "A.", "A.1") so the role table sees the bare name. */
export function bareHeading(text: string) {
  return text.trim().replace(NUMBER_OR_LETTER, '').trim();
}

/** The role a heading names, or null when the table does not know it (the segmenter then inherits). */
export function headingRole(text: string): Role | null {
  const name = bareHeading(text);
  return SECTION_ROLE_PATTERNS.find(([pattern]) => pattern.test(name))?.[1] ?? null;
}

/** Whether the line's wording alone marks it as a heading (no tail, no bare generic word, no letter numbering). */
export function headingCue(text: string): boolean {
  const name = text.trim().replace(NUMBER, '').trim();
  return CUE_PATTERNS.some((pattern) => pattern.test(name));
}

const COMBINED: readonly [RegExp, Role[]][] = [
  [/^(?:results?|findings|experimental\s+results?)\s*(?:and|&)\s*discussions?\b/i, ['results', 'discussion']],
  [/^discussions?\s*(?:and|&)\s*(?:results?|findings)\b/i, ['results', 'discussion']],
  [
    /^(?:discussions?\s*(?:and|&)\s*conclusions?|conclusions?\s*(?:and|&)\s*discussions?)\b/i,
    ['discussion', 'conclusion'],
  ],
];

/** The roles a combined heading such as "Results and discussion" covers, or undefined for a single-role heading. */
export function combinedRoles(text: string): Role[] | undefined {
  const name = bareHeading(text);
  return COMBINED.find(([pattern]) => pattern.test(name))?.[1];
}
