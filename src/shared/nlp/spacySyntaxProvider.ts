import type { SyntaxProvider, SyntaxResult } from '@/core/analysis';
import { sentenceSyntaxFromParse } from '@/core/syntaxParse';
import { sliceCp } from '@/core/text';
import { createNlpClient, NLP_URL, type NlpClient } from './client';

export const SPACY_SYNTAX_PROVIDER = 'spacy';

/** ADR-0004 optional provider: spaCy over HTTP, re-aligned to S2 tokens; reproducible for a fixed service version. */
export function createSpacySyntaxProvider(client: NlpClient): SyntaxProvider {
  return {
    async analyze(text, signal): Promise<SyntaxResult> {
      const items = text.sentences
        .map((sentence) => ({
          key: sentence.id,
          text: sliceCp(text.sourceText, sentence.start, sentence.end),
        }))
        .filter((item) => item.text.trim());
      const result = items.length ? await client.parse(items, signal) : null;
      const byKey = new Map(result?.sentences.map((sentence) => [sentence.key, sentence]));
      return {
        provider: SPACY_SYNTAX_PROVIDER,
        providerVersion: result ? `${result.version}+spacy-${result.spacyVersion}` : 'none',
        reproducible: true,
        model: result ? `${result.model}-${result.modelVersion ?? 'unknown'}` : null,
        sentences: text.sentences.map((sentence) =>
          sentenceSyntaxFromParse(byKey.get(sentence.id), sentence, text),
        ),
      };
    },
  };
}

/** The spaCy client from `VITE_NLP_URL`, or null when it is not set: callers then skip or use the LLM provider. */
export function nlpClientFromEnv(getToken: () => Promise<string>): NlpClient | null {
  return NLP_URL ? createNlpClient({ baseUrl: NLP_URL, getToken }) : null;
}

export function spacySyntaxProviderFromEnv(getToken: () => Promise<string>): SyntaxProvider | null {
  const client = nlpClientFromEnv(getToken);
  return client ? createSpacySyntaxProvider(client) : null;
}
