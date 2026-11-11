import type { PaperMetadata } from '../schemas/paperContext';

export type CitationMetadata = Pick<
  PaperMetadata,
  'title' | 'authors' | 'year' | 'venue' | 'doi' | 'volume' | 'issue' | 'pages'
>;

export function paperRis(meta: CitationMetadata): string {
  const line = (tag: string, value: string) => `${tag}  - ${value.replace(/\s+/gu, ' ').trim()}`;
  return [
    line('TY', 'JOUR'),
    ...(meta.title ? [line('TI', meta.title)] : []),
    ...meta.authors.map((author) => line('AU', author)),
    ...(meta.year ? [line('PY', String(meta.year))] : []),
    ...(meta.venue ? [line('JO', meta.venue)] : []),
    ...(meta.doi ? [line('DO', meta.doi), line('UR', `https://doi.org/${meta.doi}`)] : []),
    ...(meta.volume ? [line('VL', meta.volume)] : []),
    ...(meta.issue ? [line('IS', meta.issue)] : []),
    ...(meta.pages ? [line('SP', meta.pages)] : []),
    'ER  - ',
    '',
  ].join('\r\n');
}

export function paperBibtex(meta: CitationMetadata): string {
  const escape = (value: string) =>
    value
      .replace(/\\/gu, '\\textbackslash{}')
      .replace(/([{}%&#_$])/gu, '\\$1')
      .replace(/\s+/gu, ' ')
      .trim();
  const fields: [string, string | null][] = [
    ['title', meta.title],
    ['author', meta.authors.join(' and ') || null],
    ['year', meta.year?.toString() ?? null],
    ['journal', meta.venue],
    ['doi', meta.doi],
    ['volume', meta.volume],
    ['number', meta.issue],
    ['pages', meta.pages],
  ];
  return `@article{paper,\n${fields
    .filter(([, value]) => value)
    .map(([key, value]) => `  ${key} = {${escape(value ?? '')}}`)
    .join(',\n')}\n}\n`;
}
