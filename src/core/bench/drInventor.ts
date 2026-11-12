import type { Paper, PaperParagraph, Section } from '../schemas/paper';

export type GoldLabel = 'own_claim' | 'background_claim' | 'data';
export type GoldSpan = { label: GoldLabel; start: number; end: number };
export type Prediction = { kind: 'claim' | 'data'; rawStart: number; rawEnd: number };
type RawCharacter = { start: number; end: number };

export function parseBrat(ann: string): GoldSpan[] {
  return ann.split(/\r?\n/u).flatMap((line) => {
    const match = /^T\d+\t(own_claim|background_claim|data) (\d+) (\d+)\t/u.exec(line);
    if (!match) return [];
    const start = Number(match[2]);
    const end = Number(match[3]);
    return end > start ? [{ label: match[1] as GoldLabel, start, end }] : [];
  });
}

/** Offsets in the mapping and brat annotations count Unicode code points in the raw file. */
export function toPaper(raw: string, id: string) {
  const sections: Section[] = [];
  const paragraphs: PaperParagraph[] = [];
  const mapping: Record<string, RawCharacter[]> = {};
  let section: Section | undefined;
  let text = '';
  let positions: RawCharacter[] = [];
  let heading: string | null = null;
  let title = '';
  let inTitle = false;
  let offset = 0;
  const addSection = (name: string, level = 1) => {
    section = { id: `s${sections.length + 1}`, heading: name, role: 'other', level, pageStart: null };
    sections.push(section);
  };
  const flush = () => {
    let first = 0;
    let last = positions.length;
    const chars = Array.from(text);
    while (first < last && /\s/u.test(chars[first] ?? '')) first++;
    while (last > first && /\s/u.test(chars[last - 1] ?? '')) last--;
    const content = chars.slice(first, last).join('');
    if (content && !/^(?:doi\s*:|[a-f\d]{32,}\s*$)/iu.test(content)) {
      if (!section) addSection('');
      const paragraphId = `p${paragraphs.length + 1}`;
      paragraphs.push({
        id: paragraphId,
        sectionId: section?.id ?? '',
        order: paragraphs.length,
        text: content,
        pageStart: null,
        kind: 'body',
        textHash: '',
      });
      mapping[paragraphId] = positions.slice(first, last);
    }
    text = '';
    positions = [];
  };
  const tokens = raw.matchAll(
    /<!--[\s\S]*?-->|<[^>]*>|&(?:#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);|\r?\n\s*\r?\n|[\s\S]/giu,
  );
  for (const match of tokens) {
    const token = match[0];
    const length = Array.from(token).length;
    if (token.startsWith('<')) {
      const tag = /^<\s*(\/?)\s*([\w:-]+)/u.exec(token);
      const name = tag?.[2]?.toLowerCase() ?? '';
      const closing = tag?.[1] === '/';
      if (/^h[1-6]$/u.test(name)) {
        if (closing) {
          addSection(heading?.trim() ?? '', Number(name[1]));
          heading = null;
        } else {
          flush();
          heading = '';
        }
      } else if (name === 'title') {
        inTitle = !closing;
      } else if (/^(?:sentence|p|paragraph)$/u.test(name)) flush();
    } else if (/^\r?\n\s*\r?\n$/u.test(token)) {
      if (heading !== null) heading += ' ';
      else if (!inTitle) flush();
    } else {
      const entities: Record<string, string> = {
        '&amp;': '&',
        '&lt;': '<',
        '&gt;': '>',
        '&quot;': '"',
        '&apos;': "'",
      };
      let value = entities[token.toLowerCase()] ?? token;
      if (/^&#/u.test(token)) {
        const hex = /^&#x/iu.test(token);
        const n = Number.parseInt(token.slice(hex ? 3 : 2, -1), hex ? 16 : 10);
        if (n <= 0x10ffff) value = String.fromCodePoint(n);
      }
      if (heading !== null) heading += value;
      else if (inTitle) title += value;
      else {
        text += value;
        positions.push(...Array.from(value, () => ({ start: offset, end: offset + length })));
      }
    }
    offset += length;
  }
  flush();
  const paper: Paper = {
    schemaVersion: 1,
    id: '00000000-0000-4000-8000-000000000000',
    title: title.trim() || id,
    createdAt: '1970-01-01T00:00:00.000Z',
    updatedAt: '1970-01-01T00:00:00.000Z',
    source: { kind: 'text', fileName: `${id}.txt`, pageCount: null, sha256: '' },
    sections,
    paragraphs,
  };
  return { paper, mapping };
}

export function mapSpan(
  mapping: Record<string, RawCharacter[]>,
  paragraphId: string,
  start: number,
  end: number,
) {
  const chars = mapping[paragraphId];
  const first = chars?.[start];
  const last = chars?.[end - 1];
  return first && last && end > start ? { rawStart: first.start, rawEnd: last.end } : null;
}

const LABELS = ['own_claim', 'background_claim', 'data'] as const;
const ratio = (numerator: number, denominator: number) => (denominator ? numerator / denominator : null);

export function scoreSpans(predicted: Prediction[], gold: GoldSpan[]) {
  const confusion = {
    claim: { own_claim: 0, background_claim: 0, data: 0, none: 0 },
    data: { own_claim: 0, background_claim: 0, data: 0, none: 0 },
  };
  const overlap = (p: Prediction, g: GoldSpan) =>
    Math.max(0, Math.min(p.rawEnd, g.end) - Math.max(p.rawStart, g.start));
  for (const p of predicted) {
    let label: GoldLabel | 'none' = 'none';
    let best = 0;
    for (const g of gold) {
      const n = overlap(p, g);
      if (n > best) {
        best = n;
        label = g.label;
      }
    }
    confusion[p.kind][label]++;
  }
  const recallCounts = (label: 'own_claim' | 'data', kind: Prediction['kind']) => {
    const spans = gold.filter((g) => g.label === label);
    return {
      found: spans.filter((g) => predicted.some((p) => p.kind === kind && overlap(p, g) > 0)).length,
      total: spans.length,
    };
  };
  const claimRecall = recallCounts('own_claim', 'claim');
  const dataRecall = recallCounts('data', 'data');
  const dataPredictions = predicted.filter((p) => p.kind === 'data');
  const dataContainsGold = dataPredictions.filter((p) =>
    gold.some((g) => g.label === 'data' && overlap(p, g) * 2 >= g.end - g.start),
  ).length;
  const majority = LABELS.reduce((best, label) =>
    gold.filter((g) => g.label === label).length > gold.filter((g) => g.label === best).length ? label : best,
  );
  return {
    confusion,
    precision: {
      claim: ratio(confusion.claim.own_claim, predicted.filter((p) => p.kind === 'claim').length),
      data: ratio(confusion.data.data, dataPredictions.length),
      dataContainsGold: ratio(dataContainsGold, dataPredictions.length),
    },
    recall: {
      own_claim: ratio(claimRecall.found, claimRecall.total),
      data: ratio(dataRecall.found, dataRecall.total),
    },
    recallCounts: { own_claim: claimRecall, data: dataRecall },
    majorityLabel: gold.length ? majority : null,
    majorityBaseline: ratio(
      gold.length ? confusion.claim[majority] + confusion.data[majority] : 0,
      predicted.length,
    ),
  };
}
