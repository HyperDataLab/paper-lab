import {
  PaperModelSchema,
  type Paper,
  type PaperMetadata,
  type PaperModel,
  type PaperModelMetadata,
  type PaperModelSection,
  type PaperInsightsRecord,
  type StanceRecord,
} from '../schemas';
import { referenceList } from '../scholarlyContext';
import { SEGMENTER_VERSION } from '../text';
import { paperLabAnnotations } from './annotations';
import { sentenceIndex } from './sentenceIndex';
import { SENTENCE_KEY_VERSION } from './sentenceKey';

/** The parent is the nearest earlier section with a smaller level, so a jump from 1 to 3 still nests. */
export function sectionTree(paper: Paper): PaperModelSection[] {
  const open: { id: string; level: number }[] = [];
  return paper.sections.map((section) => {
    while (open.length && (open.at(-1)?.level ?? 0) >= section.level) open.pop();
    const parentId = open.at(-1)?.id ?? null;
    open.push({ id: section.id, level: section.level });
    return {
      id: section.id,
      parentId,
      title: section.heading,
      level: section.level,
      role: section.role,
      page: section.pageStart,
    };
  });
}

function abstractOf(paper: Paper): string | null {
  const ids = new Set(paper.sections.filter((s) => s.role === 'abstract').map((s) => s.id));
  const text = paper.paragraphs
    .filter((p) => ids.has(p.sectionId) && p.kind === 'body')
    .map((p) => p.text.trim())
    .filter(Boolean)
    .join('\n\n');
  return text || null;
}

function metadataOf(paper: Paper, metadata: PaperMetadata | null): PaperModelMetadata {
  return {
    title: metadata?.title ?? paper.title,
    authors: metadata?.authors ?? [],
    affiliations: metadata?.affiliations ?? [],
    doi: metadata?.doi ?? null,
    year: metadata?.year ?? null,
    venue: metadata?.venue ?? null,
    volume: metadata?.volume ?? null,
    issue: metadata?.issue ?? null,
    pages: metadata?.pages ?? null,
    keywords: metadata?.keywords ?? [],
    abstract: abstractOf(paper),
    source: metadata?.source ?? 'parsed',
  };
}

export function buildPaperModel({
  paper,
  metadata,
  insights,
  stance,
  now,
}: {
  paper: Paper;
  metadata: PaperMetadata | null;
  insights?: PaperInsightsRecord | null;
  stance?: StanceRecord | null;
  now: Date;
}): PaperModel {
  const sentences = sentenceIndex(paper);
  const labels = paperLabAnnotations(sentences, insights, stance);
  return PaperModelSchema.parse({
    format: 'paperlab-paper-model',
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    generator: {
      app: 'PaperLab',
      segmenterVersion: SEGMENTER_VERSION,
      sentenceKeyVersion: SENTENCE_KEY_VERSION,
      parserVersion: paper.source.parserVersion ?? null,
    },
    document: {
      source: {
        kind: paper.source.kind,
        sha256: paper.source.sha256 || null,
        pageCount: paper.source.pageCount,
      },
      metadata: metadataOf(paper, metadata),
      sections: sectionTree(paper),
      blocks: paper.paragraphs.map((p) => ({
        id: p.id,
        sectionId: p.sectionId,
        kind: p.kind,
        page: p.pageStart,
        text: p.text,
        textHash: p.textHash,
      })),
      references: referenceList(paper, now).map((item, index) => ({
        id: `ref${index + 1}`,
        text: item.text,
        year: item.year,
        doi: item.doi,
      })),
    },
    sentences,
    annotations: labels.annotations,
    annotationRuns: labels.runs,
    knowledge: { phrases: [], triples: [] },
  });
}

/**
 * Carries labels from an older model onto a new one; labels whose sentence is gone are dropped. `sameFile` is true
 * only when both models record the same file hash; a caller shows a warning when it is false.
 */
export function reanchor(oldModel: PaperModel, newModel: PaperModel) {
  const keys = new Set(newModel.sentences.map((sentence) => sentence.key));
  const annotations = oldModel.annotations.filter((annotation) => keys.has(annotation.key));
  const before = oldModel.document.source.sha256;
  const sameFile = before !== null && before === newModel.document.source.sha256;
  return { annotations, dropped: oldModel.annotations.length - annotations.length, sameFile };
}
