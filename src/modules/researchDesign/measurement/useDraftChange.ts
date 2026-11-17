import { useCallback, useLayoutEffect, useRef } from 'react';
import type { DraftError, DraftResult } from '@/core/researchDesign/draft/ops';
import type { Draft } from '@/core/researchDesign/draft/schema';
import type { ResearchDesign } from '@/core/schemas/researchDesign';
import { ResearchDesignConflictError } from '@/shared/storage/researchDesigns';
import { useToast } from '@/shared/ui/toastContext';
import { useResearchDesign } from '../ResearchDesignProvider';
import { errorWords, fallbackError } from './words';

export type Change = (fn: (draft: Draft) => DraftResult) => Promise<boolean>;
type Save = (update: (design: ResearchDesign) => ResearchDesign) => Promise<void>;

class Refused extends Error {
  constructor(readonly code: DraftError) {
    super(code);
  }
}

/**
 * The section's only write path. The op runs against the record being saved, not the rendered draft, and a
 * version conflict is retried once, as Research Design's updateDoc did.
 */
export function useDraftChange(): Change {
  const state = useResearchDesign();
  const toast = useToast();
  const save = useRef<Save | null>(null);
  // A layout effect arms the write path during commit, before any button rendered from this state can be clicked.
  useLayoutEffect(() => {
    save.current = state.loading || state.error ? null : state.save;
  });
  return useCallback(
    async (fn) => {
      const attempt = async () => {
        const current = save.current;
        if (!current) throw new Error('Research design is not loaded');
        await current((record) => {
          const result = fn(record.draft);
          if (!result.ok) throw new Refused(result.error);
          return { ...record, draft: result.doc };
        });
      };
      try {
        try {
          await attempt();
        } catch (error) {
          if (!(error instanceof ResearchDesignConflictError)) throw error;
          await attempt();
        }
        return true;
      } catch (error) {
        toast(
          error instanceof Refused
            ? (errorWords[error.code] ?? fallbackError)
            : error instanceof ResearchDesignConflictError
              ? (errorWords.conflict ?? fallbackError)
              : fallbackError,
        );
        return false;
      }
    },
    [toast],
  );
}
