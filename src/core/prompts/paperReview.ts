import { z } from 'zod';
import type { Paper } from '../schemas/paper';

export const LENSES = {
  methods_skeptic: {
    label: 'Phương pháp',
    description:
      'Examine whether the methods and evidence support the reported claims, identifying specific limitations without inventing results.',
  },
  clarity_editor: {
    label: 'Biên tập rõ ràng',
    description: 'Examine writing clarity and the flow of ideas using the principles of Writing Science.',
  },
  reproducibility_auditor: {
    label: 'Khả năng tái lập',
    description:
      'Examine whether reported procedures and materials provide enough detail to reproduce the work.',
  },
  newcomer_reader: {
    label: 'Người đọc mới',
    description:
      'Read as an informed researcher outside the subfield and identify passages needing context or explanation.',
  },
  limitations_ethics: {
    label: 'Giới hạn và đạo đức',
    description: 'Examine reported limitations and ethical considerations, grounded in the manuscript.',
  },
} as const;
export const LensSchema = z.enum([
  'methods_skeptic',
  'clarity_editor',
  'reproducibility_auditor',
  'newcomer_reader',
  'limitations_ethics',
]);
export type Lens = z.infer<typeof LensSchema>;
export const ReviewDimensionSchema = z.enum([
  'soundness',
  'clarity',
  'reproducibility',
  'significance',
  'originality',
  'limitations_ethics',
  'citations',
]);
export const ReviewPointSchema = z.object({
  kind: z.enum(['strength', 'weakness', 'question', 'needs_evidence']),
  dimension: ReviewDimensionSchema,
  paragraphId: z.string(),
  quote: z.string(),
  point: z.string(),
  rationale: z.string(),
  severity: z.enum(['minor', 'moderate', 'major']),
  confidence: z.number().min(0).max(1),
});
export const PaperReviewOutputSchema = z.object({
  lens: LensSchema,
  summary: z.string(),
  points: z.array(ReviewPointSchema),
  unanchored: z.array(z.object({ point: z.string(), reason: z.string() })),
  cannotJudge: z.array(z.object({ dimension: ReviewDimensionSchema, reason: z.string() })),
});
export type PaperReviewOutput = z.infer<typeof PaperReviewOutputSchema>;
export type ReviewPoint = z.infer<typeof ReviewPointSchema>;

export function buildPaperReviewPrompt(
  paper: Paper,
  options: { lens: Lens; sectionIds: string[]; checkSummary: string },
) {
  const selected = new Set(options.sectionIds);
  const provided = paper.sections.filter((s) => selected.has(s.id));
  const missing = paper.sections.filter((s) => !selected.has(s.id));
  const paragraphs = paper.paragraphs.filter((p) => selected.has(p.sectionId) && p.kind === 'body');
  if (paragraphs.reduce((sum, p) => sum + p.text.length, 0) > 60000)
    throw new Error('Vui lòng chọn ít phần hơn (tối đa 60.000 ký tự).');
  const sections = (items: Paper['sections']) =>
    items.map((s) => `${s.id} | ${s.role} | ${s.heading}`).join('; ') || 'none';
  return {
    system: `You are one reviewer in a panel that helps authors improve a manuscript before submission.
Your lens: ${LENSES[options.lens].description.replace(/\.$/u, '')}. Other reviewers cover other lenses; do not try to cover everything.

Rules:
- You advise the authors. You do not decide acceptance and you do not give an overall rating.
- Every point must quote the manuscript verbatim (5–40 words) in "quote" and name the paragraph id it comes from.
  If you cannot quote supporting text, put the point in "unanchored" and say why.
- Be specific to this manuscript. Do not use stock phrases that would fit any paper
  (for example "honest discussion of limitations", "it is not fully clear whether", "there is no comparison to")
  unless you immediately say exactly what is missing and where.
- Keep separate: writing clarity, scientific soundness, reproducibility, and ethics/limitations.
- Do not invent results, numbers, citations, experiments or proofs, and do not suggest that the authors add
  results they have not reported. You may ask for evidence ("needs_evidence").
- Prefer fewer, consequential points over many minor ones. Say "cannot judge" when the provided sections or your
  knowledge are insufficient (for example novelty without the related-work landscape).
- Write "point" and "rationale" in Vietnamese; keep quotes in the manuscript's language.

Sections provided: ${sections(provided)}. Sections not provided: ${sections(missing)}.
Deterministic check results (already verified by code): ${options.checkSummary}.`,
    user: [
      paper.sections.map((s) => `${s.id} | ${s.role} | ${s.heading}`).join('\n'),
      ...paragraphs.map((p) => `${p.id} | ${JSON.stringify(p.text)}`),
    ].join('\n'),
  };
}
