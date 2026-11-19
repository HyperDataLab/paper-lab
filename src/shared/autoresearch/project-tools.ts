import type { ReadTool } from '@/core/autoresearch/agent-loop';
import { currentArtifact } from '@/core/autoresearch/artifacts';
import { stageSchema, type StageContent } from '@/core/autoresearch/contracts';
import type { Run } from '@/core/autoresearch/record';
import { candidateFromWork } from '@/core/extraction';
import { abstractOf } from '@/core/paperModel/buildPaperModel';
import type { BankDoc } from '@/core/researchDesign/bank/snapshot';
import type { ExtractionProject } from '@/core/schemas';
import type { createLabResearchClient } from '@/shared/labResearch';
import type { createScholarClient } from '@/shared/scholar/client';
import type { Repositories } from '@/shared/storage/repositories';
import { collectCandidates } from './collection';
import type { NoveltyPaper } from './engines';

const noFilter = { from: null, to: null };
export function projectTools(deps: {
  project: ExtractionProject;
  repo: Repositories;
  bank: BankDoc | null;
  scholar: ReturnType<typeof createScholarClient>;
  lab: ReturnType<typeof createLabResearchClient> | null;
  getRun: () => Run;
  requireConsent: () => void;
  signal?: AbortSignal;
}) {
  const { scholar, signal, requireConsent } = deps;
  const check = () => {
    signal?.throwIfAborted();
    requireConsent();
  };
  const search = async (query: string, filter: StageContent['S3']['yearFilter']): Promise<NoveltyPaper[]> => {
    check();
    const { results } = await scholar.searchWorks(
      query,
      {
        fromYear: filter.from,
        toYear: filter.to,
        perPage: 5,
      },
      signal,
    );
    return results.flatMap((work) => {
      const candidate = candidateFromWork(work, query);
      return candidate
        ? [
            {
              id: candidate.doi ?? `openalex:${candidate.key}`,
              title: candidate.title,
              abstract: candidate.abstract,
              source: 'openalex' as const,
            },
          ]
        : [];
    });
  };
  return {
    async collect(plan: StageContent['S3']) {
      const { project, repo } = deps;
      const corpus = project.corpusId ? await repo.corpora.get(project.corpusId) : undefined;
      const { candidates } = collectCandidates(project, corpus, plan);
      const paperIds = new Map<string, string[]>();
      for (const member of corpus?.members ?? []) paperIds.set(member.memberId, member.identifiers.paperIds);
      for (const paper of project.papers)
        if (paper.source.kind === 'paper') paperIds.set(paper.key, [paper.source.paperId]);
      for (const candidate of candidates.filter((item) => !item.abstract)) {
        for (const id of new Set(candidate.sources.flatMap((source) => paperIds.get(source.ref) ?? []))) {
          signal?.throwIfAborted();
          const paper = await repo.papers.get(id);
          const abstract = paper && abstractOf(paper);
          if (!abstract) continue;
          candidate.abstract = abstract;
          candidate.sources.push({ kind: 'local_abstract', ref: id });
          break;
        }
      }
      // Existing corpus records can be metadata-only. Only the DOI is used to fill a missing abstract.
      const missing = candidates.filter((paper) => !paper.abstract && paper.doi);
      for (let start = 0; start < missing.length; start += 4) {
        const batch = await Promise.all(
          missing.slice(start, start + 4).map(async (paper) => {
            check();
            if (!paper.doi) return true;
            try {
              const abstract = (await scholar.workAbstract(paper.doi, signal))?.trim();
              if (abstract) {
                paper.abstract = abstract;
                paper.sources.push({ kind: 'openalex_abstract', ref: paper.doi });
              }
              return true;
            } catch {
              check();
              return false;
            }
          }),
        );
        if (batch.includes(false)) break;
      }
      return { candidates };
    },
    async search(query: string, filter: StageContent['S3']['yearFilter']) {
      try {
        return await search(query, filter);
      } catch {
        check();
        return null;
      }
    },
    async read(tool: ReadTool, input: string | null): Promise<unknown> {
      check();
      const run = deps.getRun();
      try {
        switch (tool) {
          case 'list_artifacts':
            return run.artifacts.map(({ stage, attempt, schemaVersion, hash, status, evidence_scope }) => ({
              stage,
              attempt,
              schemaVersion,
              hash,
              status,
              evidence_scope,
            }));
          case 'read_artifact': {
            const match = /^(S[1-8])(?::([1-9][0-9]*))?$/u.exec(input ?? '');
            const stage = stageSchema.safeParse(match?.[1]);
            if (!stage.success) return { error: 'Use a stage ID or stage:attempt from list_artifacts.' };
            const artifact = match?.[2]
              ? run.artifacts.find((a) => a.stage === stage.data && a.attempt === Number(match[2]))
              : currentArtifact(run, stage.data);
            return artifact ?? { error: 'Artifact unavailable.' };
          }
          case 'read_notebook':
            return run.notebook;
          case 'search_lab_kg':
            if (!deps.lab) return { error: 'Lab KG unavailable.' };
            if (!input || input.length > 240) return { error: 'Use a short public search phrase.' };
            return await deps.lab.callTool('search_papers', { query: input, limit: 5 }, signal);
          case 'search_openalex':
            if (!input || input.length > 240) return { error: 'Use a short public search phrase.' };
            return await search(input, noFilter);
          case 'lookup_writing_bank': {
            if (!deps.bank) return { error: 'No Writing Bank snapshot is pinned.' };
            if (!input)
              return { release: deps.bank.release, collections: Object.keys(deps.bank.collections) };
            const query = input.toLowerCase();
            return {
              release: deps.bank.release,
              entries: Object.values(deps.bank.collections)
                .flat()
                .filter(
                  (entry) =>
                    entry.id.toLowerCase() === query ||
                    ('name' in entry &&
                      typeof entry.name === 'string' &&
                      entry.name.toLowerCase().includes(query)),
                )
                .slice(0, 8),
            };
          }
        }
      } catch {
        check();
        return { error: 'The selected read tool is unavailable.' };
      }
    },
  };
}
