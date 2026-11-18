import { fnv1a64 } from '@/core/paperModel/sentenceKey';
import {
  buildScgAlignmentPrompt,
  buildScgContributionPrompt,
  buildScgPrerequisitePrompt,
  PROMPT_VERSIONS,
} from '@/core/prompts';
import { scgIdBase, scgReviewCarry } from '@/core/scg';
import {
  addDropped,
  emptyScgDropped,
  scgAlignmentCandidates,
  scgAlignmentGroups,
  scgApplyMatches,
  scgApplyPrerequisites,
  scgContributionBatches,
  scgDraftsFromOutput,
  scgHeadings,
  scgMergeDrafts,
  scgPrerequisiteContext,
  scgPrerequisiteGroups,
  scgReferenceLines,
} from '@/core/scg/pass';
import {
  ScgAlignmentOutputSchema,
  ScgContributionOutputSchema,
  ScgPaperRunSchema,
  ScgPrerequisiteOutputSchema,
  type PaperModel,
  type ScgPaperRun,
} from '@/core/schemas';
import type { ZodType } from 'zod';
import type { LlmClient } from './client';
import type { LlmConfig } from './config';
import { requirePaperConsent } from './consent';

const TIMEOUT_MS = 300000;
const VERSIONS = {
  contributions: PROMPT_VERSIONS.scgContributions,
  prerequisites: PROMPT_VERSIONS.scgPrerequisites,
  alignment: PROMPT_VERSIONS.scgAlignment,
};
export const SCG_PROMPT_VERSION = [VERSIONS.contributions, VERSIONS.prerequisites, VERSIONS.alignment].join(
  '+',
);
const isAbort = (cause: unknown) => cause instanceof DOMException && cause.name === 'AbortError';
const abortIfStopped = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
};

export type ScgRunOptions = {
  paperId: string;
  doi: string | null;
  config: LlmConfig;
  /** The stored run of this paper, resumed when it is unfinished and still matches the paper and prompts. */
  previous?: ScgPaperRun;
  /** Runs of the other lab papers, the graph that stage 3 aligns against. */
  others?: ScgPaperRun[];
  /** DOI to S2 corpus id; a failure other than abort counts as "not known". */
  lookupS2CorpusId?: (doi: string, signal?: AbortSignal) => Promise<string | null>;
  /** Called after every LLM call and stage change, with the run to store as the checkpoint. */
  onProgress?: (run: ScgPaperRun) => Promise<void>;
  signal?: AbortSignal;
  now?: () => string;
};

async function lookup(options: ScgRunOptions) {
  if (!options.doi || !options.lookupS2CorpusId) return { s2CorpusId: null, s2CheckedAt: null };
  try {
    const s2CorpusId = await options.lookupS2CorpusId(options.doi, options.signal);
    return { s2CorpusId, s2CheckedAt: options.now?.() ?? new Date().toISOString() };
  } catch (cause) {
    if (isAbort(cause)) throw cause;
    return { s2CorpusId: null, s2CheckedAt: null };
  }
}

/**
 * The SCG pass over one paper: (1) contributions by section batch, (2) prerequisites per group of
 * contributions, (3) alignment of prerequisites to the lab graph. Every item is anchored to the paper's
 * sentences and stays a candidate. The run is checkpointed after each call, so an abort or a failure
 * resumes where it stopped. At most 14 calls per paper.
 */
