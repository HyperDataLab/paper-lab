/// <reference types="node" />
import { webcrypto } from 'node:crypto';
import { beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { buildSentenceSyntaxPrompt, PROMPT_VERSIONS, type SentenceSyntaxOutput } from '@/core/prompts';
import { analyzeText } from '@/core/text';
import type { LlmClient } from './client';
import { acceptConsent } from './consent';
import { describeLlmError } from './describeError';
import {
  ConsentRequiredError,
  InvalidModelOutputError,
  LlmConfigError,
  LlmHttpError,
  LlmNetworkError,
  LlmTimeoutError,
} from './errors';
import { createGatedClient } from './gatedClient';
import { createLlmSyntaxProvider, LLM_SYNTAX_PROVIDER_ID, SYNTAX_BATCH_SIZE } from './llmSyntaxProvider';

beforeAll(() => vi.stubGlobal('crypto', webcrypto));
beforeEach(() => localStorage.clear());

function fakeClient(answer: (user: string) => SentenceSyntaxOutput) {
  const calls: string[] = [];
  const client: LlmClient = {
    completeJson: vi.fn(async (options) => {
      calls.push(options.user);
      return {
        data: options.schema.parse(answer(options.user)),
        meta: { model: 'fake-model', promptVersion: options.promptVersion, latencyMs: 1, repaired: false },
      };
    }) as LlmClient['completeJson'],
  };
  return { client, calls };
}
const emptyFor = (user: string): SentenceSyntaxOutput => ({
  sentences: [...user.matchAll(/^(s\d+):/gm)].map((match) => ({
    sentenceId: match[1]!,
    subject: null,
    subjectHead: null,
    mainVerb: null,
    mainVerbHead: null,
    topic: null,
    action: null,
    stress: null,
    voice: 'active',
    clauseCount: 1,
    maxClauseDepth: 0,
    confidence: 0.8,
  })),
});

it('ADR-0004 prompt numbers tokens with global indexes and forbids character offsets', async () => {
  const text = await analyzeText('Cells grow. Roots spread fast.');
  const { system, user } = buildSentenceSyntaxPrompt(text);
  expect(user).toContain('s1: [0]Cells [1]grow [2].');
  expect(user).toContain('s2: [3]Roots [4]spread [5]fast [6].');
  expect(system).toContain('token indexes');
  expect(system).toContain('never character offsets');
  expect(PROMPT_VERSIONS.sentenceSyntax).toBe('sent-syntax-1');
});

it('ADR-0004 provider batches 13 sentences into 2 calls and validates the output', async () => {
  const text = await analyzeText(
    Array.from({ length: 13 }, (_, i) => `Sentence number ${i + 1} is here.`).join(' '),
  );
  const { client, calls } = fakeClient(emptyFor);
  const result = await createLlmSyntaxProvider(client).analyze(text);
  expect(SYNTAX_BATCH_SIZE).toBe(12);
  expect(calls).toHaveLength(2);
  expect(calls[1]).toContain('s13:');
  expect(calls[1]).not.toContain('s12:');
  expect(result.sentences).toHaveLength(13);
  expect(result).toMatchObject({
    provider: 'llm',
    providerVersion: 'sent-syntax-1',
    reproducible: false,
    model: 'fake-model',
  });
  expect(LLM_SYNTAX_PROVIDER_ID).toBe('llm/sent-syntax-1');
});

it('PRD §9 Privacy: the gated provider throws before calling the model without consent', async () => {
  const text = await analyzeText('Cells grow.');
  const { client, calls } = fakeClient(emptyFor);
  const config = { baseUrl: '/llm', model: 'm' };
  const provider = createLlmSyntaxProvider(createGatedClient(config, client));
  await expect(provider.analyze(text)).rejects.toBeInstanceOf(ConsentRequiredError);
  expect(calls).toHaveLength(0);
  acceptConsent(config);
  await expect(provider.analyze(text)).resolves.toMatchObject({ sentences: [{ sentenceId: 's1' }] });
  expect(calls).toHaveLength(1);
});

it('describeLlmError maps every error class to Vietnamese, and cancellations to null', () => {
  expect(describeLlmError(new ConsentRequiredError())).toBeNull();
  expect(describeLlmError(new DOMException('Aborted', 'AbortError'))).toBeNull();
  expect(describeLlmError(new LlmHttpError(401, false))).toBe('Khoá không hợp lệ');
  expect(describeLlmError(new LlmHttpError(500, true))).toBe('Máy chủ trả lỗi HTTP 500');
  expect(describeLlmError(new LlmTimeoutError())).toBe('Hết thời gian chờ phản hồi');
  expect(describeLlmError(new InvalidModelOutputError('x', 'y'))).toBe('Kết quả của mô hình không hợp lệ');
  expect(describeLlmError(new LlmNetworkError())).toBe('Không kết nối được (kiểm tra CORS hoặc mạng)');
  expect(describeLlmError(new LlmConfigError('bad'))).toBe('Cấu hình kết nối chưa hợp lệ (xem Cài đặt)');
  expect(describeLlmError(new Error('?'))).toBe('Đã có lỗi không xác định');
});
