import { useEffect, useRef } from 'react';
import type { ResearchDesign } from '@/core/schemas/researchDesign';
import { ResearchDesignConflictError } from '@/shared/storage/researchDesigns';

type Save = (update: (design: ResearchDesign) => ResearchDesign) => Promise<void>;

/**
 * Saves through the provider and, after a version conflict, applies the same change once more to the design the
 * provider then holds (as Research Design re-read and retried once after a 412). Other errors are rethrown.
 */
export function useSaveOnceMore(save: Save) {
  const latest = useRef(save);
  useEffect(() => {
    latest.current = save;
  }, [save]);
  return async (update: (design: ResearchDesign) => ResearchDesign): Promise<'saved' | 'conflict'> => {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await latest.current(update);
        return 'saved';
      } catch (error) {
        if (!(error instanceof ResearchDesignConflictError)) throw error;
      }
    }
    return 'conflict';
  };
}
