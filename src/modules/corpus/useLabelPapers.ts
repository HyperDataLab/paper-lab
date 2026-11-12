import { useEffect, useState } from 'react';
import type { Corpus } from '@/core/schemas/corpus';
import { useRepositories } from '@/shared/storage/StorageProvider';
import type { LabelPaper } from './labelPlan';
import { labelMembers, loadLabelPaper } from './labelRun';

/**
 * The papers and runs behind the members with a built model. Reloaded when that set changes or a labelling
 * checkpoint lands, not on every corpus save (a review decision changes nothing here).
 */
export function useLabelPapers(corpus: Corpus) {
  const repo = useRepositories();
  const [items, setItems] = useState<LabelPaper[]>();
  const members = labelMembers(corpus);
  const queue = corpus.labelQueue;
  const key = JSON.stringify([
    members.map((m) => [m.memberId, m.inputs]),
    queue?.pending.length,
    queue?.status,
    corpus.runs.length,
  ]);
  useEffect(() => {
    let active = true;
    void Promise.all(labelMembers(corpus).map((m) => loadLabelPaper(m, repo))).then((loaded) => {
      if (active) setItems(loaded.filter((item): item is LabelPaper => item !== null));
    });
    return () => {
      active = false;
    };
    // `key` stands for the parts of the corpus this depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, repo]);
  return items;
}
