import { locate } from '../reviewPanel';
import type { Paper } from '../schemas/paper';
import type {
  CellEvidence,
  CellStatus,
  ExtractionCell,
  ExtractionMode,
  MatrixOutput,
  ExtractionProject,
  ProjectField,
  ProjectPaper,
} from '../schemas/extraction';

export * from './catalog';
export * from './citation';

/** Fields per request, so one answer stays well inside the output limit. */
export const FIELDS_PER_CALL = 12;
const FULL_TEXT_CHARS = 30000;
const ROLE_ORDER = [
  'abstract',
  'introduction',
  'methods',
  'results',
  'discussion',
  'conclusion',
  'related_work',
  'other',
];
const NUMBERS = /\d+(?:[.,]\d+)?/gu;

export interface SourceParagraph {
  id: string;
  text: string;
  section: string | null;
  page: number | null;
}

/** What extraction may read: the paper's prose in priority order, or the abstract alone. */
export function extractionSource(projectPaper: ProjectPaper, paper: Paper | undefined): SourceParagraph[] {
  if (projectPaper.access === 'ABSTRACT_ONLY')
    return projectPaper.abstract
      ? [{ id: 'abstract', text: projectPaper.abstract, section: 'Abstract', page: null }]
      : [];
  if (projectPaper.access !== 'FULL_TEXT' || !paper) return [];
  const sectionOf = (id: string) => paper.sections.find((section) => section.id === id);
  const rank = (role: string | undefined) => {
    const index = ROLE_ORDER.indexOf(role ?? 'other');
    return index < 0 ? ROLE_ORDER.length : index;
  };
  const ordered = paper.paragraphs
    .filter((paragraph) => paragraph.kind === 'body' && sectionOf(paragraph.sectionId)?.role !== 'references')
    .map((paragraph, index) => ({ paragraph, index, rank: rank(sectionOf(paragraph.sectionId)?.role) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index);
  const chosen: SourceParagraph[] = [];
  let size = 0;
  for (const { paragraph } of ordered) {
    if (size + paragraph.text.length > FULL_TEXT_CHARS) continue;
    size += paragraph.text.length;
    chosen.push({
      id: paragraph.id,
      text: paragraph.text,
      section: sectionOf(paragraph.sectionId)?.heading ?? null,
      page: paragraph.pageStart,
    });
  }
  // Reading order makes the document easier for the model, and for a person checking the prompt.
  const order = new Map(paper.paragraphs.map((paragraph, index) => [paragraph.id, index]));
  return chosen.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

export function fieldBatches<T>(fields: T[]): T[][] {
  const batches: T[][] = [];
  for (let start = 0; start < fields.length; start += FIELDS_PER_CALL)
    batches.push(fields.slice(start, start + FIELDS_PER_CALL));
  return batches;
}

/** High Quality adds a verification request per batch and, at most, one targeted retry per paper. */
export function estimateCalls(
  project: ExtractionProject,
  paperKeys: string[],
  fieldKeys: string[],
  mode: ExtractionMode = 'STANDARD',
) {
  const readable = project.papers.filter(
    (paper) => paperKeys.includes(paper.key) && paper.access !== 'METADATA_ONLY',
  );
  const batches = Math.ceil(fieldKeys.length / FIELDS_PER_CALL);
  return readable.length * (mode === 'STANDARD' ? batches : batches * 2 + (fieldKeys.length ? 1 : 0));
}

export function evidenceFrom(
  raw: { paragraphId: string; quote: string },
  source: SourceParagraph[],
): CellEvidence | null {
  const paragraph = source.find((item) => item.id === raw.paragraphId);
  const found = paragraph && locate(paragraph.text, raw.quote);
  if (!paragraph || !found) return null;
  return {
    paragraphId: paragraph.id === 'abstract' ? null : paragraph.id,
    section: paragraph.section,
    page: paragraph.page,
    start: found.start,
    end: found.end,
    quote: Array.from(paragraph.text).slice(found.start, found.end).join(''),
    stance: 'supports',
  };
}

interface CellContext {
  paper: ProjectPaper;
  runId: string;
  mode: ExtractionMode;
  at: string;
}

function cell(
  context: CellContext,
  field: ProjectField,
  status: CellStatus,
  values: {
    value?: string | null;
    aiValue?: string | null;
    evidence?: CellEvidence[];
    flags?: string[];
    inferred?: boolean;
  },
): ExtractionCell {
  const value = values.value ?? null;
  return {
    paperKey: context.paper.key,
    fieldKey: field.key,
    fieldVersion: field.version,
    paperRevision: context.paper.revision,
    runId: context.runId,
    mode: context.mode,
    status,
    value,
    aiValue: values.aiValue ?? null,
    assertion: values.aiValue ? (values.inferred ? 'INFERRED' : 'AUTHOR_REPORTED') : null,
    evidence: values.evidence ?? [],
    flags: values.flags ?? [],
    sourceAccess: context.paper.access,
    verification: null,
    verdict: null,
    verifierNote: null,
    history: [{ at: context.at, action: 'extract', by: 'model', value, status }],
  };
}

/**
 * Turns the model's answer into cells. A value is shown only with evidence code can find, and every number in it
 * must appear in that evidence. Anything else is withheld for review rather than guessed.
 */
export function cellsFromOutput(
  output: MatrixOutput,
  fields: ProjectField[],
  source: SourceParagraph[],
  context: CellContext,
): ExtractionCell[] {
  return fields.map((field) => {
    const raw = output.fields.find((item) => item.field_key === field.key);
    if (!raw) return cell(context, field, 'FAILED', { flags: ['MISSING_IN_OUTPUT'] });
    if (raw.status === 'not_applicable') return cell(context, field, 'NOT_APPLICABLE', {});
    if (raw.status === 'not_found' || !raw.value?.trim())
      return cell(
        context,
        field,
        context.paper.access === 'FULL_TEXT' ? 'NOT_FOUND' : 'INSUFFICIENT_SOURCE',
        {},
      );
    const evidence = raw.evidence.flatMap((item) => evidenceFrom(item, source) ?? []);
    const flags: string[] = [];
    if (raw.evidence.length > evidence.length) flags.push('EVIDENCE_NOT_FOUND');
    if (!evidence.length) flags.push('UNSUPPORTED');
    const quoted = evidence.map((item) => item.quote).join(' ');
    if ((raw.value.match(NUMBERS) ?? []).some((number) => !quoted.includes(number)))
      flags.push('NUMBER_NOT_IN_EVIDENCE');
    if (raw.inferred) flags.push('INFERRED');
    if (context.paper.access === 'ABSTRACT_ONLY') flags.push('ABSTRACT_ONLY');
    const withheld = flags.includes('UNSUPPORTED') || flags.includes('NUMBER_NOT_IN_EVIDENCE');
    const status: CellStatus = withheld || raw.inferred ? 'NEEDS_REVIEW' : 'EXTRACTED';
    return cell(context, field, status, {
      value: withheld ? null : raw.value,
      aiValue: raw.value,
      evidence,
      flags,
      inferred: raw.inferred,
    });
  });
}

/** A paper with nothing readable cannot be extracted; saying so is better than an empty request. */
export function insufficientCells(fields: ProjectField[], context: CellContext) {
  return fields.map((field) => cell(context, field, 'INSUFFICIENT_SOURCE', { flags: ['METADATA_ONLY'] }));
}

export function failedCells(fields: ProjectField[], context: CellContext, message: string) {
  return fields.map((field) => cell(context, field, 'FAILED', { flags: [message] }));
}

const sameCell = (a: ExtractionCell, b: ExtractionCell) =>
  a.paperKey === b.paperKey && a.fieldKey === b.fieldKey;

/** New cells replace old ones, except that a human-verified cell survives a rerun unless asked otherwise. */
export function mergeCells(
  existing: ExtractionCell[],
  incoming: ExtractionCell[],
  options: { keepVerified: boolean },
) {
  const kept = incoming.filter(
    (next) =>
      !(options.keepVerified && existing.some((old) => sameCell(old, next) && old.verification === 'HUMAN')),
  );
  return [...existing.filter((old) => !kept.some((next) => sameCell(old, next))), ...kept];
}

export function isStale(cell: ExtractionCell, project: ExtractionProject) {
  const field = project.fields.find((item) => item.key === cell.fieldKey);
  const paper = project.papers.find((item) => item.key === cell.paperKey);
  return Boolean(
    field && paper && (field.version !== cell.fieldVersion || paper.revision !== cell.paperRevision),
  );
}

export type ReviewAction = 'approve' | 'edit' | 'reject' | 'reopen';

/** The model's value stays in `aiValue` whatever the reviewer does. */
export function reviewCell(
  target: ExtractionCell,
  action: ReviewAction,
  at: string,
  edited?: string,
): ExtractionCell {
  const next = { ...target };
  if (action === 'approve') {
    next.status = 'VERIFIED';
    next.verification = 'HUMAN';
    next.value = target.value ?? target.aiValue;
  } else if (action === 'edit') {
    next.status = 'VERIFIED';
    next.verification = 'HUMAN';
    next.value = edited?.trim() || null;
    next.flags = [...new Set([...target.flags, 'HUMAN_EDITED'])];
  } else if (action === 'reject') {
    next.status = 'NEEDS_REVIEW';
    next.verification = null;
    next.value = null;
    next.flags = [...new Set([...target.flags, 'REJECTED_BY_REVIEWER'])];
  } else {
    const first = target.history[0];
    next.status = first?.status ?? 'NEEDS_REVIEW';
    next.verification = null;
    next.value = first?.value ?? null;
    next.flags = target.flags.filter((flag) => flag !== 'REJECTED_BY_REVIEWER' && flag !== 'HUMAN_EDITED');
  }
  next.history = [...target.history, { at, action, by: 'human', value: next.value, status: next.status }];
  return next;
}

export const NEEDS_ATTENTION: CellStatus[] = ['NEEDS_REVIEW', 'CONFLICT', 'FAILED'];

export function cellCounts(project: ExtractionProject) {
  const counts = Object.fromEntries(
    [
      'EXTRACTED',
      'NEEDS_REVIEW',
      'VERIFIED',
      'NOT_FOUND',
      'NOT_APPLICABLE',
      'INSUFFICIENT_SOURCE',
      'CONFLICT',
      'FAILED',
    ].map((status) => [status, 0]),
  ) as Record<CellStatus, number>;
  for (const item of project.cells) counts[item.status]++;
  return { counts, stale: project.cells.filter((item) => isStale(item, project)).length };
}

const csvCell = (value: string) => {
  const text = /^[=+@\t\r-]/u.test(value) ? `'${value}` : value;
  return /[",\n\r]/u.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/** Value and status sit in separate columns, so a reader never mistakes a withheld cell for an empty one. */
export function matrixCsv(project: ExtractionProject, options: { verifiedOnly: boolean }) {
  const fields = project.fields.filter((field) => !field.hidden);
  const header = [
    'Title',
    'Year',
    'DOI',
    'Source access',
    ...fields.flatMap((field) => [field.label, `${field.label} [status]`]),
  ];
  const rows = project.papers.map((paper) => [
    paper.title,
    paper.year === null ? '' : String(paper.year),
    paper.doi ?? '',
    paper.access,
    ...fields.flatMap((field) => {
      const found = project.cells.find((item) => item.paperKey === paper.key && item.fieldKey === field.key);
      const shown =
        found && (!options.verifiedOnly || found.status === 'VERIFIED') ? (found.value ?? '') : '';
      return [shown, found ? found.status : 'NOT_RUN'];
    }),
  ]);
  return [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\n');
}

export function matrixJson(project: ExtractionProject, options: { verifiedOnly: boolean }) {
  return {
    format: 'paperlab-extraction',
    version: 1,
    project: { id: project.id, title: project.title, researchQuestion: project.researchQuestion },
    fields: project.fields.filter((field) => !field.hidden),
    papers: project.papers.map(({ abstract: _abstract, ...paper }) => paper),
    runs: project.runs,
    cells: options.verifiedOnly ? project.cells.filter((item) => item.status === 'VERIFIED') : project.cells,
  };
}
export * from './project';
export * from './verify';
export * from './deep';
