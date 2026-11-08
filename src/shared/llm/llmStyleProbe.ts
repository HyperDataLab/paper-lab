import { buildSentenceAnnotations, validateSyntaxOutput } from '@/core/analysis';
import { BatchBudgetExceededError, contextFor } from '@/core/batch';
import { applyJudgement, detectCandidates } from '@/core/detectors';
import { estimateProbe, selectProbeParagraphs, summariseProbe, validateProbe } from '@/core/probe';
import {
  buildCandidateJudgePrompt,
  buildScoringPrompt,
  buildSentenceSyntaxPrompt,
  buildStyleProbePrompt,
  CandidateJudgeOutputSchema,
  PROMPT_VERSIONS,
  ScoringOutputSchema,
  SentenceSyntaxOutputSchema,
  StyleProbeOutputSchema,
} from '@/core/prompts';
import { PaperProbeRunSchema, type Analysis, type Paper, type PaperProbeRun } from '@/core/schemas';
import { assessability } from '@/core/scoring/availability';
import { computeScores } from '@/core/scoring/computeScores';
import { buildEvidencePackages } from '@/core/scoring/evidencePackage';
import { DIMENSIONS, RUBRIC_VERSION } from '@/core/scoring/rubric';
import { analyzeText } from '@/core/text/analyzeText';
import type { LlmClient } from './client';
import type { LlmConfig } from './config';
import { requirePaperConsent } from './consent';

