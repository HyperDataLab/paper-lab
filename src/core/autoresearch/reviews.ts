import { z } from 'zod';
import { score, stageSchema, text, texts, type Charter, type Stage } from './contracts';

const pointSchema = z.strictObject({
  id: text,
  lens: z.enum(['charter', 'risk', 'directive', 'integrity']),
  ref: text,
  itemId: text.nullable(),
  severity: z.enum(['info', 'concern', 'serious']),
  fixClass: z.enum(['fix', 'needs_evidence', 'later']),
  text,
});
export const criticOutputSchema = z.strictObject({
  points: z.array(pointSchema).max(8),
  resolutions: z.array(
    z.strictObject({ pointId: text, status: z.enum(['resolved', 'maintained']), note: text }),
  ),
});
export const criticReportSchema = criticOutputSchema.extend({
  verdict: z.enum(['sound', 'concerns', 'serious']),
});
export type CriticOutput = z.infer<typeof criticOutputSchema>;
export type CriticReport = z.infer<typeof criticReportSchema>;
export const integrityTags = ['post-hoc-criteria', 'spin', 'suppressed-result', 'fabrication', 'leakage'];
export const notebookEntrySchema = z.strictObject({
  id: text,
  kind: z.enum(['directive', 'lesson', 'risk', 'observation', 'question']),
  author: z.enum(['person', 'pi']),
  text,
  at: z.iso.datetime(),
});
export type NotebookEntry = z.infer<typeof notebookEntrySchema>;
export const obligationSchema = z.strictObject({
  id: text,
  sourceStage: stageSchema,
  itemId: text.nullable(),
  findingId: text,
  text,
  targetStage: stageSchema,
  status: z.enum(['open', 'controlled', 'unresolved']),
  locator: text.nullable(),
  note: text.nullable(),
});
export type Obligation = z.infer<typeof obligationSchema>;

export const actions = ['accept', 'send_back', 'rerun', 'stop', 'escalate'] as const;
const action = z.enum(actions);
export const piDecisionSchema = z.strictObject({
  action,
  selectionIds: texts,
  target: stageSchema.nullable(),
  note: text.nullable(),
  rationale: text,
  confidence: score,
  options: z.array(z.strictObject({ action, selectionIds: texts, rationale: text })).min(1),
  answers: z.array(z.strictObject({ pointId: text, response: text })),
  directiveIds: texts,
  problem: z.strictObject({ ref: text, fix: text }).nullable(),
  handoff: texts.max(5),
  notebook: z
    .array(z.strictObject({ kind: z.enum(['lesson', 'risk', 'observation', 'question']), text }))
    .max(8),
});
export type PiDecision = z.infer<typeof piDecisionSchema>;

type CriticContext = {
  charter: Charter;
  notebook: NotebookEntry[];
  obligations: Obligation[];
  previous: CriticReport | null;
  itemIds: string[];
};
type PiContext = {
  allowedActions: readonly PiDecision['action'][];
  itemIds: string[];
  selectableIds: string[];
  sendBackTargets: Stage[];
  directives: NotebookEntry[];
  critic: CriticReport | null;
  stageError: string | null;
};
const unique = (values: string[]) => new Set(values).size === values.length;
const isDirective = (entry: NotebookEntry) => entry.kind === 'directive' && entry.author === 'person';
export function isSerious(point: CriticOutput['points'][number]) {
  return point.severity === 'serious';
}

function resolves(point: CriticOutput['points'][number], context: CriticContext) {
  const prefix = `${point.lens}:`;
  if (!point.ref.startsWith(prefix)) return false;
  const value = point.ref.slice(prefix.length);
  if (point.lens === 'directive') return context.notebook.some((e) => isDirective(e) && e.id === value);
  if (point.lens === 'risk') return context.obligations.some((obligation) => obligation.id === value);
  if (point.lens === 'integrity') return integrityTags.includes(value);
  const match = /^([a-z_]+)(?:\[(0|[1-9]\d*)\])?$/u.exec(value);
  if (!match?.[1] || !Object.hasOwn(context.charter, match[1])) return false;
  const field = context.charter[match[1] as keyof Charter];
  return typeof field === 'string'
    ? match[2] === undefined
    : match[2] !== undefined && Number(match[2]) < field.length;
}

