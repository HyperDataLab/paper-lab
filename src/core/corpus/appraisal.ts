import type { Corpus, CorpusMember } from '../schemas';
import { isIncluded } from './screening';

/**
 * MMAT 2018 (Hong et al.): two screening questions, then the five criteria of the study's category. Ids follow
 * the tool; the English text is a short form for exports, not the tool's wording, and the Vietnamese labels live
 * in the module.
 */
export const MMAT_TOOL = 'MMAT-2018';
export const MMAT_JUDGEMENTS = ['yes', 'no', 'cant_tell'] as const;
export type MmatJudgement = (typeof MMAT_JUDGEMENTS)[number];
export type MmatCriterion = { id: string; short: string };

export const MMAT_SCREENING: MmatCriterion[] = [
  { id: 'S1', short: 'clear research questions' },
  { id: 'S2', short: 'data address the questions' },
];
export const MMAT_CATEGORIES = [
  {
    id: 'qualitative',
    short: 'qualitative',
    criteria: [
      { id: '1.1', short: 'approach appropriate' },
      { id: '1.2', short: 'data collection adequate' },
      { id: '1.3', short: 'findings derived from data' },
      { id: '1.4', short: 'interpretation substantiated' },
      { id: '1.5', short: 'coherence throughout' },
    ],
  },
  {
    id: 'quantitative-randomised',
    short: 'quantitative randomised',
    criteria: [
      { id: '2.1', short: 'randomisation appropriate' },
      { id: '2.2', short: 'groups comparable at baseline' },
      { id: '2.3', short: 'outcome data complete' },
      { id: '2.4', short: 'assessors blinded' },
      { id: '2.5', short: 'adherence to intervention' },
    ],
  },
  {
    id: 'quantitative-non-randomised',
    short: 'quantitative non-randomised',
    criteria: [
      { id: '3.1', short: 'participants representative' },
      { id: '3.2', short: 'measurements appropriate' },
      { id: '3.3', short: 'outcome data complete' },
      { id: '3.4', short: 'confounders accounted for' },
      { id: '3.5', short: 'exposure as intended' },
    ],
  },
  {
    id: 'quantitative-descriptive',
    short: 'quantitative descriptive',
    criteria: [
      { id: '4.1', short: 'sampling strategy relevant' },
      { id: '4.2', short: 'sample representative' },
      { id: '4.3', short: 'measurements appropriate' },
      { id: '4.4', short: 'nonresponse bias low' },
      { id: '4.5', short: 'analysis appropriate' },
    ],
  },
  {
    id: 'mixed-methods',
    short: 'mixed methods',
    criteria: [
      { id: '5.1', short: 'rationale for mixing' },
      { id: '5.2', short: 'components integrated' },
      { id: '5.3', short: 'integration interpreted' },
      { id: '5.4', short: 'divergences addressed' },
      { id: '5.5', short: 'each component meets its criteria' },
    ],
  },
] as const satisfies readonly { id: string; short: string; criteria: readonly MmatCriterion[] }[];
export type MmatCategory = (typeof MMAT_CATEGORIES)[number]['id'];
export const CATEGORY_DOMAIN = 'category';

export const categoryOf = (id: string) => MMAT_CATEGORIES.find((category) => category.id === id);
export const isJudgement = (value: string): value is MmatJudgement =>
  (MMAT_JUDGEMENTS as readonly string[]).includes(value);

export type MmatAnswer = { judgement: MmatJudgement; quote?: string; note?: string };
export type AppraisalInput = {
  category: MmatCategory | '';
  /** Keyed by S1, S2 and the category's criterion ids. */
  answers: Partial<Record<string, MmatAnswer>>;
  appraiser: string;
};
export type AppraisalError =
  'unknown-member' | 'not-included' | 'appraiser-required' | 'category-required' | 'answers-incomplete';
export type AppraisalResult = { ok: true; corpus: Corpus } | { ok: false; error: AppraisalError };

/** MMAT: when a screening question is No or Can't tell, further appraisal may not be feasible, so it is optional. */
export const criteriaRequired = (answers: AppraisalInput['answers']) =>
  MMAT_SCREENING.every((question) => answers[question.id]?.judgement === 'yes');

