import { locate } from '../reviewPanel';
import type {
  AbstractAlignmentOutput,
  AbstractClaim,
  InsightDecision,
  Paper,
  PaperParagraph,
  RhetoricCategory,
  RhetoricItem,
  RhetoricOutput,
  RhetoricRun,
} from '../schemas';
import { planStance, type StanceChunk } from '../stance';

export const CARS_MOVES: RhetoricCategory[] = ['territory', 'niche', 'occupy'];
export const DISCUSSION_MOVES: RhetoricCategory[] = [
  'result_statement',
  'comparison',
  'explanation',
  'limitation',
  'implication',
];
export const VALIDITY_THREATS: RhetoricCategory[] = [
  'threat_internal',
  'threat_external',
  'threat_construct',
  'threat_conclusion',
];
export const AVAILABILITY: RhetoricCategory[] = ['data_availability', 'code_availability'];
/** Enough to compare against without one request carrying the whole paper. */
const ALIGNMENT_BODY_CHARS = 40000;
const SKIP_HEADING =
  /^(front matter|acknowledg|funding|author contribution|conflicts? of interest|competing interest)/iu;

/** Data-availability statements are kept in on purpose, unlike the stance sections. */
export function defaultRhetoricSections(paper: Paper) {
  const prose = new Set(paper.paragraphs.filter((p) => p.kind === 'body').map((p) => p.sectionId));
  return paper.sections
    .filter(
      (section) =>
        prose.has(section.id) &&
        !['references', 'appendix'].includes(section.role) &&
        !SKIP_HEADING.test(section.heading),
    )
    .map((section) => section.id);
}

export const planRhetoric = (paper: Paper, sectionIds: string[]) => planStance(paper, sectionIds);

export function alignmentInputs(paper: Paper, sectionIds: string[]) {
  const selected = new Set(sectionIds);
  const inRole = (roles: string[]) => {
    const ids = new Set(
      paper.sections.filter((s) => roles.includes(s.role) && selected.has(s.id)).map((s) => s.id),
    );
    return paper.paragraphs.filter((p) => p.kind === 'body' && ids.has(p.sectionId));
  };
  const abstract = inRole(['abstract']);
  const body: PaperParagraph[] = [];
  let size = 0;
  for (const paragraph of inRole(['results', 'discussion', 'conclusion'])) {
    if (size + paragraph.text.length > ALIGNMENT_BODY_CHARS) break;
    body.push(paragraph);
    size += paragraph.text.length;
  }
  return { abstract, body };
}

function span(paragraph: PaperParagraph, quote: string) {
  const found = locate(paragraph.text, quote);
  if (!found) return null;
  return {
    paragraphId: paragraph.id,
    sectionId: paragraph.sectionId,
    page: paragraph.pageStart,
    start: found.start,
    end: found.end,
    excerpt: Array.from(paragraph.text).slice(found.start, found.end).join(''),
  };
}

/** A candidate survives only if code can find its quote in the paragraph the model named. */
export function verifyRhetoric(output: RhetoricOutput, chunk: StanceChunk) {
  const items: Omit<RhetoricItem, 'id'>[] = [];
  const discarded = { not_found: 0, duplicate: 0 };
  const seen = new Set<string>();
  for (const raw of output.items) {
    const paragraph = chunk.paragraphs.find((p) => p.id === raw.paragraphId);
    const located = paragraph && span(paragraph, raw.quote);
    if (!located) {
      discarded.not_found++;
      continue;
    }
    const key = `${raw.category}|${located.paragraphId}|${located.start}|${located.end}`;
    if (seen.has(key)) {
      discarded.duplicate++;
      continue;
    }
    seen.add(key);
    items.push({ ...located, category: raw.category, rationale: raw.rationale });
  }
  return { items, discarded };
}

export function verifyAlignment(
  output: AbstractAlignmentOutput,
  abstract: PaperParagraph[],
  body: PaperParagraph[],
) {
  let notFound = 0;
  const claims: AbstractClaim[] = [];
  for (const raw of output.claims) {
    const source = abstract.find((p) => p.id === raw.abstractParagraphId);
    const claim = source && span(source, raw.abstractQuote);
    if (!claim) {
      notFound++;
      continue;
    }
    const target = body.find((p) => p.id === raw.supportParagraphId);
    const support = target && raw.supportQuote ? span(target, raw.supportQuote) : null;
    if (raw.supportQuote && !support) notFound++;
    claims.push({ id: `ac-${claims.length + 1}`, claim, support: support ?? null, rationale: raw.rationale });
  }
  return { claims, notFound };
}

export function buildRhetoricRun(input: {
  id: string;
  createdAt: string;
  model: string;
  promptVersion: string;
  callsUsed: number;
  sectionIds: string[];
  chunks: StanceChunk[];
  results: Record<string, RhetoricOutput>;
  alignment: { output: AbstractAlignmentOutput | null; abstract: PaperParagraph[]; body: PaperParagraph[] };
}): RhetoricRun {
  const items: RhetoricItem[] = [];
  const discarded = { not_found: 0, duplicate: 0 };
  const failed = new Set<string>();
  for (const chunk of input.chunks) {
    const output = input.results[chunk.id];
    if (!output) {
      chunk.paragraphs.forEach((p) => failed.add(p.sectionId));
      continue;
    }
    const verified = verifyRhetoric(output, chunk);
    verified.items.forEach((item) => items.push({ ...item, id: `rh-${items.length + 1}` }));
    discarded.not_found += verified.discarded.not_found;
    discarded.duplicate += verified.discarded.duplicate;
  }
  const aligned = input.alignment.output
    ? verifyAlignment(input.alignment.output, input.alignment.abstract, input.alignment.body)
    : null;
  discarded.not_found += aligned?.notFound ?? 0;
  return {
    id: input.id,
    createdAt: input.createdAt,
    model: input.model,
    promptVersion: input.promptVersion,
    callsUsed: input.callsUsed,
    sectionIds: input.sectionIds,
    failedSectionIds: [...failed],
    items,
    abstractClaims: aligned?.claims ?? [],
    abstractChecked: aligned !== null,
    discarded,
  };
}

export type InsightState = 'confirmed' | 'dismissed';
export function insightStates(run: { id: string }, decisions: InsightDecision[]) {
  const states = new Map<string, InsightState>();
  for (const decision of decisions) {
    if (decision.run_id !== run.id) continue;
    if (decision.decision === 'reopen') states.delete(decision.item_id);
    else states.set(decision.item_id, decision.decision === 'confirm' ? 'confirmed' : 'dismissed');
  }
  return states;
}

export function rhetoricMetrics(run: RhetoricRun, decisions: InsightDecision[]) {
  const states = insightStates(run, decisions);
  const live = run.items.filter((item) => states.get(item.id) !== 'dismissed');
  const present = (categories: RhetoricCategory[]) =>
    categories.filter((category) => live.some((item) => item.category === category));
  const claims = run.abstractClaims.filter((claim) => states.get(claim.id) !== 'dismissed');
  return {
    states,
    live,
    cars: present(CARS_MOVES),
    discussion: present(DISCUSSION_MOVES),
    threats: present(VALIDITY_THREATS),
    availability: present(AVAILABILITY),
    claims,
    supported: claims.filter((claim) => claim.support !== null).length,
  };
}
