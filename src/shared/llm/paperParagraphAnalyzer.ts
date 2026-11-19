import { buildSentenceAnnotations, validateSyntaxOutput } from '@/core/analysis';
import { applyJudgement, detectCandidates, DETECTOR_VERSION, mergeHumanDecisions } from '@/core/detectors';
import { paragraphIssues } from '@/core/paragraph/issues';
import { computeParagraphMetrics } from '@/core/paragraph/metrics';
import { validateParagraphStructure } from '@/core/paragraph/validateParagraphStructure';
import {
  buildCandidateJudgePrompt,
  buildParagraphStructurePrompt,
  buildScoringPrompt,
  buildSyntaxBatchPrompt,
  CandidateJudgeOutputSchema,
  ParagraphStructureOutputSchema,
  PROMPT_VERSIONS,
  ScoringOutputSchema,
  SentenceSyntaxOutputSchema,
  splitSyntaxBatch,
  SYNTAX_BATCH_SENTENCES,
  type RawSentenceSyntax,
  type SyntaxBatchPart,
  type PaperContext,
} from '@/core/prompts';
import type { Analysis, BatchStep, Paper, PaperParagraph, PaperRun } from '@/core/schemas';
import { assessability } from '@/core/scoring/availability';
import { computeScores } from '@/core/scoring/computeScores';
import { buildEvidencePackages } from '@/core/scoring/evidencePackage';
import { DIMENSIONS, RUBRIC_VERSION } from '@/core/scoring/rubric';
import { analyzeText } from '@/core/text/analyzeText';
import type { Repositories } from '@/shared/storage/types';
import type { LlmClient } from './client';
import { contextFor } from '@/core/batch';

export const PAPER_PROMPT_VERSIONS = {
  syntax: PROMPT_VERSIONS.sentenceSyntaxPaperBatch,
  judge: PROMPT_VERSIONS.candidateJudgePaper,
  structure: PROMPT_VERSIONS.paragraphStructurePaper,
  score: PROMPT_VERSIONS.scoringPaper,
  transitions: PROMPT_VERSIONS.paragraphTransition,
};

/** A request of 40 sentences takes much longer than the default wait. */
const SYNTAX_BATCH_TIMEOUT_MS = 180000;

function refreshedCandidates(analysis: Analysis, annotations: Analysis['sentenceAnnotations']) {
  const detected = detectCandidates(analysis.text, annotations);
  const ids = new Set(detected.map((issue) => issue.id));
  const retained = analysis.issues.filter(
    (issue) =>
      issue.category === 'flow' ||
      issue.category === 'organization' ||
      (!ids.has(issue.id) &&
        (issue.status === 'confirmed_by_human' || issue.status === 'dismissed_by_human')),
  );
  return mergeHumanDecisions(
    [...detected, ...retained.filter((issue) => !ids.has(issue.id))],
    analysis.issues,
  );
}

