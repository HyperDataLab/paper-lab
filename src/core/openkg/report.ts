import type { KgPredicate, PaperKg } from './types';

export function markdown(text: string) {
  return text
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(/[\\`*_{}[\]()<>#+.!|~&-]/gu, '\\$&');
}

export function toSciAtlasReport(kg: PaperKg): string {
  const byId = new Map(kg.nodes.map((node) => [node.id, node]));
  const label = (id: string) => markdown(byId.get(id)?.label ?? id);
  const withPredicate = (predicate: KgPredicate) => kg.edges.filter((edge) => edge.p === predicate);
  const section = (heading: string, items: string[]) => [
    `## ${heading}`,
    '',
    ...(items.length ? items : ['No entries.']),
    '',
  ];
  const list = (lines: string[]) => lines.map((line) => `- ${line}`);
  const paper = kg.nodes.find((node) => node.type === 'Paper');
  const disciplines = kg.nodes.filter((node) => node.layer === 'disciplinary');
  const keywords = kg.nodes.filter((node) => node.type === 'Keyword');
  const dependencies = withPredicate('buildsOn');
  const affiliation = withPredicate('affiliatedWith');
  const levels = withPredicate('evidenceLevel');
  return [
    '# OpenKG paper report',
    '',
    ...section('Overview', [
      ...(paper ? [markdown(paper.label), ''] : []),
      ...list([
        `${kg.nodes.length} nodes, ${kg.edges.length} relationships`,
        ...(paper?.attrs.doi ? [`DOI ${markdown(String(paper.attrs.doi))}`] : []),
        ...withPredicate('publishedIn').map((edge) => `Published in ${label(edge.o)}`),
      ]),
    ]),
    ...section('Disciplines', list(disciplines.map((node) => `${node.type} — ${label(node.id)}`))),
    ...section(
      'Keywords by salience',
      ['high', 'middle', 'low'].flatMap((salience) => {
        const group = keywords.filter((node) => node.attrs.salience === salience);
        return group.length ? [`### ${salience}`, '', ...list(group.map((node) => label(node.id))), ''] : [];
      }),
    ),
    ...section('Contributions and what they build on', [
      ...list(withPredicate('contributes').map((edge) => `${label(edge.o)} (${edge.provenance})`)),
      ...list(dependencies.map((edge) => `${label(edge.s)} → ${label(edge.o)} (${edge.provenance})`)),
    ]),
    ...section(
      'Authors and institutions',
      list(
        withPredicate('authoredBy').map((edge) => {
          const institutions = affiliation.filter((link) => link.s === edge.o).map((link) => label(link.o));
          return [label(edge.o), ...institutions].join(' — ');
        }),
      ),
    ),
    ...section('References', list([...new Set(withPredicate('cites').map((edge) => edge.o))].map(label))),
    ...section(
      'Evidence levels',
      list(
        levels.map((edge) => {
          const basis = byId.get(edge.s)?.attrs.evidenceBasis;
          return `${label(edge.s)} — ${label(edge.o)} (${edge.provenance})${basis ? ` · ${markdown(String(basis))}` : ''}`;
        }),
      ),
    ),
  ].join('\n');
}