export function guardCritic(report: CriticOutput, context: CriticContext): string[] {
  const errors: string[] = [];
  if (report.points.length > 8) errors.push('TOO_MANY_POINTS');
  if (!unique(report.points.map((p) => p.id))) errors.push('DUPLICATE_POINTS');
  if (report.points.some((p) => !pointSchema.safeParse(p).success)) errors.push('INVALID_POINT');
  if (report.points.some((p) => !resolves(p, context))) errors.push('UNKNOWN_CRITIC_REF');
  if (report.points.some((p) => p.itemId !== null && !context.itemIds.includes(p.itemId)))
    errors.push('UNKNOWN_CRITIC_ITEM');
  const serious = context.previous?.points.filter(isSerious).map((point) => point.id) ?? [];
  const resolved = report.resolutions.map((r) => r.pointId);
  if (
    resolved.length !== serious.length ||
    !unique(resolved) ||
    resolved.some((id) => !serious.includes(id)) ||
    report.resolutions.some((r) => !['resolved', 'maintained'].includes(r.status) || !r.note.trim()) ||
    report.resolutions.some(
      (r) => r.status === 'maintained' && !report.points.some((p) => p.id === r.pointId && isSerious(p)),
    )
  )
    errors.push('INVALID_RESOLUTIONS');
  return errors;
}

export function criticVerdict(points: CriticOutput['points']): CriticReport['verdict'] {
  return points.some(isSerious)
    ? 'serious'
    : points.some((point) => point.severity === 'concern')
      ? 'concerns'
      : 'sound';
}

export function guardPi(decision: PiDecision, context: PiContext): string[] {
  const errors: string[] = [];
  const { action, selectionIds, target, note, rationale, answers, directiveIds, options, problem, handoff } =
    decision;
  const criticPoints = context.critic?.points ?? [];
  const directives = context.directives.filter(isDirective).map((entry) => entry.id);
  if (!actions.includes(action) || !context.allowedActions.includes(action))
    errors.push('ACTION_NOT_ALLOWED');
  const knownSelection = (ids: string[]) =>
    unique(ids) && ids.every((id) => context.selectableIds.includes(id));
  if (!knownSelection(selectionIds) || options.some((option) => !knownSelection(option.selectionIds)))
    errors.push('UNKNOWN_SELECTION');
  if (action === 'send_back' && (!target || !context.sendBackTargets.includes(target) || !note?.trim()))
    errors.push('INVALID_SEND_BACK');
  if (!rationale.trim()) errors.push('RATIONALE_REQUIRED');
  if (
    criticPoints.some(
      (p) => isSerious(p) && answers.filter((a) => a.pointId === p.id && a.response.trim()).length !== 1,
    ) ||
    !unique(answers.map((a) => a.pointId)) ||
    answers.some((a) => !criticPoints.some((p) => p.id === a.pointId))
  )
    errors.push('CRITIC_ANSWER_REQUIRED');
  if (
    action !== 'escalate' &&
    (!unique(directiveIds) ||
      directives.length !== directiveIds.length ||
      directiveIds.some((id) => !directives.includes(id)))
  )
    errors.push('DIRECTIVE_CITATION_REQUIRED');
  const reject = action === 'send_back' || action === 'rerun' || action === 'stop';
  if (
    reject &&
    (!problem?.fix.trim() ||
      !(
        problem.ref === context.stageError ||
        criticPoints.some((p) => p.id === problem.ref && p.fixClass !== 'later') ||
        context.itemIds.includes(problem.ref)
      ))
  )
    errors.push('FIXABLE_PROBLEM_REQUIRED');
  if (
    reject &&
    context.selectableIds.length &&
    !options.some(
      (o) =>
        o.action === 'accept' &&
        o.rationale.trim() &&
        ((o.selectionIds.length > 0 && o.selectionIds.length < context.selectableIds.length) ||
          (context.selectableIds.length === 1 && o.selectionIds.length === 0)),
    )
  )
    errors.push('PARTIAL_ACCEPT_REQUIRED');
  if (handoff.length > 5 || handoff.some((line) => /[\r\n\u2028\u2029]/u.test(line)))
    errors.push('HANDOFF_TOO_LONG');
  return errors;
}
