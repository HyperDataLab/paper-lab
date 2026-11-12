import { locate } from '../reviewPanel';
import type { Paper, PaperParagraph, Section } from '../schemas/paper';
import {
  ENGAGEMENT_CATEGORIES,
  STANCE_CATEGORIES,
  type StanceAnnotation,
  type StanceCategory,
  type StanceDecision,
  type StanceOutput,
  type StanceRun,
} from '../schemas/stance';

const CHUNK_CHARS = 7000;

export interface StanceChunk {
  id: string;
  paragraphs: PaperParagraph[];
}

export const isStanceSection = (section: Pick<Section, 'role' | 'heading'>) =>
  !['references', 'appendix'].includes(section.role) &&
  !/^(front matter|acknowledg|funding|author contribution|conflict of interest|competing interest|data availability)/i.test(
    section.heading,
  );

/** Prose only: tables, captions, equations and lists would distort both the markers and the word count. */
const proseOf = (paper: Paper, sectionIds: string[]) => {
  const selected = new Set(sectionIds);
  return paper.paragraphs.filter((p) => selected.has(p.sectionId) && p.kind === 'body');
};

export function defaultStanceSections(paper: Paper) {
  const prose = new Set(paper.paragraphs.filter((p) => p.kind === 'body').map((p) => p.sectionId));
  return paper.sections.filter((s) => prose.has(s.id) && isStanceSection(s)).map((s) => s.id);
}

/** Chunks break between paragraphs, so a marker is never read without its sentence. */
export function planStance(paper: Paper, sectionIds: string[], chunkChars = CHUNK_CHARS): StanceChunk[] {
  const chunks: StanceChunk[] = [];
  let current: StanceChunk | undefined;
  let size = 0;
  for (const paragraph of proseOf(paper, sectionIds)) {
    if (!current || size + paragraph.text.length > chunkChars) {
      current = { id: `chunk-${chunks.length + 1}`, paragraphs: [] };
      chunks.push(current);
      size = 0;
    }
    current.paragraphs.push(paragraph);
    size += paragraph.text.length;
  }
  return chunks;
}

/** Counts word tokens; a hyphenated term or a contraction is one word. */
export function countWords(text: string) {
  return text.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu)?.length ?? 0;
}

