import type { Finding, Paper } from '../schemas';
import { finding, matches, result, role, type Located } from './common';

const normalize = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const authorYear =
  /\b([\p{L}\p{M}'’]+)(?:\s+(?:et al\.|and\s+[\p{L}\p{M}'’]+|&\s*[\p{L}\p{M}'’]+))?\s*[, (]+\s*(\d{4}[a-z]?)/giu;
function key(text: string) {
  const m = new RegExp(authorYear.source, 'iu').exec(text);
  return m ? `${normalize(m[1] ?? '')}:${m[2]?.toLowerCase()}` : '';
}
function numbers(text: string): number[] {
  const values: number[] = [];
  for (const part of text.replace(/[[\]]/gu, '').split(/\s*[,;]\s*/u)) {
    const range = /^(\d+)\s*[-–—]\s*(\d+)$/u.exec(part);
    if (range) {
      const a = Number(range[1]),
        b = Number(range[2]);
      if (b >= a && b - a <= 1000) for (let i = a; i <= b; i++) values.push(i);
    } else if (/^\d+$/u.test(part.trim())) values.push(Number(part));
  }
  return values;
}
export function citationsReferences(paper: Paper) {
  const id = 'citations_references';
  const refs = paper.paragraphs.filter((p) => p.kind === 'reference' || role(paper, p) === 'references');
  const body = paper.paragraphs.filter((p) => !refs.includes(p) && p.kind === 'body');
  const cited = body.flatMap((p) => [
    ...matches(p, /\[\s*\d+(?:\s*[,;–—-]\s*\d+)*\s*\]/gu).flatMap((m) =>
      numbers(m.text).map((n) => ({ key: `n:${n}`, loc: m })),
    ),
    ...matches(p, authorYear).map((m) => ({ key: key(m.text), loc: m })),
  ]);
  const entries = refs.flatMap((p, i) => {
    const loc = matches(p, /.+/gu)[0];
    if (!loc) return [];
    const number = /^\s*(?:\[(\d+)\]|(\d+)[.)])/u.exec(p.text);
    const k = key(p.text);
    return [{ keys: [...(number ? [`n:${number[1] ?? number[2]}`] : []), ...(k ? [k] : [])], loc, index: i }];
  });
  const findings: Finding[] = [];
  for (const item of cited)
    if (!entries.some((e) => e.keys.includes(item.key)))
      findings.push(
        finding(id, `missing:${item.key}`, 'moderate', 'Trích dẫn chưa có tài liệu tham khảo tương ứng.', [
          item.loc,
        ]),
      );
  for (const entry of entries)
    if (entry.keys.length && !entry.keys.some((k) => cited.some((c) => c.key === k)))
      findings.push(
        finding(id, `unused:${entry.index}`, 'info', 'Tài liệu tham khảo chưa được trích dẫn.', [entry.loc]),
      );
  const numeric = entries.flatMap((e) =>
    e.keys.filter((k) => k.startsWith('n:')).map((k) => Number(k.slice(2))),
  );
  if (numeric.length)
    for (let n = 1; n < Math.max(...numeric); n++)
      if (!numeric.includes(n)) {
        const loc = entries.find((e) => e.keys.includes(`n:${n + 1}`))?.loc ?? entries[0]?.loc;
        if (loc) findings.push(finding(id, `gap:${n}`, 'minor', `Thiếu số thứ tự tài liệu ${n}.`, [loc]));
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
    const nums = items.map((c) => Number(c.key.split(':')[1]));
    if (nums.length)
      for (let n = 1; n < Math.max(...nums); n++)
        if (!nums.includes(n)) {
          const loc: Located | undefined = items[0]?.loc;
          if (loc)
            findings.push(finding(id, `gap:${type}:${n}`, 'minor', `Thiếu số thứ tự ${type} ${n}.`, [loc]));
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
