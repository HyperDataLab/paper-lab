import { bodyBlocks, bodySentences } from '../corpusProfile/measure';
import { measurePaperV2Detail, type PaperSyntax } from '../corpusProfile/measureV2';
import { SECTION_MAP } from '../corpusProfile/registry';
import { FEATURE_REGISTRY_V2, registryV2Digest } from '../corpusProfile/registryV2';
import { headingRole, PAPER_PARSER_VERSION, segmentPaper } from '../paper';
import { buildPaperModel } from '../paperModel/buildPaperModel';
import type { Paper, PaperModel } from '../schemas';
import type { ParseResult } from '../syntaxParse/schema';
import { tokenize } from '../text/tokenize';
import type { DraftFeature, DraftInput, DraftMeasure, DraftSection, DraftWarning } from './schema';

/** A draft read into the paper model the corpus-profile measures accept, with what the reading noticed. */
export type PreparedDraft = {
  model: PaperModel;
  title: string | null;
  sections: DraftSection[];
  warnings: DraftWarning[];
};

/** What the grammar service gave: a parse, nothing configured, or a call that failed. */
export type DraftGrammar =
  | {
      status: 'parsed';
      result: Pick<ParseResult, 'model' | 'modelVersion' | 'spacyVersion' | 'version' | 'sentences'>;
    }
  | { status: 'not_configured' }
  | { status: 'failed' };

const DRAFT_PAPER_ID = '00000000-0000-4000-8000-000000000000';
const EPOCH = new Date('2000-01-01T00:00:00.000Z');
const LINE_MARKER = /^#{1,6}\s+/u;
const NUMBERING = /^(?:\d+(?:\.\d+)*\.?|[IVX]+\.|[A-Z](?:\.\d+(?:\.\d+)*)?)\s+/u;
const words = (text: string) => tokenize(text).filter((token) => token.kind === 'word').length;

/**
 * A single leading `# Title` above `##` sections is the draft's title, not a section: left in, it would hold every
 * other section as a subsection and `structure.section_count` would be 1. A heading that names a role (`# Methods`) stays a
 * section. The line is blanked so line numbers stay.
 */
