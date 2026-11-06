import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Analysis, Issue, SentenceAnnotation, TextAnalysis } from '@/core/schemas';
import { createLlmParagraphAnalyzer } from '@/shared/llm/llmParagraphAnalyzer';
import { describeLlmError } from '@/shared/llm';
import { useLlm } from '@/shared/llm/LlmProvider';
import { mergeHumanDecisions } from './useCandidateJudge';

type Result = Omit<
  Awaited<ReturnType<ReturnType<typeof createLlmParagraphAnalyzer>['analyze']>>,
  'model' | 'promptVersion'
> & {
  model: string | null;
  promptVersion: string | null;
};
export function useParagraphAnalysis() {
  const { client, ensureConsent } = useLlm();
  const analyzer = useMemo(() => createLlmParagraphAnalyzer(client), [client]);
  const [result, setResult] = useState<Result | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  async function run(text: TextAnalysis, annotations: SentenceAnnotation[] | null, issues: Issue[]) {
    setError(null);
    if (!(await ensureConsent())) return;
    const current = new AbortController();
    controller.current = current;
    setRunning(true);
    try {
      const next = await analyzer.analyze(
        text,
        annotations,
        { before: null, after: null, audience: null },
        current.signal,
      );
      if (!current.signal.aborted) setResult({ ...next, issues: mergeHumanDecisions(next.issues, issues) });
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
  const load = useCallback((analysis: Analysis) => {
    if (!analysis.paragraph || !analysis.paragraphMetrics) {
      setResult(null);
      return;
    }
    setResult({
      paragraph: analysis.paragraph,
      flowLinks: analysis.flowLinks,
      metrics: analysis.paragraphMetrics,
      roles: analysis.sentenceAnnotations.map((item) => ({
        sentenceId: item.sentenceId,
        role: item.role ?? 'unknown',
        confidence: item.roleConfidence,
        rationale: item.roleRationale,
      })),
      issues: analysis.issues.filter((item) => item.category === 'flow' || item.category === 'organization'),
      model: analysis.versions.structureModel,
      promptVersion: analysis.versions.structurePrompt,
    });
  }, []);
  return { result, running, error, run, reset, load, cancel: () => controller.current?.abort() };
}
