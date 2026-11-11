import type { DigestSection } from '../prompts/digest';
import type {
  DigestOutput,
  DigestRun,
  DigestSourceSchema,
  DigestText,
  Paper,
  PaperParagraph,
} from '../schemas';
import type { z } from 'zod';

/** About 15 000 words: a full research paper, with room for the answer. */
const INPUT_CHARS = 90000;
const SKIPPED_ROLES = new Set(['references', 'title']);
const NUMBERS = /\d+(?:[.,]\d+)?/gu;

/**
 * The paper in its own order and sections, body text only. References are left out. When a paper is longer
 * than the input allows, the paragraphs that fit are sent and the run says how many were read.
 */
export function digestInput(paper: Paper): { sections: DigestSection[]; read: number; total: number } {
  const sectionOf = new Map(paper.sections.map((section) => [section.id, section]));
  const body = paper.paragraphs.filter(
    (paragraph) =>
      paragraph.kind === 'body' && !SKIPPED_ROLES.has(sectionOf.get(paragraph.sectionId)?.role ?? ''),
  );
  const sections: DigestSection[] = [];
  let size = 0;
  let read = 0;
  for (const paragraph of body) {
    if (size + paragraph.text.length > INPUT_CHARS) break;
    size += paragraph.text.length;
    read += 1;
    const heading = sectionOf.get(paragraph.sectionId)?.heading ?? '';
    const last = sections.at(-1);
    if (last && last.heading === heading) last.paragraphs.push(paragraph);
    else sections.push({ heading, paragraphs: [paragraph] });
  }
  return { sections, read, total: body.length };
}

type Source = z.infer<typeof DigestSourceSchema>;

/**
 * Keeps what the model wrote, but only with sources code can find: unknown paragraph ids are dropped, a part
 * with no source left is flagged, and so is a part whose numbers are not in the paragraphs it cites.
 */
export function verifyDigest(
  output: DigestOutput,
  paragraphs: PaperParagraph[],
): Pick<DigestRun, 'headline' | 'overview' | 'sections'> {
  const byId = new Map(paragraphs.map((paragraph) => [paragraph.id, paragraph]));
  const check = (text: string, refs: string[]): DigestText => {
    const cited = [...new Set(refs)].flatMap((id) => {
      const paragraph = byId.get(id);
      return paragraph ? [paragraph] : [];
    });
    const sources: Source[] = cited.map((paragraph) => ({
      paragraphId: paragraph.id,
      page: paragraph.pageStart,
    }));
    const flags: DigestText['flags'] = [];
    if (cited.length === 0) flags.push('no_source');
    else {
      const source = cited.map((paragraph) => paragraph.text).join('\n');
      const numbers = text.match(NUMBERS) ?? [];
      if (numbers.some((number) => !source.includes(number))) flags.push('number_not_in_source');
    }
    return { text: text.trim(), sources, flags };
  };
  return {
    headline: output.headline.trim(),
    overview: check(output.overview.text, output.overview.refs),
    sections: output.sections
      .map((section) => ({
        heading: section.heading.trim(),
        blocks: section.blocks
          .map((block) => ({
            text: block.text.trim() ? check(block.text, block.refs) : null,
            items: block.items
              .filter((item) => item.text.trim())
              .map((item) => ({
                ...check(`${item.lead ?? ''} ${item.text}`, item.refs),
                text: item.text.trim(),
                lead: item.lead?.trim() || null,
              })),
          }))
          .filter((block) => block.text || block.items.length > 0),
      }))
      .filter((section) => section.blocks.length > 0),
  };
}
