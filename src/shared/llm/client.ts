import { z, type ZodType } from 'zod';
import { isProxyBaseUrl, validateConfig, type LlmConfig } from './config';
import {
  InvalidModelOutputError,
  LlmConfigError,
  LlmHttpError,
  LlmNetworkError,
  LlmTimeoutError,
} from './errors';

type Options<T> = {
  system: string;
  user: string;
  schema: ZodType<T>;
  schemaName: string;
  promptVersion: string;
  temperature?: number;
  signal?: AbortSignal;
  onRequest?: () => Promise<void>;
  /** Per-request limit; defaults to 60 s. */
  timeoutMs?: number;
};
export type LlmClient = {
  completeJson<T>(options: Options<T>): Promise<{
    data: T;
    meta: { model: string; promptVersion: string; latencyMs: number; repaired: boolean; usage?: unknown };
  }>;
};
type Deps = { fetch: typeof fetch; sleep: (ms: number) => Promise<void>; now: () => number };
const defaults: Deps = {
  fetch: (...args) => fetch(...args),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now(),
};

function extractObject(raw: string): string {
  let start = -1,
    depth = 0,
    quoted = false,
    escaped = false;
  for (let i = 0; i < raw.length; i++) {
    const char = raw[i];
    if (start < 0) {
      if (char === '{') {
        start = i;
        depth = 1;
      }
      continue;
    }
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === '{') depth++;
    else if (char === '}' && --depth === 0) return raw.slice(start, i + 1);
  }
  throw new Error('Invalid JSON object');
}

/** Providers behind a combo may return OpenAI text, content blocks, or a JSON value. */
function contentText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value))
    return value
      .map((part) => {
        if (typeof part === 'string') return part;
        const text = z.object({ text: z.string() }).safeParse(part);
        return text.success ? text.data.text : '';
      })
      .filter(Boolean)
      .join('\n');
  if (value !== null && typeof value === 'object') return JSON.stringify(value);
  return '';
}

/** Some OpenAI-compatible translators return constrained JSON as a function/tool call. */
function messageText(value: unknown): string {
  const message = z
    .object({
      content: z.unknown().optional(),
      tool_calls: z.array(z.object({ function: z.object({ arguments: z.unknown() }) })).optional(),
      function_call: z.object({ arguments: z.unknown() }).optional(),
    })
    .safeParse(value);
  if (!message.success) return '';
  const calls = message.data.tool_calls?.map((call) => contentText(call.function.arguments)) ?? [];
  const legacyCall = message.data.function_call ? contentText(message.data.function_call.arguments) : '';
  return [...calls, legacyCall].find(Boolean) ?? contentText(message.data.content);
}

const ChunkSchema = z.object({
  choices: z
    .array(
      z.object({
        delta: z
          .object({
            content: z.unknown().optional(),
            tool_calls: z
              .array(
                z.object({ index: z.number().optional(), function: z.object({ arguments: z.unknown() }) }),
              )
              .optional(),
          })
          .optional(),
      }),
    )
    .optional(),
  usage: z.unknown().optional(),
});

/**
 * Some 9router providers (e.g. `ag/…` Gemini) answer with server-sent chunks even when no stream was asked
 * for; the deltas are joined back into one chat completion so the JSON contract can be checked as usual.
 */
function parseBody(text: string): unknown {
  if (!/^\s*data:/u.test(text)) return JSON.parse(text) as unknown;
  let content = '';
  const calls = new Map<number, string>();
  let usage: unknown;
  for (const line of text.split(/\r?\n/u)) {
    const data = line.match(/^data:\s?(.*)$/u)?.[1]?.trim();
    if (!data || data === '[DONE]') continue;
    let parsedChunk: unknown;
    try {
      parsedChunk = JSON.parse(data) as unknown;
    } catch {
      continue;
    }
    const chunk = ChunkSchema.safeParse(parsedChunk);
    if (!chunk.success) continue;
    if (chunk.data.usage) usage = chunk.data.usage;
    const delta = chunk.data.choices?.[0]?.delta;
    content += contentText(delta?.content);
    for (const call of delta?.tool_calls ?? [])
      calls.set(call.index ?? 0, (calls.get(call.index ?? 0) ?? '') + contentText(call.function.arguments));
  }
  const toolCalls = [...calls.values()].map((args) => ({ function: { arguments: args } }));
  return {
    choices: [{ message: { content, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) } }],
    ...(usage ? { usage } : {}),
  };
}

