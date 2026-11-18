import { afterEach, describe, expect, it, vi } from 'vitest';
import { DraftMeasureSchema } from '../../src/core/draftMeasure';
import { handle, type Bucket, type Deps } from './app';

// Synthetic draft only.
const DRAFT = [
  '## Introduction',
  '',
  'Widgets may matter for toy tasks. We study them here.',
  '',
  '## Methods',
  '',
  'The widgets were measured twice. We counted every widget.',
].join('\n');

function setup(overrides: Partial<Deps> = {}) {
  const calls: string[] = [];
  const record =
    (name: string) =>
    async (..._args: unknown[]): Promise<never> => {
      calls.push(name);
      throw new Error(`bucket.${name} must not be called`);
    };
  const bucket: Bucket = {
    head: record('head'),
    get: record('get'),
    list: record('list'),
    put: record('put'),
  };
  const deps: Deps = {
    bucket,
    verifyToken: async (token) => {
      if (token !== 'good') throw new Error('bad token');
      return { uid: '1', email: 'lab@example.org' };
    },
    allowedOrigins: ['https://bank.example.org'],
    now: () => new Date('2026-11-18T00:00:00Z'),
    ...overrides,
  };
  const call = (
    body: string,
    init: { token?: string | null; method?: string; headers?: Record<string, string> } = {},
  ) =>
    handle(
      deps,
      new Request('https://worker.test/v1/measure', {
        method: init.method ?? 'POST',
        headers: {
          ...(init.token === null ? {} : { authorization: `Bearer ${init.token ?? 'good'}` }),
          origin: 'https://bank.example.org',
          'content-type': 'application/json',
          ...init.headers,
        },
        body: init.method === 'GET' ? undefined : body,
      }),
    );
  return { call, calls };
}

afterEach(() => vi.restoreAllMocks());

describe('POST /v1/measure', () => {
  it('measures a signed-in draft without storing or logging it', async () => {
    const logs = [vi.spyOn(console, 'log'), vi.spyOn(console, 'error'), vi.spyOn(console, 'warn')];
    const { call, calls } = setup();
    const response = await call(JSON.stringify({ format: 'markdown', text: DRAFT }));
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe('https://bank.example.org');
    expect(response.headers.get('cache-control')).toBe('no-store');
    const measure = DraftMeasureSchema.parse(await response.json());
    expect(measure.sections.map((section) => [section.heading, section.role, section.paragraphs])).toEqual([
      ['## Introduction', 'INTRODUCTION', 1],
      ['## Methods', 'METHODS', 1],
    ]);
    expect(measure.grammar.status).toBe('not_configured');
    expect(measure.features.find((item) => item.id === 'section.METHODS.passive')).toMatchObject({
      reason: 'grammar_service_unavailable',
    });
    expect(calls).toEqual([]);
    for (const spy of logs) expect(spy).not.toHaveBeenCalled();
  });

  it('answers 401 without a token or with a bad one', async () => {
    const { call } = setup();
    const body = JSON.stringify({ format: 'text', text: DRAFT });
    for (const token of [null, 'bad']) {
      const response = await call(body, { token });
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ error: 'unauthenticated' });
    }
  });

  it('answers 413 over 200 KB, by header or by body', async () => {
    const { call } = setup();
    const big = JSON.stringify({ format: 'text', text: 'Widgets. '.repeat(25_000) });
    const response = await call(big);
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ error: 'bad_request' });
    expect((await call('{}', { headers: { 'content-length': String(300 * 1024) } })).status).toBe(413);
  });

  it('answers 400 for bad JSON, bad shape or a wrong method, without echoing the draft', async () => {
    const { call } = setup();
    expect((await call('not json')).status).toBe(400);
    const wrong = await call(JSON.stringify({ format: 'docx', text: 'Secret synthetic sentence.' }));
    expect(wrong.status).toBe(400);
    const error = (await wrong.json()) as { error: string; message: string };
    expect(error.error).toBe('bad_request');
    expect(error.message).toContain('format');
    expect(error.message).not.toContain('Secret');
    expect((await call(JSON.stringify({ format: 'text', text: '   ' }))).status).toBe(400);
    expect((await call(JSON.stringify({ format: 'text', text: DRAFT, extra: 1 }))).status).toBe(400);
    expect((await call('', { method: 'GET' })).status).toBe(400);
  });

  it('calls the grammar service with the caller token when configured', async () => {
    const seen: { token: string; keys: string[] }[] = [];
    const { call } = setup({
      nlpParse: async (sentences, token) => {
        seen.push({ token, keys: sentences.map((sentence) => sentence.key) });
        return new Response(
          JSON.stringify({
            model: 'toy_model',
            modelVersion: '1',
            spacyVersion: '0',
            version: 'toy-1',
            sentences: sentences.map((sentence) => ({
              key: sentence.key,
              tokens: [],
              root: null,
              voice: /were/u.test(sentence.text) ? 'passive' : 'active',
              tense: 'past',
              modal: null,
            })),
          }),
        );
      },
    });
    const measure = DraftMeasureSchema.parse(
      await (await call(JSON.stringify({ format: 'markdown', text: DRAFT }))).json(),
    );
    expect(seen).toHaveLength(1);
    expect(seen[0]?.token).toBe('good');
    expect(seen[0]?.keys).toHaveLength(4);
    expect(measure.grammar).toEqual({
      status: 'parsed',
      parser: 'toy-1+spacy-0 toy_model-1',
      sentences: 4,
      parsed: 4,
    });
    expect(measure.features.find((item) => item.id === 'section.METHODS.passive')).toEqual({
      id: 'section.METHODS.passive',
      value: 0.5,
      status: 'measured',
    });
  });

  it('degrades to unavailable with a warning when the grammar service fails', async () => {
    for (const nlpParse of [
      async () => new Response('{"error":"nlp starting"}', { status: 503 }),
      async () => new Response('{"sentences":"nope"}'),
      async () => {
        throw new Error('network');
      },
    ]) {
      const { call } = setup({ nlpParse });
      const response = await call(JSON.stringify({ format: 'markdown', text: DRAFT }));
      expect(response.status).toBe(200);
      const measure = DraftMeasureSchema.parse(await response.json());
      expect(measure.grammar.status).toBe('failed');
      expect(measure.warnings.map((warning) => warning.code)).toContain('grammar_service_failed');
      expect(measure.features.find((item) => item.id === 'section.METHODS.tense.past')).toMatchObject({
        reason: 'grammar_service_unavailable',
      });
    }
  });
});
