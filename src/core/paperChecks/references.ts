import type { Finding, Paper } from '../schemas';
import { finding, matches, result, role, type Located } from './common';

const normalize = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
function referenceTextMatches(citationKey: string, referenceText: string) {
  if (citationKey.startsWith('n:')) return false;
  const [surname, year] = citationKey.split(':');
  if (!surname || !year) return false;
  const escaped = surname.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const names = new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, 'gu');
  const yearPattern = new RegExp(`(?<![\\p{L}\\p{N}])${year}(?![\\p{L}\\p{N}])`, 'u');
  for (const match of referenceText.matchAll(names)) {
    const after = referenceText.slice(match.index + match[0].length);
    const yearMatch = yearPattern.exec(after);
    if (yearMatch && Array.from(after.slice(0, yearMatch.index)).length <= 400) return true;
  }
  return false;
}
const authorYear =
  /(?<![\p{L}\p{M}])([\p{L}\p{M}'’]+)(?:\s+(?:et al\.|and\s+[\p{L}\p{M}'’]+|&\s*[\p{L}\p{M}'’]+))?\s*[, (]+\s*((?:19|20)\d{2}[a-z]?)/giu;
function key(text: string) {
  const m = new RegExp(authorYear.source, 'iu').exec(text);
  return m ? `${normalize(m[1] ?? '')}:${m[2]?.toLowerCase()}` : '';
}
function referenceEntries(refs: Paper['paragraphs']) {
  const entries: { paragraphs: Paper['paragraphs']; sectionId: string }[] = [];
  for (const p of refs) {
    if (!p.text.trim()) continue;
    const start =
      /^\s*(?:\[\d+\]|\d+[.)])\s*/u.test(p.text) ||
      /^\s*[\p{L}\p{M}'’.-]+(?:\s+[\p{L}\p{M}'’.-]+)*,\s*\p{L}\./iu.test(p.text);
    const previous = entries[entries.length - 1];
    if (!previous || previous.sectionId !== p.sectionId || start)
      entries.push({ paragraphs: [p], sectionId: p.sectionId });
    else previous.paragraphs.push(p);
  }
  return entries.flatMap(({ paragraphs }, index) => {
    const first = paragraphs[0];
    if (!first) return [];
    const locs = paragraphs.flatMap((p) => matches(p, /[\s\S]+/gu));
    const text = paragraphs.map((p) => p.text).join(' ');
    const number = /^\s*(?:\[(\d+)\]|(\d+)[.)])/u.exec(text);
    const withoutNumber = text.replace(/^\s*(?:\[\d+\]|\d+[.)])\s*/u, '');
    const surname = /^\s*([\p{L}\p{M}'’.-]+(?:\s+[\p{L}\p{M}'’.-]+)*),/u.exec(withoutNumber)?.[1];
    const years = [...withoutNumber.matchAll(/(?<!\d)(?:19|20)\d{2}[a-z]?(?![\p{L}\p{N}])/giu)];
    const year = years[years.length - 1]?.[0];
    const authorKey =
      surname && year
        ? `${normalize(surname.replace(/\s+et al\.$/iu, ''))}:${year.toLowerCase()}`
        : key(withoutNumber);
    return [
      {
        keys: [...(number ? [`n:${number[1] ?? number[2]}`] : []), ...(authorKey ? [authorKey] : [])],
        locs,
        index,
        clean:
          /^\s*[\p{L}\p{M}'’.-]+(?:\s+[\p{L}\p{M}'’.-]+)*,\s*\p{L}\./u.test(text) &&
          /(?<!\d)(?:19|20)\d{2}[a-z]?[.\s]*$/iu.test(text),
      },
    ];
  });
}
function numbers(text: string): { values: number[]; unchecked: string[] } {
  const values: number[] = [];
  const unchecked: string[] = [];
  for (const part of text.replace(/[[\]]/gu, '').split(/\s*[,;]\s*/u)) {
    const range = /^(\d+)\s*[-–—]\s*(\d+)$/u.exec(part);
    if (range) {
      const a = Number(range[1]),
        b = Number(range[2]);
      if (
        Number.isSafeInteger(a) &&
        Number.isSafeInteger(b) &&
        a > 0 &&
        b <= 10000 &&
        b >= a &&
        b - a <= 1000
      )
        for (let i = a; i <= b; i++) values.push(i);
      else unchecked.push(part);
    } else if (/^\d+$/u.test(part.trim())) {
      const number = Number(part);
      if (Number.isSafeInteger(number) && number > 0 && number <= 10000) values.push(number);
      else unchecked.push(part);
    }
  }
  return { values, unchecked };
}
const parentheticalAuthor =
  /(?<=[(;])\s*\p{Lu}[\p{Ll}\p{M}]+(?:[-'’]\p{Lu}?[\p{Ll}\p{M}]+)*(?:\s+(?:et al\.|(?:and|&)\s+\p{Lu}[\p{Ll}\p{M}]+))?\s*,\s*(?:19|20)\d{2}[a-z]?(?=\s*[,;)])/gu;
const narrativeAuthor =
  /(?<![\p{L}\p{M}])\p{Lu}[\p{Ll}\p{M}]+(?:[-'’]\p{Lu}?[\p{Ll}\p{M}]+)*(?:\s+(?:et al\.|(?:and|&)\s+\p{Lu}[\p{Ll}\p{M}]+))?\s*\((?:19|20)\d{2}[a-z]?\)/gu;
function tableLine(location: Located) {
  const text = Array.from(location.paragraph.text);
  const start = text.lastIndexOf('\n', location.start - 1) + 1;
  const end = text.indexOf('\n', location.end);
  const line = text.slice(start, end < 0 ? text.length : end).join('');
  const symbols = line.match(/[|│┆┊]/gu)?.length ?? 0;
  const visible = line.match(/\S/gu)?.length ?? 0;
  const nonletters = line.match(/[^\p{L}\p{M}\s]/gu)?.length ?? 0;
  return symbols >= 2 || (visible > 0 && nonletters > visible / 2);
}
export function citationsReferences(paper: Paper) {
  const id = 'citations_references';
  const refs = paper.paragraphs.filter((p) => p.kind === 'reference' || role(paper, p) === 'references');
  const body = paper.paragraphs.filter((p) => !refs.includes(p) && p.kind === 'body');
  const unchecked: { text: string; loc: Located }[] = [];
  const cited = body.flatMap((p) => [
    ...matches(p, /\[\s*\d+(?:\s*[,;–—-]\s*\d+)*\s*\]/gu).flatMap((m) => {
      const parsed = numbers(m.text);
      unchecked.push(...parsed.unchecked.map((text) => ({ text, loc: m })));
      return parsed.values.map((n) => ({ key: `n:${n}`, loc: m }));
    }),
    ...[...matches(p, parentheticalAuthor), ...matches(p, narrativeAuthor)]
      .filter((m) => !tableLine(m))
      .map((m) => ({ key: key(m.text), loc: m })),
  ]);
  const entries = referenceEntries(refs);
  const referenceParagraphs = refs.filter((p) => p.kind === 'reference');
  const referenceText = normalize(
    (referenceParagraphs.length ? referenceParagraphs : refs).map((p) => p.text).join(' '),
  );
  const findings: Finding[] = [];
  const missing = new Map<string, Located[]>();
  for (const item of cited)
    if (!entries.some((e) => e.keys.includes(item.key)) && !referenceTextMatches(item.key, referenceText)) {
      const locations = missing.get(item.key) ?? [];
      locations.push(item.loc);
      missing.set(item.key, locations);
    }
  for (const [citationKey, locations] of missing) {
    const candidate = finding(
      id,
      `missing:${citationKey}`,
      'moderate',
      'Trích dẫn chưa có tài liệu tham khảo tương ứng.',
      locations,
    );
    candidate.evidence.push(`${locations.length} lần trích dẫn`);
    findings.push(candidate);
  }
  for (const item of unchecked)
    findings.push(
      finding(id, `unchecked:${item.text}`, 'minor', `Không kiểm tra được trích dẫn số ${item.text}.`, [
        item.loc,
      ]),
    );
  for (const entry of entries)
    if (entry.clean && entry.keys.length && !entry.keys.some((k) => cited.some((c) => c.key === k)))
      findings.push(
        finding(id, `unused:${entry.index}`, 'info', 'Tài liệu tham khảo chưa được trích dẫn.', entry.locs),
      );
  const numeric = entries.flatMap((e) =>
    e.keys.filter((k) => k.startsWith('n:')).map((k) => Number(k.slice(2))),
  );
  let previous = 0;
  for (const n of [...new Set(numeric)].sort((a, b) => a - b)) {
    if (n > previous + 1) {
      const loc = entries.find((e) => e.keys.includes(`n:${n}`))?.locs[0];
      const first = previous + 1;
      const missing = first === n - 1 ? `${first}` : `${first}–${n - 1}`;
      if (loc)
        findings.push(finding(id, `gap:${missing}`, 'minor', `Thiếu số thứ tự tài liệu ${missing}.`, [loc]));
    }
    previous = n;
  }
  return result(
    id,
    'Trích dẫn và tài liệu tham khảo',
    refs.length > 0 && body.length > 0,
    findings,
    'Định dạng tài liệu và tên tác giả có thể không được nhận diện đầy đủ.',
  );
}
export function figuresTables(paper: Paper) {
  const id = 'figures_tables';
  const extract = (p: Paper['paragraphs'][number]) =>
    matches(p, /\b(?:fig(?:ure)?\.?|table)\s+\d+\b/giu).map((loc) => ({
      key: `${/^t/iu.test(loc.text) ? 'table' : 'figure'}:${loc.text.match(/\d+/u)?.[0]}`,
      loc,
    }));
  const body = paper.paragraphs.filter((p) => p.kind === 'body').flatMap(extract);
  const captions = paper.paragraphs.filter((p) => p.kind === 'caption').flatMap(extract);
  const findings: Finding[] = [];
  for (const item of body)
    if (!captions.some((c) => c.key === item.key))
      findings.push(
        finding(id, `missing:${item.key}`, 'minor', 'Không tìm thấy chú thích tương ứng.', [item.loc]),
      );
  for (const item of captions)
    if (!body.some((c) => c.key === item.key))
      findings.push(
        finding(id, `unused:${item.key}`, 'info', 'Chú thích chưa được nhắc đến trong nội dung.', [item.loc]),
      );
  for (const type of ['figure', 'table']) {
    const items = captions.filter((c) => c.key.startsWith(type));
    const nums = [
      ...new Set(items.map((c) => Number(c.key.split(':')[1])).filter(Number.isSafeInteger)),
    ].sort((a, b) => a - b);
    let previous = 0;
    for (const n of nums) {
      if (n > previous + 1) {
        const first = previous + 1;
        const gap = first === n - 1 ? `${first}` : `${first}–${n - 1}`;
        const loc = items.find((item) => Number(item.key.split(':')[1]) === n)?.loc;
        if (loc)
          findings.push(
            finding(
              id,
              `gap:${type}:${gap}`,
              'minor',
              `Thiếu ${type === 'figure' ? 'Hình' : 'Bảng'} ${gap}.`,
              [loc],
            ),
          );
      }
      previous = n;
    }
  }
  return result(
    id,
    'Hình và bảng',
    body.length > 0 || captions.length > 0,
    findings,
    'Chú thích có thể không được phân loại hoặc dùng cách ghi khác.',
  );
}
