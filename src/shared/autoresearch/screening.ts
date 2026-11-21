import type { Charter, ResearchCandidate, StageContent } from '@/core/autoresearch/contracts';
import { SCREENING_BATCH } from '@/core/extraction';
import { PROMPT_VERSIONS } from '@/core/prompts';
import type { Candidate, SearchPlan } from '@/core/schemas';
import type { LlmClient } from '@/shared/llm/client';
import type { LlmConfig } from '@/shared/llm/config';
import { llmScreening } from '@/shared/llm/llmDeepResearch';

export type ScreenCriteria = { charter: Charter; plan: StageContent['S3'] };
export type Screen = (
  candidates: ResearchCandidate[],
  criteria: ScreenCriteria,
) => Promise<StageContent['S5']>;
type Decision = StageContent['S5']['decisions'][number];
export const screeningPromptVersion = PROMPT_VERSIONS.screening;

export function defaultScreen(deps: {
  client: LlmClient;
  config: LlmConfig;
  signal?: AbortSignal;
  onRequest: () => Promise<void>;
  completed: Decision[];
  checkpoint: (decisions: Decision[]) => Promise<void>;
}): Screen {
  return async (candidates, criteria) => {
    const plan: SearchPlan = {
      concepts: criteria.charter.scope_in,
      queries: criteria.plan.strategies.flatMap((s) => s.queries.map((q) => q.query)),
      inclusion: criteria.plan.inclusion,
      exclusion: criteria.plan.exclusion,
      fromYear: criteria.plan.yearFilter.from,
      toYear: criteria.plan.yearFilter.to,
      perQuery: 15,
      approvedAt: null,
    };
    const completed = new Map(deps.completed.map((decision) => [decision.paperId, decision]));
    const pending = candidates.filter((p) => !completed.has(p.id) && !p.existingDecision);
    for (let start = 0; start < pending.length; start += SCREENING_BATCH) {
      const batch: Candidate[] = pending.slice(start, start + SCREENING_BATCH).map((paper) => ({
        key: paper.id,
        doi: paper.doi,
        title: paper.title,
        abstract: paper.abstract,
        year: paper.year,
        openalexId: null,
        authors: [],
        venue: null,
        citedBy: null,
        foundBy: paper.queryIds,
        status: 'candidate',
        suggestion: null,
        reason: null,
        decidedAt: null,
      }));
      const screened = await llmScreening(deps.client, criteria.charter.question, plan, batch, {
        config: deps.config,
        signal: deps.signal,
        onRequest: deps.onRequest,
      });
      for (const paper of screened) completed.set(paper.key, decisionFor(paper.key, paper.suggestion));
      await deps.checkpoint([...completed.values()]);
    }
    return {
      decisions: candidates.map(
        (paper) => completed.get(paper.id) ?? decisionFor(paper.id, paper.existingDecision),
      ),
      thresholds: { relevance: null, quality: null },
    };
  };
}

function decisionFor(paperId: string, value: ResearchCandidate['existingDecision']): Decision {
  return {
    id: `screen:${paperId}`,
    paperId,
    decision: value?.decision ?? 'uncertain',
    reason: value?.reason.trim() || 'No screening assessment was returned.',
    relevance: null,
    quality: null,
  };
}