const SELF = /\b(?:i|we|me|us|my|our|mine|ours|the authors?|this author)\b/iu;
const READER = /\b(?:you|your|yours|we|us|our|one|one's|readers?)\b/iu;

/** Checks the form only. Whether a form serves that function in context is for the model and the reviewer. */
function wrongForm(category: StanceCategory, marker: string, quote: string) {
  if (category === 'self_mention') return !SELF.test(marker);
  if (category === 'reader_pronouns') return !READER.test(marker);
  if (category === 'questions') return !quote.includes('?');
  return false;
}

export interface VerifiedChunk {
  annotations: Omit<StanceAnnotation, 'id'>[];
  discarded: StanceRun['discarded'];
}

/** Keeps a candidate only if code can find it in the paragraph the model named. */
export function verifyStance(output: StanceOutput, chunk: StanceChunk): VerifiedChunk {
  const annotations: VerifiedChunk['annotations'] = [];
  const discarded = { not_found: 0, wrong_form: 0, duplicate: 0 };
  const seen = new Set<string>();
  for (const raw of output.annotations) {
    const paragraph = chunk.paragraphs.find((item) => item.id === raw.paragraphId);
    const span = paragraph && raw.marker.trim() ? locate(paragraph.text, raw.quote) : null;
    if (!paragraph || !span) {
      discarded.not_found++;
      continue;
    }
    const chars = Array.from(paragraph.text);
    const excerpt = chars.slice(span.start, span.end).join('');
    const inner = locate(excerpt, raw.marker.trim());
    if (!inner) {
      discarded.not_found++;
      continue;
    }
    const start = span.start + inner.start;
    const end = span.start + inner.end;
    const marker = chars.slice(start, end).join('');
    if (wrongForm(raw.category, marker, excerpt)) {
      discarded.wrong_form++;
      continue;
    }
    const key = `${paragraph.id}:${start}:${end}:${raw.category}`;
    if (seen.has(key)) {
      discarded.duplicate++;
      continue;
    }
    seen.add(key);
    annotations.push({
      paragraphId: paragraph.id,
      sectionId: paragraph.sectionId,
      page: paragraph.pageStart,
      category: raw.category,
      marker,
      start,
      end,
      excerpt,
      rationale: raw.rationale,
    });
  }
  return { annotations, discarded };
}

export function buildStanceRun(input: {
  id: string;
  createdAt: string;
  model: string;
  promptVersion: string;
  callsUsed: number;
  sectionIds: string[];
  chunks: StanceChunk[];
  results: Record<string, StanceOutput>;
}): StanceRun {
  const annotations: StanceAnnotation[] = [];
  const discarded = { not_found: 0, wrong_form: 0, duplicate: 0 };
  const words: Record<string, number> = {};
  const failed = new Set<string>();
  for (const chunk of input.chunks) {
    const output = input.results[chunk.id];
    if (!output) {
      chunk.paragraphs.forEach((p) => failed.add(p.sectionId));
      continue;
    }
    for (const paragraph of chunk.paragraphs)
      words[paragraph.sectionId] = (words[paragraph.sectionId] ?? 0) + countWords(paragraph.text);
    const verified = verifyStance(output, chunk);
    verified.annotations.forEach((item) =>
      annotations.push({ ...item, id: `sa-${String(annotations.length + 1).padStart(4, '0')}` }),
    );
    discarded.not_found += verified.discarded.not_found;
    discarded.wrong_form += verified.discarded.wrong_form;
    discarded.duplicate += verified.discarded.duplicate;
  }
  return {
    id: input.id,
    createdAt: input.createdAt,
    model: input.model,
    promptVersion: input.promptVersion,
    callsUsed: input.callsUsed,
    sectionIds: input.sectionIds,
    words,
    failedSectionIds: [...failed],
    annotations,
    discarded,
  };
}

export type StanceState = 'candidate' | 'confirmed' | 'dismissed';

export function stanceStates(run: StanceRun, decisions: StanceDecision[]) {
  const states = new Map<string, StanceState>();
  for (const decision of decisions) {
    if (decision.run_id !== run.id) continue;
    if (decision.decision === 'reopen') states.delete(decision.annotation_id);
    else states.set(decision.annotation_id, decision.decision === 'confirm' ? 'confirmed' : 'dismissed');
  }
  return states;
}

export interface CategoryMetric {
  category: StanceCategory;
  count: number;
  confirmed: number;
  dismissed: number;
  /** Occurrences per 1,000 analysed words, leaving out what a person dismissed. */
  per1000: number | null;
}

function metric(
  category: StanceCategory,
  items: StanceAnnotation[],
  states: Map<string, StanceState>,
  words: number,
): CategoryMetric {
  const own = items.filter((item) => item.category === category);
  const dismissed = own.filter((item) => states.get(item.id) === 'dismissed').length;
  const count = own.length - dismissed;
  return {
    category,
    count,
    dismissed,
    confirmed: own.filter((item) => states.get(item.id) === 'confirmed').length,
    per1000: words > 0 ? (count / words) * 1000 : null,
  };
}

export function stanceMetrics(run: StanceRun, decisions: StanceDecision[]) {
  const states = stanceStates(run, decisions);
  const words = Object.values(run.words).reduce((sum, value) => sum + value, 0);
  const group = (categories: readonly StanceCategory[]) => {
    const rows = categories.map((category) => metric(category, run.annotations, states, words));
    const count = rows.reduce((sum, row) => sum + row.count, 0);
    return { rows, count, per1000: words > 0 ? (count / words) * 1000 : null };
  };
  const sections = Object.entries(run.words).map(([sectionId, sectionWords]) => {
    const items = run.annotations.filter(
      (item) => item.sectionId === sectionId && states.get(item.id) !== 'dismissed',
    );
    const stance = items.filter((item) =>
      (STANCE_CATEGORIES as readonly string[]).includes(item.category),
    ).length;
    return {
      sectionId,
      words: sectionWords,
      stance,
      engagement: items.length - stance,
      per1000: sectionWords > 0 ? (items.length / sectionWords) * 1000 : null,
    };
  });
  return {
    words,
    stance: group(STANCE_CATEGORIES),
    engagement: group(ENGAGEMENT_CATEGORIES),
    sections,
    confirmed: [...states.values()].filter((state) => state === 'confirmed').length,
  };
}

const cell = (value: string) => {
  const text = /^[=+@\t\r-]/u.test(value) ? `'${value}` : value;
  return /[",\n\r]/u.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/** Dismissed items stay in the file with their state, so a count can be traced. */
export function stanceCsv(run: StanceRun, decisions: StanceDecision[]) {
  const states = stanceStates(run, decisions);
  const rows = [
    ['id', 'category', 'marker', 'state', 'page', 'section', 'paragraph', 'excerpt', 'rationale'],
    ...run.annotations.map((item) => [
      item.id,
      item.category,
      item.marker,
      states.get(item.id) ?? 'candidate',
      item.page === null ? '' : String(item.page),
      item.sectionId,
      item.paragraphId,
      item.excerpt,
      item.rationale,
    ]),
  ];
  return rows.map((row) => row.map(cell).join(',')).join('\r\n');
}