export function createPaperParagraphAnalyzer(client: LlmClient, repositories: Repositories, paper: Paper) {
  async function findCached(paragraph: PaperParagraph, run: PaperRun): Promise<string | null> {
    const analyses = await repositories.analyses.listByPaper(paper.id);
    const found = analyses.find((analysis) => {
      if (
        analysis.origin?.kind !== 'paper' ||
        analysis.origin.paragraphId !== paragraph.id ||
        analysis.text.sourceHash !== paragraph.textHash
      )
        return false;
      const versions = {
        syntax: analysis.versions.syntaxProvider,
        judge: analysis.versions.judgePrompt,
        structure: analysis.versions.structurePrompt,
        score: analysis.versions.scoringPrompt,
      };
      const key = JSON.stringify([contextFor(paper, paragraph), run.model]);
      return run.plan.steps
        .filter((step) => step !== 'transitions')
        .every(
          (step) =>
            versions[step] === run.promptVersions[step] && analysis.versions.paperStepKeys[step] === key,
        );
    });
    return found?.id ?? null;
  }
  async function analyzeSyntaxBatch(
    members: { paragraph: PaperParagraph; context: PaperContext; analysisId: string }[],
    onRequest?: () => Promise<void>,
  ): Promise<string[]> {
    const loaded = await Promise.all(
      members.map(async (member) => {
        const analysis = await repositories.analyses.get(member.analysisId);
        if (!analysis) throw new Error('Analysis not found');
        return { ...member, analysis };
      }),
    );
    const [first] = loaded;
    if (!first) return [];
    const requests: SyntaxBatchPart[][] = [];
    if (loaded.length > 1) requests.push(loaded.map(({ analysis }) => ({ text: analysis.text })));
    else {
      const { text } = first.analysis;
      let start = 0;
      do {
        requests.push([{ text, sentences: text.sentences.slice(start, start + SYNTAX_BATCH_SENTENCES) }]);
        start += SYNTAX_BATCH_SENTENCES;
      } while (start < text.sentences.length);
    }
    const raw = loaded.map((): RawSentenceSyntax[] => []);
    let model = '';
    for (const parts of requests) {
      const result = await client.completeJson({
        ...buildSyntaxBatchPrompt(parts, first.context),
        schema: SentenceSyntaxOutputSchema,
        schemaName: 'sentence_syntax',
        promptVersion: PAPER_PROMPT_VERSIONS.syntax,
        temperature: 0,
        timeoutMs: SYNTAX_BATCH_TIMEOUT_MS,
        onRequest,
      });
      model = result.meta.model;
      splitSyntaxBatch(result.data.sentences, parts).forEach((entries, position) =>
        raw[position]?.push(...entries),
      );
    }
    const completed: string[] = [];
    for (const [position, { analysis, context, paragraph }] of loaded.entries()) {
      // In a shared request, a paragraph the model skipped is left for its own request.
      const entries = raw[position] ?? [];
      if (loaded.length > 1 && entries.length === 0) continue;
      const sentenceAnnotations = buildSentenceAnnotations(
        analysis.text,
        validateSyntaxOutput(entries, analysis.text),
      );
      await repositories.analyses.update(analysis.id, {
        sentenceAnnotations,
        issues: refreshedCandidates(analysis, sentenceAnnotations),
        scores: analysis.scores,
        versions: {
          ...analysis.versions,
          syntaxProvider: PAPER_PROMPT_VERSIONS.syntax,
          model,
          paperStepKeys: { ...analysis.versions.paperStepKeys, syntax: JSON.stringify([context, model]) },
        },
      });
      completed.push(paragraph.id);
    }
    return completed;
  }
  async function analyze(
    paragraph: PaperParagraph,
    context: PaperContext,
    step: BatchStep | 'detectors',
    analysisId: string | null,
    onRequest?: () => Promise<void>,
  ): Promise<string> {
    let current = analysisId ? await repositories.analyses.get(analysisId) : undefined;
    if (!current) {
      const text = await analyzeText(paragraph.text);
      const existing = (await repositories.analyses.listByPaper(paper.id)).find(
        (a) =>
          a.origin?.kind === 'paper' &&
          a.origin.paragraphId === paragraph.id &&
          a.text.sourceHash === text.sourceHash,
      );
      current =
        existing ??
        (await repositories.analyses.create({
          text,
          title: `${context.heading} · ${paragraph.id}`,
          origin: { kind: 'paper', paperId: paper.id, paragraphId: paragraph.id },
          context: { before: context.previousLast, after: context.nextFirst, audience: null },
          contextLimited: !context.previousLast || !context.nextFirst,
        }));
    }
    const analysis: Analysis = current;
    const versions = { ...analysis.versions };
    const stepVersions = (model: string) => ({
      ...versions.paperStepKeys,
      [step]: JSON.stringify([context, model]),
    });
    if (step === 'detectors') {
      await repositories.analyses.update(analysis.id, {
        title: `${context.heading} · ${paragraph.id}`,
        context: { before: context.previousLast, after: context.nextFirst, audience: null },
        contextLimited: !context.previousLast || !context.nextFirst,
        issues: refreshedCandidates(analysis, analysis.sentenceAnnotations),
        versions: { ...versions, detectors: DETECTOR_VERSION },
      });
    } else if (step === 'syntax') {
      await analyzeSyntaxBatch([{ paragraph, context, analysisId: analysis.id }], onRequest);
    } else if (step === 'judge') {
      const result = await client.completeJson({
        ...buildCandidateJudgePrompt(
          analysis.text,
          analysis.sentenceAnnotations,
          analysis.issues,
          analysis.context,
          true,
          context,
        ),
        schema: CandidateJudgeOutputSchema,
        schemaName: 'candidate_judgement',
        promptVersion: PAPER_PROMPT_VERSIONS.judge,
        temperature: 0,
        onRequest,
      });
      await repositories.analyses.update(analysis.id, {
        issues: mergeHumanDecisions(
          applyJudgement(analysis.issues, result.data, analysis.text, analysis.sentenceAnnotations),
          analysis.issues,
        ),
        versions: {
          ...versions,
          judgePrompt: PAPER_PROMPT_VERSIONS.judge,
          model: result.meta.model,
          paperStepKeys: stepVersions(result.meta.model),
        },
      });
    } else if (step === 'structure') {
      const result = await client.completeJson({
        ...buildParagraphStructurePrompt(
          analysis.text,
          analysis.sentenceAnnotations,
          analysis.context,
          context,
        ),
        schema: ParagraphStructureOutputSchema,
        schemaName: 'paragraph_structure',
        promptVersion: PAPER_PROMPT_VERSIONS.structure,
        temperature: 0,
        onRequest,
      });
      const structure = validateParagraphStructure(result.data, analysis.text, analysis.sentenceAnnotations);
      const sentenceAnnotations = analysis.sentenceAnnotations.map((annotation) => {
        const role = structure.roles.find((item) => item.sentenceId === annotation.sentenceId);
        return {
          ...annotation,
          role: role?.role ?? null,
          roleConfidence: role?.confidence ?? null,
          roleRationale: role?.rationale ?? null,
        };
      });
      const issues = paragraphIssues(
        structure.paragraph,
        structure.flowLinks,
        analysis.text,
        structure.roles,
      );
      await repositories.analyses.update(analysis.id, {
        paragraph: structure.paragraph,
        flowLinks: structure.flowLinks,
        paragraphMetrics: computeParagraphMetrics(structure.paragraph, structure.roles, structure.flowLinks),
        sentenceAnnotations,
        issues: mergeHumanDecisions(
          [
            ...analysis.issues.filter(
              (issue) => issue.category !== 'flow' && issue.category !== 'organization',
            ),
            ...issues,
          ],
          analysis.issues,
        ),
        versions: {
          ...versions,
          structurePrompt: PAPER_PROMPT_VERSIONS.structure,
          structureModel: result.meta.model,
          paperStepKeys: stepVersions(result.meta.model),
        },
      });
    } else {
      const availability = assessability(analysis);
      const result = await client.completeJson({
        ...buildScoringPrompt(
          analysis.text,
          buildEvidencePackages(analysis, availability),
          DIMENSIONS.filter((item) => availability[item.id].applicable),
          analysis.context,
          context,
        ),
        schema: ScoringOutputSchema,
        schemaName: 'scoring',
        promptVersion: PAPER_PROMPT_VERSIONS.score,
        temperature: 0,
        onRequest,
      });
      const scores = computeScores(result.data, availability, analysis.issues, {
        sentenceIds: analysis.text.sentences.map((s) => s.id),
        contextLimited: analysis.contextLimited,
      });
      await repositories.analyses.update(analysis.id, {
        scores,
        versions: {
          ...versions,
          rubric: RUBRIC_VERSION,
          scoringPrompt: PAPER_PROMPT_VERSIONS.score,
          scoringModel: result.meta.model,
          paperStepKeys: stepVersions(result.meta.model),
        },
      });
    }
    return analysis.id;
  }
  return { analyze, analyzeSyntaxBatch, findCached };
}
