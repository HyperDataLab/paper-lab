import { TextAnalysisSchema, type TextAnalysis } from '../schemas/text';
import { sourceHash } from './hash';
import { createOffsetIndex, OFFSET_UNIT } from './offsets';
import { segmentSentences, SEGMENTER_VERSION } from './segment';
import { tokenize, TOKENIZER_VERSION } from './tokenize';
export async function analyzeText(text: string): Promise<TextAnalysis> {
  const tokens = tokenize(text),
    sentences = segmentSentences(text, tokens),
    offsets = createOffsetIndex(text);
  let previous = 0;
  for (const token of tokens) {
    if (
      token.start < previous ||
      token.start >= token.end ||
      offsets.sliceCp(token.start, token.end) !== token.text
    )
      throw new Error('Invalid token span');
    previous = token.end;
  }
  previous = 0;
  for (const sentence of sentences) {
    if (
      sentence.start < previous ||
      sentence.start >= sentence.end ||
      sentence.end > offsets.length ||
      sentence.tokenStart > sentence.tokenEnd ||
      sentence.tokenEnd > tokens.length
    )
      throw new Error('Invalid sentence span');
    previous = sentence.end;
  }
  return TextAnalysisSchema.parse({
    schemaVersion: 1,
    sourceText: text,
    sourceHash: await sourceHash(text),
    offsetUnit: OFFSET_UNIT,
    tokenizerVersion: TOKENIZER_VERSION,
    segmenterVersion: SEGMENTER_VERSION,
    sentences,
    tokens,
  });
}
