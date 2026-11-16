import { anchorCitation, anchorText } from '../grobid/anchor';
import type { Finding, GrobidResult, Paper } from '../schemas';
import { finding, type Located } from './common';
import { numberingGaps, numbers, paperReferenceParagraphs } from './references';

type Numbered = { number: number; place: Located | null };

function findingsForGaps(items: Numbered[], checkId: string, type: 'reference' | 'figure' | 'table') {
  const findings: Finding[] = [];
  let suppressed = 0;
  for (const { number, gap } of numberingGaps(items.map((item) => item.number))) {
    const place = items.find((item) => item.number === number && item.place)?.place;
    if (!place) {
      suppressed++;
      continue;
    }
    const label = type === 'reference' ? 'số thứ tự tài liệu' : type === 'figure' ? 'Hình' : 'Bảng';
    findings.push(
      finding(checkId, `gap:grobid:${type}:${gap}`, 'minor', `Thiếu ${label} ${gap} (GROBID).`, [place]),
    );
  }
  return { findings, suppressed };
}

export function grobidReferenceGaps(paper: Paper, grobid: GrobidResult) {
  const refs = paperReferenceParagraphs(paper);
  const body = paper.paragraphs.filter((paragraph) => paragraph.kind === 'body' && !refs.includes(paragraph));
  const listed = grobid.references.flatMap((reference) => {
    const label = reference.label ?? reference.rawText?.match(/^\s*(?:\[\d+\]|\d+[.)])/u)?.[0];
    const match = label?.match(/^\s*(?:\[(\d+)\]|(\d+)[.)]?)(?:\s|$)/u);
    if (!match) return [];
    return [{ number: Number(match[1] ?? match[2]), place: anchorText(refs, label ?? '') }];
  });
  const cited = grobid.citations.flatMap((citation) => {
    if (!/^\s*\[\s*\d+(?:\s*[,;–—-]\s*\d+)*\s*\]\s*$/u.test(citation.text)) return [];
    return numbers(citation.text).values.map((number) => ({ number, place: anchorCitation(body, citation) }));
  });
  return findingsForGaps([...listed, ...cited], 'citations_references', 'reference');
}

export function grobidFigureGaps(paper: Paper, grobid: GrobidResult) {
  const all = (['figure', 'table'] as const).map((type) => {
    const items = (grobid.figures ?? [])
      .filter((item) => item.type === type)
      .flatMap((item) => {
        const match = /\b(?:fig(?:ure)?s?\.?|tables?)\s+(\d+)\b/iu.exec(item.label);
        if (!match) return [];
        return [{ number: Number(match[1]), place: anchorText(paper.paragraphs, match[0]) }];
      });
    return findingsForGaps(items, 'figures_tables', type);
  });
  return {
    findings: all.flatMap((item) => item.findings),
    suppressed: all.reduce((n, item) => n + item.suppressed, 0),
  };
}
