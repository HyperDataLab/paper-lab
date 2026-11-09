import type { Paper, PaperParagraph } from '../schemas/paper';

const UNIT_CHARS = 14000;
const BLOCK_KINDS: PaperParagraph['kind'][] = ['body', 'caption', 'equation', 'list', 'table'];

export interface ExtractionUnit {
  id: string;
  sectionIds: string[];
  blocks: PaperParagraph[];
}

export const isMeasurementBlock = (paragraph: PaperParagraph) => BLOCK_KINDS.includes(paragraph.kind);

export function defaultMeasurementSections(paper: Paper) {
  return paper.sections
    .filter(
      (section) =>
        section.role !== 'references' &&
        paper.paragraphs.some((p) => p.sectionId === section.id && isMeasurementBlock(p)),
    )
    .map((section) => section.id);
}

/** One unit per top-level section, split at section boundaries when it would exceed one prompt. */
export function planExtraction(paper: Paper, sectionIds: string[]): ExtractionUnit[] {
  const selected = new Set(sectionIds);
  const units: ExtractionUnit[] = [];
  let current: ExtractionUnit | undefined;
  let size = 0;
  for (const section of paper.sections) {
    if (!selected.has(section.id)) continue;
    const blocks = paper.paragraphs.filter((p) => p.sectionId === section.id && isMeasurementBlock(p));
    if (!blocks.length) continue;
    const chars = blocks.reduce((sum, p) => sum + p.text.length, 0);
    if (!current || section.level === 1 || size + chars > UNIT_CHARS) {
      current = { id: `unit-${units.length + 1}`, sectionIds: [], blocks: [] };
      units.push(current);
      size = 0;
    }
    current.sectionIds.push(section.id);
    current.blocks.push(...blocks);
    size += chars;
  }
  return units;
}

/** One classification, one extraction per unit, one linking and one findings call. */
export function estimateMeasurementCalls(units: ExtractionUnit[]) {
  return units.length + 3;
}
