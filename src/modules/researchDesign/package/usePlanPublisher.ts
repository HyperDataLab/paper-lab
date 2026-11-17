import { useCallback } from 'react';
import type { ExperimentPlan } from '@/core/researchDesign/plan/schema';
import type { ResearchDesign } from '@/core/schemas/researchDesign';
import { useAuth } from '@/shared/auth/authContext';
import { publishFrozenPlan, PublishPlanError } from '@/shared/pdfStore/published';

export type PublishOutcome = { ok: boolean; text: string; detail: string };

export const NOT_SIGNED_IN = 'Chưa gửi lên máy chủ lab (cần đăng nhập).';

/**
 * Sends frozen plans to the lab's server for SRD and records which versions it holds. Never throws: freezing must not
 * fail because the server is unreachable, so every failure comes back as a message.
 */
export function usePlanPublisher(
  projectId: string,
  update: (change: (design: ResearchDesign) => ResearchDesign) => Promise<ResearchDesign>,
) {
  const { user, ready, getIdToken } = useAuth();
  const signedIn = ready && Boolean(user);
  const publish = useCallback(
    async (plan: ExperimentPlan): Promise<PublishOutcome> => {
      if (!signedIn) return { ok: false, text: NOT_SIGNED_IN, detail: '' };
      const version = plan.planVersion;
      try {
        const token = await getIdToken();
        if (!token) throw new PublishPlanError(401, version);
        const result = await publishFrozenPlan(projectId, plan.title, plan, token);
        // A failed mark is harmless: resending the same version is answered as unchanged and marks it then.
        await update((design) => ({
          ...design,
          publishedPlans: {
            ...design.publishedPlans,
            [String(version)]: { publishedAt: new Date().toISOString() },
          },
        })).catch(() => undefined);
        return {
          ok: true,
          text: result.unchanged
            ? `Phiên bản ${version} đã có sẵn trên máy chủ lab cho SRD.`
            : `Đã gửi phiên bản ${version} lên máy chủ lab cho SRD.`,
          detail: '',
        };
      } catch (error) {
        const reason =
          error instanceof PublishPlanError
            ? error.message
            : 'Không kết nối được máy chủ lab. Vui lòng thử lại.';
        return {
          ok: false,
          text: `Chưa gửi được phiên bản ${version} lên máy chủ lab: ${reason}`,
          detail: error instanceof Error ? error.message : String(error),
        };
      }
    },
    [signedIn, getIdToken, projectId, update],
  );
  return { signedIn, publish };
}
