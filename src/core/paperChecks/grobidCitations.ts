import { anchorCitation } from '../grobid/anchor';
import { grobidReferenceItems } from '../grobid/merge';
import type { CheckResult, Finding, GrobidResult, Paper } from '../schemas';
import { finding, result, type Located } from './common';
import { paperReferenceParagraphs } from './references';

/**
 * Citations and references checked against GROBID's links instead of the text patterns. A citation GROBID
 * could not link stays a candidate finding; a reference is unused only when no in-text citation resolves to it.
 * Numbering gaps and unreadable numeric ranges are not checked here: GROBID has already resolved the numbers.
 * Findings that cannot be placed in the PDF.js text are left out and counted in `suppressed`.
 */
export function grobidCitationsReferences(
  paper: Paper,
  grobid: GrobidResult,
): { check: CheckResult; suppressed: number } {
  const id = 'citations_references';
  const refs = paperReferenceParagraphs(paper);
  const body = paper.paragraphs.filter((p) => !refs.includes(p) && p.kind === 'body');
  const known = new Set(grobid.references.map((reference) => reference.id));
  const cited = new Set(
    grobid.citations.flatMap((citation) =>
      citation.referenceId && known.has(citation.referenceId) ? [citation.referenceId] : [],
    ),
  );
  let suppressed = 0;
  const missing = new Map<string, Located[]>();
  for (const citation of grobid.citations) {
    if (citation.referenceId && known.has(citation.referenceId)) continue;
    // A marker is looked for on its own page first (a paragraph may start on the page before).
    const page = citation.page;
    const onPage = page ? body.filter((p) => p.pageStart === page || p.pageStart === page - 1) : [];
    const place = anchorCitation(onPage.length ? onPage : body, citation);
    if (!place) {
      suppressed += 1;
      continue;
    }
    const key = citation.text.replace(/\s+/gu, ' ').trim();
    const locations = missing.get(key) ?? [];
    if (!locations.some((item) => item.paragraph === place.paragraph && item.start === place.start))
      locations.push(place);
    missing.set(key, locations);
  }
  const findings: Finding[] = [];
  for (const [key, locations] of missing) {
    const candidate = finding(
      id,
      `missing:grobid:${key}`,
      'moderate',
      'Trích dẫn chưa có tài liệu tham khảo tương ứng.',
      locations,
    );
    candidate.evidence.push(`${locations.length} lần trích dẫn`);
    findings.push(candidate);
  }
  for (const item of grobidReferenceItems(grobid, refs)) {
    if (cited.has(item.id)) continue;
    if (!item.place) {
      suppressed += 1;
      continue;
    }
    findings.push(
      finding(id, `unused:grobid:${item.id}`, 'info', 'Tài liệu tham khảo chưa được trích dẫn.', [
        item.place,
      ]),
    );
  }
  return {
    check: result(
      id,
      'Trích dẫn và tài liệu tham khảo',
      grobid.references.length > 0 && body.length > 0,
      findings,
      'Liên kết trích dẫn lấy từ GROBID; trích dẫn GROBID không nối được vẫn chỉ là ứng viên.',
    ),
    suppressed,
  };
}
