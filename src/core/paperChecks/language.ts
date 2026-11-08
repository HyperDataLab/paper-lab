import type { Finding, Paper } from '../schemas';
import { quantity, citation } from '../revision/meaningChecks';
import { segmentSentences } from '../text/segment';
import { finding, matches, result, role, type Located } from './common';

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
];
export function acronyms(paper: Paper) {
  const id = 'acronyms',
    findings: Finding[] = [];
  const definitions = new Map<string, { expansion: string; loc: Located }>();
  const paragraphs = paper.paragraphs.filter((p) => p.kind === 'body');
  for (const p of paragraphs) {
    const defs = matches(p, /\b(?:[\p{L}][\p{L}-]*\s+){1,7}\(([A-Z]{2,8})\)/gu);
    const words = matches(p, /\b[A-Z]{2,8}\d*s?\b/gu);
    for (const word of words) {
      const name = word.text.replace(/s$/u, '');
      if (IGNORED_ACRONYMS.includes(name)) continue;
      const def = defs.find((d) => d.start <= word.start && d.end >= word.end);
      if (def) {
        const expansion = def.text.slice(0, def.text.lastIndexOf('(')).trim().toLowerCase();
        const previous = definitions.get(name);
        if (previous && previous.expansion !== expansion)
          findings.push(
            finding(id, `duplicate:${name}`, 'minor', 'Chữ viết tắt có các định nghĩa khác nhau.', [
              previous.loc,
              def,
            ]),
          );
        else definitions.set(name, { expansion, loc: def });
      } else if (!definitions.has(name))
        findings.push(
          finding(id, `undefined:${name}`, 'minor', 'Chữ viết tắt được dùng trước khi định nghĩa.', [word]),
        );
    }
  }
  return result(
    id,
    'Chữ viết tắt',
    paragraphs.length > 0,
    findings,
    'Tên riêng và cách định nghĩa khác có thể bị nhận diện nhầm.',
  );
}
function quantities(p: Paper['paragraphs'][number]) {
  return matches(p, quantity).filter(
    (m) =>
      /[%‰°\p{L}µμ]/u.test(m.text) && !matches(p, citation).some((c) => c.start < m.end && c.end > m.start),
  );
}
export function numbersConsistency(paper: Paper) {
  const id = 'numbers_consistency',
    findings: Finding[] = [];
  const claims = paper.paragraphs.filter(
    (p) => p.kind === 'body' && ['abstract', 'conclusion'].includes(role(paper, p) ?? ''),
  );
  const evidence = paper.paragraphs.filter(
    (p) =>
      (p.kind === 'body' && ['results', 'discussion'].includes(role(paper, p) ?? '')) || p.kind === 'caption',
  );
  const all = evidence.flatMap(quantities);
  for (const item of claims.flatMap(quantities))
    if (
      !all.some(
        (x) => x.text.toLowerCase().replace(/\s/gu, '') === item.text.toLowerCase().replace(/\s/gu, ''),
      )
    )
      findings.push(
        finding(
          id,
          'missing',
          'minor',
          'Số liệu chưa được tìm thấy trong kết quả, thảo luận hoặc chú thích.',
          [item],
        ),
      );
  const values = [...claims, ...evidence].flatMap(quantities);
  const context = (item: Located) => {
    const before = Array.from(item.paragraph.text).slice(0, item.start).join('');
    return (before.toLowerCase().match(/[\p{L}]+/gu) ?? []).slice(-3).join(' ');
  };
  for (let i = 0; i < values.length; i++)
    for (let j = i + 1; j < values.length; j++) {
      const a = values[i],
        b = values[j];
      if (!a || !b) continue;
      const unitA = a.text.match(/[%‰°\p{L}µμ][\p{L}\p{N}%‰°µμ/·^−-]*/u)?.[0]?.toLowerCase();
      const unitB = b.text.match(/[%‰°\p{L}µμ][\p{L}\p{N}%‰°µμ/·^−-]*/u)?.[0]?.toLowerCase();
      if (unitA && unitA === unitB && context(a) && context(a) === context(b) && a.text !== b.text)
        findings.push(
          finding(id, 'different', 'minor', 'Cùng ngữ cảnh và đơn vị có số liệu khác nhau.', [a, b]),
        );
    }
  return result(
    id,
    'Nhất quán số liệu',
    claims.length > 0 && evidence.length > 0,
    findings,
    'Ngữ cảnh và đơn vị tương đương có thể được diễn đạt khác nhau.',
  );
}
const sentencesIn = (paragraph: Paper['paragraphs'][number]): Located[] =>
  segmentSentences(paragraph.text).map(({ start, end }) => ({
    paragraph,
    start,
    end,
    text: Array.from(paragraph.text).slice(start, end).join(''),
  }));
