import { liveQuery } from 'dexie';
import { normalizeDoi } from '@/core/library';
import { buildCorpusKg, type CorpusKgMetadata } from '@/core/openkg';
import { buildPaperModel } from '@/core/paperModel';
import {
  LibraryItemSchema,
  PaperContextRecordSchema,
  PaperInsightsRecordSchema,
  PaperSchema,
} from '@/core/schemas';
import type { Corpus } from '@/core/schemas/corpus';
import { paperDoi } from '@/core/scholarlyContext';
import type { createCorpusKeywordsRepository } from './corpusKeywords';
import type { ParagraphDb } from './db';
import type { createScgRepository } from './scg';

export function createCorpusOpenKgRepository(
  db: ParagraphDb,
  keywordRepo: ReturnType<typeof createCorpusKeywordsRepository>,
  scg: ReturnType<typeof createScgRepository>,
) {
  async function read(corpus: Corpus) {
    const members = corpus.members;
    const paperIds = [...new Set(members.flatMap(({ identifiers }) => identifiers.paperIds))];
    const [rows, contexts, insights, runs, keywordData] = await Promise.all([
      db.papers.bulkGet(paperIds),
      db.paperContext.bulkGet(paperIds),
      db.paperInsights.bulkGet(paperIds),
      scg.listByPapers(paperIds),
      keywordRepo.memberKeywords(corpus),
    ]);
    const byPaper = new Map(runs.map((run) => [run.paperId, run]));
    const local = rows.flatMap((row, i) => {
      if (!row) return [];
      const paper = PaperSchema.parse(row);
      const context = contexts[i] && PaperContextRecordSchema.parse(contexts[i]);
      const insight = insights[i] && PaperInsightsRecordSchema.parse(insights[i]);
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
      db.library.bulkGet(libraryIds),
      db.library.where('doi').anyOf(dois).toArray(),
      db.library.where('paper_id').anyOf(paperIds).toArray(),
    ]);
    const items = [
      ...new Map(
        [...linked, ...byDoiRows, ...attached].flatMap((row) =>
          row ? ([[row.id, LibraryItemSchema.parse(row)]] as const) : [],
        ),
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

  return { observe: (corpus: Corpus) => liveQuery(() => read(corpus)) };
}
