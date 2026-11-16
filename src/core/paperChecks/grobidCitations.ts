import { anchorCitation } from '../grobid/anchor';
import { isCutCitation, pairLeftoverCitations, resolveCitation } from '../grobid/citationFallback';
import { grobidReferenceItems } from '../grobid/merge';
import type { CheckResult, Finding, GrobidResult, Paper } from '../schemas';
import { finding, result, type Located } from './common';
import { paperReferenceParagraphs } from './references';
import { grobidReferenceGaps } from './grobidGaps';

/**
 * Citations and references checked against GROBID's links instead of the text patterns. A citation GROBID
 * could not link stays a candidate finding; a reference is unused only when no in-text citation resolves to it.
 * Unreadable numeric ranges are not checked.
 * Findings that cannot be placed in the PDF.js text are left out and counted in `suppressed`.
 */
export function grobidCitationsReferences(
  paper: Paper,
  grobid: GrobidResult,
): {
  check: CheckResult;
  suppressed: number;
  resolutions: { referenceId: string | null; matchedBy: 'link' | 'author-year' | 'leftover' | null }[];
} {
  const id = 'citations_references';
  const refs = paperReferenceParagraphs(paper);
  const body = paper.paragraphs.filter((p) => !refs.includes(p) && p.kind === 'body');
  const known = new Set(grobid.references.map((reference) => reference.id));
  const cited = new Set<string>();
  let suppressed = 0;
  const missing = new Map<string, Located[]>();
  const resolutions = grobid.citations.map((citation) => {
    if (citation.referenceId && known.has(citation.referenceId))
      return { referenceId: citation.referenceId, matchedBy: 'link' as const };
    const referenceId = resolveCitation(citation.text, grobid.references);
    return { referenceId, matchedBy: referenceId ? ('author-year' as const) : null };
  });
  const initialCited = new Set(
    resolutions.flatMap((entry) => (entry.referenceId ? [entry.referenceId] : [])),
  );
  const unresolvedIndexes = resolutions.flatMap((entry, index) => (entry.referenceId ? [] : [index]));
  const leftovers = unresolvedIndexes.flatMap((index) => {
    const citation = grobid.citations[index];
    return citation ? [citation] : [];
  });
  const pairs = pairLeftoverCitations(
    leftovers,
    grobid.references.filter((reference) => !initialCited.has(reference.id)),
  );
  const finalResolutions: {
    referenceId: string | null;
    matchedBy: 'link' | 'author-year' | 'leftover' | null;
  }[] = resolutions;
  pairs.forEach((referenceId, index) => {
    const originalIndex = unresolvedIndexes[index];
    if (originalIndex !== undefined) finalResolutions[originalIndex] = { referenceId, matchedBy: 'leftover' };
  });
  for (const [index, citation] of grobid.citations.entries()) {
    const linked = finalResolutions[index]?.referenceId;
    if (linked) {
      cited.add(linked);
      continue;
    }
    if (isCutCitation(citation.text)) {
      suppressed += 1;
      continue;
    }
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
  const gaps = grobidReferenceGaps(paper, grobid);
  findings.push(...gaps.findings);
  suppressed += gaps.suppressed;
  return {
    resolutions: finalResolutions,
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