/** Appends one appraisal: the category plus every answer, sharing one timestamp so the latest set is read whole. */
export function recordAppraisal(
  corpus: Corpus,
  memberId: string,
  input: AppraisalInput,
  at: string,
): AppraisalResult {
  const member = corpus.members.find((item) => item.memberId === memberId);
  if (!member) return { ok: false, error: 'unknown-member' };
  if (!isIncluded(member)) return { ok: false, error: 'not-included' };
  const appraiser = input.appraiser.trim();
  if (!appraiser) return { ok: false, error: 'appraiser-required' };
  const category = input.category ? categoryOf(input.category) : undefined;
  if (!category) return { ok: false, error: 'category-required' };
  const screening = MMAT_SCREENING.map((question) => question.id);
  const criteria = category.criteria.map((criterion) => criterion.id);
  const required = criteriaRequired(input.answers) ? [...screening, ...criteria] : screening;
  if (required.some((id) => !input.answers[id])) return { ok: false, error: 'answers-incomplete' };
  const entries = [...screening, ...criteria].flatMap((domain) => {
    const answer = input.answers[domain];
    if (!answer) return [];
    const quote = answer.quote?.trim();
    const note = answer.note?.trim();
    return [
      {
        tool: MMAT_TOOL,
        domain,
        judgement: answer.judgement,
        ...(quote ? { quote } : {}),
        ...(note ? { note } : {}),
        appraiser,
        at,
      },
    ];
  });
  const appraisal = [
    { tool: MMAT_TOOL, domain: CATEGORY_DOMAIN, judgement: category.id, appraiser, at },
    ...entries,
  ];
  return {
    ok: true,
    corpus: {
      ...corpus,
      updatedAt: at,
      members: corpus.members.map((item) =>
        item.memberId === memberId ? { ...item, appraisal: [...item.appraisal, ...appraisal] } : item,
      ),
    },
  };
}

export type CurrentAppraisal = {
  category: (typeof MMAT_CATEGORIES)[number];
  appraiser: string;
  at: string;
  answers: Partial<Record<string, MmatAnswer>>;
  counts: Record<MmatJudgement, number>;
};

/** The latest saved appraisal; earlier ones stay in the log. Counts cover the five criteria only. */
export function currentAppraisal(member: CorpusMember): CurrentAppraisal | undefined {
  const mmat = member.appraisal.filter((entry) => entry.tool === MMAT_TOOL);
  const head = mmat.reduce<(typeof mmat)[number] | undefined>(
    (latest, entry) =>
      entry.domain === CATEGORY_DOMAIN && (!latest || entry.at >= latest.at) ? entry : latest,
    undefined,
  );
  const category = head && categoryOf(head.judgement);
  if (!head || !category) return undefined;
  const answers: CurrentAppraisal['answers'] = {};
  for (const entry of mmat)
    if (entry.at === head.at && entry.domain !== CATEGORY_DOMAIN && isJudgement(entry.judgement))
      answers[entry.domain] = { judgement: entry.judgement, quote: entry.quote, note: entry.note };
  const counts: Record<MmatJudgement, number> = { yes: 0, no: 0, cant_tell: 0 };
  for (const criterion of category.criteria) {
    const answer = answers[criterion.id];
    if (answer) counts[answer.judgement]++;
  }
  return { category, appraiser: head.appraiser, at: head.at, answers, counts };
}

export const includedMembers = (corpus: Corpus) => corpus.members.filter(isIncluded);

const CSV_HEADER = [
  'member',
  'title',
  'tool',
  'category',
  'item',
  'item short form',
  'judgement',
  'quote',
  'note',
  'appraiser',
  'at',
];

/** One row per answer of each included study's latest appraisal. No overall score: MMAT advises against one. */
export function appraisalCsvRows(corpus: Corpus): string[][] {
  const rows = includedMembers(corpus).flatMap((member) => {
    const current = currentAppraisal(member);
    if (!current) return [];
    return [...MMAT_SCREENING, ...current.category.criteria].flatMap((item) => {
      const answer = current.answers[item.id];
      return answer
        ? [
            [
              member.exportId,
              member.title ?? member.identifiers.doi ?? '',
              MMAT_TOOL,
              current.category.id,
              item.id,
              item.short,
              answer.judgement,
              answer.quote ?? '',
              answer.note ?? '',
              current.appraiser,
              current.at,
            ],
          ]
        : [];
    });
  });
  return [CSV_HEADER, ...rows];
}