function liftTitle(input: DraftInput): { lines: string[]; lifted: string | null } {
  const lines = input.text.replace(/\r\n?/gu, '\n').split('\n');
  if (input.format !== 'markdown') return { lines, lifted: null };
  const first = lines.findIndex((line) => line.trim());
  const top = /^#\s+(.+)$/u.exec(lines[first]?.trim() ?? '');
  const otherTop = lines.some((line, i) => i !== first && /^#\s+/u.test(line.trim()));
  const sub = lines.some((line) => /^#{2,6}\s+/u.test(line.trim()));
  if (!top?.[1] || headingRole(top[1]) || otherTop || !sub) return { lines, lifted: null };
  const copy = [...lines];
  copy[first] = '';
  return { lines: copy, lifted: top[1].trim() };
}

/** The source line of each parsed heading, in order; a heading the segmenter merged from two lines keeps both. */
function headingLines(lines: string[], headings: string[]) {
  let cursor = 0;
  return headings.map((heading) => {
    for (let i = cursor; i < lines.length; i++) {
      const written = lines[i]?.trim() ?? '';
      if (!written) continue;
      const bare = written.replace(LINE_MARKER, '');
      const name = [written, bare, bare.replace(NUMBERING, '')].find(
        (candidate) => candidate && (heading === candidate || heading.startsWith(`${candidate} `)),
      );
      if (!name) continue;
      cursor = i + 1;
      const merged = heading !== name;
      if (merged) cursor = i + 2;
      return {
        line: i + 1,
        written: merged ? `${written} ${lines[i + 1]?.trim() ?? ''}`.trim() : written,
      };
    }
    return null;
  });
}

/** Reads a draft with PaperLab's own segmenter (no fork) and builds the paper model the measures take. */
export async function prepareDraft(input: DraftInput): Promise<PreparedDraft> {
  const { lines, lifted } = liftTitle(input);
  const parsed = await segmentPaper(lines.join('\n'));
  const title = input.title?.trim() || lifted || null;
  const paper: Paper = {
    schemaVersion: 1,
    id: DRAFT_PAPER_ID,
    title: title ?? 'Draft',
    createdAt: EPOCH.toISOString(),
    updatedAt: EPOCH.toISOString(),
    source: {
      kind: input.format,
      fileName: input.format === 'markdown' ? 'draft.md' : 'draft.txt',
      pageCount: null,
      sha256: '',
      parserVersion: PAPER_PARSER_VERSION,
    },
    ...parsed,
  };
  // Text before the first heading sits in a section the segmenter adds itself ("Front matter"). At level 1 it would be
  // the parent of every `##` section, and boilerplate exclusion would then drop them all; at the deepest level used it
  // is nobody's parent, so only its own text is left out.
  const synthetic = parsed.sections[0]?.id === 'sec1' && parsed.sections[0].heading === 'Front matter';
  if (synthetic) {
    const deepest = Math.max(...parsed.sections.map((section) => section.level));
    paper.sections = paper.sections.map((section, i) => (i === 0 ? { ...section, level: deepest } : section));
  }
  const model = buildPaperModel({ paper, metadata: null, now: EPOCH });
  const real = synthetic ? parsed.sections.slice(1) : parsed.sections;
  const found = headingLines(
    lines,
    real.map((section) => section.heading),
  );
  const counted = new Set(bodyBlocks(model).map((block) => block.sectionId));
  const sections: DraftSection[] = parsed.sections.map((section, index) => {
    const body = parsed.paragraphs.filter(
      (paragraph) => paragraph.sectionId === section.id && paragraph.kind === 'body',
    );
    const source = synthetic && index === 0 ? null : found[synthetic ? index - 1 : index];
    return {
      index,
      line: source?.line ?? null,
      heading: source?.written ?? null,
      title: section.heading,
      level: section.level,
      role: SECTION_MAP[section.role],
      counted: counted.has(section.id),
      paragraphs: body.length,
      words: body.reduce((sum, paragraph) => sum + words(paragraph.text), 0),
    };
  });

  const warnings: DraftWarning[] = [];
  if (lifted)
    warnings.push({
      code: 'title_heading_lifted',
      message: `The leading "# ${lifted}" heading was read as the draft title, not as a section.`,
    });
  if (!real.length)
    warnings.push({
      code: 'no_headings',
      message:
        'No heading was found, so no text was measured. Mark sections with "#"/"##" (markdown) or put each heading on its own line.',
    });
  const front = synthetic ? sections[0] : undefined;
  if (real.length && front && parsed.paragraphs.some((paragraph) => paragraph.sectionId === 'sec1'))
    warnings.push({
      code: 'text_before_first_heading',
      message: `Text before the first heading (${front.paragraphs} paragraphs) is read as front matter and not measured.`,
      sections: [0],
    });
  const other = sections.filter(
    (section) => section.heading !== null && section.role === 'OTHER' && section.counted,
  );
  if (other.length)
    warnings.push({
      code: 'unrecognised_headings',
      message: `No section role was recognised for: ${other.map((section) => `"${section.title}"`).join(', ')}. Their text counts as OTHER.`,
      sections: other.map((section) => section.index),
    });
  const excluded = sections.filter(
    (section) => section.heading !== null && !section.counted && section.paragraphs > 0,
  );
  if (excluded.length)
    warnings.push({
      code: 'excluded_sections',
      message: `Not measured (references, title or boilerplate such as acknowledgements): ${excluded.map((section) => `"${section.title}"`).join(', ')}.`,
      sections: excluded.map((section) => section.index),
    });
  const kinds = new Map<string, number>();
  for (const paragraph of parsed.paragraphs)
    if (paragraph.kind !== 'body' && paragraph.kind !== 'reference')
      kinds.set(paragraph.kind, (kinds.get(paragraph.kind) ?? 0) + 1);
  if (kinds.size)
    warnings.push({
      code: 'non_body_blocks',
      message: `Blocks read as non-body text and not counted as paragraphs: ${[...kinds]
        .map(([kind, count]) => `${count} ${kind}`)
        .join(', ')}. A line with "=" reads as an equation; a line starting with "-", "*" or "1." as a list.`,
    });
  return { model, title, sections, warnings };
}

/** Body sentences the grammar service should parse: the keys `measureSectionSyntax` looks up. */
export function draftSentences(prepared: PreparedDraft) {
  const seen = new Set<string>();
  return bodySentences(prepared.model).flatMap((sentence) => {
    if (seen.has(sentence.key)) return [];
    seen.add(sentence.key);
    return [{ key: sentence.key, text: sentence.text }];
  });
}

/** Every registry v2 feature for a prepared draft, through `measurePaperV2Detail` with no LLM runs. */
export async function measurePreparedDraft(
  prepared: PreparedDraft,
  grammar: DraftGrammar = { status: 'not_configured' },
): Promise<DraftMeasure> {
  const result = grammar.status === 'parsed' ? grammar.result : null;
  const syntax: PaperSyntax | null = result
    ? new Map(result.sentences.map((sentence) => [sentence.key, sentence]))
    : null;
  const { values } = measurePaperV2Detail(prepared.model, null, null, syntax);
  const features: DraftFeature[] = FEATURE_REGISTRY_V2.features.map((feature) => {
    if (feature.extractor === 'llm')
      return { id: feature.id, value: null, status: 'unavailable', reason: 'needs_llm_pass' };
    if (feature.extractor === 'tool' && !syntax)
      return { id: feature.id, value: null, status: 'unavailable', reason: 'grammar_service_unavailable' };
    const value = values[feature.id] ?? null;
    return value === null
      ? { id: feature.id, value: null, status: 'unavailable', reason: 'no_data' }
      : { id: feature.id, value, status: 'measured' };
  });
  const sentences = draftSentences(prepared);
  const parsed = syntax ? sentences.filter((sentence) => syntax.has(sentence.key)).length : 0;
  const warnings = [...prepared.warnings];
  if (grammar.status === 'failed')
    warnings.push({
      code: 'grammar_service_failed',
      message: 'The grammar service did not answer, so passive voice and tense were not measured.',
    });
  if (syntax && parsed < sentences.length)
    warnings.push({
      code: 'grammar_partial',
      message: `The grammar service parsed ${parsed} of ${sentences.length} body sentences.`,
    });
  return {
    format: 'paperlab-draft-measure',
    version: 1,
    registryId: FEATURE_REGISTRY_V2.id,
    registryVersion: FEATURE_REGISTRY_V2.version,
    registryDigest: await registryV2Digest(),
    title: prepared.title,
    features,
    sections: prepared.sections,
    grammar: {
      status: grammar.status,
      parser: result
        ? `${result.version}+spacy-${result.spacyVersion} ${result.model}-${result.modelVersion ?? 'unknown'}`
        : null,
      sentences: sentences.length,
      parsed,
    },
    warnings,
  };
}

/** Measures a writer's draft against registry v2 without any LLM pass (Writing Bank B4). */
export async function measureDraft(input: DraftInput, grammar?: DraftGrammar): Promise<DraftMeasure> {
  return measurePreparedDraft(await prepareDraft(input), grammar);
}
