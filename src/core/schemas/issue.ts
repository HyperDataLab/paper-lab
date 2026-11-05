import { z } from 'zod';
import { RoleSpanSchema } from './span';
export const ISSUE_CATEGORY = {
  SUBJECT_VERB_GAP: 'structure',
  PRE_TOPIC_LENGTH: 'structure',
  CLAUSE_DEPTH: 'structure',
  OVERLOADED_SENTENCE: 'structure',
  PASSIVE_PROBLEMATIC: 'word',
  FUZZY_VERB: 'word',
  NOMINALIZATION: 'word',
  WEAK_MODIFIER: 'word',
  UNSUPPORTED_INTENSIFIER: 'word',
  JARGON_UNEXPLAINED: 'word',
  REDUNDANT_PHRASE: 'word',
  METADISCOURSE: 'word',
  OFF_TOPIC_SENTENCE: 'organization',
  CENTRAL_POINT_WEAK: 'organization',
  FLOW_BREAK_CANDIDATE: 'flow',
  UNEXPLAINED_TOPIC_SHIFT: 'flow',
  STRESS_TOPIC_MISALIGNMENT: 'flow',
  MEANING_RISK: 'critical',
} as const;
export const IssueSchema = z.object({
  id: z.string(),
  type: z.enum(
    Object.keys(ISSUE_CATEGORY) as [keyof typeof ISSUE_CATEGORY, ...(keyof typeof ISSUE_CATEGORY)[]],
  ),
  category: z.enum(['structure', 'flow', 'word', 'organization', 'critical']),
  findingKind: z.enum(['confirmed_violation', 'review_candidate', 'stylistic_suggestion']),
  status: z.enum(['candidate', 'confirmed_by_model', 'confirmed_by_human', 'dismissed_by_human']),
  severity: z.enum(['critical', 'major', 'moderate', 'minor', 'info']),
  spans: z.array(RoleSpanSchema).min(1),
  sentenceIds: z.array(z.string()),
  metric: z.object({ name: z.string(), value: z.number().nullable(), unit: z.string().nullable() }),
  why: z.string(),
  suggestedFix: z.string().nullable(),
  sourcePrinciple: z.string(),
  confidence: z.number().min(0).max(1),
});
export type Issue = z.infer<typeof IssueSchema>;
