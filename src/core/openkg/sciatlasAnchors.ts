import type { CorpusKg } from './corpus';
import type { SciAtlasLevel } from './sciatlas';
import type { PaperKg } from './types';

export const ANCHOR_LIMITS = { keywords: 8, references: 10, yearSpan: 5 } as const;

/** The anchors a SciAtlas search sends; the user may remove any of them or change a keyword's level. */
export interface SciAtlasAnchors {
  keywords: { text: string; level: SciAtlasLevel }[];
  titles: { title: string; level: SciAtlasLevel }[];
  references: string[];
  /** Publication years to search, when the paper or corpus has a year. */
  years: { from: number; to: number } | null;
}

const clean = (value: string) => value.replace(/\s+/gu, ' ').trim();
const OPENALEX_WORK = /^W\d+$/u;

function uniqueTitles(values: Iterable<string>, limit: number) {
  const seen = new Set<string>();
  const titles: string[] = [];
  for (const value of values) {
    const title = clean(value);
    const key = title.toLowerCase();
    // A bare OpenAlex id or a whole citation string is not a title SciAtlas can match.
    if (title.length < 8 || title.length > 300 || OPENALEX_WORK.test(title) || seen.has(key)) continue;
    seen.add(key);
    titles.push(title);
    if (titles.length === limit) break;
  }
  return titles;
}

/**
 * Anchors for one paper: its high- and middle-salience OpenAlex keywords (highest score first, at most 8), its
 * title as a high title, up to 10 reference titles and the paper's year ± 5. Reference titles come from
 * `referenceTitles` (GROBID's structured references) and then from SCG references in the graph; the graph's
 * other Work labels are raw citation strings or OpenAlex ids, so they are not sent.
 */
export function paperSciAtlasAnchors(kg: PaperKg, referenceTitles: readonly string[] = []): SciAtlasAnchors {
  const nodes = new Map(kg.nodes.map((node) => [node.id, node]));
  const article = kg.nodes.find((node) => node.type === 'Paper');
  const keywords = kg.nodes
    .filter(
      (node) =>
        node.type === 'Keyword' && (node.attrs.salience === 'high' || node.attrs.salience === 'middle'),
    )
    .sort((a, b) => Number(b.attrs.score ?? 0) - Number(a.attrs.score ?? 0) || a.label.localeCompare(b.label))
    .slice(0, ANCHOR_LIMITS.keywords)
    .map((node) => ({ text: clean(node.label), level: node.attrs.salience as SciAtlasLevel }));
  const scgTitles = kg.edges
    .filter((edge) => edge.p === 'buildsOn' && nodes.get(edge.o)?.type === 'Work')
    .map((edge) => nodes.get(edge.o)?.label ?? '');
  const title = article ? clean(article.label) : '';
  const year = typeof article?.attrs.year === 'number' ? article.attrs.year : null;
  return {
    keywords,
    titles: title ? [{ title, level: 'high' }] : [],
    references: uniqueTitles(
      [...referenceTitles, ...scgTitles].filter(
        (value) => clean(value).toLowerCase() !== title.toLowerCase(),
      ),
      ANCHOR_LIMITS.references,
    ),
    years: year === null ? null : { from: year - ANCHOR_LIMITS.yearSpan, to: year + ANCHOR_LIMITS.yearSpan },
  };
}

/**
 * Anchors for a corpus: its 8 keywords carried by the most member papers, the first half as high and the rest as
 * middle; no titles or references, and the corpus's publication years.
 */
export function corpusSciAtlasAnchors(kg: CorpusKg): SciAtlasAnchors {
  const top = [...kg.trend.keywords]
    .sort((a, b) => b.paperCount - a.paperCount || b.meanScore - a.meanScore || a.name.localeCompare(b.name))
    .slice(0, ANCHOR_LIMITS.keywords);
  const highCount = Math.ceil(top.length / 2);
  const years = kg.trend.years;
  const from = years[0];
  const to = years.at(-1);
  return {
    keywords: top.map((keyword, index) => ({
      text: clean(keyword.name),
      level: index < highCount ? 'high' : 'middle',
    })),
    titles: [],
    references: [],
    years: from !== undefined && to !== undefined ? { from, to } : null,
  };
}
