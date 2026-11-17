import type { ResearchDesign } from '@/core/schemas/researchDesign';
import type { Draft } from '@/core/researchDesign/draft/schema';
import type { DraftResult } from '@/core/researchDesign/draft/ops';

export async function saveDraftChange(
  save: (update: (record: ResearchDesign) => ResearchDesign) => Promise<void>,
  change: (draft: Draft) => DraftResult,
  toast: (message: string) => void,
): Promise<boolean> {
  try {
    await save((record) => {
      const result = change(record.draft);
      if (!result.ok) throw new Error(result.error);
      return { ...record, draft: result.doc };
    });
    return true;
  } catch {
    toast('Không lưu được thay đổi. Vui lòng tải lại và thử lại.');
    return false;
  }
}
