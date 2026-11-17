import { afterEach, describe, expect, it, vi } from 'vitest';
import { examplePaperModel } from '@/core/paperModel/contract';
import { examplePlan } from '@/core/researchDesign/plan/examplePlan';
import { publishFrozenPlan, publishPaperModel, PublishPaperError, PublishPlanError } from './published';

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

describe('publishFrozenPlan', () => {
  it('PUTs the frozen plan unchanged with the title in the query', async () => {
    const plan = examplePlan();
    const fetchMock = vi.fn(async () =>
      Response.json({ projectId: 'p', version: plan.planVersion, etag: 'c'.repeat(64) }, { status: 201 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    expect(await publishFrozenPlan('Proj 1', 'Tên & kế hoạch', plan, 'test-token')).toEqual({
      unchanged: false,
      etag: 'c'.repeat(64),
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(
        new RegExp(`/v1/projects/Proj%201/plans/${plan.planVersion}\\?title=T%C3%AAn%20%26%20k`, 'u'),
      ),
      {
        method: 'PUT',
        headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
        body: JSON.stringify(plan),
      },
    );
  });

  it('reports a write-once resend as unchanged', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ unchanged: true })),
    );
    expect(await publishFrozenPlan('p', 't', examplePlan(), 'token')).toEqual({
      unchanged: true,
      etag: null,
    });
  });

  it.each([
    [401, 'Phiên đăng nhập'],
    [403, 'Tài khoản'],
    [409, 'nội dung khác'],
    [422, 'chưa hợp lệ'],
    [400, 'lỗi 400'],
    [503, 'lỗi 503'],
  ])('maps HTTP %i to a Vietnamese reason', async (status, text) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status })),
    );
    const failure = publishFrozenPlan('p', 't', examplePlan(), 'token');
    await expect(failure).rejects.toBeInstanceOf(PublishPlanError);
    await expect(failure).rejects.toThrow(text);
  });
});
