import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Analysis } from '@/core/schemas';
import type { Scores } from '@/core/schemas/scores';
import { createLlmScorer } from '@/shared/llm/llmScorer';
import { describeLlmError } from '@/shared/llm';
import { useLlm } from '@/shared/llm/LlmProvider';

export function useScoring() {
  const { client, ensureConsent } = useLlm();
  const scorer = useMemo(() => createLlmScorer(client), [client]);
  const [result, setResult] = useState<{
    scores: Scores;
    model: string | null;
    promptVersion: string | null;
  } | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  async function run(analysis: Analysis) {
    setError(null);
    if (!(await ensureConsent())) return;
    const current = new AbortController();
    controller.current = current;
    setRunning(true);
    try {
      const next = await scorer.score(analysis, current.signal);
      if (!current.signal.aborted) setResult(next);
    } catch (cause) {
      if (!current.signal.aborted) setError(describeLlmError(cause));
    } finally {
      if (controller.current === current) {
        controller.current = null;
        setRunning(false);
      }
    }
  }
  const reset = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
    setRunning(false);
    setResult(null);
    setError(null);
  }, []);
  const load = useCallback(
    (analysis: Analysis) =>
      setResult(
        analysis.scores
          ? {
              scores: analysis.scores,
              model: analysis.versions.scoringModel,
              promptVersion: analysis.versions.scoringPrompt,
            }
          : null,
      ),
    [],
  );
  return { result, running, error, run, reset, load, cancel: () => controller.current?.abort() };
}
