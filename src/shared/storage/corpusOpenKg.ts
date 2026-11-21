import { normalizeDoi } from '@/core/library';
import { buildCorpusKg, type CorpusKg, type CorpusKgMetadata } from '@/core/openkg';
import { buildPaperModel } from '@/core/paperModel';
import {
  LibraryItemSchema,
  PaperContextRecordSchema,
  PaperInsightsRecordSchema,
  PaperSchema,
} from '@/core/schemas';
import type { Corpus } from '@/core/schemas/corpus';
import { paperDoi } from '@/core/scholarlyContext';
import type { SubscribeChanges } from './changeEvents';
import type { createCorpusKeywordsRepository } from './corpusKeywords';
import type { DocReader } from './docStore';
import { libraryByDois, libraryByPapers } from './library';
import type { createScgRepository } from './scg';

/** Collections the corpus graph reads; a write to any of them rebuilds it. */
const SOURCES: ReadonlySet<string> = new Set([
  'papers',
  'paperContext',
  'paperInsights',
  'scgRuns',
  'library',
  'doiKeywords',
]);

export interface GraphObserver {
  next?: (graph: CorpusKg) => void;
  error?: (cause: unknown) => void;
}

export function createCorpusOpenKgRepository(
  store: DocReader,
  changes: SubscribeChanges,
  keywordRepo: ReturnType<typeof createCorpusKeywordsRepository>,
  scg: ReturnType<typeof createScgRepository>,
) {
  async function read(corpus: Corpus) {
    const members = corpus.members;
    const paperIds = [...new Set(members.flatMap(({ identifiers }) => identifiers.paperIds))];
    const [rows, contexts, insights, runs, keywordData] = await Promise.all([
      store.getMany('papers', paperIds),
      store.getMany('paperContext', paperIds),
      store.getMany('paperInsights', paperIds),
      scg.listByPapers(paperIds),
      keywordRepo.memberKeywords(corpus),
    ]);
    const byPaper = new Map(runs.map((run) => [run.paperId, run]));
    const local = rows.flatMap((row, i) => {
      if (!row) return [];
      const paper = PaperSchema.parse(row.doc);
      const contextRow = contexts[i];
      const insightRow = insights[i];
      const context = contextRow ? PaperContextRecordSchema.parse(contextRow.doc) : undefined;
      const insight = insightRow ? PaperInsightsRecordSchema.parse(insightRow.doc) : undefined;
      return [
        {
          paper,
          metadata: context?.metadata ?? null,
          doi: normalizeDoi(context?.metadata?.doi ?? context?.paperDoi ?? paperDoi(paper) ?? ''),
          scgRun: byPaper.get(paper.id),
          argumentRun: insight?.argumentRuns.at(-1),
        },
      ];
    });
    const memberDois = (member: Corpus['members'][number]) =>
      [member.identifiers.doi, ...(member.identifiers.doiAliases ?? [])].flatMap((raw) => {
        const doi = normalizeDoi(raw ?? '');
        return doi ? [doi] : [];
      });
    const libraryIds = [...new Set(members.flatMap(({ identifiers }) => identifiers.libraryIds))];
    const dois = [...new Set([...members.flatMap(memberDois), ...local.flatMap(({ doi }) => doi ?? [])])];
    const [linked, byDoiRows, attached] = await Promise.all([
      store.getMany('library', libraryIds),
      libraryByDois(store, dois),
      libraryByPapers(store, paperIds),
    ]);
    const items = [
      ...new Map(
        [
          ...linked.flatMap((row) => (row ? [LibraryItemSchema.parse(row.doc)] : [])),
          ...byDoiRows,
          ...attached,
        ].map((item) => [item.id, item] as const),
      ).values(),
    ];
    const byId = new Map(items.map((item) => [item.id, item]));
    const byDoi = new Map(items.map((item) => [item.doi, item]));
    const byAttached = new Map(items.filter((item) => item.paper_id).map((item) => [item.paper_id, item]));
    const keywords = new Map(keywordData.papers.map((entry) => [entry.memberId, entry.keywords]));
    const memberMetadata = new Map<string, CorpusKgMetadata>();
    for (const member of members) {
      const library =
        member.identifiers.libraryIds.map((id) => byId.get(id)).find(Boolean) ??
        memberDois(member)
          .map((doi) => byDoi.get(doi))
          .find(Boolean);
      memberMetadata.set(member.memberId, { library, keywords: keywords.get(member.memberId) });
    }
    const papers = local.map(({ paper, metadata, doi, scgRun, argumentRun }) => ({
      paper,
      model: buildPaperModel({ paper, metadata, now: new Date(paper.updatedAt) }),
      library: byAttached.get(paper.id) ?? (doi ? byDoi.get(doi) : undefined),
      scgRun,
      argumentRun,
    }));
    return buildCorpusKg({ papers, members, memberMetadata });
  }

  /**
   * Builds the graph now and again after writes to a collection it reads. One build runs at a time; writes during
   * it (a keyword backfill writes once per member) cause a single rebuild after it.
   */
  function observe(corpus: Corpus) {
    return {
      subscribe(observer: GraphObserver) {
        let closed = false;
        let running = false;
        let again = false;
        const refresh = () => {
          if (running) {
            again = true;
            return;
          }
          running = true;
          void read(corpus)
            .then(
              (graph) => {
                if (!closed && !again) observer.next?.(graph);
              },
              (cause: unknown) => {
                if (!closed && !again) observer.error?.(cause);
              },
            )
            .finally(() => {
              running = false;
              if (again && !closed) {
                again = false;
                refresh();
              }
            });
        };
        const off = changes((collections) => {
          if ([...collections].some((collection) => SOURCES.has(collection))) refresh();
        });
        refresh();
        return {
          unsubscribe() {
            closed = true;
            off();
          },
        };
      },
    };
  }

  return { read, observe };
}