export function createStyleProbeRun(
  paper: Paper,
  analyses: Analysis[],
  options: {
    n?: number;
    budget: number;
    model: string;
    id: string;
    now: string;
    seed?: string;
    preserveTerms?: Record<string, string[]>;
  },
): PaperProbeRun {
  const paragraphs = selectProbeParagraphs(paper, analyses, options.n, options.seed);
  const selected = paragraphs.map((p) => {
    const found = analyses
      .filter(
        (a) =>
          a.origin?.kind === 'paper' &&
          a.origin.paperId === paper.id &&
          a.origin.paragraphId === p.id &&
          a.text.sourceHash === p.textHash &&
          a.scores?.dimensions.some((d) => d.applicable && d.score !== null),
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    if (!found) throw new Error('Scored analysis not found');
    return found;
  });
  return PaperProbeRunSchema.parse({
    id: options.id,
    createdAt: options.now,
    updatedAt: options.now,
    n: paragraphs.length,
    promptVersions: {
      rewrite: PROMPT_VERSIONS.styleProbe,
      syntax: PROMPT_VERSIONS.sentenceSyntaxPaper,
      judge: PROMPT_VERSIONS.candidateJudgePaper,
      score: PROMPT_VERSIONS.scoringPaper,
      rubric: RUBRIC_VERSION,
    },
    model: options.model,
    paragraphIds: paragraphs.map((p) => p.id),
    analysisIds: selected.map((a) => a.id),
    analysisUpdatedAt: selected.map((a) => a.updatedAt),
    preserveTerms: options.preserveTerms ?? {},
    budget: options.budget,
    callsUsed: 0,
    status: 'running',
    items: [],
    summary: summariseProbe([]),
  });
}

export { estimateProbe };

export async function llmStyleProbe(
  client: LlmClient,
  paper: Paper,
  analyses: Analysis[],
  input: PaperProbeRun,
  options: {
    config: LlmConfig;
    save: (run: PaperProbeRun) => Promise<unknown>;
    now: () => string;
    signal?: AbortSignal;
  },
): Promise<PaperProbeRun> {
  const run = PaperProbeRunSchema.parse(structuredClone(input));
  if (
    run.model !== options.config.model ||
    run.paragraphIds.length !== run.analysisIds.length ||
    run.paragraphIds.length !== run.analysisUpdatedAt.length ||
    run.paragraphIds.length !== run.n ||
    new Set(run.paragraphIds).size !== run.n
  )
    throw new Error('Invalid probe plan');
  requirePaperConsent(options.config);
  const checkpoint = async () => {
    run.updatedAt = options.now();
    run.summary = summariseProbe(run.items);
    await options.save(PaperProbeRunSchema.parse(structuredClone(run)));
  };
  const aborted = () => {
    if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  };
  const onRequest = async () => {
    aborted();
    requirePaperConsent(options.config);
    if (run.callsUsed >= run.budget) throw new BatchBudgetExceededError();
    run.callsUsed++;
    await checkpoint();
  };
  run.status = 'running';
  await checkpoint();
  try {
    for (const [index, paragraphId] of run.paragraphIds.entries()) {
      if (run.items.some((item) => item.paragraphId === paragraphId)) continue;
      aborted();
      const paragraph = paper.paragraphs.find((p) => p.id === paragraphId && p.kind === 'body');
      const original = analyses.find((a) => a.id === run.analysisIds[index]);
      if (
        !paragraph ||
        !original ||
        original.origin?.kind !== 'paper' ||
        original.origin.paperId !== paper.id ||
        original.origin.paragraphId !== paragraphId ||
        original.text.sourceHash !== paragraph.textHash ||
        original.text.sourceText !== paragraph.text ||
        original.updatedAt !== run.analysisUpdatedAt[index] ||
        original.versions.scoringPrompt !== PROMPT_VERSIONS.scoringPaper ||
        original.versions.scoringModel !== run.model ||
        !original.scores
      )
        throw new Error('Probe source changed');
      const context = contextFor(paper, paragraph);
      const rewrite = await client.completeJson({
        ...buildStyleProbePrompt(paragraph.text),
        schema: StyleProbeOutputSchema,
        schemaName: 'style_probe',
        promptVersion: PROMPT_VERSIONS.styleProbe,
        temperature: 0,
        onRequest,
        signal: options.signal,
      });
      const rewrittenText = StyleProbeOutputSchema.parse(rewrite.data).rewritten;
      const validation = validateProbe(paragraph.text, rewrittenText, run.preserveTerms[paragraphId] ?? []);
      const item = {
        paragraphId,
        sectionId: paragraph.sectionId,
        textHash: paragraph.textHash,
        analysisId: original.id,
        rewrittenText,
        reasons: validation.reasons,
        original: original.scores,
        rewritten: null as Analysis['scores'],
        baseline: null as Analysis['scores'],
      };
      if (validation.valid) {
        const text = await analyzeText(rewrittenText);
        const syntax = await client.completeJson({
          ...buildSentenceSyntaxPrompt(text, text.sentences, context),
          schema: SentenceSyntaxOutputSchema,
          schemaName: 'sentence_syntax',
          promptVersion: PROMPT_VERSIONS.sentenceSyntaxPaper,
          temperature: 0,
          onRequest,
          signal: options.signal,
        });
        const annotations = buildSentenceAnnotations(text, validateSyntaxOutput(syntax.data.sentences, text));
        let issues = detectCandidates(text, annotations);
        if (original.versions.judgePrompt) {
          const judgement = await client.completeJson({
            ...buildCandidateJudgePrompt(text, annotations, issues, original.context, true, context),
            schema: CandidateJudgeOutputSchema,
            schemaName: 'candidate_judgement',
            promptVersion: PROMPT_VERSIONS.candidateJudgePaper,
            temperature: 0,
            onRequest,
            signal: options.signal,
          });
          issues = applyJudgement(issues, judgement.data, text, annotations);
        }
        const revised: Analysis = {
          ...original,
          text,
          sentenceAnnotations: annotations,
          issues,
          paragraph: null,
          paragraphMetrics: null,
          flowLinks: [],
          scores: null,
        };
        const score = async (analysis: Analysis) => {
          const availability = assessability(analysis);
          const response = await client.completeJson({
            ...buildScoringPrompt(
              analysis.text,
              buildEvidencePackages(analysis, availability),
              DIMENSIONS.filter((dimension) => availability[dimension.id].applicable),
              analysis.context,
              context,
            ),
            schema: ScoringOutputSchema,
            schemaName: 'scoring',
            promptVersion: PROMPT_VERSIONS.scoringPaper,
            temperature: 0,
            onRequest,
            signal: options.signal,
          });
          return computeScores(response.data, availability, analysis.issues, {
            sentenceIds: analysis.text.sentences.map((s) => s.id),
            contextLimited: analysis.contextLimited,
          });
        };
        item.rewritten = await score(revised);
        item.baseline = await score(original);
      }
      run.items.push(item);
      await checkpoint();
    }
    run.status = 'done';
  } catch (error) {
    run.status =
      options.signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')
        ? 'cancelled'
        : error instanceof BatchBudgetExceededError
          ? 'budget_exceeded'
          : 'failed';
    await checkpoint();
    if (run.status === 'failed') throw error;
    return run;
  }
  await checkpoint();
  return run;
}
