import { normalizeDoi } from '../library/doi';
import type { Corpus } from '../schemas';
import { intakeRecords } from './intake';

export type ImportedRecord = {
  title: string | null;
  authors: string[];
  year: number | null;
  doi: string | null;
  journal: string | null;
};
export type ParsedSearchFile = {
  format: 'ris' | 'csv';
  records: ImportedRecord[];
  /** Records with neither a title nor a DOI; they cannot be matched or screened. */
  skipped: number;
};

const yearOf = (value: string | undefined) => {
  const match = value?.match(/\b(1[5-9]\d\d|20\d\d)\b/u);
  return match?.[1] ? Number(match[1]) : null;
};
const doiOf = (value: string | undefined) => (value ? normalizeDoi(value) : null);
const textOf = (value: string | undefined) => {
  const text = value?.trim();
  return text ? text : null;
};
const usable = (record: ImportedRecord) => Boolean(record.title || record.doi);
const withoutBom = (text: string) => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);

/** RIS as Scopus, Web of Science and PubMed export it: `TY  - JOUR` … `ER  -`, one tag per line. */
export function parseRis(text: string): ParsedSearchFile {
  const records: ImportedRecord[] = [];
  let skipped = 0;
  let tags: Record<string, string[]> | null = null;
  let last: string | null = null;
  const finish = () => {
    if (!tags) return;
    const first = (...keys: string[]) => keys.map((key) => tags?.[key]?.[0]).find(Boolean);
    const record = {
      title: textOf(first('TI', 'T1')),
      authors: [...(tags.AU ?? []), ...(tags.A1 ?? [])].map((name) => name.trim()).filter(Boolean),
      year: yearOf(first('PY', 'Y1')),
      doi: doiOf(first('DO')),
      journal: textOf(first('JO', 'T2', 'JF')),
    };
    if (usable(record)) records.push(record);
    else skipped++;
    tags = null;
    last = null;
  };
  for (const line of withoutBom(text).split(/\r\n|\r|\n/u)) {
    const match = line.match(/^([A-Z][A-Z0-9]) {2}-(?: (.*))?$/u);
    if (!match?.[1]) {
      // A wrapped value continues the previous tag.
      if (tags && last && line.trim()) {
        const values = tags[last];
        if (values?.length) values[values.length - 1] = `${values[values.length - 1] ?? ''} ${line.trim()}`;
      }
      continue;
    }
    const tag = match[1];
    const value = match[2] ?? '';
    if (tag === 'TY') {
      finish();
      tags = {};
      continue;
    }
    if (tag === 'ER') {
      finish();
      continue;
    }
    if (!tags) continue;
    (tags[tag] ??= []).push(value);
    last = tag;
  }
  finish();
  return { format: 'ris', records, skipped };
}

/** RFC 4180 rows: quoted fields may hold commas, newlines and doubled quotes. */
export function csvRows(text: string, strict = false): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let closed = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
        closed = true;
      } else field += char;
    } else if (char === '"') {
      if (strict && (field || closed)) throw new Error('Unexpected CSV quote');
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
      closed = false;
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      closed = false;
    } else {
      if (strict && closed) throw new Error('Unexpected text after CSV quote');
      field += char;
    }
  }
  if (strict && quoted) throw new Error('Unclosed CSV quote');
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((cell) => cell.trim()));
}

const HEADERS: Record<'title' | 'year' | 'doi' | 'authors' | 'journal', string[]> = {
  title: ['title', 'article title', 'document title', 'ti'],
  year: ['year', 'publication year', 'pubyear', 'py', 'publication date', 'create date'],
  doi: ['doi', 'di'],
  authors: ['authors', 'author', 'author full names', 'au'],
  journal: ['source title', 'journal', 'journal/book', 'source', 'publication title', 'so'],
};
const headerKey = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/gu, ' ');

/** CSV with a header row; column names are matched without case and with the common export variants. */
export function parseCsv(text: string): ParsedSearchFile {
  const [header, ...rows] = csvRows(withoutBom(text));
  if (!header) return { format: 'csv', records: [], skipped: 0 };
  const keys = header.map(headerKey);
  const column = (name: keyof typeof HEADERS) => keys.findIndex((key) => HEADERS[name].includes(key));
  const at = {
    title: column('title'),
    year: column('year'),
    doi: column('doi'),
    authors: column('authors'),
    journal: column('journal'),
  };
  const cell = (row: string[], index: number) => (index < 0 ? undefined : row[index]);
  const records: ImportedRecord[] = [];
  let skipped = 0;
  for (const row of rows) {
    const record = {
      title: textOf(cell(row, at.title)),
      authors: (cell(row, at.authors) ?? '')
        .split(';')
        .map((name) => name.trim())
        .filter(Boolean),
      year: yearOf(cell(row, at.year)),
      doi: doiOf(cell(row, at.doi)),
      journal: textOf(cell(row, at.journal)),
    };
    if (usable(record)) records.push(record);
    else skipped++;
  }
  return { format: 'csv', records, skipped };
}

/** Chooses the parser from the file name, then from the content (`TY  -` starts a RIS record). */
export function parseSearchFile(fileName: string, text: string): ParsedSearchFile {
  const name = fileName.toLowerCase();
  if (name.endsWith('.ris')) return parseRis(text);
  if (name.endsWith('.csv')) return parseCsv(text);
  return /^TY {2}-/mu.test(withoutBom(text)) ? parseRis(text) : parseCsv(text);
}

/** Records an imported database export as a search entry; its records go through intake like any search. */
export function recordImport(corpus: Corpus, fileName: string, parsed: ParsedSearchFile, at: string) {
  const intake = intakeRecords(
    corpus,
    parsed.records.map((record) => ({ title: record.title, year: record.year, doi: record.doi })),
    at,
  );
  return {
    corpus: {
      ...intake.corpus,
      updatedAt: at,
      searches: [
        ...intake.corpus.searches,
        {
          fileName,
          format: parsed.format,
          records: parsed.records.length,
          added: intake.added,
          duplicates: intake.duplicates,
          runAt: at,
        },
      ],
    },
    added: intake.added,
    duplicates: intake.duplicates,
    pending: intake.pending,
    skipped: parsed.skipped,
  };
}
