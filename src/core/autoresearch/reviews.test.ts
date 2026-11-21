import { expect, it, vi } from 'vitest';
import { AGENT_STEP_LIMITS, AgentStepLimitError, emptyProgress, runAgent } from './agent-loop';
import { at, charter, critic, pi, seriousPoint } from './fixtures';
import {
  criticOutputSchema,
  criticVerdict,
  guardCritic,
  guardPi,
  piDecisionSchema,
  type NotebookEntry,
} from './reviews';

const directive: NotebookEntry = {
  id: 'rule-a',
  kind: 'directive',
  text: 'Use simulation.',
  author: 'person',
  at,
};
const report = { ...critic, points: [seriousPoint], verdict: 'serious' as const };
const piContext = {
  allowedActions: piDecisionSchema.shape.action.options,
  itemIds: ['item-a', 'item-b'],
  selectableIds: ['item-a', 'item-b'],
  sendBackTargets: ['S1' as const],
  directives: [directive],
  critic: report,
  stageError: null,
};
const advice = {
  ...pi,
  directiveIds: ['rule-a'],
  answers: [{ pointId: seriousPoint.id, response: 'Use a fixed allocation.' }],
};
const reviewContext = {
  charter,
  notebook: [directive],
  obligations: [
    {
      id: 'risk-a',
      itemId: null,
      findingId: 'point-a',
      locator: null,
      note: null,
      text: 'Randomize reviewers.',
      sourceStage: 'S1' as const,
      targetStage: 'S2' as const,
      status: 'open' as const,
    },
  ],
  previous: null,
  itemIds: ['item-a'],
};

it('guards PI action, item selection in decisions and options, target, rationale, serious replies, directives and handoff', () => {
  expect(guardPi(advice, piContext)).toEqual([]);
  expect(guardPi({ ...advice, action: 'accept' }, { ...piContext, allowedActions: ['escalate'] })).toContain(
    'ACTION_NOT_ALLOWED',
  );
  expect(guardPi({ ...advice, selectionIds: ['unknown'] }, piContext)).toContain('UNKNOWN_SELECTION');
  expect(
    guardPi(
      {
        ...advice,
        options: [{ ...advice.options[0], action: 'accept', rationale: 'Reason', selectionIds: ['unknown'] }],
      },
      piContext,
    ),
  ).toContain('UNKNOWN_SELECTION');
  expect(guardPi({ ...advice, action: 'send_back', target: 'S2', note: null }, piContext)).toContain(
    'INVALID_SEND_BACK',
  );
  expect(guardPi({ ...advice, action: 'send_back', target: 'S1', note: '' }, piContext)).toContain(
    'INVALID_SEND_BACK',
  );
  expect(guardPi({ ...advice, rationale: ' ' }, piContext)).toContain('RATIONALE_REQUIRED');
  expect(guardPi({ ...advice, answers: [] }, piContext)).toContain('CRITIC_ANSWER_REQUIRED');
  expect(guardPi({ ...advice, answers: [...advice.answers, ...advice.answers] }, piContext)).toContain(
    'CRITIC_ANSWER_REQUIRED',
  );
  expect(guardPi({ ...advice, directiveIds: ['unknown'] }, piContext)).toContain(
    'DIRECTIVE_CITATION_REQUIRED',
  );
  expect(guardPi({ ...advice, handoff: ['one\ntwo'] }, piContext)).toContain('HANDOFF_TOO_LONG');
  expect(guardPi({ ...advice, handoff: Array.from({ length: 6 }, () => 'Line') }, piContext)).toContain(
    'HANDOFF_TOO_LONG',
  );
});

it.each(['send_back', 'rerun', 'stop'] as const)(
  'requires a fixable problem and partial acceptance for %s',
  (action) => {
    const decision = { ...advice, action, target: 'S1' as const, note: 'Fix the allocation.' };
    expect(guardPi(decision, piContext)).toEqual(['FIXABLE_PROBLEM_REQUIRED', 'PARTIAL_ACCEPT_REQUIRED']);
    expect(
      guardPi(
        {
          ...decision,
          problem: { ref: 'point-a', fix: 'Specify allocation' },
          options: [{ action: 'accept', selectionIds: ['item-a'], rationale: 'Part is usable.' }],
        },
        piContext,
      ),
    ).toEqual([]);
  },
);

it('escalation skips the directive and actionability checks and still answers the Critic', () => {
  const decision = { ...advice, action: 'escalate' as const, directiveIds: [], problem: null };
  expect(guardPi(decision, piContext)).toEqual([]);
  expect(guardPi({ ...decision, answers: [] }, piContext)).toContain('CRITIC_ANSWER_REQUIRED');
});

