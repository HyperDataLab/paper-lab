import {
  GenerationInputSchema,
  GenerationOutputSchema,
  PROMPT_VERSIONS,
  type GenerationInput,
  type GenerationOutput,
} from '../prompts';
import { GenerationSchema } from '../schemas/generation';
import { createOffsetIndex } from '../text/offsets';
import { checkProvenance } from './provenance';

export function buildGeneration(
  rawInput: GenerationInput,
  rawOutput: GenerationOutput,
  metadata: { id: string; model: string; createdAt: string },
) {
  const input = GenerationInputSchema.parse(rawInput);
  const output = GenerationOutputSchema.parse(rawOutput);
  const offsets = createOffsetIndex(output.paragraph);
  const checks = checkProvenance(input, output);
  const anchoredChecks: typeof checks.sentences = [];
  const unanchored: {
    sentenceIndex: number;
    text: string;
    check: { id: string; status: 'fail'; detail: string };
  }[] = [];
  let cursor = 0;
  const sentences = output.sentences.flatMap((sentence, sentenceIndex) => {
    const start = output.paragraph.indexOf(sentence.text, cursor);
    if (start < 0) {
      console.warn('Suppressed unanchored generated sentence', sentence.text);
      unanchored.push({
        sentenceIndex,
        text: sentence.text,
        check: { id: 'unanchored_sentence', status: 'fail', detail: 'Không tìm thấy câu trong đoạn.' },
      });
      return [];
    }
    const sentenceCheck = checks.sentences[sentenceIndex];
    if (sentenceCheck) anchoredChecks.push({ ...sentenceCheck, sentenceIndex: anchoredChecks.length });
    cursor = start + sentence.text.length;
    return [{ ...sentence, span: { start: offsets.utf16ToCp(start), end: offsets.utf16ToCp(cursor) } }];
  });
  if (
    sentences.length !== output.sentences.length ||
    sentences
      .map((s) => s.text)
      .join('')
      .replace(/\s/gu, '') !== output.paragraph.replace(/\s/gu, '')
  )
    checks.overall.push({
      id: 'sentence_coverage',
      status: 'fail',
      detail: 'Generated sentences do not cover the paragraph.',
    });
  return GenerationSchema.parse({
    schemaVersion: 1,
    ...metadata,
    input,
    paragraph: output.paragraph,
    sentences,
    needsEvidence: output.needsEvidence,
    checks: { ...checks, sentences: anchoredChecks, unanchored },
    promptVersion: PROMPT_VERSIONS.generation,
  });
}
