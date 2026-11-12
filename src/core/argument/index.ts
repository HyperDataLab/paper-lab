import { locate } from '../reviewPanel';
import type {
  Argument,
  ArgumentOutput,
  ArgumentRun,
  InsightDecision,
  Paper,
  PaperParagraph,
} from '../schemas';
import { planStance, type StanceChunk } from '../stance';
import { insightStates } from '../rhetoric';

const CHUNK_CHARS = 14000;
export const planArguments = (paper: Paper, sectionIds: string[]) =>
  planStance(paper, sectionIds, CHUNK_CHARS);

type Span = Argument['claim'];
type Ref = { paragraphId: string; quote: string };

function resolve(ref: Ref, paragraphs: PaperParagraph[]): Span | null {
  const paragraph = paragraphs.find((p) => p.id === ref.paragraphId);
  const found = paragraph && locate(paragraph.text, ref.quote);
  if (!paragraph || !found) return null;
  return {
    paragraphId: paragraph.id,
    sectionId: paragraph.sectionId,
    page: paragraph.pageStart,
    start: found.start,
    end: found.end,
    excerpt: Array.from(paragraph.text).slice(found.start, found.end).join(''),
  };
}

/**
 * A quote that cannot be found is dropped, and its slot stays empty. A stated warrant that fails is never
 * downgraded to an inferred one, which would turn a failed quote into the analyst's own words.
 */
export function verifyArguments(output: ArgumentOutput, chunk: StanceChunk) {
  const discarded = { claim_not_found: 0, element_not_found: 0, duplicate: 0 };
  const items: Omit<Argument, 'id'>[] = [];
  const seen = new Set<string>();
  const list = (refs: Ref[]) =>
    refs.flatMap((ref) => {
      const span = resolve(ref, chunk.paragraphs);
      if (!span) discarded.element_not_found++;
      return span ? [span] : [];
    });
  const one = (ref: Ref | null) => (ref ? (list([ref])[0] ?? null) : null);
  for (const raw of output.arguments) {
    const claim = resolve(raw.claim, chunk.paragraphs);
    if (!claim) {
      discarded.claim_not_found++;
      continue;
    }
    const key = `${claim.paragraphId}|${claim.start}|${claim.end}`;
    if (seen.has(key)) {
      discarded.duplicate++;
      continue;
    }
    seen.add(key);
    const statedWarrant = one(raw.statedWarrant);
    items.push({
      importance: raw.importance,
      claim,
      claimType: raw.claimType,
      data: list(raw.data),
      statedWarrant,
      inferredWarrant: raw.statedWarrant === null ? raw.inferredWarrant : null,
      backing: list(raw.backing),
      qualifier: one(raw.qualifier),
      rebuttals: list(raw.rebuttals),
    });
  }
  return { items, discarded };
}

export function buildArgumentRun(input: {
  id: string;
  createdAt: string;
  model: string;
  promptVersion: string;
  callsUsed: number;
  sectionIds: string[];
  chunks: StanceChunk[];
  results: Record<string, ArgumentOutput>;
}): ArgumentRun {
  const items: Argument[] = [];
  const discarded = { claim_not_found: 0, element_not_found: 0, duplicate: 0 };
  const failed = new Set<string>();
  for (const chunk of input.chunks) {
    const output = input.results[chunk.id];
    if (!output) {
      chunk.paragraphs.forEach((p) => failed.add(p.sectionId));
      continue;
    }
    const verified = verifyArguments(output, chunk);
    verified.items.forEach((item) => items.push({ ...item, id: `arg-${items.length + 1}` }));
    discarded.claim_not_found += verified.discarded.claim_not_found;
    discarded.element_not_found += verified.discarded.element_not_found;
    discarded.duplicate += verified.discarded.duplicate;
  }
  return {
    id: input.id,
    createdAt: input.createdAt,
    model: input.model,
    promptVersion: input.promptVersion,
    callsUsed: input.callsUsed,
    sectionIds: input.sectionIds,
    failedSectionIds: [...failed],
    arguments: items,
    discarded,
  };
}

export interface ArgumentNode {
  id: string;
  /** I holds content. RA and CA are inference and conflict steps and never hold content themselves. */
  kind: 'I' | 'RA' | 'CA';
  span: Span | null;
}
export interface ArgumentEdge {
  from: string;
  to: string;
}

const overlaps = (a: Span, b: Span) => a.paragraphId === b.paragraphId && a.start < b.end && b.start < a.end;

/** Code derives the graph, so a premise can only reach a conclusion through an RA node. */
export function buildArgumentGraph(items: Argument[]) {
  const nodes: ArgumentNode[] = [];
  const edges: ArgumentEdge[] = [];
  const statement = (span: Span) => {
    const existing = nodes.find((node) => node.kind === 'I' && node.span && overlaps(node.span, span));
    if (existing) return existing.id;
    const id = `i-${nodes.filter((node) => node.kind === 'I').length + 1}`;
    nodes.push({ id, kind: 'I', span });
    return id;
  };
  for (const item of items) {
    const conclusion = statement(item.claim);
    if (item.data.length) {
      const ra = `ra-${item.id}`;
      nodes.push({ id: ra, kind: 'RA', span: null });
      edges.push({ from: ra, to: conclusion });
      for (const datum of item.data) edges.push({ from: statement(datum), to: ra });
      for (const support of [item.statedWarrant, ...item.backing]) {
        if (support) edges.push({ from: statement(support), to: ra });
      }
    }
    item.rebuttals.forEach((rebuttal, index) => {
      const ca = `ca-${item.id}-${index + 1}`;
      nodes.push({ id: ca, kind: 'CA', span: null });
      edges.push({ from: statement(rebuttal), to: ca });
      edges.push({ from: ca, to: conclusion });
    });
  }
  return { nodes, edges };
}

export function argumentMetrics(run: ArgumentRun, decisions: InsightDecision[]) {
  const states = insightStates(run, decisions);
  const live = run.arguments.filter((item) => states.get(item.id) !== 'dismissed');
  const main = live.filter((item) => item.importance === 'main');
  const graph = buildArgumentGraph(live);
  const share = (test: (item: Argument) => boolean) => ({
    count: main.filter(test).length,
    total: main.length,
  });
  const usedAsPremise = (item: Argument) =>
    live.some(
      (other) =>
        other.id !== item.id && [...other.data, ...other.backing].some((span) => overlaps(span, item.claim)),
    );
  return {
    states,
    live,
    main,
    graph,
    withData: share((item) => item.data.length > 0),
    statedWarrant: share((item) => item.statedWarrant !== null),
    inferredWarrant: share((item) => item.inferredWarrant !== null),
    withBacking: share((item) => item.backing.length > 0),
    withQualifier: share((item) => item.qualifier !== null),
    withRebuttal: share((item) => item.rebuttals.length > 0),
    /** Claims with no premise, so no RA node leads into them. */
    unsupported: main.filter((item) => item.data.length === 0),
    /** Supporting claims that no other argument builds on. */
    dangling: live.filter((item) => item.importance === 'supporting' && !usedAsPremise(item)),
  };
}
