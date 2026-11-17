import { paperIdentity } from '../paperIdentity';
import type { PaperMetadata } from '../schemas/paperContext';
import type { LibraryItem } from '../schemas/library';
import type { Paper } from '../schemas/paper';
import type { ExtractionProject, FieldDefinition, ProjectField, ProjectPaper } from '../schemas/extraction';

export const MAX_COLUMNS = 50;

/** A short, stable fingerprint, so a changed source text shows up as stale cells. */
function fingerprint(text: string) {
  let hash = 2166136261;
  for (const char of text) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(36);
}

export function newProject(input: {
  id: string;
  title: string;
  researchQuestion: string;
  now: string;
}): ExtractionProject {
  return {
    schemaVersion: 1,
    id: input.id,
    paperId: null,
    title: input.title.trim(),
    researchQuestion: input.researchQuestion.trim(),
    createdAt: input.now,
    updatedAt: input.now,
    papers: [],
    fields: [],
    runs: [],
    cells: [],
    deep: null,
  };
}

export function projectPaperFromPaper(
  paper: Paper,
  library?: LibraryItem,
  metadata?: PaperMetadata | null,
): ProjectPaper {
  const identity = paperIdentity(paper, { metadata, library });
  return {
    key: `paper:${paper.id}`,
    source: { kind: 'paper', paperId: paper.id },
    title: identity.title,
    authors: identity.authors,
    year: identity.year,
    venue: identity.venue,
    doi: library?.doi ?? metadata?.doi ?? null,
    access: 'FULL_TEXT',
    abstract: null,
    revision: fingerprint(paper.paragraphs.map((paragraph) => paragraph.textHash).join('|')),
    screening: 'included',
  };
}

/** A DOI without an imported file is read from its abstract, or not at all; the access tier says which. */
export function projectPaperFromLibrary(item: LibraryItem, abstract: string | null): ProjectPaper {
  return {
    key: `library:${item.id}`,
    source: { kind: 'library', libraryId: item.id },
    title: item.title ?? item.doi,
    authors: item.authors,
    year: item.year,
    venue: item.venue,
    doi: item.doi,
    access: abstract ? 'ABSTRACT_ONLY' : 'METADATA_ONLY',
    abstract,
    revision: abstract ? fingerprint(abstract) : 'metadata',
    screening: 'included',
  };
}

/** Adds what is new. The same paper or DOI is never added twice. */
export function addPapers(project: ExtractionProject, papers: ProjectPaper[]): ExtractionProject {
  const existingPapers = [...project.papers];
  const fresh: ProjectPaper[] = [];
  for (const paper of papers) {
    const sameKeyIndex = existingPapers.findIndex((existing) => existing.key === paper.key);
    const existing = sameKeyIndex >= 0 ? existingPapers[sameKeyIndex] : undefined;
    if (
      existing?.access === 'METADATA_ONLY' &&
      paper.access === 'ABSTRACT_ONLY' &&
      existing.source.kind === 'library' &&
      paper.source.kind === 'library'
    ) {
      existingPapers[sameKeyIndex] = paper;
      continue;
    }
    const known =
      existing !== undefined ||
      existingPapers.some(
        (item) => paper.doi !== null && item.doi?.toLowerCase() === paper.doi.toLowerCase(),
      ) ||
      fresh.some(
        (item) =>
          item.key === paper.key ||
          (paper.doi !== null && item.doi?.toLowerCase() === paper.doi.toLowerCase()),
      );
    if (!known) fresh.push(paper);
  }
  return { ...project, papers: [...existingPapers, ...fresh] };
}

export function removePaper(project: ExtractionProject, key: string): ExtractionProject {
  return {
    ...project,
    papers: project.papers.filter((paper) => paper.key !== key),
    cells: project.cells.filter((cell) => cell.paperKey !== key),
  };
}

export function addFields(
  project: ExtractionProject,
  fields: FieldDefinition[],
  limit = MAX_COLUMNS,
): ExtractionProject {
  const fresh = fields.filter(
    (field, index) =>
      !project.fields.some((existing) => existing.key === field.key) &&
      fields.findIndex((other) => other.key === field.key) === index,
  );
  return {
    ...project,
    fields: [
      ...project.fields,
      ...fresh
        .slice(0, Math.max(0, limit - project.fields.length))
        .map((field) => ({ ...field, hidden: false })),
    ],
  };
}

/** Hiding keeps the data; removing a column keeps its cells too, so adding it back shows them again. */
export function updateField(
  project: ExtractionProject,
  key: string,
  patch: Partial<Pick<ProjectField, 'hidden'>>,
) {
  return {
    ...project,
    fields: project.fields.map((field) => (field.key === key ? { ...field, ...patch } : field)),
  };
}

export function removeField(project: ExtractionProject, key: string): ExtractionProject {
  return { ...project, fields: project.fields.filter((field) => field.key !== key) };
}

export function moveField(project: ExtractionProject, key: string, direction: -1 | 1): ExtractionProject {
  const index = project.fields.findIndex((field) => field.key === key);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= project.fields.length) return project;
  const fields = [...project.fields];
  const [moved] = fields.splice(index, 1);
  if (moved) fields.splice(target, 0, moved);
  return { ...project, fields };
}

/** Changing what a column asks for is a new version; cells made under the old one become stale. */
export function editInstruction(
  project: ExtractionProject,
  key: string,
  instruction: string,
): ExtractionProject {
  return {
    ...project,
    fields: project.fields.map((field) =>
      field.key === key && field.instruction !== instruction.trim()
        ? { ...field, instruction: instruction.trim(), version: field.version + 1 }
        : field,
    ),
  };
}

export function customField(input: {
  label: string;
  description: string;
  instruction: string;
  existing: string[];
}): FieldDefinition {
  const base =
    input.label
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .replace(/đ/giu, 'd')
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, '_')
      .replace(/^_|_$/gu, '') || 'field';
  let key = `custom_${base}`;
  for (let n = 2; input.existing.includes(key); n++) key = `custom_${base}_${n}`;
  return {
    key,
    label: input.label.trim(),
    group: 'Custom',
    priority: 2,
    description: input.description.trim(),
    instruction:
      input.instruction.trim() || `Extract: ${input.label.trim()}. ${input.description.trim()}`.trim(),
    dataType: 'text',
    custom: true,
    version: 1,
  };
}
