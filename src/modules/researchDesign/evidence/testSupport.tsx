import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { vi } from 'vitest';
import type { ExtractionProject } from '@/core/schemas';
import { emptyResearchDesign, type ResearchDesign } from '@/core/schemas/researchDesign';
import type { BankDoc } from '@/core/researchDesign/bank/snapshot';
import type { ExperimentFactsView } from '@/core/researchDesign/facts/experimentFacts';
import example from '@/core/researchDesign/facts/example.json';
import type { Paper, PaperModelView } from '@/core/researchDesign/papers';
import { ResearchDesignConflictError } from '@/shared/storage/errors';
import type { Loaded } from './useEvidence';

/** Synthetic data only: invented sentences, tables and titles. */
export const facts = example as ExperimentFactsView;
export const projectId = '00000000-0000-4000-8000-000000000001';
const at = '2026-01-01T00:00:00.000Z';
export const model: PaperModelView = {
  format: 'paperlab-paper-model',
  schemaVersion: 1,
  document: {
    source: { kind: 'pdf', sha256: null, pageCount: 3 },
    metadata: { title: 'Invented', authors: [], doi: null, year: null, venue: null },
    sections: [{ id: 's1', parentId: null, title: 'Results', level: 1, role: 'results' }],
    blocks: [{ id: 't1', sectionId: 's1', kind: 'table', page: 3, text: 'Invented table text' }],
  },
  sentences: [
    {
      key: 'f070f37a466398fb#1',
      displayId: 'S1',
      sectionId: 's1',
      page: 2,
      text: 'Invented sentence about accuracy.',
    },
  ],
};
export function paper(index: number, options: { decision?: Paper['decision']; local?: boolean } = {}): Paper {
  return {
    id: `project-paper-${index}`,
    title: `Paper ${index}`,
    authors: [],
    year: null,
    venue: null,
    doi: null,
    decision: options.decision ?? 'included',
    reason: null,
    addedBy: 'local',
    addedAt: at,
    model:
      options.local === false
        ? null
        : {
            paperlab: { paperId: `local-${index}`, etag: facts.modelEtag },
            sourceHash: null,
            sentences: 1,
            importedBy: 'local',
            importedAt: at,
          },
  };
}

type Setup = {
  papers: Paper[];
  live: Record<string, { facts: ExperimentFactsView; model: PaperModelView }>;
  design?: ResearchDesign;
  bank?: BankDoc | null;
  conflicts?: number;
};
const Context = createContext<Loaded | null>(null);
export function useTestDesign() {
  const value = useContext(Context);
  if (!value) throw new Error('Harness is missing');
  return value;
}

/** Stands in for ResearchDesignProvider: `save` applies the update to the held design, as the provider does. */
export function harness(setup: Setup) {
  const saved: ResearchDesign[] = [];
  const box: { conflicts: number; held: ResearchDesign; show: (design: ResearchDesign) => void } = {
    conflicts: setup.conflicts ?? 0,
    held: setup.design ?? emptyResearchDesign(projectId),
    show: () => {},
  };
  const save = vi.fn(async (update: (value: ResearchDesign) => ResearchDesign) => {
    if (box.conflicts > 0) {
      box.conflicts--;
      throw new ResearchDesignConflictError('Research design changed');
    }
    box.held = { ...update(box.held), version: box.held.version + 1 };
    saved.push(box.held);
    box.show(box.held);
  });
  function Harness({ children }: { children: ReactNode }) {
    const [design, setDesign] = useState(box.held);
    useEffect(() => {
      box.show = setDesign;
    }, []);
    const value: Loaded = {
      loading: false,
      error: null,
      project: { id: projectId } as ExtractionProject,
      design,
      bank: setup.bank ?? null,
      papers: { schemaVersion: 1, papers: setup.papers, log: [] },
      facts: setup.live,
      save,
      update: async (change) => {
        await save(change);
        return box.held;
      },
      reload: async () => {},
      importBank: async () => box.held,
      freeze: async () => box.held,
    };
    return <Context.Provider value={value}>{children}</Context.Provider>;
  }
  return { Harness, saved, save };
}
