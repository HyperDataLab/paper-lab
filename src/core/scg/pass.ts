import type {
  PaperModel,
  PaperModelSentence,
  ScgAlignmentOutput,
  ScgContribution,
  ScgContributionDraft,
  ScgContributionOutput,
  ScgDropped,
  ScgPaperRun,
  ScgPrerequisite,
  ScgPrerequisiteOutput,
  ScgReference,
} from '../schemas';
import {
  anchorScgEvidence,
  prefilterScg,
  scgContributionCarryKey,
  scgContributionId,
  scgNameKey,
  scgPrerequisiteCarryKey,
  scgPrerequisiteId,
} from './index';

/**
 * Call bounds per paper: stage 1 at most 5 batches, stage 2 at most 4 groups, stage 3 at most 5 groups,
 * so a paper never takes more than 14 calls (the plan aims at 10-15; SCG itself makes 40+).
 */
export const SCG_LIMITS = {
  contributionBatches: 5,
  batchSentences: 160,
  prerequisiteGroups: 4,
  prerequisiteGroupSize: 4,
  contextSentences: 260,
  references: 150,
  referenceChars: 240,
  alignmentGroups: 5,
  alignmentGroupSize: 6,
  candidates: 8,
} as const;

export const scgHeadings = (model: PaperModel) =>
  new Map(model.document.sections.map((section) => [section.id, section.title]));

/** Stage 1 batches: whole sections in reading order, a long section split, at most 5 batches. */
export function scgContributionBatches(sentences: PaperModelSentence[]) {
  const size = Math.max(
    SCG_LIMITS.batchSentences,
    Math.ceil(sentences.length / SCG_LIMITS.contributionBatches),
  );
  const runs: PaperModelSentence[][] = [];
  for (const sentence of sentences) {
    const last = runs.at(-1);
    if (last?.[0]?.sectionId === sentence.sectionId) last.push(sentence);
    else runs.push([sentence]);
  }
  // Whole sections are packed together; a section that does not fit starts a batch, a long one is split.
  const batches: PaperModelSentence[][] = [];
  let current: PaperModelSentence[] = [];
  for (const run of runs) {
    if (current.length && current.length + run.length > size) {
      batches.push(current);
      current = [];
    }
    for (const sentence of run) {
      if (current.length >= size) {
        batches.push(current);
        current = [];
      }
      current.push(sentence);
    }
  }
  if (current.length) batches.push(current);
  if (batches.length <= SCG_LIMITS.contributionBatches) return batches;
  // Packing whole sections left too many part-full batches: split evenly in reading order instead.
  const even: PaperModelSentence[][] = [];
  for (let i = 0; i < sentences.length; i += size) even.push(sentences.slice(i, i + size));
  return even;
}

/** Upper bound on the LLM calls of one paper, for the button label. */
export function scgCallBound(sentences: PaperModelSentence[]) {
  const batches = scgContributionBatches(sentences).length;
  return batches ? batches + SCG_LIMITS.prerequisiteGroups + SCG_LIMITS.alignmentGroups : 0;
}

const emptyDropped = (): ScgDropped => ({
  quotes: 0,
  contributions: 0,
  prerequisites: 0,
  references: 0,
  matches: 0,
});
export const addDropped = (a: ScgDropped, b: Partial<ScgDropped>): ScgDropped => {
  const sum = { ...a };
  for (const key of Object.keys(sum) as (keyof ScgDropped)[]) sum[key] += b[key] ?? 0;
  return sum;
};
export { emptyDropped as emptyScgDropped };

/** Anchors stage 1 output; a contribution with no anchored quote is dropped. */
export function scgDraftsFromOutput(
  output: ScgContributionOutput,
  sentences: PaperModelSentence[],
  headings: ReadonlyMap<string, string>,
) {
  const byKey = new Map(sentences.map((s) => [s.key, s]));
  const titles = new Set(headings.values());
  const dropped = emptyDropped();
  const drafts: ScgContributionDraft[] = [];
  for (const item of output.contributions) {
    const anchored = anchorScgEvidence(item.evidence, byKey);
    dropped.quotes += anchored.dropped;
    const name = item.name.trim();
    if (!name || !anchored.sourceSentenceKeys.length) {
      dropped.contributions++;
      continue;
    }
    const types = [...new Map(item.types.map((t) => [t.type, t])).values()];
    const sections = new Set(
      anchored.sourceSentenceKeys.flatMap((key) => {
        const title = headings.get(byKey.get(key)?.sectionId ?? '');
        return title ? [title] : [];
      }),
    );
    for (const title of item.sections) if (titles.has(title)) sections.add(title);
    drafts.push({
      name,
      description: item.description.trim(),
      types: types.length ? types : [{ type: 'other', explanation: '' }],
      sections: [...sections],
      sourceSentenceKeys: anchored.sourceSentenceKeys,
    });
  }
  return { drafts, dropped };
}

