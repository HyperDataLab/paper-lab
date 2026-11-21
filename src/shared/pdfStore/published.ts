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

export async function publishPaperModel(model: PaperModel, localPaperId: string, token: string, projectId: string) {
  const id = publishedPaperId(model, localPaperId);
  const response = await fetch(`${PDF_WORKER_URL}/v1/papers/${encodeURIComponent(id)}/model`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'X-Project-Id': projectId, 'Content-Type': 'application/json' },
    body: JSON.stringify(model),
  });
  if (!response.ok) throw new PublishPaperError(response.status);
  return PublishResultSchema.parse(await response.json());
}

export class PublishPlanError extends Error {
  constructor(
    public status: number,
    version: number,
  ) {
    super(
      status === 401
        ? 'Phiên đăng nhập đã hết hạn.'
        : status === 403
          ? 'Tài khoản này không được gửi kế hoạch lên máy chủ lab.'
          : status === 409
            ? `Máy chủ lab đã có phiên bản ${version} với nội dung khác; phiên bản đã đóng băng không thay đổi được.`
            : status === 422
              ? 'Máy chủ lab thấy kế hoạch chưa hợp lệ.'
              : status < 500
                ? `Máy chủ lab không nhận kế hoạch (lỗi ${status}).`
                : `Máy chủ lab gặp lỗi ${status}. Vui lòng thử lại.`,
    );
  }
}

// The worker answers 201 { projectId, version, etag } for a new version and 200 { unchanged: true } for a resend.
const PlanPublishResultSchema = z.looseObject({
  unchanged: z.boolean().optional(),
  etag: z.string().optional(),
});

/**
 * Sends one frozen plan exactly as stored, so SRD can read it. The title goes in `?title=` because the body must
 * stay the frozen plan: the server compares its hash to decide write-once.
 */
export async function publishFrozenPlan(
  projectId: string,
  title: string,
  plan: { planVersion: number },
  token: string,
  hubProjectId: string,
) {
  const version = plan.planVersion;
  const response = await fetch(
    `${PDF_WORKER_URL}/v1/projects/${encodeURIComponent(projectId)}/plans/${version}?title=${encodeURIComponent(title)}`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'X-Project-Id': hubProjectId, 'Content-Type': 'application/json' },
      body: JSON.stringify(plan),
    },
  );
  if (!response.ok) throw new PublishPlanError(response.status, version);
  const body = PlanPublishResultSchema.safeParse(await response.json().catch(() => ({})));
  return {
    unchanged: body.success && body.data.unchanged === true,
    etag: (body.success && body.data.etag) || null,
  };
}

export async function publishExperimentFacts(facts: ExperimentFacts, token: string, projectId: string) {
  const response = await fetch(
    `${PDF_WORKER_URL}/v1/papers/${encodeURIComponent(facts.paperId)}/experiment-facts`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'X-Project-Id': projectId, 'Content-Type': 'application/json' },
      body: JSON.stringify(facts),
    },
  );
  if (!response.ok) throw new PublishPaperError(response.status, 'facts');
  return PublishResultSchema.parse(await response.json());
}
