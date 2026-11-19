import { normalizeDoi } from '../library/doi';
import type { ScgPaperRun, ScgReview } from '../schemas';
import type { KgBuilder } from './build';
import { kgIri, type KgPredicate } from './types';

export function addScg(
  graph: KgBuilder,
  paper: string,
  run: ScgPaperRun,
  references: ReadonlyMap<string, string>,
  sentenceKeys: ReadonlySet<string>,
) {
  function link(s: string, p: KgPredicate, o: string, review: ScgReview, keys: string[]) {
    graph.edge({
      s,
      p,
      o,
      layer: 'conceptual',
      provenance: review === 'accepted' ? 'accepted' : 'llm_candidate',
      evidence: keys.filter((key) => sentenceKeys.has(key)),
    });
  }
  const active = run.contributions.filter((contribution) => contribution.review !== 'rejected');
  const localIds = new Set(run.contributions.map(({ id }) => id));
  const contributions = new Map(
    active.map((item) => [
      item.id,
      graph.node({
        id: kgIri('contribution', item.id),
        type: 'Contribution',
        label: item.name,
        layer: 'conceptual',
        attrs: { description: item.description, review: item.review },
      }),
    ]),
  );
  for (const item of active) {
    const contribution = kgIri('contribution', item.id);
    link(paper, 'contributes', contribution, item.review, item.sourceSentenceKeys);
    for (const prerequisite of item.prerequisites) {
      if (prerequisite.review === 'rejected') continue;
      const { review, sourceSentenceKeys: keys } = prerequisite;
      const dependency = graph.node({
        id: kgIri('prerequisite', prerequisite.id),
        type: 'Prerequisite',
        label: prerequisite.name,
        layer: 'conceptual',
        attrs: { description: prerequisite.description, review },
      });
      link(contribution, 'buildsOn', dependency, review, keys);
      for (const [index, ref] of prerequisite.references.entries()) {
        if (ref.kind === 'contribution') {
          const id = contributions.get(ref.contributionId);
          if (id) link(dependency, 'buildsOn', id, review, keys);
        } else if (ref.kind === 'tool') {
          const tool = graph.node({
            id: kgIri('tool', ref.url),
            type: 'Tool',
            label: ref.url,
            layer: 'conceptual',
          });
          link(dependency, 'buildsOn', tool, review, keys);
        } else {
          const existing = ref.refId ? references.get(ref.refId) : undefined;
          const doi = normalizeDoi(ref.doi ?? '');
          const work =
            existing ??
            graph.node({
              id: doi
                ? kgIri('work', doi)
                : ref.s2CorpusId
                  ? kgIri('work', 's2', ref.s2CorpusId)
                  : kgIri('work', run.paperId, 'scg', prerequisite.id, String(index)),
              type: 'Work',
              label: ref.title,
              layer: 'evidential',
              attrs: { ...(doi ? { doi } : {}), ...(ref.year !== null ? { year: ref.year } : {}) },
            });
          link(dependency, 'buildsOn', work, review, keys);
        }
      }
      for (const match of prerequisite.matches) {
        if (match.review === 'rejected') continue;
        const known = contributions.get(match.contributionId);
        if (!known && localIds.has(match.contributionId)) continue;
        const target =
          known ??
          graph.node({
            id: kgIri('contribution', match.contributionId),
            type: 'Contribution',
            label: match.contributionId,
            layer: 'conceptual',
          });
        link(dependency, 'buildsOn', target, match.review, keys);
      }
    }
  }
}