const statistic = /\b(?:p\s*[<=>]|n\s*=|\d+(?:\.\d+)?\s*%|CI\b)|±/iu;
export function claimStrengthDrift(paper: Paper) {
  const id = 'claim_strength_drift',
    findings: Finding[] = [];
  const claims = paper.paragraphs
    .filter((p) => p.kind === 'body' && ['abstract', 'conclusion'].includes(role(paper, p) ?? ''))
    .flatMap(sentencesIn);
  const evidence = paper.paragraphs
    .filter((p) => p.kind === 'body' && ['results', 'discussion'].includes(role(paper, p) ?? ''))
    .flatMap(sentencesIn);
  const words = (s: string) =>
    new Set(
      (s.toLowerCase().match(/[a-z]{4,}/gu) ?? []).filter(
        (w) =>
          ![
            'this',
            'that',
            'with',
            'from',
            'results',
            'show',
            'suggest',
            'likely',
            'demonstrate',
            'demonstrates',
            'significantly',
          ].includes(w),
      ),
    );
  for (const a of claims) {
    if (
      !/\b(?:demonstrates?|demonstrated|proves?|proved|establish(?:es|ed)?|clearly|definitely|always|significantly)\b/iu.test(
        a.text,
      ) ||
      (/\bsignificantly\b/iu.test(a.text) && statistic.test(a.text))
    )
      continue;
    const aw = words(a.text);
    for (const b of evidence)
      if (
        /\b(?:may|might|suggests?|likely|preliminary)\b/iu.test(b.text) &&
        [...words(b.text)].filter((w) => aw.has(w)).length >= 2
      )
        findings.push(
          finding(id, 'drift', 'minor', 'Mức khẳng định có thể mạnh hơn phần kết quả hoặc thảo luận.', [
            a,
            b,
          ]),
        );
  }
  return result(
    id,
    'Mức độ khẳng định',
    claims.length > 0 && evidence.length > 0,
    findings,
    'Từ chung chủ đề không đảm bảo hai câu nói về cùng một kết luận.',
  );
}
export function unsupportedClaims(paper: Paper) {
  const id = 'unsupported_claims',
    findings: Finding[] = [];
  const paragraphs = paper.paragraphs.filter((p) => p.kind === 'body');
  const sentences = paragraphs.flatMap(sentencesIn);
  const support =
    /\b(?:fig(?:ure)?\.?|table)\s+\d+|\[\d|\b(?:p\s*[<=>]|n\s*=)|±|\bCI\b|\([^)]*\d{4}[a-z]?\)/iu;
  for (let i = 0; i < sentences.length; i++) {
    const s = sentences[i];
    if (!s) continue;
    if (
      /\b(?:ablation|theorem|proof|statistical(?:ly)? significan\w*|state.of.the.art|extensive experiments)\b/iu.test(
        s.text,
      ) &&
      !support.test(s.text + ' ' + (sentences[i + 1]?.text ?? ''))
    )
      findings.push(
        finding(id, 'claim', 'minor', 'Khẳng định chưa có dấu hiệu dẫn chứng ở câu này hoặc câu sau.', [s]),
      );
  }
  for (let i = 0; i < paragraphs.length; i++) {
    const p = paragraphs[i];
    if (!p) continue;
    for (const theorem of matches(p, /\bTheorem\s+\d+\b/giu))
      if (!paragraphs.slice(i + 1).some((next) => /^\s*proof\b/iu.test(next.text)))
        findings.push(
          finding(id, 'theorem', 'minor', 'Không tìm thấy đoạn chứng minh phía sau định lý.', [theorem]),
        );
  }
  for (const section of paper.sections)
    if (/\b(?:answers? to reviewers?|response to reviewers?)\b/iu.test(section.heading)) {
      const sectionParagraphs = paper.paragraphs.filter(
        (item) => item.sectionId === section.id && item.text.trim(),
      );
      const p =
        sectionParagraphs.find(
          (item) => item.kind === 'heading_like' && item.text.includes(section.heading),
        ) ?? sectionParagraphs[0];
      const loc = p ? matches(p, /[\s\S]+/gu)[0] : undefined;
      if (loc)
        findings.push(finding(id, 'reviewers', 'info', 'Mục này có tiêu đề trả lời người phản biện.', [loc]));
    }
  return result(
    id,
    'Khẳng định cần dẫn chứng',
    paragraphs.length > 0 || findings.length > 0,
    findings,
    'Dẫn chứng có thể nằm ở vị trí khác hoặc dùng định dạng khác.',
  );
}
