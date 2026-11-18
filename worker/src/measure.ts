// POST /v1/measure: a writer's draft measured against feature registry v2 (Writing Bank B4).
// The draft is read, measured and answered in memory: it is never written to R2 and never logged.
import {
  DRAFT_MAX_BYTES,
  DraftInputSchema,
  draftSentences,
  measurePreparedDraft,
  prepareDraft,
  type DraftGrammar,
} from '../../src/core/draftMeasure';
import { batchSentences, ParseResultSchema, type ParseResult } from '../../src/core/syntaxParse';
import type { Deps } from './app';
import { publishedError } from './published';

export const MEASURE_PATH = '/v1/measure';
type Headers = Record<string, string>;

/** Parses the draft's body sentences with the topics worker, in batches under its caps; any failure → `failed`. */
async function grammarOf(deps: Deps, token: string, sentences: { key: string; text: string }[]) {
  // A draft with no measured body sentence has nothing to parse; the grammar features stay unavailable.
  if (!deps.nlpParse || !sentences.length) return { status: 'not_configured' } as const;
  try {
    const results: ParseResult[] = [];
    for (const batch of batchSentences(sentences)) {
      const response = await deps.nlpParse(batch, token);
      if (!response.ok) return { status: 'failed' } as const;
      const result = ParseResultSchema.parse(await response.json());
      const keys = new Set(batch.map((item) => item.key));
      const first = results[0];
      if (
        result.sentences.some((sentence) => !keys.has(sentence.key)) ||
        (first && (first.version !== result.version || first.modelVersion !== result.modelVersion))
      )
        return { status: 'failed' } as const;
      results.push(result);
    }
    const first = results[0] as ParseResult;
    return {
      status: 'parsed',
      result: { ...first, sentences: results.flatMap((result) => result.sentences) },
    } as const satisfies DraftGrammar;
  } catch {
    return { status: 'failed' } as const;
  }
}

/** The caller has already checked the Firebase token; `token` is passed on to the grammar service. */
export async function handleMeasure(deps: Deps, request: Request, token: string, headers: Headers) {
  if (request.method !== 'POST') return publishedError(400, 'bad_request', 'Use POST.', headers);
  const tooLarge = () => publishedError(413, 'bad_request', 'Draft request exceeds 200 KB.', headers);
  if (Number(request.headers.get('content-length') ?? '0') > DRAFT_MAX_BYTES) return tooLarge();
  const raw = await request.arrayBuffer();
  if (raw.byteLength > DRAFT_MAX_BYTES) return tooLarge();
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return publishedError(400, 'bad_request', 'Body is not JSON.', headers);
  }
  const input = DraftInputSchema.safeParse(body);
  // Only the failing field paths are echoed back, never the draft's text.
  if (!input.success)
    return publishedError(
      400,
      'bad_request',
      `Invalid draft: ${[...new Set(input.error.issues.map((issue) => issue.path.join('.') || 'body'))].join(', ')}.`,
      headers,
    );
  const prepared = await prepareDraft(input.data);
  const grammar = await grammarOf(deps, token, draftSentences(prepared));
  const measure = await measurePreparedDraft(prepared, grammar);
  return new Response(JSON.stringify(measure), {
    status: 200,
    headers: { ...headers, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
