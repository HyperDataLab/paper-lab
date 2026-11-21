import type { LibraryItem, PaperKeyword } from '../schemas';
import type { KgBuilder } from './build';
import { kgIri, type KgLayer, type KgNodeType, type KgPredicate } from './types';

/** OpenAlex relevance cutoffs used by PaperLab to group keywords in SciAtlas style. */
export const KEYWORD_SALIENCE = { high: 0.6, middle: 0.4 } as const;

export const keywordSalience = (score: number) =>
  score >= KEYWORD_SALIENCE.high ? 'high' : score >= KEYWORD_SALIENCE.middle ? 'middle' : 'low';

export function addKeywords(graph: KgBuilder, article: string, keywords: PaperKeyword[]) {
  for (const { id, name, score } of keywords) {
    const keyword = graph.node({
      id: kgIri('keyword', id.slice('keywords/'.length)),
      type: 'Keyword',
      label: name,
      layer: 'conceptual',
      attrs: { score, salience: keywordSalience(score) },
    });
    graph.edge({ s: article, p: 'hasKeyword', o: keyword, layer: 'conceptual', provenance: 'openalex' });
  }
}

export function addOpenAlex(graph: KgBuilder, article: string, library: LibraryItem) {
  const link = (layer: KgLayer, s: string, p: KgPredicate, o: string) =>
    graph.edge({ s, p, o, layer, provenance: 'openalex' });

  for (const work of library.referenced_works ?? []) {
    const cited = graph.node({
      id: kgIri('work', work),
      type: 'Work',
      label: work,
      layer: 'evidential',
      attrs: { openalexId: work },
    });
    link('evidential', article, 'cites', cited);
  }
  if (library.openalex_source_id || (library.openalex_id && library.venue)) {
    const venue = library.openalex_source_id;
    const source = graph.node({
      id: venue ? kgIri('source', venue) : kgIri('source', 'name', library.venue ?? ''),
      type: 'Source',
      label: library.venue ?? venue ?? '',
      layer: 'evidential',
      attrs: venue ? { openalexId: venue } : {},
    });
    link('evidential', article, 'publishedIn', source);
  }
  addKeywords(graph, article, library.keywords ?? []);

  const taxonomy = library.taxonomy;
  if (taxonomy) {
    const levels = [
      ['Domain', taxonomy.domainId, taxonomy.domain],
      ['Field', taxonomy.fieldId, taxonomy.field],
      ['Subfield', taxonomy.subfieldId, taxonomy.subfield],
      ['Topic', taxonomy.topicId, taxonomy.topic],
    ] as const satisfies readonly [KgNodeType, string | null | undefined, string | null][];
    let parent: string | undefined;
    for (const [type, id, label] of levels) {
      if (!id) continue;
      const discipline = graph.node({
        id: kgIri('discipline', ...id.split('/')),
        type,
        label: label ?? id,
        layer: 'disciplinary',
        attrs: { openalexId: id },
      });
      if (parent) link('disciplinary', discipline, 'broader', parent);
      parent = discipline;
    }
    if (parent) link('disciplinary', article, 'inTopic', parent);
  }

  for (const authorship of library.authorships ?? []) {
    const identity = authorship.orcid ?? authorship.id;
    if (!identity) continue;
    const author = graph.node({
      id: kgIri('author', identity),
      type: 'Author',
      label: authorship.name ?? identity,
      layer: 'expertise',
      attrs: {
        ...(authorship.orcid ? { orcid: authorship.orcid } : {}),
        ...(authorship.id ? { openalexId: authorship.id } : {}),
      },
    });
    link('expertise', article, 'authoredBy', author);
    for (const { ror, name, country } of authorship.institutions) {
      if (!ror) continue;
      const institution = graph.node({
        id: kgIri('institution', ror),
        type: 'Institution',
        label: name ?? ror,
        layer: 'expertise',
        attrs: { ror, ...(country ? { country } : {}) },
      });
      link('expertise', author, 'affiliatedWith', institution);
    }
  }
}
