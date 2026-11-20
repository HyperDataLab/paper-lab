import { useEffect, useRef, useState } from 'react';
import { addFields, FIELD_CATALOG } from '@/core/extraction';
import type { ExtractionProject, Paper } from '@/core/schemas';
import { describeLlmError } from '@/shared/llm/describeError';
import { useLlm } from '@/shared/llm/LlmProvider';
import { llmExtraction } from '@/shared/llm/llmExtraction';
import { useRepositories } from '@/shared/storage/StorageProvider';
import type { RunChoice } from './RunPanel';

export function useExtractionRun(
  project: ExtractionProject | null,
  papers: Map<string, Paper>,
  setProject: (project: ExtractionProject) => void,
  setError: (error: string) => void,
) {
  const repo = useRepositories();
  const llm = useLlm();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState('');
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  async function run(choice: RunChoice) {
    if (!project) return;
    const abort = new AbortController();
    controller.current = abort;
    setRunning(true);
    setError('');
    try {
      if (!(await llm.ensureConsent('paper')) || abort.signal.aborted) return;
      const prepared = choice.fullExtract
        ? addFields(
            project,
            FIELD_CATALOG.filter((field) => choice.fieldKeys.includes(field.key)),
            project.fields.length + FIELD_CATALOG.length,
          )
        : project;
      const done = await llmExtraction(llm.client, prepared, papers, {
        ...choice,
        config: llm.config,
        signal: abort.signal,
        onProgress: (finished, total) => setProgress(`${finished}/${total} bài`),
        save: async (next) => setProject(await repo.extraction.checkpoint(next)),
      });
      const last = done.runs.at(-1);
      await repo.extraction.flush(done.id);
      await repo.extraction.recordEvents(done.id, [
        { action: 'run_extraction', after: { runId: last?.id, status: last?.status } },
      ]);
      if (last?.status === 'PARTIAL') setError('Một số ô chưa chạy xong hoặc bị lỗi; xem trạng thái từng ô.');
    } catch (cause) {
      setError(describeLlmError(cause) ?? String(cause));
    } finally {
      try {
        await repo.extraction.flush(project.id);
      } catch (cause) {
        setError(String(cause));
      }
      setRunning(false);
      setProgress('');
      controller.current = null;
    }
  }
  return { run, running, progress, cancel: () => controller.current?.abort() };
}
