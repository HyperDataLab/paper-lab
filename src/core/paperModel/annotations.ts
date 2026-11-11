import { insightStates } from '../rhetoric';
import type {
  PaperInsightsRecord,
  PaperModelAnnotation,
  PaperModelAnnotationRun,
  PaperModelSentence,
  StanceRecord,
} from '../schemas';
import { stanceStates } from '../stance';
import { sliceCp } from '../text';

export interface SentenceHit {
  sentence: PaperModelSentence;
  /** Code points relative to the sentence. */
  span: { start: number; end: number };
}

/**
 * The sentences a paragraph span overlaps, each with the span clipped to it. `start`/`end` are
 * code points in the paragraph, as both sentences and run items store them.
 */
export function spanToSentences(
  sentences: readonly PaperModelSentence[],
  paragraphId: string,
  start: number,
  end: number,
): SentenceHit[] {
  return sentences
    .filter((s) => s.paragraphId === paragraphId && s.start < end && start < s.end)
    .map((sentence) => ({
      sentence,
      span: {
        start: Math.max(start, sentence.start) - sentence.start,
        end: Math.min(end, sentence.end) - sentence.start,
      },
    }));
}

type State = PaperModelAnnotation['state'];
const stateOf = (value: 'candidate' | 'confirmed' | 'dismissed' | undefined): State =>
  value === 'confirmed' ? 'confirmed' : value === 'dismissed' ? 'rejected' : 'machine';

interface Item {
  paragraphId: string;
  start: number;
  end: number;
  label: string;
  state: State;
  attrs: PaperModelAnnotation['attrs'];
}

function annotate(
  scheme: 'paperlab-rhetoric' | 'paperlab-stance',
  run: { id: string; model: string; promptVersion: string; createdAt: string },
  items: Item[],
  byParagraph: Map<string, PaperModelSentence[]>,
) {
  const source = { runId: run.id, model: run.model, promptVersion: run.promptVersion };
  let skipped = 0;
  const annotations = items.flatMap((item) => {
    const hits = spanToSentences(
      byParagraph.get(item.paragraphId) ?? [],
      item.paragraphId,
      item.start,
      item.end,
    );
    if (!hits.length) skipped++;
    return hits.map(
      ({ sentence, span }) =>
        ({
          key: sentence.key,
          scheme,
          label: item.label,
          attrs: item.attrs,
          span,
          text: sliceCp(sentence.text, span.start, span.end),
          origin: 'ai',
          state: item.state,
          source,
          second: null,
        }) as PaperModelAnnotation,
    );
  });
  const summary: PaperModelAnnotationRun = {
    scheme,
    runId: run.id,
    model: run.model,
    promptVersion: run.promptVersion,
    createdAt: run.createdAt,
    items: items.length,
    skipped,
  };
  return { annotations, summary };
}

/**
 * Today's PaperLab labels (latest rhetoric run, latest stance run) on the sentence index. A reader's
 * dismissal is kept as `rejected`, not dropped, so a consumer can tell "rejected" from "never labelled".
 */
export function paperLabAnnotations(
  sentences: readonly PaperModelSentence[],
  insights?: PaperInsightsRecord | null,
  stance?: StanceRecord | null,
) {
  const byParagraph = new Map<string, PaperModelSentence[]>();
  for (const sentence of sentences) {
    const list = byParagraph.get(sentence.paragraphId) ?? [];
    list.push(sentence);
    byParagraph.set(sentence.paragraphId, list);
  }
  const parts: ReturnType<typeof annotate>[] = [];
  const rhetoric = insights?.rhetoricRuns.at(-1);
  if (rhetoric) {
    const states = insightStates(rhetoric, insights?.decisions ?? []);
    parts.push(
      annotate(
        'paperlab-rhetoric',
        rhetoric,
        rhetoric.items.map((item) => ({
          paragraphId: item.paragraphId,
          start: item.start,
          end: item.end,
          label: item.category,
          state: stateOf(states.get(item.id)),
          attrs: { itemId: item.id, rationale: item.rationale },
        })),
        byParagraph,
      ),
    );
  }
  const stanceRun = stance?.runs.at(-1);
  if (stanceRun) {
    const states = stanceStates(stanceRun, stance?.decisions ?? []);
    parts.push(
      annotate(
        'paperlab-stance',
        stanceRun,
        // The marker's span, not the excerpt around it: the marker is what carries the label.
        stanceRun.annotations.map((item) => ({
          paragraphId: item.paragraphId,
          start: item.start,
          end: item.end,
          label: item.category,
          state: stateOf(states.get(item.id)),
          attrs: { itemId: item.id, marker: item.marker, rationale: item.rationale },
        })),
        byParagraph,
      ),
    );
  }
  return {
    annotations: parts.flatMap((part) => part.annotations),
    runs: parts.map((part) => part.summary),
  };
}
