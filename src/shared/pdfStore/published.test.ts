import { afterEach, describe, expect, it, vi } from 'vitest';
import { examplePaperModel } from '@/core/paperModel/contract';
import { publishPaperModel, PublishPaperError } from './published';

afterEach(() => vi.unstubAllGlobals());
const noHashModel = () => {
  const model = examplePaperModel();
  model.document.source.sha256 = null;
  return model;
};

describe('publishPaperModel', () => {
  it('sends the model with the token and parses the response', async () => {
    const model = examplePaperModel();
    model.document.source.sha256 = `sha256:${'a'.repeat(64)}`;
    const result = {
      paperId: `sha256-${'a'.repeat(64)}`,
      etag: 'b'.repeat(64),
      updatedAt: '2026-01-01T00:00:00.000Z',
      unchanged: false,
    };
    const fetchMock = vi.fn(async () => Response.json(result));
    vi.stubGlobal('fetch', fetchMock);
    expect(await publishPaperModel(model, 'unused', 'test-token')).toEqual(result);
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining(`/v1/papers/${result.paperId}/model`), {
      method: 'PUT',
      headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
      body: JSON.stringify(model),
    });
  });

  it.each([401, 403, 400, 500])('maps HTTP %i to a Vietnamese error', async (status) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status })),
    );
    await expect(publishPaperModel(noHashModel(), 'id', 'token')).rejects.toBeInstanceOf(PublishPaperError);
    await expect(publishPaperModel(noHashModel(), 'id', 'token')).rejects.toThrow(
      status === 401 ? 'Phiên đăng nhập' : status === 403 ? 'Tài khoản' : 'Máy chủ lab',
    );
  });
  it('rejects malformed successful responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ unchanged: true })),
    );
    await expect(publishPaperModel(noHashModel(), 'id', 'token')).rejects.toThrow();
  });
});
