import { ParseResultSchema, type ParseResult } from '@/core/syntaxParse';

/** Base URL of the worker that serves POST /nlp/parse (the topics worker). Unset → no spaCy provider. */
export const NLP_URL: string | null =
  ((import.meta.env.VITE_NLP_URL as string | undefined) ?? '').trim().replace(/\/+$/u, '') || null;
/** Server caps are 200 sentences and 100 KB per request; batches stay under both. */
export const NLP_MAX_SENTENCES = 200;
export const NLP_BATCH_BYTES = 90_000;

export type SentenceInput = { key: string; text: string };
export interface NlpClient {
  /** Parses every sentence, in batches; keys must be unique. */
  parse(items: SentenceInput[], signal?: AbortSignal): Promise<ParseResult>;
}
export type NlpClientOptions = {
  baseUrl: string;
  getToken: () => Promise<string>;
  fetch?: typeof fetch;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  maxSentences?: number;
  maxBytes?: number;
  /** Extra attempts after a 503 (container starting). */
  retries?: number;
};

const encoder = new TextEncoder();
const size = (item: SentenceInput) => encoder.encode(JSON.stringify(item)).length + 1;

/** Splits into batches of at most `maxSentences` items and about `maxBytes` of JSON. */
export function batchSentences(items: SentenceInput[], maxSentences: number, maxBytes: number) {
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

function abortableSleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

export function createNlpClient(options: NlpClientOptions): NlpClient {
  const fetchImpl = options.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const sleep = options.sleep ?? abortableSleep;
  const retries = options.retries ?? 3;
  async function parseBatch(batch: SentenceInput[], signal?: AbortSignal): Promise<ParseResult> {
    for (let attempt = 0; ; attempt += 1) {
      const token = await options.getToken();
      const response = await fetchImpl(`${options.baseUrl}/nlp/parse`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ sentences: batch }),
        signal,
      });
      if (response.status === 503 && attempt < retries) {
        const wait = Number(response.headers.get('retry-after'));
        await sleep(1000 * (Number.isFinite(wait) && wait > 0 ? Math.min(wait, 20) : 5), signal);
        continue;
      }
      if (!response.ok) throw new Error(`Phân tích cú pháp thất bại (${response.status})`);
      const result = ParseResultSchema.parse(await response.json());
      const keys = new Set(batch.map((item) => item.key));
      if (result.sentences.some((sentence) => !keys.has(sentence.key)))
        throw new Error('Dịch vụ phân tích trả về câu không có trong yêu cầu');
      return result;
    }
  }
  return {
    async parse(items, signal) {
      if (!items.length) throw new RangeError('no sentences to parse');
      if (new Set(items.map((item) => item.key)).size !== items.length)
        throw new RangeError('duplicate keys');
      const batches = batchSentences(
        items,
        options.maxSentences ?? NLP_MAX_SENTENCES,
        options.maxBytes ?? NLP_BATCH_BYTES,
      );
      const results: ParseResult[] = [];
      for (const batch of batches) {
        signal?.throwIfAborted();
        const result = await parseBatch(batch, signal);
        const first = results[0];
        if (first && (first.version !== result.version || first.modelVersion !== result.modelVersion))
          throw new Error('Dịch vụ phân tích đổi phiên bản giữa chừng; chạy lại');
        results.push(result);
      }
      return { ...(results[0] as ParseResult), sentences: results.flatMap((result) => result.sentences) };
    },
  };
}
