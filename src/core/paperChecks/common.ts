import type { CheckId, CheckResult, Finding, Paper, PaperParagraph } from '../schemas';
import { createOffsetIndex } from '../text/offsets';

export type Located = { paragraph: PaperParagraph; text: string; start: number; end: number };
export function matches(paragraph: PaperParagraph, pattern: RegExp): Located[] {
  const offsets = createOffsetIndex(paragraph.text);
  return Array.from(paragraph.text.matchAll(pattern), (m) => ({
    paragraph,
    text: m[0],
    start: offsets.utf16ToCp(m.index),
    end: offsets.utf16ToCp(m.index + m[0].length),
  }));
}
export function finding(
  checkId: string,
  key: string,
  severity: Finding['severity'],
  message: string,
  locations: Located[],
): Finding {
  return {
    id: `${checkId}:${key}:${locations.map((p) => `${p.paragraph.id}:${p.start}:${p.end}`).join(':')}`,
    checkId,
    severity,
    message,
    locations: locations.map((p) => ({ paragraphId: p.paragraph.id, start: p.start, end: p.end })),
    evidence: locations.map((p) => p.text),
  };
}
export function result(
  id: CheckId,
  label: string,
  applicable: boolean,
  findings: Finding[],
  note: string,
): CheckResult {
  return {
    id,
    label,
    experimental: true,
    status: !applicable
      ? 'not_applicable'
      : findings.some((f) => f.severity === 'moderate' && id === 'citations_references')
        ? 'fail'
        : findings.some((f) => f.severity !== 'info')
          ? 'warn'
          : 'pass',
    summary: applicable ? `${findings.length} mục cần xem lại.` : 'Không đủ dữ liệu để kiểm tra.',
    findings: applicable ? findings : [],
    falsePositiveNotes: [note],
  };
}
export function role(paper: Paper, paragraph: PaperParagraph) {
  return paper.sections.find((s) => s.id === paragraph.sectionId)?.role;
}
export function validateLocations(paper: Paper, findings: Finding[]) {
  let dropped = 0;
  const valid = findings.flatMap((item) => {
    const locations = item.locations.filter((loc) => {
      const p = paper.paragraphs.find((paragraph) => paragraph.id === loc.paragraphId);
      const ok =
        !!p &&
        Number.isInteger(loc.start) &&
        Number.isInteger(loc.end) &&
        loc.start >= 0 &&
        loc.end > loc.start &&
        loc.end <= Array.from(p.text).length;
      if (!ok) dropped++;
      return ok;
    });
    return locations.length ? [{ ...item, locations }] : [];
  });
  return { findings: valid, dropped };
}
