import { useRef, useState } from 'react';
import { z } from 'zod';
import { PROMPT_VERSIONS } from '@/core/prompts';
import type { FactsDoc } from '@/core/researchDesign/facts/factsDoc';
import type { Paper } from '@/core/researchDesign/papers';
import { buildSuggestionRequest, readSuggestions, type Target } from '@/core/researchDesign/suggest/suggest';
import type { Draft } from '@/core/researchDesign/draft/schema';
import { ConsentRequiredError, InvalidModelOutputError, describeLlmError } from '@/shared/llm';
import { useLlm } from '@/shared/llm/LlmProvider';

type State = 'idle' | 'sending' | 'done' | 'failed' | 'unreadable' | 'consent';
const answerSchema = z.object({
  suggestions: z.array(z.object({ text: z.string(), cites: z.array(z.string()) })),
});

/** One request per press: the facts set to Dùng plus the plan's questions and hypotheses (D55). */
export function useSuggestions({
  projectId,
  target,
  papers,
  docs,
  draft,
}: {
  projectId: string;
  target: Target;
  papers: Paper[];
  docs: Record<string, FactsDoc | undefined>;
  draft: Draft;
}) {
  const llm = useLlm();
  const [state, setState] = useState<State>('idle');
  const [message, setMessage] = useState('');
  const [suggestions, setSuggestions] = useState<{ text: string; cites: string[] }[]>([]);
  const [droppedCites, setDroppedCites] = useState(0);
  const [forTarget, setForTarget] = useState<Target | null>(null);
  const sending = useRef(false);
  const built = buildSuggestionRequest({ projectId, target, papers, factsByPaperId: docs, draft });
  const citations = Object.fromEntries(
    papers.flatMap((paper) => {
      const doc = docs[paper.id];
      return (doc?.facts.facts ?? [])
        .filter((fact) => doc?.decisions[fact.id]?.decision === 'use')
        .map((fact) => [`${paper.id}/${fact.id}`, `${fact.value} · ${paper.title}`]);
    }),
  );
  async function send() {
    const { request, allow } = built;
    if (!request || sending.current) return;
    sending.current = true;
    setForTarget(target);
    setSuggestions([]);
    setDroppedCites(0);
    setMessage('');
    try {
      if (!(await llm.ensureConsent())) {
        setState('consent');
        return;
      }
      setState('sending');
      const content = (role: 'system' | 'user') =>
        request.messages
          .filter((entry) => entry.role === role)
          .map((entry) => entry.content)
          .join('\n');
      const result = await llm.client.completeJson({
        system: content('system'),
        user: content('user'),
        schema: answerSchema,
        schemaName: 'plan_suggestion',
        promptVersion: PROMPT_VERSIONS.planSuggestion,
        temperature: 0.2,
      });
      const read = readSuggestions(JSON.stringify(result.data), allow);
      if (!read.ok) {
        setState('unreadable');
        return;
      }
      setSuggestions(read.suggestions);
      setDroppedCites(read.droppedCites);
      setState('done');
    } catch (error) {
      if (error instanceof InvalidModelOutputError) setState('unreadable');
      else if (error instanceof ConsentRequiredError) setState('consent');
      else {
        setMessage(describeLlmError(error) ?? '');
        setState('failed');
      }
    } finally {
      sending.current = false;
    }
  }
  // Suggestions answer the target they were asked for; choosing another target starts over.
  const current = forTarget === target;
  return {
    factCount: built.factCount,
    citations,
    send,
    state: current || state === 'sending' ? state : 'idle',
    message: current ? message : '',
    suggestions: current ? suggestions : [],
    droppedCites: current ? droppedCites : 0,
  };
}
