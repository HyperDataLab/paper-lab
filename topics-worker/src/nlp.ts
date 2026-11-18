// POST /nlp/parse: checked and capped here, then forwarded to the spaCy container (topics-worker/nlp).
export const NLP_PATH = '/nlp/parse';
export const NLP_MAX_BYTES = 100_000;
export const NLP_MAX_SENTENCES = 200;
const MAX_KEY_LENGTH = 128;

type Json = (status: number, value: unknown, extra?: Record<string, string>) => Response;
type Container = (path: string, init?: RequestInit) => Promise<Response>;

function validSentences(body: unknown): boolean {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return false;
  const sentences = (body as { sentences?: unknown }).sentences;
  if (!Array.isArray(sentences) || sentences.length < 1 || sentences.length > NLP_MAX_SENTENCES) return false;
  const keys = new Set<string>();
  for (const item of sentences) {
    if (typeof item !== 'object' || item === null) return false;
    const { key, text } = item as { key?: unknown; text?: unknown };
    if (typeof key !== 'string' || key.length < 1 || key.length > MAX_KEY_LENGTH || keys.has(key))
      return false;
    if (typeof text !== 'string' || !text.trim()) return false;
    keys.add(key);
  }
  return true;
}

/** The caller has already checked the Firebase token. */
export async function parseNlp(
  request: Request,
  container: Container,
  json: Json,
  sleep: (ms: number) => Promise<void>,
): Promise<Response> {
  if (request.method !== 'POST') return json(405, { error: 'method not allowed' });
  if (Number(request.headers.get('content-length') ?? '0') > NLP_MAX_BYTES)
    return json(413, { error: 'payload too large' });
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > NLP_MAX_BYTES) return json(413, { error: 'payload too large' });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json(400, { error: 'invalid JSON' });
  }
  if (!validSentences(body)) return json(400, { error: 'invalid sentences' });
  // A starting container answers in plain text ("Container ..."), not JSON: wait briefly and try again.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (attempt > 0) await sleep(3000);
    let response: Response;
    try {
      response = await container(NLP_PATH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: raw,
      });
    } catch (error) {
      console.error('nlp container error:', error instanceof Error ? error.message : String(error));
      continue;
    }
    const text = await response.text();
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      console.log(
        `nlp container not ready (attempt ${attempt + 1}): ${response.status} ${text.slice(0, 120)}`,
      );
      continue;
    }
    if (response.status === 503) continue;
    return json(response.status, value);
  }
  return json(503, { error: 'nlp starting' }, { 'Retry-After': '10' });
}