export function createLlmClient(config: LlmConfig, deps: Deps = defaults): LlmClient {
  return {
    async completeJson<T>(options: Options<T>) {
      validateConfig(config);
      const proxy = isProxyBaseUrl(config.baseUrl);
      if (!proxy && !config.key) throw new LlmConfigError('API key is required');
      const safe = (value: string) => (config.key ? value.split(config.key).join('[redacted]') : value);
      const jsonSchema = z.toJSONSchema(options.schema);
      const messages = [
        {
          role: 'system',
          content: `${options.system}\nReturn JSON matching this schema:\n${JSON.stringify(jsonSchema)}`,
        },
        { role: 'user', content: options.user },
      ];
      const start = deps.now();
      let issues = '',
        raw = '';
      // Keep requesting the strict contract; only downgrade when the endpoint explicitly rejects it.
      let responseFormat: 'json_schema' | 'json_object' | 'none' = 'json_schema';
      for (let repair = 0; repair < 3; repair++) {
        let response: Response | undefined;
        let body: unknown;
        let formatRejected = false;
        for (let attempt = 0; attempt < 3; attempt++) {
          if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
          await options.onRequest?.();
          const controller = new AbortController();
          let timedOut = false;
          const timer = setTimeout(() => {
            timedOut = true;
            controller.abort();
          }, options.timeoutMs ?? 60000);
          const abort = () => controller.abort();
          options.signal?.addEventListener('abort', abort, { once: true });
          if (options.signal?.aborted) controller.abort();
          try {
            response = await deps.fetch(`${config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...(config.baseUrl.startsWith('https://') && config.key
                  ? { Authorization: `Bearer ${config.key}` }
                  : {}),
              },
              signal: controller.signal,
              body: JSON.stringify({
                model: config.model,
                stream: false,
                temperature: options.temperature ?? 0.1,
                messages,
                ...(responseFormat === 'json_schema'
                  ? {
                      response_format: {
                        type: 'json_schema',
                        json_schema: { name: options.schemaName, schema: jsonSchema, strict: true },
                      },
                    }
                  : responseFormat === 'json_object'
                    ? { response_format: { type: 'json_object' } }
                    : {}),
              }),
            });
            if (!response.ok) {
              if (response.status === 400 && responseFormat !== 'none') {
                const detail = await response
                  .clone()
                  .text()
                  .catch(() => '');
                if (
                  /response_format|json_schema|json_object|structured output|structured-output|not supported|unsupported/iu.test(
                    detail,
                  )
                ) {
                  responseFormat = responseFormat === 'json_schema' ? 'json_object' : 'none';
                  formatRejected = true;
                  break;
                }
              }
              const retryable = [429, 502, 503, 504].includes(response.status);
              if (!retryable || attempt === 2) throw new LlmHttpError(response.status, retryable);
            } else {
              try {
                body = parseBody(await response.text());
              } catch (error) {
                if (controller.signal.aborted) throw error;
                body = null;
              }
              break;
            }
          } catch (error) {
            if (timedOut) throw new LlmTimeoutError();
            if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
            if (error instanceof LlmHttpError) throw error;
            if (attempt === 2) throw new LlmNetworkError();
          } finally {
            clearTimeout(timer);
            options.signal?.removeEventListener('abort', abort);
          }
          if (!formatRejected) {
            const seconds = Number(response?.headers.get('Retry-After'));
            await deps.sleep(seconds > 0 ? seconds * 1000 : 500 * 2 ** attempt + Math.random() * 250);
          }
          response = undefined;
        }
        if (formatRejected) {
          issues = 'The endpoint rejected a JSON response format; retrying with a compatible format.';
          messages.push({
            role: 'user',
            content: `Return one JSON object that matches this exact schema; do not add markdown or commentary. Schema: ${JSON.stringify(jsonSchema)}`,
          });
          continue;
        }
        const envelope = z
          .object({
            choices: z.array(z.object({ message: z.unknown() })).min(1),
            usage: z
              .object({
                prompt_tokens: z.number().optional(),
                completion_tokens: z.number().optional(),
                total_tokens: z.number().optional(),
              })
              .optional(),
          })
          .safeParse(body);
        raw = envelope.success ? messageText(envelope.data.choices[0]?.message) : '';
        try {
          const parsed = options.schema.safeParse(JSON.parse(extractObject(raw)) as unknown);
          if (parsed.success)
            return {
              data: parsed.data,
              meta: {
                model: safe(config.model),
                promptVersion: safe(options.promptVersion),
                latencyMs: deps.now() - start,
                repaired: repair > 0,
                usage: envelope.success ? envelope.data.usage : undefined,
              },
            };
          issues = JSON.stringify(parsed.error.issues);
        } catch {
          issues = raw ? 'Invalid JSON object' : 'The response had no JSON text or tool arguments.';
        }
        if (repair < 2)
          messages.push(
            // An empty assistant turn is rejected by some providers, so only a real answer is echoed back.
            ...(raw ? [{ role: 'assistant', content: raw }] : []),
            {
              role: 'user',
              content: `Your previous answer failed validation. Return a corrected JSON object that matches this exact schema. Do not add markdown or commentary. Schema: ${JSON.stringify(jsonSchema)}. Validation issues: ${issues}`,
            },
          );
      }
      throw new InvalidModelOutputError(safe(issues), safe(raw).slice(0, 300));
    },
  };
}
