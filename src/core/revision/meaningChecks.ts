import { createOffsetIndex } from '../text/offsets';

type Side = 'source' | 'revised';
type Located = { value: string; start: number; end: number; side: Side };
export type MeaningCheck = {
  id: string;
  status: 'pass' | 'fail' | 'warn';
  detail: string;
  spans: { start: number; end: number; side: Side }[];
};

function find(text: string, pattern: RegExp, side: Side, caseSensitive = false): Located[] {
  const offsets = createOffsetIndex(text);
  return Array.from(text.matchAll(pattern), (match) => ({
    value: (caseSensitive ? match[0] : match[0].toLowerCase()).replace(/\s+/gu, ' ').trim(),
    start: offsets.utf16ToCp(match.index),
    end: offsets.utf16ToCp(match.index + match[0].length),
    side,
  }));
}
function excess(a: Located[], b: Located[]): Located[] {
  const counts = new Map<string, number>();
  for (const item of b) counts.set(item.value, (counts.get(item.value) ?? 0) + 1);
  return a.filter((item) => {
    const count = counts.get(item.value) ?? 0;
    if (count) counts.set(item.value, count - 1);
    return count === 0;
  });
}
function result(id: string, status: 'fail' | 'warn', differences: Located[], detail: string): MeaningCheck {
  return {
    id,
    status: differences.length ? status : 'pass',
    detail: differences.length ? detail : 'Được giữ lại.',
    spans: differences.map(({ start, end, side }) => ({ start, end, side })),
  };
}
const citation =
  /\[\s*\d+(?:\s*[,;–—-]\s*\d+)*\s*\]|\([^()]*\b(?:\d{4}[a-z]?|et al\.)[^()]*\)|\b[\p{L}\p{M}'’]+\s+et al\.(?:\s*\(?\d{4}[a-z]?\)?)?/giu;
const quantity =
  /(?<![\p{L}\p{N}])[-+−±]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:\s*[-–—]\s*[-+−]?\d+(?:\.\d+)?)?(?:\s*(?:[%‰°]+|[\p{L}\p{M}µμ]+)(?:[/·⋅^−-][\p{L}\p{M}\p{N}µμ⁰¹²³⁴⁵⁶⁷⁸⁹⁻-]+)*)?/gu;
const negation = /\b(?:not|no|never|neither|nor|without|cannot)\b|n['’]t\b/giu;
const hedge = /\b(?:may|might|could|suggests?|likely|possibly|appears?|approximately|about|preliminary)\b/giu;
const strong =
  /\b(?:proves?|proved|demonstrates?\s+conclusively|demonstrated\s+conclusively|definitely|always)\b/giu;

export function meaningChecks(source: string, revised: string, preserveTerms: string[]): MeaningCheck[] {
  const sourceCitations = find(source, citation, 'source');
  const revisedCitations = find(revised, citation, 'revised');
  const quantities = (text: string, side: Side, citations: Located[]) =>
    find(text, quantity, side, true).filter(
      (number) => !citations.some((c) => number.start < c.end && number.end > c.start),
    );
  const beforeNumbers = quantities(source, 'source', sourceCitations);
  const afterNumbers = quantities(revised, 'revised', revisedCitations);
  const differences = (a: Located[], b: Located[]) => [...excess(a, b), ...excess(b, a)];
  // Align clause windows by position; this deliberately flags reordered negations for review.
  const clausePattern =
    /[^;:,.!?]+?(?=\b(?:and|but|or|yet|while|whereas)\b|[;:,.!?]|$)|\b(?:and|but|or|yet|while|whereas)\b/giu;
  const clauses = (text: string, side: Side) =>
    find(text, clausePattern, side).filter((item) => !/^(?:and|but|or|yet|while|whereas)$/u.test(item.value));
  const beforeClauses = clauses(source, 'source');
  const afterClauses = clauses(revised, 'revised');
  const missingNegations: Located[] = [];
  beforeClauses.forEach((clause, index) => {
    const prior = find(clause.value, negation, 'source');
    const next = find(afterClauses[index]?.value ?? '', negation, 'revised');
    if (prior.length > next.length) missingNegations.push(clause);
  });
  const missingHedges = excess(find(source, hedge, 'source'), find(revised, hedge, 'revised'));
  const addedStrength = excess(find(revised, strong, 'revised'), find(source, strong, 'source'));
  const missingTerms = preserveTerms.filter((term) => term && !revised.includes(term));
  const termSpans: Located[] = missingTerms.flatMap((term) => {
    const index = source.indexOf(term);
    if (index < 0) return [];
    const offsets = createOffsetIndex(source);
    return [
      {
        value: term,
        start: offsets.utf16ToCp(index),
        end: offsets.utf16ToCp(index + term.length),
        side: 'source' as const,
      },
    ];
  });
  // A missing term absent from the original still needs a visible location for review.
  if (missingTerms.length && !termSpans.length && source.length)
    termSpans.push({ value: '', start: 0, end: createOffsetIndex(source).length, side: 'source' });
  if (missingTerms.length && !termSpans.length && revised.length)
    termSpans.push({ value: '', start: 0, end: createOffsetIndex(revised).length, side: 'revised' });
  return [
    result(
      'numbers_preserved',
      'fail',
      differences(beforeNumbers, afterNumbers),
      'Số liệu hoặc đơn vị đã thay đổi.',
    ),
    result(
      'citations_preserved',
      'fail',
      differences(sourceCitations, revisedCitations),
      'Trích dẫn đã thay đổi.',
    ),
    result('negation_preserved', 'fail', missingNegations, 'Phủ định trong mệnh đề đã giảm.'),
    addedStrength.length
      ? result('hedging_preserved', 'fail', addedStrength, 'Mức khẳng định tăng.')
      : result('hedging_preserved', 'warn', missingHedges, 'Từ thể hiện sự dè dặt bị thiếu.'),
    {
      ...result('preserve_terms', 'fail', termSpans, `Thiếu: ${missingTerms.join(', ')}`),
      ...(missingTerms.length ? { status: 'fail' as const } : {}),
    },
    {
      id: 'length_change',
      status: 'pass',
      detail: `Tỷ lệ độ dài: ${source.length ? (Array.from(revised).length / Array.from(source).length).toFixed(2) : '—'}`,
      spans: [],
    },
  ];
}
