import type { Analysis, Paper } from '../schemas';
import { TransitionPairSchema, type TransitionPair } from '../schemas/paperOverview';
import { sliceCp } from '../text/offsets';
import { paperAnalyses } from './aggregatePaper';

export function transitionPairs(paper: Paper, analyses: Analysis[]): TransitionPair[] {
  const selected = paperAnalyses(paper, analyses);
  const pairs: TransitionPair[] = [];
  for (const section of paper.sections) {
    const paragraphs = paper.paragraphs
      .filter((p) => p.sectionId === section.id && p.kind === 'body')
      .sort((a, b) => a.order - b.order);
    for (let i = 1; i < paragraphs.length; i++) {
      const from = paragraphs[i - 1];
      const to = paragraphs[i];
      if (!from || !to) continue;
      const a = selected.get(from.id);
      const b = selected.get(to.id);
      const last = a?.text.sentences.at(-1);
      const first = b?.text.sentences[0];
      const stress = a?.sentenceAnnotations.find((v) => v.sentenceId === last?.id)?.stressSpan;
      const topic = b?.sentenceAnnotations.find((v) => v.sentenceId === first?.id)?.topicSpan;
      if (!a || !b || !last || !first || !stress || !topic) continue;
      pairs.push(
        TransitionPairSchema.parse({
          pairId: `${from.id}->${to.id}`,
          sectionId: section.id,
          sectionRole: section.role,
          from: {
            paragraphId: from.id,
            analysisId: a.id,
            analysisUpdatedAt: a.updatedAt,
            span: stress,
            quote: sliceCp(from.text, stress.start, stress.end),
            sentence: sliceCp(from.text, last.start, last.end),
          },
          to: {
            paragraphId: to.id,
            analysisId: b.id,
            analysisUpdatedAt: b.updatedAt,
            span: topic,
            quote: sliceCp(to.text, topic.start, topic.end),
            sentence: sliceCp(to.text, first.start, first.end),
          },
        }),
      );
    }
  }
  return pairs;
}
