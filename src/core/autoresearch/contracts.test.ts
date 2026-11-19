import { describe, expect, it } from 'vitest';
import { contracts, stageErrorSchema, STAGES } from './contracts';
import { outputs } from './fixtures';
import { overallTopicScore, passStage } from './validation';

describe('AutoResearch stage contracts', () => {
  it.each(STAGES.filter((stage): stage is keyof typeof outputs => Object.hasOwn(outputs, stage)))(
    '%s parses and passes with a linked synthetic chain',
    (stage) => {
      expect(contracts[stage].safeParse(outputs[stage]).success).toBe(true);
      expect(contracts[stage].safeParse({}).success).toBe(false);
      expect(passStage(stage, outputs[stage], outputs)).toBeNull();
    },
  );

  it('S1 rejects nonresearchable goals and missing required nullable fields', () => {
    const value = structuredClone(outputs.S1);
    value.goal.researchable = false;
    value.goal.rejectionReason = 'No reviewer access.';
    expect(passStage('S1', value, outputs)).toBe('INVALID_GOAL');
    expect(
      passStage(
        'S1',
        { ...outputs.S1, goal: { ...outputs.S1.goal, success_criteria: ['Positive results only.'] } },
        outputs,
      ),
    ).toBe('INVALID_GOAL');
    expect(
      contracts.S1.safeParse({ ...value, charter: { ...value.charter, objectives: ['One'] } }).success,
    ).toBe(false);
    expect(
      contracts.S1.safeParse({ ...value, goal: { ...value.goal, rejectionReason: undefined } }).success,
    ).toBe(false);
  });

  it('S2 computes the aggregate from known values and enforces the heuristic cutoff', () => {
    const value = { ...outputs.S2, scores: { ...outputs.S2.scores, specificity: null }, overall: null };
    expect(overallTopicScore(value.scores)).toBeNull();
    expect(passStage('S2', value, outputs)).toBe('TOPIC_BELOW_THRESHOLD');
    expect(passStage('S2', { ...outputs.S2, overall: 0 }, outputs)).toBe('TOPIC_BELOW_THRESHOLD');
  });

  it('S3 resolves every query to known questions and validates the year interval', () => {
    const value = structuredClone(outputs.S3);
    value.yearFilter = { from: 2025, to: 2024 };
    expect(passStage('S3', value, outputs)).toBe('INVALID_SEARCH_PLAN');
    value.yearFilter = { from: 2024, to: 2025 };
    expect(passStage('S3', value, outputs)).toBe('INVALID_SEARCH_PLAN');
    expect(passStage('S3', outputs.S3, { ...outputs, S2: undefined })).toBe('INVALID_SEARCH_PLAN');
  });

  it('S4 refuses empty candidates or fabricated query references', () => {
    const value = { candidates: outputs.S4.candidates.map((paper) => ({ ...paper, queryIds: ['unknown'] })) };
    expect(passStage('S4', value, outputs)).toBe('STAGE_ERROR');
    expect(passStage('S4', { candidates: [] }, outputs)).toBe('NO_LITERATURE');
  });

  it('S5 requires a decision for every known paper and a nonempty shortlist', () => {
    const value = structuredClone(outputs.S5);
    value.decisions = value.decisions.map((item) => ({ ...item, decision: 'excluded' }));
    expect(passStage('S5', value, outputs)).toBe('EMPTY_SHORTLIST');
    value.decisions = value.decisions.map((item) => ({ ...item, paperId: 'invented' }));
    expect(passStage('S5', value, outputs)).toBe('STAGE_ERROR');
    expect(passStage('S5', { ...value, decisions: [] }, outputs)).toBe('STAGE_ERROR');
  });

  it('S6 does not accept placeholder text, unsupported numbers, full-text claims or missing decisions', () => {
    expect(passStage('S6', { cards: [] }, outputs)).toBe('NO_CARDS');
    for (const patch of [
      { problem: 'TBD' },
      { method: 'Compared 13 reviewers' },
      { evidence_scope: 'full_text' as const },
      { decisionId: 'unknown' },
    ]) {
      const value = { cards: outputs.S6.cards.map((card) => ({ ...card, ...patch })) };
      expect(passStage('S6', value, outputs)).toBe('INVALID_CARDS');
    }
  });

  it('S7 guards exclusive coverage, cross references and numbers against the cited card', () => {
    const value = structuredClone(outputs.S7);
    expect(
      passStage('S7', { ...value, setAside: [{ cardId: 'card-a', reason: 'Off topic' }] }, outputs),
    ).toBe('INVALID_SYNTHESIS');
    expect(passStage('S7', { ...value, clusters: [] }, outputs)).toBe('INVALID_SYNTHESIS');
    value.gaps = value.gaps.map((gap) => ({ ...gap, text: 'Evidence from 120 reviewers.' }));
    expect(passStage('S7', value, outputs)).toBe('INVALID_SYNTHESIS');
    expect(passStage('S7', outputs.S7, { ...outputs, S6: undefined })).toBe('INVALID_SYNTHESIS');
  });

  it('S8 rejects unresolved references, unsupported thresholds, duplicate statements or repeated lenses', () => {
    for (const patch of [
      { gapId: 'absent' },
      { evidenceRefs: ['absent'] },
      { subQuestionIds: ['q-control'] },
      { novelty: { assessment: 'Novel', paperIds: ['absent'] } },
      { falsification: { criterion: 'Change in agreement', threshold: 0.8 } },
    ]) {
      expect(
        passStage(
          'S8',
          { ...outputs.S8, hypotheses: outputs.S8.hypotheses.map((h) => ({ ...h, ...patch })) },
          outputs,
        ),
      ).toBe('INVALID_HYPOTHESES');
    }
    const duplicate = outputs.S8.hypotheses[0]?.statement ?? '';
    expect(
      passStage(
        'S8',
        { ...outputs.S8, hypotheses: outputs.S8.hypotheses.map((h) => ({ ...h, statement: duplicate })) },
        outputs,
      ),
    ).toBe('INVALID_HYPOTHESES');
    expect(
      passStage(
        'S8',
        { ...outputs.S8, perspectives: outputs.S8.perspectives.map((p) => ({ ...p, lens: 'novelty' })) },
        outputs,
      ),
    ).toBe('INVALID_HYPOTHESES');
    expect(
      contracts.S8.safeParse({
        ...outputs.S8,
        debateRounds: Array.from({ length: 3 }, () => ({ views: outputs.S8.perspectives })),
      }).success,
    ).toBe(false);
  });

  it.each(['LLM_OUTPUT_INVALID', 'LLM_TIMEOUT', 'LLM_RATE_LIMITED', 'MISSING_INPUT', 'STAGE_ERROR'])(
    'accepts generic failure %s',
    (code) => {
      expect(stageErrorSchema.parse(code)).toBe(code);
    },
  );
});
