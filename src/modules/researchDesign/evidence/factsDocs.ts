import type { ResearchDesign } from '@/core/schemas/researchDesign';
import type { PaperModelView } from '@/core/researchDesign/papers';
import type { ExperimentFactsView } from '@/core/researchDesign/facts/experimentFacts';
import { replaceFacts, type FactsDoc } from '@/core/researchDesign/facts/factsDoc';

export type LiveFacts = { facts: ExperimentFactsView; model: PaperModelView };
export type Selection = { paperId: string; factId: string };
/** Local-first PaperLab has no signed-in person; decisions and matches record this value. */
export const WHO = 'local';

/**
 * The facts are PaperLab's, read fresh from the latest measurement run; the project adds only its decisions and
 * matches. `replaceFacts` keeps those of facts that still exist.
 */
export function factsDoc(paperId: string, stored: FactsDoc | undefined, live: LiveFacts): FactsDoc {
  const source = {
    paperlabId: live.facts.paperId,
    etag: live.facts.modelEtag,
    fetchedBy: WHO,
    fetchedAt: live.facts.generatedAt,
  };
  const base = stored
    ? {
        ...stored,
        decisions: follow(stored, live, stored.decisions),
        matches: follow(stored, live, stored.matches ?? {}),
      }
    : { schemaVersion: 1 as const, paperId, source, facts: live.facts, decisions: {}, matches: {} };
  return replaceFacts(base, live.facts, source).doc;
}

/**
 * Fact ids are positions in the latest run (`fact-1`, `fact-2`…), so a review change or a new run can give an id
 * to another fact. A decision or match follows its fact by kind and value; one whose fact is gone is dropped.
 */
function follow<T>(stored: FactsDoc, live: LiveFacts, record: Record<string, T>): Record<string, T> {
  const key = (fact: { kind: string; value: string }) => JSON.stringify([fact.kind, fact.value]);
  const ids = new Map(live.facts.facts.map((fact) => [key(fact), fact.id]));
  return Object.fromEntries(
    Object.entries(record).flatMap(([id, entry]) => {
      const fact = stored.facts.facts.find((item) => item.id === id);
      if (!fact) return [];
      const same = live.facts.facts.find((item) => item.id === id);
      const next = same && key(same) === key(fact) ? id : ids.get(key(fact));
      return next ? [[next, entry] as const] : [];
    }),
  );
}

export function factsDocs(design: ResearchDesign, live: Record<string, LiveFacts>) {
  return Object.fromEntries(
    Object.entries(live).map(([id, entry]) => [id, factsDoc(id, design.facts[id], entry)]),
  ) as Record<string, FactsDoc | undefined>;
}

export function storedDoc(doc: FactsDoc): ResearchDesign['facts'][string] {
  return { ...doc, matches: doc.matches ?? {} };
}
