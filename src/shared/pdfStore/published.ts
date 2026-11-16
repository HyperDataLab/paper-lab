import { z } from 'zod';
import { publishedPaperId } from '@/core/paperModel/published';
import type { ExperimentFacts, PaperModel } from '@/core/schemas';
import { PDF_WORKER_URL } from './index';

const PublishResultSchema = z.object({
  paperId: z.string(),
  etag: z.string().regex(/^[0-9a-f]{64}$/u),
  updatedAt: z.iso.datetime(),
  unchanged: z.boolean(),
});

export class PublishPaperError extends Error {
  constructor(
    public status: number,
    subject: 'model' | 'facts' = 'model',
  ) {
    super(
      status === 401
        ? 'Phiên đăng nhập đã hết hạn.'
        : status === 403
          ? 'Tài khoản này không được công bố lên máy chủ lab.'
          : subject === 'facts' && status === 409
            ? 'Dữ kiện thí nghiệm không khớp với paper model đã công bố.'
            : status < 500
              ? `Máy chủ lab không chấp nhận paper model (lỗi ${status}).`
              : `Máy chủ lab gặp lỗi ${status}. Vui lòng thử lại.`,
    );
  }
}

export async function publishPaperModel(model: PaperModel, localPaperId: string, token: string) {
  const id = publishedPaperId(model, localPaperId);
  const response = await fetch(`${PDF_WORKER_URL}/v1/papers/${encodeURIComponent(id)}/model`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(model),
  });
  if (!response.ok) throw new PublishPaperError(response.status);
  return PublishResultSchema.parse(await response.json());
}

export async function publishExperimentFacts(facts: ExperimentFacts, token: string) {
  const response = await fetch(
    `${PDF_WORKER_URL}/v1/papers/${encodeURIComponent(facts.paperId)}/experiment-facts`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(facts),
    },
  );
  if (!response.ok) throw new PublishPaperError(response.status, 'facts');
  return PublishResultSchema.parse(await response.json());
}
