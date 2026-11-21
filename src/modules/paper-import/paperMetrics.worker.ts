import { detectCandidates } from '@/core/detectors';
import { analyzeText } from '@/core/text';

interface AnalyzePaperMessage {
  paperId: string;
  paragraphs: { id: string; text: string }[];
}

interface PaperMetricsResult {
  paperId: string;
  counts: { sentences: number; words: number };
  candidateCounts: Record<string, number>;
}

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<AnalyzePaperMessage>) => void) | null;
  postMessage: (message: PaperMetricsResult) => void;
};

workerScope.onmessage = (event) => {
  void (async () => {
    const candidateCounts: Record<string, number> = {};
    let sentences = 0;
    let words = 0;
    for (const paragraph of event.data.paragraphs) {
      const analysis = await analyzeText(paragraph.text);
      sentences += analysis.sentences.length;
      words += analysis.tokens.filter((token) => token.kind === 'word').length;
      candidateCounts[paragraph.id] = detectCandidates(analysis, null).length;
    }
    workerScope.postMessage({
      paperId: event.data.paperId,
      counts: { sentences, words },
      candidateCounts,
    });
  })();
};
