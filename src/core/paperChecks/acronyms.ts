import type { Finding, Paper } from '../schemas';
import { finding, matches, result, role, type Located } from './common';
import { definitionName, definitions, furniture } from './acronymFurniture';

export const IGNORED_ACRONYMS = [
  'AI',
  'LLM',
  'DNA',
  'RNA',
  'PCR',
  'USA',
  'UK',
  'EU',
  'CI',
  'SD',
  'SE',
  'ID',
  'PDF',
  'URL',
  'ICLR',
  'AAAI',
  'NEURIPS',
  'ICML',
  'ACL',
  'EMNLP',
  'FACCT',
  'ARXIV',
  'ACM',
  'IEEE',
  'NLP',
  'NAACL',
  'COLING',
  'GPT',
  'BERT',
  'LLAMA',
  'T5',
];
function shoutedLine(word: Located) {
  const chars = Array.from(word.paragraph.text);
  const lineStart = chars.lastIndexOf('\n', word.start - 1) + 1;
  const lineEnd = chars.indexOf('\n', word.end);
  const line = chars.slice(lineStart, lineEnd < 0 ? chars.length : lineEnd).join('');
  const letters = line.match(/\p{L}/gu) ?? [];
  const uppercase = line.match(/\p{Lu}/gu) ?? [];
  return letters.length > 0 && uppercase.length > letters.length / 2;
}
type Occurrences = {
  first: Located;
  count: number;
  definition?: { expansion: string; loc: Located };
  conflict?: Located;
  beforeDefinition: boolean;
};
export function acronyms(paper: Paper) {
  const id = 'acronyms';
  const paragraphs = paper.paragraphs.filter((p) => {
    const section = paper.sections.find((s) => s.id === p.sectionId);
    return (
      p.kind === 'body' &&
      role(paper, p) !== 'references' &&
      role(paper, p) !== 'title' &&
      !/^front\s+matter$/iu.test(section?.heading.trim() ?? '')
    );
  });
  const found = new Map<string, Occurrences>();
  const venueDefinitions = new Set<string>();
  for (const p of paper.paragraphs) {
    for (const block of furniture(p)) {
      if (!/^\s*ACM Reference Format:/iu.test(block.text)) continue;
      for (const def of definitions(p)) {
        if (def.start < block.start || def.end > block.end) continue;
        const name = definitionName(def);
        if (name) venueDefinitions.add(name);
      }
    }
  }
  const lowercaseWords = new Set(
    paper.paragraphs.flatMap((p) =>
      Array.from(p.text.matchAll(/(?<![\p{L}\p{N}_])\p{Ll}+(?![\p{L}\p{N}_])/gu), (match) => match[0]),
    ),
  );
  for (const p of paragraphs) {
    const paragraphDefinitions = definitions(p);
    const excluded = furniture(p);
    for (const word of matches(p, /\b[A-Z]{2,8}\d*s?\b/gu)) {
      const name = word.text.replace(/s$/u, '');
      if (
        IGNORED_ACRONYMS.includes(name.toUpperCase()) ||
        excluded.some((block) => block.start <= word.start && block.end >= word.end) ||
        lowercaseWords.has(name.toLowerCase()) ||
        shoutedLine(word)
      )
        continue;
      const item = found.get(name) ?? { first: word, count: 0, beforeDefinition: false };
      item.count++;
      const def = paragraphDefinitions.find((d) => d.start <= word.start && d.end >= word.end);
      if (def) {
        const expansion = def.text.slice(0, def.text.lastIndexOf('(')).trim().toLowerCase();
        if (item.definition && item.definition.expansion !== expansion) item.conflict ??= def;
        else item.definition ??= { expansion, loc: def };
      } else if (!item.definition) item.beforeDefinition = true;
      found.set(name, item);
    }
  }
  const findings: Finding[] = [];
  for (const [name, item] of found) {
    if (venueDefinitions.has(name) && !item.conflict) continue;
    if (!item.conflict && !(item.beforeDefinition && (item.definition || item.count >= 2))) continue;
    const message = item.conflict
      ? 'Chữ viết tắt có các định nghĩa khác nhau.'
      : item.definition
        ? 'Chữ viết tắt được dùng trước khi định nghĩa.'
        : 'Chữ viết tắt chưa được định nghĩa.';
    const locations = item.conflict ? [item.first, item.conflict] : [item.first];
    const candidate = finding(
      id,
      item.conflict ? `duplicate:${name}` : `undefined:${name}`,
      'minor',
      message,
      locations,
    );
    candidate.evidence.push(`${item.count} lần xuất hiện trong nội dung`);
    findings.push(candidate);
  }
  return result(
    id,
    'Chữ viết tắt',
    paragraphs.length > 0,
    findings,
    'Tên riêng và cách định nghĩa khác có thể bị nhận diện nhầm.',
  );
}
