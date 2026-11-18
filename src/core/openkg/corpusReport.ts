import type { CorpusKg } from './corpus';
import { keywordSalience } from './openAlex';
import { markdown } from './report';
import type { KgNodeType } from './types';

const quantity = (count: number, unit: string) => `${count} ${unit}${count === 1 ? '' : 's'}`;

export function toSciAtlasCorpusReport(kg: CorpusKg, title?: string): string {
  const nodes = new Map(kg.nodes.map((node) => [node.id, node]));
  const label = (id: string) => markdown(nodes.get(id)?.label ?? id);
  const disciplinePapers = new Map<string, Set<string>>();
  const authors = new Map<string, Set<string>>();
  const institutions = new Map<string, Set<string>>();
  const citations = new Map<string, Set<string>>();
  const builtUpon = new Map<string, { contributions: Set<string>; papers: Set<string> }>();
  const broader = new Map<string, string[]>();
  for (const { s, p, o } of kg.edges) {
    if (p === 'broader') broader.set(s, [...(broader.get(s) ?? []), o]);
  }

  function add(map: Map<string, Set<string>>, id: string, papers: Iterable<string>) {
    const entry = map.get(id) ?? new Set();
    for (const paper of papers) entry.add(paper);
    map.set(id, entry);
  }
  for (const { s, p, o, support } of kg.edges) {
    const papers = support.map(({ paper }) => paper);
    if (p === 'authoredBy') add(authors, o, papers);
    if (p === 'affiliatedWith') add(institutions, o, papers);
    if (p === 'cites') add(citations, o, papers);
    if (p === 'buildsOn' && nodes.get(s)?.type === 'Contribution' && nodes.get(o)?.type === 'Contribution') {
      const entry = builtUpon.get(o) ?? { contributions: new Set(), papers: new Set() };
      entry.contributions.add(s);
      for (const paper of papers) entry.papers.add(paper);
      builtUpon.set(o, entry);
    }
    if (p === 'inTopic') {
      const ancestors = new Set([o]);
      for (const id of ancestors) {
        add(disciplinePapers, id, papers);
        for (const parent of broader.get(id) ?? []) ancestors.add(parent);
      }
    }
  }

  function ranked(map: Map<string, Set<string>>, type?: KgNodeType) {
    return [...map]
      .filter(([id]) => !type || nodes.get(id)?.type === type)
      .sort(
        ([a, first], [b, second]) =>
          second.size - first.size || label(a).localeCompare(label(b)) || a.localeCompare(b),
      )
      .slice(0, 15)
      .map(([id, papers]) => `- ${label(id)} (${quantity(papers.size, 'paper')})`);
  }
  const empty = (items: string[]) => (items.length ? items : ['No entries.']);
  const section = (heading: string, items: string[]) => [`## ${heading}`, '', ...empty(items), ''];
  const group = (heading: string, items: string[]) => [`### ${heading}`, '', ...empty(items), ''];
  const coverage = kg.coverage;
  const trend = kg.trend.keywords;
  return [
    '# OpenKG corpus trend report',
    '',
    ...section('Overview', [
      ...(title ? [markdown(title), ''] : []),
      `- ${quantity(coverage.members, 'paper')}, ${quantity(kg.nodes.length, 'node')}, ${quantity(kg.edges.length, 'relationship')}`,
      `- Coverage: ${coverage.withModel} with a paper model, ${coverage.withLookup} with an OpenAlex lookup, ${coverage.withScg} with an SCG run`,
    ]),
    ...section(
      'Disciplines mix',
      (['Domain', 'Field', 'Subfield', 'Topic'] as const).flatMap((type) =>
        group(type, ranked(disciplinePapers, type)),
      ),
    ),
    ...section(
      'Top keywords by salience and trend',
      ['high', 'middle', 'low'].flatMap((salience) =>
        group(
          salience,
          trend
            .filter(({ meanScore }) => keywordSalience(meanScore) === salience)
            .sort(
              (a, b) => b.meanScore - a.meanScore || b.paperCount - a.paperCount || a.id.localeCompare(b.id),
            )
            .map(({ name, meanScore, paperCount, years }) => {
              const timeline = Object.entries(years)
                .map(([year, count]) => `${year}: ${count}`)
                .join(', ');
              return `- ${markdown(name)} (${quantity(paperCount, 'paper')}, mean score ${meanScore.toFixed(2)}) · ${timeline || 'No publication year recorded'}`;
            }),
        ),
      ),
    ),
    ...section(
      'Most built-upon contributions',
      [...builtUpon]
        .sort(
          ([a, first], [b, second]) =>
            second.contributions.size - first.contributions.size ||
            second.papers.size - first.papers.size ||
            a.localeCompare(b),
        )
        .slice(0, 15)
        .map(
          ([id, { contributions, papers }]) =>
            `- ${label(id)} (${quantity(contributions.size, 'dependent contribution')} across ${quantity(papers.size, 'paper')})`,
        ),
    ),
    ...section('Key authors and institutions', [
      ...group('Authors', ranked(authors)),
      ...group('Institutions', ranked(institutions)),
    ]),
    ...section('Most-cited works inside and outside the corpus', [
      ...group('Inside the corpus', ranked(citations, 'Paper')),
      ...group('Outside the corpus', ranked(citations, 'Work')),
    ]),
  ].join('\n');
}
