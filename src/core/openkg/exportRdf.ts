import { KG_BASE, type KgNodeType, type KgPredicate, type KgValue, type PaperKg } from './types';

const PREFIXES = {
  schema: 'https://schema.org/',
  pl: `${KG_BASE}vocab/`,
  rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
  xsd: 'http://www.w3.org/2001/XMLSchema#',
};
const NODE_TERMS: Record<KgNodeType, string> = {
  Paper: 'schema:ScholarlyArticle',
  Work: 'schema:ScholarlyArticle',
  Source: 'schema:CreativeWork',
  Keyword: 'schema:DefinedTerm',
  Domain: 'schema:DefinedTerm',
  Field: 'schema:DefinedTerm',
  Subfield: 'schema:DefinedTerm',
  Topic: 'schema:DefinedTerm',
  Author: 'schema:Person',
  Institution: 'schema:Organization',
  Contribution: 'pl:Contribution',
  Prerequisite: 'pl:Prerequisite',
  Tool: 'pl:Tool',
  Claim: 'pl:Claim',
  Evidence: 'pl:Evidence',
  EvidenceLevel: 'schema:DefinedTerm',
};
const EDGE_TERMS: Record<KgPredicate, string> = {
  cites: 'schema:citation',
  publishedIn: 'schema:isPartOf',
  hasKeyword: 'schema:keywords',
  contributes: 'pl:contributes',
  buildsOn: 'pl:buildsOn',
  relatedKeyword: 'pl:relatedKeyword',
  inTopic: 'schema:about',
  broader: 'pl:broader',
  authoredBy: 'schema:author',
  affiliatedWith: 'schema:affiliation',
  hasClaim: 'pl:hasClaim',
  supportedBy: 'pl:supportedBy',
  evidenceLevel: 'pl:evidenceLevel',
};

type RdfValue = KgValue | { '@id': string };
interface RdfEntity {
  id: string;
  type: string;
  properties: Map<string, RdfValue[]>;
}

const ref = (id: string): RdfValue => ({ '@id': id });

function entities(kg: PaperKg): RdfEntity[] {
  const nodes = new Map(
    kg.nodes.map(({ id, type, label, layer, attrs }): [string, RdfEntity] => [
      id,
      {
        id,
        type: NODE_TERMS[type],
        properties: new Map([
          ['schema:name', [label]],
          ['pl:layer', [layer]],
          ...Object.entries(attrs).map(([key, value]): [string, RdfValue[]] => [
            key === 'description' ? 'schema:description' : `pl:${key}`,
            [value],
          ]),
        ]),
      },
    ]),
  );
  const relationships = new Set<string>();
  const statements = kg.edges.map((edge, index): RdfEntity => {
    const predicate = EDGE_TERMS[edge.p];
    const properties = nodes.get(edge.s)?.properties;
    const key = JSON.stringify([edge.s, predicate, edge.o]);
    if (properties && !relationships.has(key)) {
      relationships.add(key);
      const targets = properties.get(predicate);
      if (targets) targets.push(ref(edge.o));
      else properties.set(predicate, [ref(edge.o)]);
    }
    return {
      id: `_:statement${index + 1}`,
      type: 'rdf:Statement',
      properties: new Map([
        ['rdf:subject', [ref(edge.s)]],
        ['rdf:predicate', [ref(predicate)]],
        ['rdf:object', [ref(edge.o)]],
        ['pl:layer', [edge.layer]],
        ['pl:provenance', [edge.provenance]],
        ...(edge.evidence?.length ? [['pl:evidenceSentence', edge.evidence] as const] : []),
      ]),
    };
  });
  return [...nodes.values(), ...statements];
}

function turtleId(id: string) {
  return id.startsWith('https://') ? `<${id}>` : id;
}

function turtleValue(value: RdfValue) {
  if (typeof value === 'object') return turtleId(value['@id']);
  if (typeof value === 'string') return JSON.stringify(value.replace(/[\uD800-\uDFFF]/gu, '\uFFFD'));
  if (typeof value === 'number' && !Number.isInteger(value)) return `"${value}"^^xsd:double`;
  return String(value);
}

export function toTurtle(kg: PaperKg): string {
  const prefixes = Object.entries(PREFIXES).map(([prefix, iri]) => `@prefix ${prefix}: <${iri}> .`);
  const triples = entities(kg).flatMap(({ id, type, properties }) => [
    `${turtleId(id)} a ${type} .`,
    ...Array.from(properties, ([key, values]) =>
      values.map((value) => `${turtleId(id)} ${key} ${turtleValue(value)} .`),
    ).flat(),
  ]);
  return `${prefixes.join('\n')}\n\n${triples.join('\n')}\n`;
}

export function toJsonLd(kg: PaperKg): string {
  const graph = entities(kg).map(({ id, type, properties }) => ({
    '@id': id,
    '@type': type,
    ...Object.fromEntries(properties),
  }));
  return `${JSON.stringify({ '@context': PREFIXES, '@graph': graph }, null, 2)}\n`;
}
