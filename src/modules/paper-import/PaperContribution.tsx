import { useEffect, useState } from 'react';
import { strToU8, zipSync } from 'fflate';
import { contributionChunks, ncgZip } from '@/core/contribution';
import { buildPaperModel } from '@/core/paperModel';
import type { Paper, PaperInsightsRecord } from '@/core/schemas';
import { describeLlmError } from '@/shared/llm/describeError';
import { useLlm } from '@/shared/llm/LlmProvider';
import { llmContribution } from '@/shared/llm/llmContribution';
import { useRepositories } from '@/shared/storage/StorageProvider';
import { Button } from '@/shared/ui/Button';
import { ContributionViews } from './ContributionViews';

export function PaperContribution({
  paper,
  onLocation,
}: {
  paper: Paper;
  onLocation: (location: { paragraphId: string; start: number; end: number }) => void;
}) {
  const repo = useRepositories();
  const llm = useLlm();
  const [record, setRecord] = useState<PaperInsightsRecord>();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    void repo.paperInsights.get(paper.id).then(setRecord);
  }, [paper.id, repo]);
  const run = record?.contributionRuns.at(-1);
  const model = buildPaperModel({ paper, metadata: null, insights: record, now: new Date() });
  async function start() {
    setError('');
    setRunning(true);
    try {
      if (!(await llm.ensureConsent('paper'))) return;
      const saved = await repo.paperInsights.get(paper.id);
      const result = await llmContribution(llm.client, paper, {
        config: llm.config,
        pending: saved?.contributionPending,
        onProgress: async (pending) => {
          await repo.paperInsights.saveContributionPending(paper.id, pending);
        },
      });
      setRecord(await repo.paperInsights.saveContributionRun(paper.id, result));
    } catch (cause) {
      setError(describeLlmError(cause) ?? String(cause));
    } finally {
      setRunning(false);
    }
  }
  function download() {
    const files = ncgZip(model, run?.domain);
    const bytes = zipSync(
      Object.fromEntries(Object.entries(files).map(([name, value]) => [name, strToU8(value)])),
    );
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/zip' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'ncg.zip';
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
  return (
    <section aria-label="Contribution graph">
      <h2>Contribution graph</h2>
      <Button disabled={running || !model.sentences.length} onClick={() => void start()}>
        {running ? 'Đang phân tích…' : 'Phân tích contribution'}
      </Button>{' '}
      <span>Ước tính {contributionChunks(model.sentences).length} lượt gọi AI.</span>{' '}
      {run && <Button onClick={download}>Tải ncg.zip</Button>}
      {error && <p role="alert">{error}</p>}
      {run?.domain === 'other' && <p>NCG được thiết kế cho bài ML/NLP; bài này ngoài phạm vi đó.</p>}
      {run && (
        <p>
          Đã bỏ {run.droppedPhrases} cụm từ và {run.droppedTriples} bộ ba không kiểm chứng được.
        </p>
      )}
      <ContributionViews model={model} onLocation={onLocation} />
    </section>
  );
}
