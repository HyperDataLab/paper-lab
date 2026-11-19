import { expect, it } from 'vitest';
import { kgIri, toJsonLd, toSciAtlasReport, toTurtle, type PaperKg } from './index';

const article = 'https://hyperdatalab-paragraph-lab.web.app/kg/paper/p1';
const keyword = 'https://hyperdatalab-paragraph-lab.web.app/kg/keyword/test';
const work = 'https://hyperdatalab-paragraph-lab.web.app/kg/work/10.1000%2Fx%3C%3E';
const label = 'A "quoted" café \\ with\tbytes\r\nand 🧪 <script>';
const sentence = 'a123456789abcdef#1';
const kg: PaperKg = {
  nodes: [
    { id: article, type: 'Paper', label, layer: 'evidential', attrs: {} },
    {
      id: keyword,
      type: 'Keyword',
      label: 'Stress & focus',
      layer: 'conceptual',
      attrs: { salience: 'high', score: 0.6 },
    },
    { id: work, type: 'Work', label: 'A test source', layer: 'evidential', attrs: { year: 2025 } },
  ],
  edges: [
    { s: article, p: 'hasKeyword', o: keyword, layer: 'conceptual', provenance: 'openalex' },
    { s: article, p: 'cites', o: work, layer: 'evidential', provenance: 'paper_text', evidence: [sentence] },
    { s: article, p: 'cites', o: work, layer: 'evidential', provenance: 'openalex' },
  ],
};

it('writes stable IRIs, Turtle prefixes, statement terminators and escaped literals', () => {
  const turtle = toTurtle(kg);
  expect(kgIri('paper', 'p1')).toBe(article);
  expect(kgIri('work', '10.1000/x<>')).toBe(work);
  expect(turtle).toMatch(/^@prefix schema: <https:\/\/schema.org\/> \./u);
  expect(turtle).toContain('@prefix pl: <https://hyperdatalab-paragraph-lab.web.app/kg/vocab/> .');
  expect(turtle).toContain(`<${article}> a schema:ScholarlyArticle .`);
  expect(turtle).toContain(`<${article}> schema:name ${JSON.stringify(label)} .`);
  expect(turtle.match(/schema:citation </gu)).toHaveLength(1);
  expect(turtle).toContain(`_:statement2 rdf:object <${work}> .`);
  expect(turtle).toContain(`_:statement2 pl:evidenceSentence "${sentence}" .`);
  expect(turtle).toContain('"0.6"^^xsd:double .');
  expect(
    turtle
      .split('\n')
      .filter(Boolean)
      .every((line) => line.endsWith(' .')),
  ).toBe(true);
});

it('round-trips JSON-LD while preserving provenance for both sources of one triple', () => {
  const json: unknown = JSON.parse(toJsonLd(kg));
  expect(json).toMatchObject({
    '@context': { schema: 'https://schema.org/' },
    '@graph': [
      {
        '@id': article,
        '@type': 'schema:ScholarlyArticle',
        'schema:name': [label],
        'schema:citation': [{ '@id': work }],
      },
      { '@id': keyword, '@type': 'schema:DefinedTerm', 'pl:salience': ['high'], 'pl:score': [0.6] },
      { '@id': work, 'pl:year': [2025] },
      { '@type': 'rdf:Statement', 'rdf:predicate': [{ '@id': 'schema:keywords' }] },
      { '@type': 'rdf:Statement', 'pl:provenance': ['paper_text'], 'pl:evidenceSentence': [sentence] },
      { '@type': 'rdf:Statement', 'pl:provenance': ['openalex'] },
    ],
  });
  expect(JSON.parse(JSON.stringify(json))).toEqual(json);
});

it('writes the requested report sections, salience and safe Markdown text', () => {
  const report = toSciAtlasReport(kg);
  expect(report.match(/^## .+$/gmu)).toEqual([
    '## Overview',
    '## Disciplines',
    '## Keywords by salience',
    '## Contributions and what they build on',
    '## Authors and institutions',
    '## References',
    '## Evidence levels',
  ]);
  expect(report).toContain('### high\n\n- Stress \\& focus');
  expect(report).toContain('\\<script\\>');
  expect(report.match(/- A test source/gu)).toHaveLength(1);
});