/** Merges stage 1 batches by name, in batch order, and assigns `<idBase>.c<n>` ids. */
export function scgMergeDrafts(
  batches: ScgContributionDraft[][],
  idBase: string,
  carry: ScgPaperRun['reviewCarry'],
): ScgContribution[] {
  const merged = new Map<string, ScgContributionDraft>();
  for (const draft of batches.flat()) {
    const key = scgNameKey(draft.name);
    const seen = merged.get(key);
    if (!seen) {
      merged.set(key, { ...draft });
      continue;
    }
    const types = new Map(seen.types.map((t) => [t.type, t]));
    for (const t of draft.types) if (!types.has(t.type)) types.set(t.type, t);
    merged.set(key, {
      name: seen.name,
      description: draft.description.length > seen.description.length ? draft.description : seen.description,
      types: [...types.values()],
      sections: [...new Set([...seen.sections, ...draft.sections])],
      sourceSentenceKeys: [...new Set([...seen.sourceSentenceKeys, ...draft.sourceSentenceKeys])],
    });
  }
  return [...merged.values()].map((draft, index) => ({
    ...draft,
    id: scgContributionId(idBase, index),
    prerequisites: [],
    review: carry[scgContributionCarryKey(draft.name)] ?? 'candidate',
  }));
}

const CONTEXT_ROLES = new Set(['introduction', 'related_work', 'methods']);
/** Stage 2 context: introduction, related work and methods; the whole paper when it has none of them. */
export function scgPrerequisiteContext(model: PaperModel) {
  const roles = new Map(model.document.sections.map((s) => [s.id, s.role]));
  const context = model.sentences.filter((s) => CONTEXT_ROLES.has(roles.get(s.sectionId) ?? ''));
  return (context.length ? context : model.sentences).slice(0, SCG_LIMITS.contextSentences);
}
export const scgReferenceLines = (model: PaperModel) =>
  model.document.references.slice(0, SCG_LIMITS.references).map((ref) => ({
    id: ref.id,
    text: ref.text.slice(0, SCG_LIMITS.referenceChars),
  }));

const chunk = <T>(items: T[], groups: number, minSize: number) => {
  const size = Math.max(minSize, Math.ceil(items.length / groups));
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};
export const scgPrerequisiteGroups = (contributions: ScgContribution[]) =>
  chunk(contributions, SCG_LIMITS.prerequisiteGroups, SCG_LIMITS.prerequisiteGroupSize);

const isHttpUrl = (text: string) => {
  try {
    return ['http:', 'https:'].includes(new URL(text).protocol);
  } catch {
    return false;
  }
};

/**
 * Anchors stage 2 output into the contributions of the group. A prerequisite is dropped when its
 * contribution is unknown or no quote anchors; a reference is dropped when the paper does not have it.
 */
