import type { PaperParagraph, Section } from '../schemas/paper';
import { sourceHash } from '../text/hash';

export interface PaperLine {
  text: string;
  pageStart?: number | null;
  breakBefore?: boolean;
  height?: number;
  x?: number;
  end?: number;
  column?: 'left' | 'right' | 'full';
  columnStart?: number;
  columnEnd?: number;
}
const roles: [RegExp, Section['role']][] = [
  [/^abstract\b/i, 'abstract'],
  [/^introduction\b/i, 'introduction'],
  [/^(materials? and methods?|methods?|methodology|experimental (setup|design))\b/i, 'methods'],
  [/^(results?|findings)\b/i, 'results'],
  [/^discussion\b/i, 'discussion'],
  [/^(conclusions?|concluding remarks)\b/i, 'conclusion'],
  [/^(related work|background|literature review|prior work)\b/i, 'related_work'],
  [/^(references|bibliography|works cited)\b/i, 'references'],
  [/^appendix\b/i, 'appendix'],
  [/^acknowledg(?:e)?ments?\b/i, 'other'],
];
function isFootnote(kind: PaperParagraph['kind']) {
  return kind === 'footnote';
}
function heading(
  text: string,
  height: number | undefined,
  median: number | undefined,
): { heading: string; level: number; role: Section['role']; numbers: number[] | null } | null {
  const trimmed = text.trim();
  const markdown = /^(#{1,6})\s+(.+)$/.exec(trimmed);
  const latex = /^\\(section|subsection|subsubsection|paragraph)\*?\{([^}]*)\}/.exec(trimmed);
  const numbered = /^(\d+(?:\.\d+)*\.?|[IVX]+\.)\s+(.+)$/.exec(trimmed);
  const name = markdown?.[2] ?? latex?.[2] ?? numbered?.[2] ?? trimmed;
  const role = roles.find(([pattern]) => pattern.test(name))?.[1] ?? 'other';
  const known = roles.some(([pattern]) => pattern.test(name));
  const caps = /[A-Z]/.test(name) && name === name.toUpperCase() && /^[A-Z\d\s&-]+$/.test(name);
  const explicit = Boolean(markdown || latex);
  if (
    !explicit &&
    (!/^[A-Z]/.test(name) ||
      /[-,.:;!?]$/.test(name) ||
      /\b(?:we|they|our|their|demonstrate|validate)\b/i.test(name) ||
      /\bfor details\b/i.test(name))
  )
    return null;
  if (!explicit && (!/[a-zA-Z]{2}/.test(name) || (name.match(/[A-Za-z]/g)?.length ?? 0) < name.length * 0.45))
    return null;
  if (
    !explicit &&
    !numbered &&
    !known &&
    (!caps || name.length < 4 || (height !== undefined && median !== undefined && height <= median * 1.05))
  )
    return null;
  if (
    !explicit &&
    numbered &&
    /^\d+\.$/.test(numbered[1] ?? '') &&
    !known &&
    height !== undefined &&
    median !== undefined &&
    height <= median * 1.05
  )
    return null;
  if (name.length > 120 || name.split(/\s+/).length > 12) return null;
  const numbers =
    numbered && /^\d/.test(numbered[1] ?? '')
      ? (numbered[1] ?? '').replace(/\.$/, '').split('.').map(Number)
      : null;
  const level =
    markdown?.[1]?.length ??
    (latex
      ? ['section', 'subsection', 'subsubsection', 'paragraph'].indexOf(latex[1] ?? '') + 1
      : numbered
        ? (trimmed.match(/^\d+(?:\.\d+)*/)?.[0]?.split('.').length ?? 1)
        : 1);
  return { heading: name, level, role, numbers };
}
export async function segmentPaper(input: string | PaperLine[]) {
  const lines: PaperLine[] =
    typeof input === 'string'
      ? input
          .replace(/\r\n?/g, '\n')
          .split('\n')
          .map((text) => ({ text }))
      : input;
  const sections: Section[] = [];
  const paragraphs: PaperParagraph[] = [];
  let current: Section | undefined;
  let buffer: string[] = [];
  let page: number | null = null;
  let kind: PaperParagraph['kind'] = 'body';
  let footnoteHeight: number | undefined;
  const heights = lines
    .map((line) => line.height)
    .filter((height): height is number => height !== undefined && height > 0)
    .sort((a, b) => a - b);
  const median = heights[Math.floor(heights.length / 2)];
  let outline: number[] = [];
  async function flush() {
    if (!buffer.length || !current) return;
    let text = buffer[0] ?? '';
    for (const line of buffer.slice(1))
      text = /-$/.test(text) && /^[a-z]/.test(line) ? text.slice(0, -1) + line : `${text} ${line}`;
    const order = paragraphs.filter((p) => p.sectionId === current?.id).length;
    paragraphs.push({
      id: `${current.id}_p${String(order + 1).padStart(2, '0')}`,
      sectionId: current.id,
      order,
      text,
      pageStart: page,
      kind,
      textHash: await sourceHash(text),
    });
    buffer = [];
  }
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (!line) continue;
    const text = line.text.trim();
    if (!text) {
      await flush();
      continue;
    }
    if (/^\d{1,4}$|^page\s+\d+(?:\s+of\s+\d+)?$|^arxiv:\s*\d/i.test(text)) continue;
    const footnote =
      /^(?:proceedings of the|copyright\s+\d{4}|correspondence(?:\s+to)?\s*:|\*?corresponding author\b)/i.test(
        text,
      );
    const continuation: boolean =
      !footnote &&
      isFootnote(kind) &&
      buffer.length > 0 &&
      !line.breakBefore &&
      (line.pageStart ?? null) === page &&
      text.length <= 120 &&
      (footnoteHeight === undefined ||
        line.height === undefined ||
        Math.abs(line.height - footnoteHeight) <= footnoteHeight * 0.15) &&
      (median === undefined || line.height === undefined || line.height <= median);
    const found = footnote || continuation ? null : heading(text, line.height, median);
    if (found?.numbers) {
      const nums = found.numbers;
      const depth = nums.length;
      const validParent =
        depth === 1 || (depth <= outline.length + 1 && nums.slice(0, -1).every((n, i) => n === outline[i]));
      const expected = depth > outline.length ? 1 : (outline[depth - 1] ?? 0) + 1;
      if (!validParent || nums[depth - 1] !== expected) found.numbers = [];
    }
    if (found && (found.numbers === null || found.numbers.length > 0)) {
      await flush();
      if (found.numbers) outline = found.numbers;
      const next = lines[index + 1];
      const nextText = next?.text.trim() ?? '';
      const sameHeight =
        line.height !== undefined &&
        next?.height !== undefined &&
        Math.abs(line.height - next.height) <= line.height * 0.15;
      const sameColumn =
        next &&
        ((line.x === undefined && next.x === undefined) ||
          (line.x !== undefined &&
            next.x !== undefined &&
            Math.abs(line.x - next.x) <= Math.max(6, line.height ?? 10) &&
            line.column === next.column &&
            (line.columnStart === undefined || next.x >= line.columnStart - 2) &&
            (line.columnEnd === undefined || (next.end !== undefined && next.end <= line.columnEnd + 2))));
      if (
        next &&
        sameColumn &&
        !/[.!?:;,]$/.test(found.heading) &&
        !next.breakBefore &&
        (next.pageStart ?? null) === (line.pageStart ?? null) &&
        nextText.length > 0 &&
        nextText.length <= 80 &&
        nextText.split(/\s+/).length <= 10 &&
        /^[A-Za-z]/.test(nextText) &&
        !/[-.!?:;,]$/.test(nextText) &&
        !/[()]/.test(nextText) &&
        !/\b(?:is|are|was|were|has|have|shows?|suggests?|indicates?|demonstrates?)\b/i.test(nextText) &&
        !heading(nextText, next.height, median) &&
        (sameHeight || (line.height === undefined && next.height === undefined && /^[a-z]/.test(nextText)))
      ) {
        found.heading += ` ${nextText}`;
        index++;
      }
      const parent = [...sections].reverse().find((section) => section.level < found.level);
      current = {
        id: `sec${sections.length + 1}`,
        heading: found.heading,
        level: found.level,
        role: found.role === 'other' && parent ? parent.role : found.role,
        pageStart: line.pageStart ?? null,
      };
      sections.push(current);
      continue;
    }
    if (!current) {
      current = {
        id: 'sec1',
        heading: 'Front matter',
        role: 'other',
        level: 1,
        pageStart: line.pageStart ?? null,
      };
      sections.push(current);
    }
    const nextKind: PaperParagraph['kind'] =
      footnote || continuation
        ? 'footnote'
        : current.role === 'references'
          ? 'reference'
          : /^(?:(?:figure|fig\.|table)\s+\d+[.:]|\\caption\{)/i.test(text)
            ? 'caption'
            : /^(?:\[math\]|\$\$|\\\[)|[=∑∫]/.test(text)
              ? 'equation'
              : /^(?:[-*•]|\d+[.)])\s+/.test(text)
                ? 'list'
                : 'body';
    if (line.breakBefore || nextKind !== kind || (nextKind !== 'body' && !continuation)) await flush();
    if (!buffer.length) {
      page = line.pageStart ?? null;
      kind = nextKind;
      footnoteHeight = footnote ? line.height : undefined;
    }
    buffer.push(text.replace(/^\\caption\{(.*)\}$/, '$1'));
  }
  await flush();
  return { sections, paragraphs };
}
