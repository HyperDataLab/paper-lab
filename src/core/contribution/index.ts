import type { ContributionOutput, ContributionRun, PaperModel, PaperModelSentence } from '../schemas';
export * from './ncgZip';

export function contributionChunks(sentences: PaperModelSentence[]) {
  const chunks: PaperModelSentence[][] = [];
  for (let i = 0; i < sentences.length; i += 90) chunks.push(sentences.slice(i, i + 90));
  return chunks;
}

export function verifyContribution(output: ContributionOutput, sentences: PaperModelSentence[]) {
  const byId = new Map(sentences.map((sentence) => [sentence.key, sentence]));
  let droppedPhrases = 0;
  let droppedTriples = 0;
  const verified = output.sentences.flatMap((item) => {
    const source = byId.get(item.sentenceId);
    const phrases = item.phrases.filter((phrase) => {
      const found = !!source && source.text.includes(phrase);
      if (!found) droppedPhrases++;
      return found;
    });
    const triples = item.triples.filter((triple) => {
      const found =
        !!source &&
        triple.unit === item.unit &&
        [triple.subject, triple.predicate, triple.object].every((p) => phrases.includes(p));
      if (!found) droppedTriples++;
      return found;
    });
    return source ? [{ ...item, phrases, triples }] : [];
  });
  return { domain: output.domain, sentences: verified, droppedPhrases, droppedTriples };
}

export function contributionKnowledge(
  run: ContributionRun | undefined,
  sentences: PaperModelSentence[],
): PaperModel['knowledge'] {
  if (!run) return { phrases: [], triples: [] };
  const verified = verifyContribution(run, sentences);
  const sources = new Map(sentences.map((s) => [s.key, s]));
  const phrases: PaperModel['knowledge']['phrases'] = [];
  const triples: PaperModel['knowledge']['triples'] = [];
  for (const item of verified.sentences) {
    const source = sources.get(item.sentenceId);
    if (!source) continue;
    const ids = new Map<string, string>();
    for (const text of new Set(item.phrases)) {
      const start = Array.from(source.text.slice(0, source.text.indexOf(text))).length;
      const id = `phrase-${phrases.length + 1}`;
      ids.set(text, id);
      phrases.push({ id, key: source.key, start, end: start + Array.from(text).length, text });
    }
    for (const triple of item.triples) {
      const subject = ids.get(triple.subject),
        predicate = ids.get(triple.predicate),
        object = ids.get(triple.object);
      if (subject && predicate && object)
        triples.push({ unit: triple.unit, subject, predicate, object, key: source.key });
    }
  }
  return { phrases, triples };
}