export function scgApplyPrerequisites(
  contributions: ScgContribution[],
  groupIds: ReadonlySet<string>,
  output: ScgPrerequisiteOutput,
  model: PaperModel,
  carry: ScgPaperRun['reviewCarry'],
) {
  const byKey = new Map(model.sentences.map((s) => [s.key, s]));
  const refs = new Map(model.document.references.map((ref) => [ref.id, ref]));
  const ids = new Set(contributions.map((c) => c.id));
  const dropped = emptyDropped();
  const added = new Map<string, ScgPrerequisite[]>();
  for (const item of output.prerequisites) {
    const owner = contributions.find((c) => c.id === item.contributionId);
    const anchored = anchorScgEvidence(item.evidence, byKey);
    dropped.quotes += anchored.dropped;
    if (!owner || !groupIds.has(owner.id) || !item.name.trim() || !anchored.sourceSentenceKeys.length) {
      dropped.prerequisites++;
      continue;
    }
    const references: ScgReference[] = [];
    for (const cited of item.references) {
      const ref = refs.get(cited.refId);
      if (!ref) {
        dropped.references++;
        continue;
      }
      const title = cited.title?.trim();
      references.push({
        kind: 'paper',
        refId: ref.id,
        // The title must be in the entry; otherwise the entry itself stands in for it.
        title: title && ref.text.toLowerCase().includes(title.toLowerCase()) ? title : ref.text.slice(0, 200),
        year: ref.year,
        doi: ref.doi,
        s2CorpusId: null,
      });
    }
    const internal = item.internalContributionId;
    if (internal) {
      if (ids.has(internal) && internal !== owner.id)
        references.push({ kind: 'contribution', contributionId: internal });
      else dropped.references++;
    }
    const url = item.toolUrl?.trim();
    if (url) {
      const inText = anchored.sourceSentenceKeys.some((key) => byKey.get(key)?.text.includes(url));
      if (isHttpUrl(url) && inText) references.push({ kind: 'tool', url });
      else dropped.references++;
    }
    const list = added.get(owner.id) ?? [];
    list.push({
      id: '',
      name: item.name.trim(),
      description: item.description.trim(),
      explanation: item.explanation.trim(),
      coreOrPeripheral: item.coreOrPeripheral,
      references,
      matches: [],
      sourceSentenceKeys: anchored.sourceSentenceKeys,
      review: carry[scgPrerequisiteCarryKey(owner.name, item.name.trim())] ?? 'candidate',
    });
    added.set(owner.id, list);
  }
  const next = contributions.map((c) => {
    const extra = added.get(c.id);
    if (!extra) return c;
    const prerequisites = [...c.prerequisites];
    for (const p of extra) prerequisites.push({ ...p, id: scgPrerequisiteId(c.id, prerequisites.length) });
    return { ...c, prerequisites };
  });
  return { contributions: next, dropped };
}

const normDoi = (doi: string | null) => doi?.trim().toLowerCase() ?? null;
/**
 * Stage 3 candidates for each prerequisite: every contribution of a lab paper whose DOI the prerequisite
 * cites, then the lexical prefilter over the rest of the lab graph. The paper's own runs are excluded.
 */
export function scgAlignmentCandidates(run: ScgPaperRun, others: ScgPaperRun[]) {
  const pool = others.filter((o) => o.paperId !== run.paperId && o.idBase !== run.idBase);
  const all = pool.flatMap((o) => o.contributions.filter((c) => c.review !== 'rejected'));
  const byDoi = new Map<string, ScgContribution[]>();
  for (const o of pool) {
    const doi = normDoi(o.doi);
    if (doi)
      byDoi.set(doi, [...(byDoi.get(doi) ?? []), ...o.contributions.filter((c) => c.review !== 'rejected')]);
  }
  const result = new Map<string, ScgContribution[]>();
  for (const c of run.contributions)
    for (const p of c.prerequisites) {
      const cited = p.references.flatMap((r) =>
        r.kind === 'paper' ? (byDoi.get(normDoi(r.doi) ?? '') ?? []) : [],
      );
      const lexical = prefilterScg(p, all, { limit: 5, excludeIdBase: run.idBase });
      const unique = [...new Map([...cited, ...lexical].map((x) => [x.id, x])).values()];
      result.set(p.id, unique.slice(0, SCG_LIMITS.candidates));
    }
  return result;
}
export const scgAlignmentGroups = <T>(items: T[]) =>
  chunk(items, SCG_LIMITS.alignmentGroups, SCG_LIMITS.alignmentGroupSize);

/** Keeps matches whose prerequisite is in the group and whose contribution was offered for it. */
export function scgApplyMatches(
  contributions: ScgContribution[],
  offered: ReadonlyMap<string, ReadonlySet<string>>,
  output: ScgAlignmentOutput,
) {
  let dropped = 0;
  const found = new Map<string, ScgAlignmentOutput['matches']>();
  for (const match of output.matches) {
    if (!offered.get(match.prerequisiteId)?.has(match.contributionId)) {
      dropped++;
      continue;
    }
    found.set(match.prerequisiteId, [...(found.get(match.prerequisiteId) ?? []), match]);
  }
  const next = contributions.map((c) => ({
    ...c,
    prerequisites: c.prerequisites.map((p) => {
      const extra = found.get(p.id);
      if (!extra) return p;
      const matches = [...p.matches];
      for (const m of extra)
        if (!matches.some((x) => x.contributionId === m.contributionId))
          matches.push({
            contributionId: m.contributionId,
            matchType: m.matchType,
            explanation: m.explanation.trim(),
            review: 'candidate',
          });
      return { ...p, matches };
    }),
  }));
  return { contributions: next, dropped: { matches: dropped } };
}
