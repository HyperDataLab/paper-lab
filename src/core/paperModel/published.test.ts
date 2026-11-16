import { webcrypto, createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { examplePaperModel } from './contract';
import { contentEtag, publishedPaperId } from './published';
import type { PaperModel } from '../schemas';

afterEach(() => vi.unstubAllGlobals());

describe('published paper identity and content', () => {
  it('uses the recorded source digest or the lowercase local UUID', () => {
    const model = examplePaperModel();
    model.document.source.sha256 = `sha256:${'a'.repeat(64)}`;
    expect(publishedPaperId(model, 'unused')).toBe(`sha256-${'a'.repeat(64)}`);
    model.document.source.sha256 = null;
    expect(publishedPaperId(model, 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA')).toBe(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    );
    model.document.source.sha256 = 'invalid';
    expect(() => publishedPaperId(model, 'unused')).toThrow();
  });

  it('hashes JSON without generatedAt and changes when content changes', async () => {
    vi.stubGlobal('crypto', webcrypto);
    const model = examplePaperModel();
    const content: Partial<PaperModel> = { ...model };
    delete content.generatedAt;
    const expected = createHash('sha256').update(JSON.stringify(content)).digest('hex');
    expect(await contentEtag(model)).toBe(expected);
    expect(await contentEtag({ ...model, generatedAt: '2027-01-01T00:00:00.000Z' })).toBe(expected);
    expect(await contentEtag({ ...model, sentences: [] })).not.toBe(expected);
  });
});
