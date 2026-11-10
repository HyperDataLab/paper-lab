import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import type { Paper, Section } from '@/core/schemas';
import { budgetFor, getRunDefaults } from '@/shared/llm/runDefaults';

/**
 * The sections a reader wants analysed, chosen once per paper and shared by every analysis.
 * Stored in the browser only. `null` means "not chosen yet", and each analysis then uses its own default.
 */
const listeners = new Set<() => void>();
const key = (paperId: string) => `pl.scope.${paperId}`;

function read(paperId: string): string | null {
  try {
    return localStorage.getItem(key(paperId));
  } catch {
    return null;
  }
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export const isMainBody = (section: Section) =>
  !['references', 'appendix'].includes(section.role) && !/^(front matter|acknowledg)/i.test(section.heading);

/** The main-body sections that hold body paragraphs: the default for analyses that had none. */
export function mainBodySections(paper: Paper): string[] {
  const withBody = new Set(paper.paragraphs.filter((p) => p.kind === 'body').map((p) => p.sectionId));
  return paper.sections.filter((section) => isMainBody(section) && withBody.has(section.id)).map((s) => s.id);
}

export function usePaperScope(paper: Paper, fallback: (paper: Paper) => string[]) {
  const raw = useSyncExternalStore(
    subscribe,
    () => read(paper.id),
    () => null,
  );
  const sections = useMemo(() => {
    const known = new Set(paper.sections.map((section) => section.id));
    try {
      const saved: unknown = raw ? JSON.parse(raw) : null;
      // Ids from before a re-import no longer exist; drop them rather than send nothing.
      if (Array.isArray(saved))
        return saved.filter((id): id is string => typeof id === 'string' && known.has(id));
    } catch {
      /* fall through to the default */
    }
    return fallback(paper);
    // The fallback is a pure function of the paper; listing it would recompute on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raw, paper]);
  const setSections = useCallback(
    (ids: string[]) => {
      try {
        localStorage.setItem(key(paper.id), JSON.stringify(ids));
      } catch {
        /* the choice then lasts for this visit only */
      }
      for (const listener of listeners) listener();
    },
    [paper.id],
  );
  return [sections, setSections] as const;
}

/** The call ceiling for a run: the Settings default for this estimate, unless the reader typed one. */
export function useRunBudget(estimate: number) {
  const [defaults] = useState(getRunDefaults);
  const [override, setOverride] = useState<number | null>(null);
  return {
    budget: override ?? budgetFor(estimate, defaults),
    custom: override !== null,
    /** An empty or invalid entry goes back to the Settings default. */
    setBudget: (value: string | number) => {
      const number = Math.floor(Number(value));
      setOverride(value === '' || !Number.isFinite(number) || number < 0 ? null : number);
    },
  };
}