export async function llmScg(client: LlmClient, model: PaperModel, options: ScgRunOptions) {
  requirePaperConsent(options.config);
  const now = () => options.now?.() ?? new Date().toISOString();
  const sentences = model.sentences;
  if (!sentences.length) throw new Error('Không có câu để phân tích.');
  const fingerprint = fnv1a64(sentences.map((s) => s.key).join('\n'));
  const previous = options.previous;
  let run: ScgPaperRun;
  if (
    previous &&
    previous.status !== 'complete' &&
    previous.promptVersion === SCG_PROMPT_VERSION &&
    previous.requestedModel === options.config.model &&
    previous.progress.fingerprint === fingerprint
  ) {
    run = structuredClone(previous);
    if (!run.s2CheckedAt) Object.assign(run, await lookup(options));
  } else {
    const s2 = previous?.s2CheckedAt
      ? { s2CorpusId: previous.s2CorpusId, s2CheckedAt: previous.s2CheckedAt }
      : await lookup(options);
    run = {
      schemaVersion: 1,
      paperId: options.paperId,
      doi: options.doi,
      ...s2,
      // Fixed by the first run so contribution ids, and other papers' matches to them, never change.
      idBase: previous?.idBase ?? scgIdBase(options.paperId, s2.s2CorpusId),
      promptVersion: SCG_PROMPT_VERSION,
      promptVersions: VERSIONS,
      requestedModel: options.config.model,
      model: options.config.model,
      status: 'contributions',
      callsUsed: 0,
      dropped: emptyScgDropped(),
      contributions: [],
      progress: { fingerprint, contributionBatches: {}, prerequisitesDone: [], alignmentDone: [] },
      reviewCarry: scgReviewCarry(previous),
      createdAt: now(),
      updatedAt: now(),
    };
  }
  const save = async () => {
    run.updatedAt = now();
    run = ScgPaperRunSchema.parse(run);
    await options.onProgress?.(run);
  };
  const call = async <T>(
    prompt: { system: string; user: string },
    schema: ZodType<T>,
    schemaName: string,
    promptVersion: string,
  ) => {
    abortIfStopped(options.signal);
    const result = await client.completeJson({
      ...prompt,
      schema,
      schemaName,
      promptVersion,
      temperature: 0,
      timeoutMs: TIMEOUT_MS,
      signal: options.signal,
      onRequest: async () => {
        requirePaperConsent(options.config);
        run.callsUsed++;
        await save();
      },
    });
    run.model = result.meta.model;
    return schema.parse(result.data);
  };
  await save();
  const headings = scgHeadings(model);

  if (run.status === 'contributions') {
    const batches = scgContributionBatches(sentences);
    for (const [index, batch] of batches.entries()) {
      if (run.progress.contributionBatches[String(index)]) continue;
      const data = ScgContributionOutputSchema.parse(
        await call(
          buildScgContributionPrompt(batch, headings, { index, total: batches.length }),
          ScgContributionOutputSchema,
          'scg_contributions',
          VERSIONS.contributions,
        ),
      );
      const { drafts, dropped } = scgDraftsFromOutput(data, batch, headings);
      run.progress.contributionBatches[String(index)] = drafts;
      run.dropped = addDropped(run.dropped, dropped);
      await save();
    }
    run.contributions = scgMergeDrafts(
      batches.map((_, index) => run.progress.contributionBatches[String(index)] ?? []),
      run.idBase,
      run.reviewCarry,
    );
    run.progress.contributionBatches = {};
    run.status = run.contributions.length ? 'prerequisites' : 'complete';
    await save();
  }

  if (run.status === 'prerequisites') {
    const context = scgPrerequisiteContext(model);
    const references = scgReferenceLines(model);
    for (const group of scgPrerequisiteGroups(run.contributions)) {
      const pending = group.filter((c) => !run.progress.prerequisitesDone.includes(c.id));
      if (!pending.length) continue;
      const data = ScgPrerequisiteOutputSchema.parse(
        await call(
          buildScgPrerequisitePrompt(pending, run.contributions, context, headings, references),
          ScgPrerequisiteOutputSchema,
          'scg_prerequisites',
          VERSIONS.prerequisites,
        ),
      );
      const applied = scgApplyPrerequisites(
        run.contributions,
        new Set(pending.map((c) => c.id)),
        data,
        model,
        run.reviewCarry,
      );
      run.contributions = applied.contributions;
      run.dropped = addDropped(run.dropped, applied.dropped);
      run.progress.prerequisitesDone.push(...pending.map((c) => c.id));
      await save();
    }
    run.status = 'alignment';
    await save();
  }

  if (run.status === 'alignment') {
    const candidates = scgAlignmentCandidates(run, options.others ?? []);
    const pending = run.contributions
      .flatMap((c) => c.prerequisites)
      .filter((p) => !run.progress.alignmentDone.includes(p.id));
    // Prerequisites without a candidate need no call.
    const items = pending.flatMap((p) => {
      const offered = candidates.get(p.id) ?? [];
      return offered.length ? [{ prerequisite: p, candidates: offered }] : [];
    });
    run.progress.alignmentDone.push(...pending.filter((p) => !candidates.get(p.id)?.length).map((p) => p.id));
    for (const group of scgAlignmentGroups(items)) {
      const data = ScgAlignmentOutputSchema.parse(
        await call(
          buildScgAlignmentPrompt(group),
          ScgAlignmentOutputSchema,
          'scg_alignment',
          VERSIONS.alignment,
        ),
      );
      const offered = new Map(
        group.map((item) => [item.prerequisite.id, new Set(item.candidates.map((c) => c.id))]),
      );
      const applied = scgApplyMatches(run.contributions, offered, data);
      run.contributions = applied.contributions;
      run.dropped = addDropped(run.dropped, applied.dropped);
      run.progress.alignmentDone.push(...group.map((item) => item.prerequisite.id));
      await save();
    }
    run.status = 'complete';
    await save();
  }
  return run;
}
