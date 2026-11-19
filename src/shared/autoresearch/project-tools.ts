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
import { loadProjectFullTexts } from './card-sources';
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
  getLabToken?: () => Promise<string | null>;
  now?: () => string;
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
    collect(plan: StageContent['S3']) {
      const { project, repo } = deps;
      return collectCandidates(plan, {
        project,
        corpus: async () => (project.corpusId ? repo.corpora.get(project.corpusId) : undefined),
        localAbstract: async (ids) => {
          for (const paperId of ids) {
            signal?.throwIfAborted();
            const paper = await repo.papers.get(paperId);
            const text = paper && abstractOf(paper);
            if (text) return { paperId, text };
          }
          return null;
        },
        scholar,
        getLabToken: deps.getLabToken,
        check,
        now: deps.now ?? (() => new Date().toISOString()),
        signal,
      });
    },
    loadFullTexts(dois: string[]) {
      check();
      return loadProjectFullTexts(deps.repo, deps.project, dois, signal);
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
            const [id, attempt, extra] = input?.split(':') ?? [];
            const stage = stageSchema.safeParse(id);
            if (
              !stage.success ||
              extra !== undefined ||
              (attempt !== undefined && !/^[1-9][0-9]*$/u.test(attempt))
            )
              return { error: 'Use a stage ID or stage:attempt from list_artifacts.' };
            const artifact = attempt
              ? run.artifacts.find((a) => a.stage === stage.data && a.attempt === Number(attempt))
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
