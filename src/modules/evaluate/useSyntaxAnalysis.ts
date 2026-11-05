import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildSentenceAnnotations } from '@/core/analysis';
import type { Analysis, SentenceAnnotation, TextAnalysis } from '@/core/schemas';
import { createLlmSyntaxProvider, describeLlmError, LLM_SYNTAX_PROVIDER_ID } from '@/shared/llm';
import { useLlm } from '@/shared/llm/LlmProvider';

export type SyntaxVersions = Pick<Analysis['versions'], 'prompt' | 'model' | 'syntaxProvider'>;

/** Runs the sentence-syntax provider for a split paragraph (consent first, cancellable). */
export function useSyntaxAnalysis() {
  const { client, ensureConsent } = useLlm();
  const provider = useMemo(() => createLlmSyntaxProvider(client), [client]);
  const [annotations, setAnnotations] = useState<SentenceAnnotation[] | null>(null);
  const [versions, setVersions] = useState<SyntaxVersions | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);

  async function run(text: TextAnalysis) {
    setError(null);
    if (!(await ensureConsent())) return;
    const current = new AbortController();
    controller.current = current;
    setRunning(true);
    try {
      const result = await provider.analyze(text, current.signal);
      setAnnotations(buildSentenceAnnotations(text, result.sentences));
      setVersions({
        prompt: result.providerVersion,
        model: result.model,
        syntaxProvider: LLM_SYNTAX_PROVIDER_ID,
      });
    } catch (cause) {
      setError(describeLlmError(cause));
    } finally {
      if (controller.current === current) controller.current = null;
      setRunning(false);
    }
  }
  const cancel = useCallback(() => controller.current?.abort(), []);
  const reset = useCallback(() => {
    controller.current?.abort();
    setAnnotations(null);
    setVersions(null);
    setError(null);
  }, []);
  const load = useCallback((saved: SentenceAnnotation[], savedVersions: SyntaxVersions) => {
    setAnnotations(saved.length > 0 ? saved : null);
    setVersions(saved.length > 0 ? savedVersions : null);
    setError(null);
  }, []);
  return { annotations, versions, running, error, run, cancel, reset, load };
}
export type SyntaxAnalysis = ReturnType<typeof useSyntaxAnalysis>;
