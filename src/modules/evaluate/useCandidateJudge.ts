import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Analysis, Issue, SentenceAnnotation, TextAnalysis } from '@/core/schemas';
import { createLlmCandidateJudge, describeLlmError } from '@/shared/llm';
import { useLlm } from '@/shared/llm/LlmProvider';
import { mergeHumanDecisions } from '@/core/detectors';

export { mergeHumanDecisions } from '@/core/detectors';

export function useCandidateJudge() {
  const { client, ensureConsent } = useLlm();
  const judge = useMemo(() => createLlmCandidateJudge(client), [client]);
  const [issues, setIssues] = useState<Issue[] | null>(null);
  const [versions, setVersions] = useState<{ model: string | null; judgePrompt: string | null } | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  async function run(
    text: TextAnalysis,
    annotations: SentenceAnnotation[] | null,
    candidates: Issue[],
    context: Analysis['context'],
    currentIssues: Issue[] = [],
  ) {
    setError(null);
    if (!(await ensureConsent())) return;
    const current = new AbortController();
    controller.current = current;
    setRunning(true);
    try {
      const result = await judge.judge(text, annotations, candidates, context, current.signal);
      if (!current.signal.aborted) {
        setIssues(mergeHumanDecisions(result.issues, currentIssues));
        setVersions({ model: result.model, judgePrompt: result.promptVersion });
      }
    } catch (cause) {
      if (!current.signal.aborted) setError(describeLlmError(cause));
    } finally {
      if (controller.current === current) {
        controller.current = null;
        setRunning(false);
      }
    }
  }
  const cancel = useCallback(() => controller.current?.abort(), []);
  const reset = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
    setRunning(false);
    setIssues(null);
    setVersions(null);
    setError(null);
  }, []);
  const load = useCallback((saved: Issue[], savedVersions: Analysis['versions']) => {
    setIssues(savedVersions.detectors === null ? null : saved);
    setVersions({ model: savedVersions.model, judgePrompt: savedVersions.judgePrompt });
    setError(null);
  }, []);
  return { issues, versions, running, error, run, cancel, reset, load };
}
