import type { PaperModel } from '../schemas';

/** Returns UTF-8 text files; the caller packages them into a ZIP. */
export function ncgZip(model: PaperModel, domain?: 'ml_nlp' | 'other'): Record<string, string> {
  const files: Record<string, string> = {};
  const phrases = new Map(model.knowledge.phrases.map((phrase) => [phrase.id, phrase]));
  const keys = new Set([
    ...model.knowledge.triples.map((triple) => triple.key),
    ...model.annotations
      .filter((annotation) => annotation.scheme === 'ncg-unit')
      .map((annotation) => annotation.key),
  ]);
  const sentences = model.sentences.filter((sentence) => keys.has(sentence.key));
  files['sentences.txt'] = sentences
    .map((sentence) => sentence.text.replace(/\r\n|[\r\n]/gu, ' '))
    .join('\n');
  const entities: string[] = [];
  for (const [index, sentence] of sentences.entries()) {
    const tokens = [...sentence.text.matchAll(/\S+/gu)].map((match) => {
      const start = Array.from(sentence.text.slice(0, match.index)).length;
      return { start, end: start + Array.from(match[0]).length };
    });
    for (const phrase of model.knowledge.phrases.filter((item) => item.key === sentence.key)) {
      const start = tokens.findIndex((token) => token.end > phrase.start);
      const end = tokens.findIndex((token) => token.end >= phrase.end);
      if (start >= 0 && end >= start) entities.push(`${index}\t${start}\t${end + 1}\t${phrase.text}`);
    }
  }
  files['entities.txt'] = entities.join('\n');
  for (const unit of new Set(model.knowledge.triples.map((triple) => triple.unit))) {
    const triples = model.knowledge.triples
      .filter((triple) => triple.unit === unit)
      .flatMap((triple) => {
        const subject = phrases.get(triple.subject)?.text,
          predicate = phrases.get(triple.predicate)?.text,
          object = phrases.get(triple.object)?.text;
        return subject && predicate && object ? [{ subject, predicate, object }] : [];
      });
    files[`triples/${unit}.txt`] = [
      `(Contribution||has||${unit})`,
      ...[...new Set(triples.map((triple) => triple.subject))].map((subject) => `(${unit}||has||${subject})`),
      ...triples.map((t) => `(${t.subject}||${t.predicate}||${t.object})`),
    ].join('\n');
    files[`info-units/${unit}.json`] = JSON.stringify({ root: 'Contribution', unit, triples }, null, 2);
  }
  if (
    domain === 'other' ||
    (!domain && model.annotations.some((a) => a.scheme === 'ncg-unit' && a.attrs.domain === 'other'))
  )
    files['README.txt'] =
      'The NLPContributionGraph scheme was designed for ML/NLP papers; this paper is outside that domain. Only applicable units are exported.\n';
  return files;
}
