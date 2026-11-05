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
      for (let repair = 0; repair < 2; repair++) {
        let response: Response | undefined;
        let body: unknown;
        for (let attempt = 0; attempt < 3; attempt++) {
          const controller = new AbortController();
          let timedOut = false;
          const timer = setTimeout(() => {
            timedOut = true;
            controller.abort();
          }, 60000);
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
                temperature: options.temperature ?? 0.1,
                messages,
                response_format: {
                  type: 'json_schema',
                  json_schema: { name: options.schemaName, schema: jsonSchema, strict: true },
                },
              }),
            });
            if (!response.ok) {
              const retryable = [429, 502, 503, 504].includes(response.status);
              if (!retryable || attempt === 2) throw new LlmHttpError(response.status, retryable);
            } else {
              try {
                body = await response.json();
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
          const seconds = Number(response?.headers.get('Retry-After'));
          await deps.sleep(seconds > 0 ? seconds * 1000 : 500 * 2 ** attempt + Math.random() * 250);
          response = undefined;
        }
        const envelope = z
          .object({
            choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1),
            usage: z
              .object({
                prompt_tokens: z.number().optional(),
                completion_tokens: z.number().optional(),
                total_tokens: z.number().optional(),
              })
              .optional(),
          })
          .safeParse(body);
        raw = envelope.success ? (envelope.data.choices[0]?.message.content ?? '') : '';
        try {
          const parsed = options.schema.safeParse(JSON.parse(extractObject(raw)) as unknown);
          if (parsed.success)
            return {
              data: parsed.data,
              meta: {
                model: safe(config.model),
                promptVersion: safe(options.promptVersion),
                latencyMs: deps.now() - start,
                repaired: repair === 1,
                usage: envelope.success ? envelope.data.usage : undefined,
              },
            };
          issues = JSON.stringify(parsed.error.issues);
        } catch {
          issues = 'Invalid JSON object';
        }
        if (repair === 0)
          messages.push(
            { role: 'assistant', content: raw },
            {
              role: 'user',
              content: `Fix these validation issues and return the complete JSON object: ${issues}`,
            },
          );
      }
      throw new InvalidModelOutputError(safe(issues), safe(raw).slice(0, 300));
    },
  };
}