it('validates Critic point limits, every reference lens, severity, fix classes and computed verdict', () => {
  const points = [
    seriousPoint,
    { ...seriousPoint, id: 'point-b', lens: 'risk' as const, ref: 'risk:risk-a' },
    { ...seriousPoint, id: 'point-c', lens: 'directive' as const, ref: 'directive:rule-a' },
    { ...seriousPoint, id: 'point-d', lens: 'integrity' as const, ref: 'integrity:spin', itemId: 'item-a' },
  ];
  expect(guardCritic({ ...report, points }, reviewContext)).toEqual([]);
  for (const point of points) {
    expect(
      guardCritic({ ...report, points: [{ ...point, ref: `${point.lens}:missing` }] }, reviewContext),
    ).toContain('UNKNOWN_CRITIC_REF');
  }
  expect(guardCritic({ ...report, points: [{ ...seriousPoint, itemId: 'bogus' }] }, reviewContext)).toContain(
    'UNKNOWN_CRITIC_ITEM',
  );
  const tooMany = { ...report, points: Array.from({ length: 9 }, () => seriousPoint) };
  expect(guardCritic(tooMany, reviewContext)).toEqual(['TOO_MANY_POINTS', 'DUPLICATE_POINTS']);
  expect(criticOutputSchema.safeParse(tooMany).success).toBe(false);
  for (const field of ['severity', 'fixClass'] as const)
    expect(
      criticOutputSchema.safeParse({ resolutions: [], points: [{ ...seriousPoint, [field]: undefined }] })
        .success,
    ).toBe(false);
  expect(criticVerdict([])).toBe('sound');
  expect(criticVerdict([{ ...seriousPoint, severity: 'concern' }])).toBe('concerns');
  expect(criticVerdict(points)).toBe('serious');
});

it('requires exactly one explicit resolution per earlier serious point', () => {
  const context = { ...reviewContext, previous: report };
  const resolved = { pointId: seriousPoint.id, status: 'resolved' as const, note: 'Added allocation.' };
  expect(guardCritic({ points: [], resolutions: [resolved] }, context)).toEqual([]);
  expect(guardCritic({ points: [], resolutions: [] }, context)).toContain('INVALID_RESOLUTIONS');
  expect(guardCritic({ points: [], resolutions: [resolved, resolved] }, context)).toContain(
    'INVALID_RESOLUTIONS',
  );
  expect(guardCritic({ points: [], resolutions: [{ ...resolved, pointId: 'unknown' }] }, context)).toContain(
    'INVALID_RESOLUTIONS',
  );
  expect(
    guardCritic({ points: [], resolutions: [{ ...resolved, status: 'maintained' }] }, context),
  ).toContain('INVALID_RESOLUTIONS');
  expect(
    guardCritic({ points: [seriousPoint], resolutions: [{ ...resolved, status: 'maintained' }] }, context),
  ).toEqual([]);
});

it('feeds guard errors and read observations into later turns and checkpoints each answer', async () => {
  const checkpoint = vi.fn().mockResolvedValue(undefined);
  const read = vi.fn().mockResolvedValue([{ stage: 'S1' }]);
  const result = await runAgent({
    role: 'pi',
    schema: piDecisionSchema,
    progress: emptyProgress,
    checkpoint,
    read,
    guard: (value) => guardPi(value, piContext),
    ask: async (_schema, observations) => {
      if (!observations.length) return { next: { action: 'decide', value: pi } };
      expect(observations[0]).toContain('DIRECTIVE_CITATION_REQUIRED');
      if (observations.length === 1) return { next: { action: 'list_artifacts', input: null } };
      expect(observations[1]).toContain('S1');
      return { next: { action: 'decide', value: advice } };
    },
  });
  expect(result).toEqual(advice);
  expect(checkpoint).toHaveBeenCalledTimes(4);
  expect(read).toHaveBeenCalledWith('list_artifacts', null);
});

it.each(['pi', 'critic'] as const)('stops %s at its step limit', async (role) => {
  const ask = vi.fn(async () => ({ next: { action: 'read_notebook' as const, input: null } }));
  await expect(
    runAgent({
      role,
      schema: criticOutputSchema,
      ask,
      guard: () => [],
      progress: emptyProgress,
      read: async () => [],
      checkpoint: async () => {},
    }),
  ).rejects.toBeInstanceOf(AgentStepLimitError);
  expect(ask).toHaveBeenCalledTimes(AGENT_STEP_LIMITS[role]);
});

it('resumes a checkpointed tool action before spending another Critic turn', async () => {
  const read = vi.fn().mockResolvedValue(['A saved directive.']);
  const checkpoint = vi.fn().mockResolvedValue(undefined);
  const result = await runAgent({
    role: 'critic',
    schema: criticOutputSchema,
    read,
    checkpoint,
    progress: { observations: [], pending: { action: 'read_notebook', input: null } },
    guard: (value) => guardCritic(value, reviewContext),
    ask: async (_schema, observations) => {
      expect(read).toHaveBeenCalledOnce();
      expect(observations[0]).toContain('A saved directive.');
      if (observations.length === 1)
        return {
          next: {
            action: 'report',
            value: {
              points: [{ ...seriousPoint, ref: 'charter:objectives[99]' }],
              resolutions: [],
            },
          },
        };
      expect(observations[1]).toContain('UNKNOWN_CRITIC_REF');
      return { next: { action: 'report', value: { points: [], resolutions: [] } } };
    },
  });
  expect(result.points).toEqual([]);
  expect(checkpoint).toHaveBeenCalledTimes(3);
});
