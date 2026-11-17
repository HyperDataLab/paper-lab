import type { PaperParagraph, PaperTable, Section } from '../schemas/paper';
import { sourceHash } from '../text/hash';
import { combinedRoles, headingCue, headingRole } from './sectionRoles';

/** Recorded on papers imported with table and equation blocks; 3 adds the broader section-role headings. */
export const PAPER_PARSER_VERSION = 'paper-parser-3';

export interface PaperLine {
  text: string;
  table?: PaperTable;
  pageStart?: number | null;
  breakBefore?: boolean;
  height?: number;
  x?: number;
  end?: number;
  column?: 'left' | 'right' | 'full';
  columnStart?: number;
  columnEnd?: number;
  monospace?: boolean;
  boxed?: boolean;
  source?: 'pdf';
}
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
  const role = headingRole(name) ?? 'other';
  // Wording alone accepts a line as a heading only by the narrower cue, so wrapped body lines stay body text.
  const known = headingCue(name);
  const caps = /[A-Z]/.test(name) && name === name.toUpperCase() && /^[A-Z\d\s&-]+$/.test(name);
  const explicit = Boolean(markdown || latex);
  if (!latex && /[{}]/.test(trimmed)) return null;
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
function linkTableCaptions(paragraphs: PaperParagraph[]) {
  const claimed = new Set<string>();
  paragraphs.forEach((paragraph, index) => {
    if (!paragraph.table) return;
    // Reading order on a page can put a little text between a table and its caption.
    const caption = [-1, 1, -2, 2, -3, 3]
      .map((offset) => paragraphs[index + offset])
      .find(
        (other) =>
          other &&
          other.kind === 'caption' &&
          other.sectionId === paragraph.sectionId &&
          other.pageStart === paragraph.pageStart &&
          /^table\b/i.test(other.text) &&
          !claimed.has(other.id),
      );
    if (!caption) return;
    claimed.add(caption.id);
    paragraph.table.captionId = caption.id;
  });
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
  let afterReferences = false;
  const referenceStarts = new Map<string, number>();
  for (const line of lines) {
    if (line.x === undefined) continue;
    const key = `${line.pageStart ?? ''}:${line.column ?? ''}`;
    referenceStarts.set(key, Math.min(referenceStarts.get(key) ?? line.x, line.x));
  }
  async function flush() {
    if (!buffer.length || !current) return;
    let text = buffer[0] ?? '';
    for (const line of buffer.slice(1))
      text = /-$/.test(text) && /^[a-z]/.test(line) ? text.slice(0, -1) + line : `${text} ${line}`;
    const equationLabel =
      kind === 'equation' ? (/\(\s*(\d+[a-z]?)\s*\)\s*$/.exec(text)?.[1] ?? null) : undefined;
    await pushParagraph(text, kind, page, equationLabel === undefined ? {} : { equationLabel });
    buffer = [];
  }
  async function pushParagraph(
    text: string,
    paragraphKind: PaperParagraph['kind'],
    pageStart: number | null,
    extra: Pick<PaperParagraph, 'table' | 'equationLabel'>,
  ) {
    if (!current) return;
    const order = paragraphs.filter((p) => p.sectionId === current?.id).length;
    paragraphs.push({
      id: `${current.id}_p${String(order + 1).padStart(2, '0')}`,
      sectionId: current.id,
      order,
      text,
      pageStart,
      kind: paragraphKind,
      textHash: await sourceHash(text),
      ...extra,
    });
  }
  function ensureSection(line: PaperLine) {
    if (current) return;
    current = {
      id: 'sec1',
      heading: 'Front matter',
      role: 'other',
      level: 1,
      pageStart: line.pageStart ?? null,
    };
    sections.push(current);
  }
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (!line) continue;
    const text = line.text.trim();
    if (!text) {
      await flush();
      continue;
    }
    if (line.table) {
      await flush();
      ensureSection(line);
      await pushParagraph(line.text, 'table', line.pageStart ?? null, { table: line.table });
      continue;
    }
    if (
      line.source === 'pdf' &&
      /^\(\d+[a-z]?\)$/.test(text) &&
      kind === 'equation' &&
      buffer.length > 0 &&
      (line.pageStart ?? null) === page
    ) {
      buffer.push(text);
      continue;
    }
    if (/^\d{1,4}$|^page\s+\d+(?:\s+of\s+\d+)?$|^arxiv:\s*\d/i.test(text)) continue;
    if (line.source === 'pdf' && /^[-+]?\d\.\d$/.test(text)) continue;
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
    const appendix = afterReferences
      ? /^([A-Z])(?:\.(\d+(?:\.\d+)*))?\s+([A-Z][^{}]*[^\s:])$/.exec(text)
      : null;
    let found =
      footnote || continuation || line.monospace || line.boxed || /^\|.*\|$/.test(text)
        ? null
        : appendix
          ? {
              heading: appendix[3] ?? text,
              level: appendix[2] ? appendix[2].split('.').length + 1 : 1,
              role: 'appendix' as const,
              numbers: null,
            }
          : heading(text, line.height, median);
    const headingName = found?.heading ?? text;
    if (
      line.source === 'pdf' &&
      (/^#/.test(text) ||
        (!headingRole(headingName) &&
          /^[A-Z\d\s&:.,!?'-]+$/.test(headingName) &&
          headingName.trim().split(/\s+/).length >= 2))
    )
      found = null;
    if (
      current?.role === 'references' &&
      !appendix &&
      !/^(?:\d+(?:\.\d+)*\.?\s+)?(?:abstract|introduction|methods?|results?|discussion|conclusions?|references|bibliography|appendix|acknowledg(?:e)?ments?)\b/i.test(
        text,
      ) &&
      !/^\d+(?:\.\d+)*\.?\s+[A-Z]/.test(text)
    )
      found = null;
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
            Math.abs(line.x - next.x) <=
              Math.max(6, (line.height ?? 10) * (line.source === 'pdf' ? 2.5 : 1)) &&
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
        !next.monospace &&
        !next.boxed &&
        !/[{}]/.test(nextText) &&
        !(afterReferences && /^[A-Z](?:\.\d+(?:\.\d+)*)?\s+[A-Z]/.test(nextText)) &&
        /^[A-Za-z]/.test(nextText) &&
        !/[-.!?:;,]$/.test(nextText) &&
        !/[()]/.test(nextText) &&
        (line.source === 'pdf' ||
          !/\b(?:is|are|was|were|has|have|shows?|suggests?|indicates?|demonstrates?)\b/i.test(nextText)) &&
        !heading(nextText, next.height, median) &&
        (sameHeight || (line.height === undefined && next.height === undefined && /^[a-z]/.test(nextText)))
      ) {
        found.heading += ` ${nextText}`;
        index++;
      }
      // A subsection whose own heading names no role takes its parent's; a known `other` (e.g. funding) stays.
      const parent = [...sections].reverse().find((section) => section.level < found.level);
      const inherit = found.role === 'other' && parent && !headingRole(found.heading);
      const combined = combinedRoles(found.heading);
      current = {
        id: `sec${sections.length + 1}`,
        heading: found.heading,
        level: found.level,
        role: inherit ? parent.role : found.role,
        pageStart: line.pageStart ?? null,
        ...(combined ? { combined } : {}),
      };
      sections.push(current);
      if (current.role === 'references') afterReferences = true;
      continue;
    }
    ensureSection(line);
    const section = current as Section | undefined;
    if (!section) continue;
    const nextKind: PaperParagraph['kind'] =
      footnote || continuation
        ? 'footnote'
        : section.role === 'references'
          ? 'reference'
          : /^(?:(?:figure|fig\.|table)\s+\d+\s*[.:|]|\\caption\{)/i.test(text) ||
              /^TABLE\s+[IVXL\d]+\b/.test(text)
            ? 'caption'
            : /^(?:\[math\]|\$\$|\\\[)|[=∑∫]/.test(text)
              ? 'equation'
              : /^(?:[-*•]|\d+[.)])\s+/.test(text)
                ? 'list'
                : 'body';
    const previous = lines[index - 1];
    const pageOrColumnBreak = Boolean(
      previous &&
      ((line.pageStart != null && previous.pageStart != null && line.pageStart !== previous.pageStart) ||
        (line.column !== undefined && previous.column !== undefined && line.column !== previous.column)),
    );
    const boundary = line.breakBefore || pageOrColumnBreak;
    const continuesBody =
      pageOrColumnBreak &&
      nextKind === 'body' &&
      kind === 'body' &&
      buffer.length > 0 &&
      !/[.!?]["'”’\])]*$/.test(buffer[buffer.length - 1] ?? '') &&
      /^[a-z]/.test(text);
    const referenceKey = `${line.pageStart ?? ''}:${line.column ?? ''}`;
    const referenceStart = referenceStarts.get(referenceKey);
    const namedReference = /^(?:\[\d+\]|[A-Z][\p{L}'’-]+,\s*(?:[A-Z]\.)+)/u.test(text);
    const newReference =
      nextKind === 'reference' &&
      (namedReference ||
        (line.x !== undefined && referenceStart !== undefined && line.x <= referenceStart + 2));
    if (
      nextKind === 'reference' &&
      line.x !== undefined &&
      (referenceStart === undefined || line.x < referenceStart)
    )
      referenceStarts.set(referenceKey, line.x);
    if (
      nextKind !== kind ||
      (nextKind === 'reference' ? newReference : nextKind !== 'body' && !continuation) ||
      (boundary && nextKind !== 'reference' && !continuesBody)
    )
      await flush();
    if (!buffer.length) {
      page = line.pageStart ?? null;
      kind = nextKind;
      footnoteHeight = footnote ? line.height : undefined;
    }
    buffer.push(text.replace(/^\\caption\{(.*)\}$/, '$1'));
  }
  await flush();
  linkTableCaptions(paragraphs);
  return { sections, paragraphs };
}
