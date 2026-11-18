/** Server caps of POST /nlp/parse are 200 sentences and 100 KB per request; batches stay under both. */
export const NLP_MAX_SENTENCES = 200;
export const NLP_BATCH_BYTES = 90_000;

export type SentenceInput = { key: string; text: string };

const encoder = new TextEncoder();
const size = (item: SentenceInput) => encoder.encode(JSON.stringify(item)).length + 1;

/** Splits into batches of at most `maxSentences` items and about `maxBytes` of JSON. */
export function batchSentences(
  items: SentenceInput[],
  maxSentences = NLP_MAX_SENTENCES,
  maxBytes = NLP_BATCH_BYTES,
) {
  const batches: SentenceInput[][] = [];
  let current: SentenceInput[] = [];
  let bytes = 0;
  for (const item of items) {
    const itemBytes = size(item);
    if (current.length && (current.length >= maxSentences || bytes + itemBytes > maxBytes)) {
      batches.push(current);
      current = [];
      bytes = 0;
    }
    current.push(item);
    bytes += itemBytes;
  }
  if (current.length) batches.push(current);
  return batches;
}
