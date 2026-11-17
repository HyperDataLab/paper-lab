import type { ResearchDesign } from '@/core/schemas/researchDesign';
import {
  clearDecision,
  clearMatch,
  confirmMatch,
  decide,
  type FactsDoc,
} from '@/core/researchDesign/facts/factsDoc';
import type { useResearchDesign } from '../ResearchDesignProvider';
import { factsDoc, factsDocs, storedDoc, WHO, type Selection } from './factsDocs';
import { useSaveOnceMore } from './useSaveOnceMore';

export type Loaded = Extract<ReturnType<typeof useResearchDesign>, { loading: false; error: null }>;
export type EvidenceError = 'not_anchored' | 'reason_required' | 'conflict' | 'network' | 'unknown';
type Outcome = { ok: true } | { ok: false; error: EvidenceError };
type Step = { ok: true; doc: FactsDoc } | { ok: false; error: string };

class StepError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
const known = (code: string): EvidenceError =>
  code === 'not_anchored' || code === 'reason_required' ? code : 'unknown';

export function useEvidence(state: Loaded) {
  const save = useSaveOnceMore(state.save);
  const papers = state.papers.papers.filter((paper) => paper.decision === 'included');
  const docs = factsDocs(state.design, state.facts);

  /**
   * Applies one change to every paper it touches in a single save, so a refusal for one paper writes nothing.
   * The change is computed from the design the save is given; after a version conflict it is applied once more.
   */
  async function apply(paperIds: string[], step: (doc: FactsDoc, paperId: string) => Step): Promise<Outcome> {
    const update = (design: ResearchDesign): ResearchDesign => {
      const facts = { ...design.facts };
      for (const id of paperIds) {
        const live = state.facts[id];
        if (!live) throw new StepError('unknown');
        const result = step(factsDoc(id, design.facts[id], live), id);
        if (!result.ok) throw new StepError(result.error);
        facts[id] = storedDoc(result.doc);
      }
      return { ...design, facts };
    };
    try {
      update(state.design);
    } catch (error) {
      return { ok: false, error: error instanceof StepError ? known(error.code) : 'unknown' };
    }
    try {
      return (await save(update)) === 'saved' ? { ok: true } : { ok: false, error: 'conflict' };
    } catch (error) {
      return { ok: false, error: error instanceof StepError ? known(error.code) : 'network' };
    }
  }

  function change(selected: Selection[], action: 'use' | 'exclude' | 'clear', reason: string | null) {
    const at = new Date().toISOString();
    const groups = new Map<string, string[]>();
    for (const entry of selected)
      groups.set(entry.paperId, [...(groups.get(entry.paperId) ?? []), entry.factId]);
    return apply([...groups.keys()], (doc, id) => {
      const ids = groups.get(id) ?? [];
      const model = state.facts[id]?.model;
      if (!model) return { ok: false, error: 'unknown' };
      return action === 'clear' ? clearDecision(doc, ids) : decide(doc, ids, action, reason, WHO, at, model);
    });
  }

  function match(paperId: string, factId: string, bankId: string | null) {
    const at = new Date().toISOString();
    return apply([paperId], (doc) =>
      bankId === null
        ? { ok: true, doc: clearMatch(doc, factId) }
        : confirmMatch(doc, factId, bankId, state.bank, WHO, at),
    );
  }

  return { papers, docs, change, match };
}
