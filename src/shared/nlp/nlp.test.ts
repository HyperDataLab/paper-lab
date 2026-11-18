import { describe, expect, it, vi } from 'vitest';
import type { ParseResult, ParsedSentence } from '@/core/syntaxParse';
import { analyzeText } from '@/core/text';
import { batchSentences, createNlpClient, NLP_URL, type SentenceInput } from './client';
import { createSpacySyntaxProvider, spacySyntaxProviderFromEnv } from './spacySyntaxProvider';

const meta = { model: 'en_core_web_sm', modelVersion: '3.8.0', spacyVersion: '3.8.7', version: 'pl-nlp-1' };
const sentence = (key: string, text: string): ParsedSentence => {
  const words = text.replace(/\.$/u, '').split(' ');
  let offset = 0;
  const tokens = words.map((word, i) => {
    const start = offset;
    offset += word.length + 1;
    return {
      i,
      text: word,
      start,
      end: start + word.length,
      lemma: word.toLowerCase(),
      pos: i === 1 ? 'VERB' : 'NOUN',
      tag: i === 1 ? 'VBD' : 'NNS',
      dep: i === 1 ? 'ROOT' : i === 0 ? 'nsubj' : 'dobj',
      head: 1,
      morph: '',
    };
  });
  return { key, tokens, root: 1, voice: 'active', tense: 'past', modal: null };
};
function server(result: (batch: SentenceInput[]) => Partial<ParseResult> = () => ({})) {
  return vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const batch = (JSON.parse(String(init?.body)) as { sentences: SentenceInput[] }).sentences;
    return Response.json({
      ...meta,
      sentences: batch.map((item) => sentence(item.key, item.text)),
      ...result(batch),
    });
  });
}
const client = (fetch: typeof globalThis.fetch, extra = {}) =>
  createNlpClient({
    baseUrl: 'https://nlp.test',
    getToken: async () => 'tok',
    fetch,
    sleep: async () => {},
    ...extra,
  });

describe('P6 spaCy NLP client', () => {
  it('batches by count and by bytes', () => {
    const items = Array.from({ length: 5 }, (_, i) => ({ key: `k${i}`, text: 'x'.repeat(10) }));
    expect(batchSentences(items, 2, 10_000).map((b) => b.length)).toEqual([2, 2, 1]);
    expect(batchSentences(items, 200, 70).map((b) => b.length)).toEqual([2, 2, 1]);
    expect(batchSentences([{ key: 'big', text: 'x'.repeat(500) }], 200, 60)).toHaveLength(1);
  });

  it('sends signed batches to /nlp/parse and merges the results in order', async () => {
    const fetch = server();
    const items = ['A b c.', 'D e f.', 'G h i.'].map((text, i) => ({ key: `s${i + 1}`, text }));
    const result = await client(fetch, { maxSentences: 2 }).parse(items);
    expect(fetch).toHaveBeenCalledTimes(2);
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe('https://nlp.test/nlp/parse');
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer tok' });
    expect(result.sentences.map((s) => s.key)).toEqual(['s1', 's2', 's3']);
    expect(result.version).toBe('pl-nlp-1');
  });

  it('retries a starting service, then fails on other errors', async () => {
    let calls = 0;
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      calls += 1;
      if (calls === 1) return new Response('{}', { status: 503, headers: { 'Retry-After': '2' } });
      return server()(input, init);
    });
    const sleep = vi.fn(async () => {});
    await client(fetch, { sleep }).parse([{ key: 's1', text: 'A b c.' }]);
    expect(sleep).toHaveBeenCalledWith(2000, undefined);
    const failing = vi.fn(async () => Response.json({ error: 'x' }, { status: 401 }));
    await expect(client(failing).parse([{ key: 's1', text: 'A.' }])).rejects.toThrow('401');
  });

  it('rejects unknown keys, a version change between batches, empty input and an aborted run', async () => {
    const stray = server(() => ({ sentences: [sentence('other', 'A b c.')] }));
    await expect(client(stray).parse([{ key: 's1', text: 'A b c.' }])).rejects.toThrow();
    let n = 0;
    const drifting = server(() => ({ version: `pl-nlp-${++n}` }));
    const two = [
      { key: 'a', text: 'A b c.' },
      { key: 'b', text: 'D e f.' },
    ];
    await expect(client(drifting, { maxSentences: 1 }).parse(two)).rejects.toThrow();
    await expect(client(server()).parse([])).rejects.toThrow(RangeError);
    const controller = new AbortController();
    controller.abort();
    await expect(client(server()).parse(two, controller.signal)).rejects.toThrow();
  });
});

describe('P6 spacySyntaxProvider', () => {
  it('maps parses to S2 sentence syntax and marks the run reproducible', async () => {
    const text = await analyzeText('Raters scored essays. Teams wrote reports.');
    const fetch = server();
    const result = await createSpacySyntaxProvider(client(fetch)).analyze(text);
    expect(result).toMatchObject({
      provider: 'spacy',
      providerVersion: 'pl-nlp-1+spacy-3.8.7',
      model: 'en_core_web_sm-3.8.0',
      reproducible: true,
    });
    const scored = text.tokens.find((t) => t.text === 'scored')?.index;
    const wrote = text.tokens.find((t) => t.text === 'wrote')?.index;
    expect(result.sentences.map((s) => [s.sentenceId, s.mainVerbHead, s.voice])).toEqual([
      ['s1', scored, 'active'],
      ['s2', wrote, 'active'],
    ]);
    const body = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body)) as { sentences: SentenceInput[] };
    expect(body.sentences).toEqual([
      { key: 's1', text: 'Raters scored essays.' },
      { key: 's2', text: 'Teams wrote reports.' },
    ]);
  });

  it('is unavailable when VITE_NLP_URL is not set', () => {
    expect(NLP_URL).toBeNull();
    expect(spacySyntaxProviderFromEnv(async () => 'tok')).toBeNull();
  });
});
