import { AnalysisSchema, type Analysis } from './analysis';
import { createOffsetIndex } from '../text/offsets';
export class InvalidAnalysisError extends Error {
  override name = 'InvalidAnalysisError';
}
export function validateAnalysisSpans(input: Analysis) {
  const analysis = AnalysisSchema.parse(input);
  const length = Array.from(analysis.text.sourceText).length;
  const inBounds = (span: { start: number; end: number }) =>
    span.start >= 0 && span.end > span.start && span.end <= length;
  for (const [kind, spans] of [
    ['sentences', analysis.text.sentences],
    ['tokens', analysis.text.tokens],
  ] as const) {
    spans.forEach((span, i) => {
      if (!inBounds(span)) throw new InvalidAnalysisError(`text.${kind}.${i}: invalid offset`);
    });
  }
  const offsets = createOffsetIndex(analysis.text.sourceText);
  analysis.text.tokens.forEach((token, i) => {
    if (offsets.sliceCp(token.start, token.end) !== token.text)
      throw new InvalidAnalysisError(`text.tokens.${i}: text mismatch`);
    if (token.index !== i || (i > 0 && token.start < (analysis.text.tokens[i - 1]?.end ?? 0)))
      throw new InvalidAnalysisError(`text.tokens.${i}: invalid order`);
  });
  analysis.text.sentences.forEach((sentence, i) => {
    const first = analysis.text.tokens[sentence.tokenStart];
    const last = analysis.text.tokens[sentence.tokenEnd - 1];
    if (
      !first ||
      !last ||
      sentence.tokenStart >= sentence.tokenEnd ||
      first.start !== sentence.start ||
      last.end !== sentence.end ||
      (i > 0 && sentence.tokenStart !== analysis.text.sentences[i - 1]?.tokenEnd)
    )
      throw new InvalidAnalysisError(`text.sentences.${i}: invalid token range`);
  });
  if (
    (analysis.text.sentences[0]?.tokenStart ?? 0) !== 0 ||
    (analysis.text.sentences.at(-1)?.tokenEnd ?? 0) !== analysis.text.tokens.length
  )
    throw new InvalidAnalysisError('text.sentences: incomplete token coverage');
  const ids = new Set(analysis.text.sentences.map((sentence) => sentence.id));
  const suppressed: { path: string; reason: string }[] = [];
  analysis.sentenceAnnotations = analysis.sentenceAnnotations.filter((annotation, i) => {
    if (!ids.has(annotation.sentenceId)) {
      suppressed.push({ path: `sentenceAnnotations.${i}`, reason: 'unknown sentence' });
      return false;
    }
    for (const key of ['topicSpan', 'actionSpan', 'stressSpan'] as const) {
      const span = annotation[key];
      if (span && !inBounds(span)) {
        suppressed.push({ path: `sentenceAnnotations.${i}.${key}`, reason: 'invalid span or sentence' });
        annotation[key] = null;
      }
    }
    return true;
  });
  analysis.issues = analysis.issues.filter((issue, i) => {
    if (
      issue.spans.some(
        (span) => !inBounds(span) || (span.sentenceId !== undefined && !ids.has(span.sentenceId)),
      ) ||
      issue.sentenceIds.some((id) => !ids.has(id))
    ) {
      suppressed.push({ path: `issues.${i}`, reason: 'invalid span or sentence' });
      return false;
    }
    return true;
  });
  return { valid: analysis, suppressed };
}
